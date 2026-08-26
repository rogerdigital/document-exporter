# Issue #76 Pipeline Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PDF attachment embeds and immediately following Markdown blocks render correctly across every `expandEmbeds` and `copyAttachments` combination.

**Architecture:** Restore same-source context that `EmbedExpander` unnecessarily split around preserved attachment embeds, while retaining marked note-transclusion seams. Separately, collect attachment metadata whenever PDF rendering needs it and gate physical asset copying on the copy setting.

**Tech Stack:** TypeScript, Vitest, Obsidian `MarkdownRenderer`, Electron PDF printing, pnpm, esbuild.

---

## File Map

- Modify `src/export/EmbedExpander.ts`: coalesce adjacent same-source fragments when their shared seam has no declared block boundary.
- Modify `src/export/EmbedExpander.test.ts`: prove preserved attachment context is restored without crossing note-transclusion seams.
- Modify `src/export/ExportRunner.ts`: collect PDF attachment metadata independently of physical asset copying.
- Modify `src/export/ExportRunner.test.ts`: exercise the exact issue through the full four-setting export matrix and align legacy copy tests with the copy setting.
- Verify generated `main.js`: load the production build in desktop Obsidian through the existing test-vault symlink.

### Task 0: Verify the isolated baseline

**Files:**
- Verify: `package.json`
- Verify: `package-lock.json`

- [ ] **Step 1: Install the locked dependencies in the worktree**

```bash
npm ci
```

Expected: npm installs the locked dependency graph without changing `package-lock.json`.

- [ ] **Step 2: Run the complete baseline suite**

```bash
pnpm exec vitest run
```

Expected: all 352 existing tests pass before any production-code change.

- [ ] **Step 3: Confirm the baseline is clean**

```bash
git status --short
```

Expected: only the approved specification clarification and this plan are modified or untracked; no dependency or source files changed.

### Task 1: Restore preserved attachment context

**Files:**
- Modify: `src/export/EmbedExpander.test.ts`
- Modify: `src/export/EmbedExpander.ts:23-35,140-154`

- [ ] **Step 1: Add the failing same-source attachment tests**

Add these tests after `leaves non-markdown embeds untouched`:

```ts
it("keeps a preserved attachment with its following heading in one fragment", async () => {
	const source = "![[image.png]]\n## Title";
	const app = makeApp({ "main.md": source, "image.png": "" });

	const result = await new EmbedExpander(app).expand(source, "main.md");

	expect(result.fragments).toEqual([{
		markdown: source,
		sourcePath: "main.md",
	}]);
});

it.each([
	"Text ![[image.png]] after",
	"- ![[image.png]]",
	"> ![[image.png]]",
])("keeps preserved attachment context byte-for-byte for %s", async (source) => {
	const app = makeApp({ "main.md": source, "image.png": "" });
	const result = await new EmbedExpander(app).expand(source, "main.md");

	expect(result.fragments).toEqual([{
		markdown: source,
		sourcePath: "main.md",
	}]);
});
```

The existing `expands a file-level wiki embed and returns host + embedded fragments` test remains the regression proving host/transclusion seams are not merged.

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
pnpm exec vitest run src/export/EmbedExpander.test.ts
```

Expected: the new expectations fail because the current result contains separate attachment and surrounding-text fragments. Existing note-transclusion tests remain green.

- [ ] **Step 3: Implement seam-aware coalescing**

Change `expand()` to restore protected code first and then coalesce:

```ts
const restored = fragments.map((f) => ({
	...f,
	markdown: restoreCodeBlocks(f.markdown, blocks),
}));
return {
	fragments: coalesceAdjacentFragments(restored),
	warnings,
	embeddedPaths: [...this.embeddedPaths],
};
```

Add this helper below `markBlockBoundaries`:

```ts
function coalesceAdjacentFragments(
	fragments: DocumentFragment[],
): DocumentFragment[] {
	const result: DocumentFragment[] = [];

	for (const fragment of fragments) {
		const previous = result.at(-1);
		if (
			previous
			&& previous.sourcePath === fragment.sourcePath
			&& !previous.blockBoundaryAfter
			&& !fragment.blockBoundaryBefore
		) {
			previous.markdown += fragment.markdown;
			if (fragment.blockBoundaryAfter) previous.blockBoundaryAfter = true;
			continue;
		}

		result.push({ ...fragment });
	}

	return result;
}
```

This preserves `blockBoundaryBefore` on the first merged fragment and propagates `blockBoundaryAfter` from the last merged fragment.

- [ ] **Step 4: Run focused fragment and joining tests**

Run:

```bash
pnpm exec vitest run src/export/EmbedExpander.test.ts src/export/FragmentJoiner.test.ts src/export/DocumentAssembler.test.ts
```

Expected: all focused tests pass, including nested transclusion and source-path boundary cases.

- [ ] **Step 5: Commit the fragment fix**

```bash
git add src/export/EmbedExpander.ts src/export/EmbedExpander.test.ts
git commit -m "fix: preserve attachment embed fragment context"
```

### Task 2: Exercise the real PDF pipeline across the settings matrix

**Files:**
- Modify: `src/export/ExportRunner.test.ts:1-9,101-105,107-654`

- [ ] **Step 1: Make the PDF renderer mock observable and deterministic**

Replace the current PDF mock and test lifecycle setup with:

```ts
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const { renderPdfMock } = vi.hoisted(() => ({
	renderPdfMock: vi.fn(),
}));

vi.mock("@/formats/pdf", () => ({
	renderPdf: renderPdfMock,
}));

beforeEach(() => {
	renderPdfMock.mockRejectedValue(
		new Error("PDF generation failed: test failure"),
	);
});

afterEach(() => {
	renderPdfMock.mockReset();
	vi.restoreAllMocks();
	Platform.isDesktopApp = true;
	Platform.isDesktop = true;
});
```

This preserves the existing PDF-failure test while allowing the new pipeline test to inspect the assembled document.

- [ ] **Step 2: Add the failing four-setting matrix test**

Under `describe("embed expansion", ...)`, add:

```ts
it.each([
	{ expandEmbeds: true, copyAttachments: true },
	{ expandEmbeds: true, copyAttachments: false },
	{ expandEmbeds: false, copyAttachments: true },
	{ expandEmbeds: false, copyAttachments: false },
])("keeps PDF attachment and heading structure for $expandEmbeds/$copyAttachments", async (settings) => {
	const source = "![[image.png]]\n## Title";
	const attachment = {
		sourcePath: "assets/image.png",
		outputRelativePath: "assets/image.png",
	};
	const app = createExpandApp({
		"main.md": source,
		"assets/image.png": "",
	}, { "image.png": "assets/image.png" });
	const collectSpy = vi.spyOn(AttachmentCollector.prototype, "collect")
		.mockResolvedValue({ attachments: [attachment], warnings: [] });
	const copySpy = vi.spyOn(OutputWriter.prototype, "copyBinaryFile")
		.mockResolvedValue(undefined);
	renderPdfMock.mockResolvedValue([]);

	const result = await new ExportRunner(app as never).run(
		makePdfPlan(["main.md"]),
		{ ...defaultSettings(), ...settings },
	);

	expect(result.success).toBe(true);
	expect(collectSpy).toHaveBeenCalledOnce();
	const renderedDoc = renderPdfMock.mock.calls[0][0];
	expect(renderedDoc.sections[0].markdown).toBe(
		'<img src="assets/image.png" alt="image.png" />\n\n## Title',
	);
	expect(renderedDoc.attachments).toEqual([attachment]);
	expect(result.warnings).not.toContain("Unresolved embed: image.png");
	if (settings.copyAttachments) {
		expect(copySpy).toHaveBeenCalledWith(
			"assets/image.png",
			"exports/assets/image.png",
		);
	} else {
		expect(copySpy).not.toHaveBeenCalled();
	}
});
```

- [ ] **Step 3: Run the matrix test and verify both red causes**

Run:

```bash
pnpm exec vitest run src/export/ExportRunner.test.ts
```

Expected failures before production changes:

- `expandEmbeds=true, copyAttachments=true` reaches `renderPdf` with a single newline before `## Title`;
- both `copyAttachments=false` cases never invoke the collector and retain the unresolved/raw attachment path.

The `expandEmbeds=false, copyAttachments=true` case is expected to pass and acts as the control.

### Task 3: Separate PDF discovery from physical copying

**Files:**
- Modify: `src/export/ExportRunner.ts:105-113,218-235`
- Modify: `src/export/ExportRunner.test.ts`

- [ ] **Step 1: Collect metadata whenever PDF rendering requires it**

Replace the collector condition with:

```ts
const needsAttachmentMetadata = settings.copyAttachments
	|| effectivePlan.profile === "pdf";
const collector = needsAttachmentMetadata
	? new AttachmentCollector(this.app, exportedPaths)
	: null;
```

- [ ] **Step 2: Gate physical copies on the copy setting**

Change the copy condition to:

```ts
if (
	settings.copyAttachments
	&& effectivePlan.profile !== "epub"
	&& doc.attachments.length > 0
) {
```

- [ ] **Step 3: Align legacy direct-plan copy tests with public setting semantics**

The existing tests that inject nonempty `plan.attachmentCopies` and expect `copyBinaryFile` must call `runner.run` with `copyAttachments: true`. Update these cases without changing their destination, cancellation, collision, or warning assertions:

- `stops before the next attachment after cancellation`;
- `attachment destination > copies attachments into the target folder's assets`;
- `output collisions > relocates attachments and warning reports with the output root`.

Use this settings argument in each case:

```ts
{ ...defaultSettings(), copyAttachments: true }
```

Because production `ExportPlan` objects start with an empty `attachmentCopies` array, these tests use the array only as fixture data. Mock the collector in each case so it returns that fixture through the real copy-enabled path:

```ts
vi.spyOn(AttachmentCollector.prototype, "collect").mockResolvedValue({
	attachments: plan.attachmentCopies,
	warnings: [],
});
```

- [ ] **Step 4: Run the full ExportRunner test file**

Run:

```bash
pnpm exec vitest run src/export/ExportRunner.test.ts
```

Expected: the four-setting matrix and all existing runner tests pass. The false-setting matrix cases collect metadata but perform zero physical copies.

- [ ] **Step 5: Run all export and format tests**

Run:

```bash
pnpm exec vitest run src/export src/formats
```

Expected: all tests pass; `LinkRewriter`, native URL restoration, PDF rendering, and other profiles remain green.

- [ ] **Step 6: Commit the PDF pipeline fix**

```bash
git add src/export/ExportRunner.ts src/export/ExportRunner.test.ts
git commit -m "fix: retain PDF attachment metadata without copying"
```

### Task 4: Complete static and artifact verification

**Files:**
- Verify: all changed source and tests
- Generate locally: ignored `main.js`

- [ ] **Step 1: Run the complete test suite**

```bash
pnpm exec vitest run
```

Expected: all test files and tests pass with zero failures.

- [ ] **Step 2: Run lint and production build**

```bash
npm run lint:obsidian-warnings
npm run build
```

Expected: ESLint reports no errors; TypeScript checking and esbuild production bundling succeed.

- [ ] **Step 3: Inspect diff integrity and scope**

```bash
git diff --check
git status --short --branch
git diff main...HEAD -- src/export/EmbedExpander.ts src/export/ExportRunner.ts
```

Expected: no whitespace errors; tracked production changes remain limited to fragment coalescing and PDF attachment collection/copy gating.

- [ ] **Step 4: Commit the clarified specification and implementation plan**

```bash
git add docs/superpowers/specs/2026-08-26-issue-76-pipeline-fix-design.md docs/superpowers/plans/2026-08-26-issue-76-pipeline-fix.md
git commit -m "docs: plan issue 76 pipeline verification"
```

### Task 5: Verify the release-equivalent bundle in desktop Obsidian

**Files:**
- Runtime fixture: `/Users/Roger/my-vault/_document-exporter-tests/issue-76-pdf-boundary.md`
- Runtime outputs: `/Users/Roger/my-vault/_document-exporter-tests/issue-76-results/`

- [ ] **Step 1: Preserve the currently installed bundle and load the worktree build**

The vault plugin directory points to the primary checkout, not this worktree. Copy the primary bundle to a temporary backup, then copy the worktree production build into the symlink target:

```bash
cp /Users/Roger/Code/personal/document-exporter/main.js /private/tmp/document-exporter-main-before-issue-76.js
cp /Users/Roger/Code/personal/document-exporter/.worktrees/fix-issue-76-pdf-embed-boundaries/main.js /Users/Roger/Code/personal/document-exporter/main.js
```

Reload the `document-exporter` plugin in Obsidian before exporting.

- [ ] **Step 2: Export the exact four-setting matrix**

Use the existing fixture:

```markdown
![[retention-cohort-q2.png]]
## Issue 76 heading

Body after heading.
```

Export into four distinct output folders so the copy-off cases can be inspected independently:

- `issue-76-results/expand-on-copy-on/issue-76.pdf`;
- `issue-76-results/expand-on-copy-off/issue-76.pdf`;
- `issue-76-results/expand-off-copy-on/issue-76.pdf`;
- `issue-76-results/expand-off-copy-off/issue-76.pdf`.

For each run, change only the two tested runtime settings and restore the user's persisted settings afterward.

- [ ] **Step 3: Render every PDF page to PNG and inspect it**

Run `pdftoppm` for each output:

```bash
/Users/Roger/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm -png -f 1 -singlefile -r 144 INPUT.pdf OUTPUT_PREFIX
```

Expected for all four PNGs:

- the chart image is visible rather than a broken-image icon;
- `Issue 76 heading` uses H2 styling and does not display literal `##`;
- body text remains a separate paragraph;
- no extra blank paragraph or reordered content is visible.

For both copy-off runs, confirm their dedicated output folders contain no `assets/` directory. For both copy-on runs, confirm the expected attachment exists in their dedicated `assets/` directory.

- [ ] **Step 4: Restore the primary-checkout bundle and reload the plugin**

```bash
cp /private/tmp/document-exporter-main-before-issue-76.js /Users/Roger/Code/personal/document-exporter/main.js
```

Verify its SHA-256 matches the pre-test backup and reload the plugin, leaving the user's primary checkout and runtime installation unchanged.

- [ ] **Step 5: Record final verification evidence**

Report the exact automated test count, lint/build result, commit list, four PDF filenames, visual result for each matrix cell, and any remaining risk. Do not reply to or close issue #76 until the user explicitly approves the external response.
