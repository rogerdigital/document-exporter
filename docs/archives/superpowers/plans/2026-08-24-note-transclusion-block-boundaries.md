# Note Transclusion Block Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make every successfully expanded Markdown note transclusion an
independent block without changing attachment embeds, fallback embeds, source-
relative link rewriting, or disabled-expansion output.

**Architecture:** Add explicit block-boundary metadata to source-aware document
fragments. Mark only the outer edges of successfully expanded Markdown notes,
including nested expansions. Join fragments through one shared helper before
assembly output and again after per-fragment link rewriting, inserting only the
missing blank-line separator at marked seams.

**Tech Stack:** TypeScript, Vitest, Obsidian vault and metadata-cache APIs,
existing `DocumentAssembler` / `LinkRewriter` / `ExportRunner` pipeline.

---

## File Map

- Modify `src/types.ts`: define the shared `DocumentFragment` type and its
  optional transclusion-boundary flags.
- Create `src/export/FragmentJoiner.ts`: concatenate fragments while enforcing
  marked Markdown block boundaries.
- Create `src/export/FragmentJoiner.test.ts`: prove spacing, line-ending,
  indentation, nesting, and exact-concatenation behavior.
- Modify `src/export/EmbedExpander.ts`: mark the first and last fragments of
  successful Markdown note expansions.
- Modify `src/export/EmbedExpander.test.ts`: prove successful, nested, repeated,
  attachment, and fallback metadata behavior.
- Modify `src/export/DocumentAssembler.ts`: preserve metadata during heading
  normalization and use the shared joiner.
- Modify `src/export/DocumentAssembler.test.ts`: prove block-safe assembly and
  unchanged disabled behavior.
- Modify `src/export/ExportRunner.ts`: preserve metadata across per-fragment
  link rewriting and use the shared joiner for the final section Markdown.
- Modify `src/export/ExportRunner.test.ts`: prove final exported Markdown keeps
  both boundaries and source-relative links.

## Scope Guardrails

- Do not modify attachment embed classification or rendering.
- Do not change warnings, maximum expansion depth, cycle detection, subpath
  resolution, frontmatter stripping, or heading normalization.
- Do not add a Markdown parser or a format-specific workaround.
- Do not change renderers unless a failing integration test proves the shared
  assembled Markdown is insufficient.

### Task 1: Specify and implement boundary-aware fragment joining

**Files:**

- Create: `src/export/FragmentJoiner.test.ts`
- Create: `src/export/FragmentJoiner.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing exact-concatenation and inline-boundary tests**

Create `FragmentJoiner.test.ts` with a small fragment factory and start with
these expectations:

```ts
import { describe, expect, it } from "vitest";
import { joinMarkdownFragments } from "@/export/FragmentJoiner";
import type { DocumentFragment } from "@/types";

const fragment = (
	markdown: string,
	overrides: Partial<DocumentFragment> = {},
): DocumentFragment => ({
	markdown,
	sourcePath: "host.md",
	...overrides,
});

it("concatenates unmarked fragments exactly", () => {
	expect(joinMarkdownFragments([
		fragment("Before "),
		fragment("middle"),
		fragment(" after"),
	])).toBe("Before middle after");
});

it("turns an inline note transclusion into an independent block", () => {
	expect(joinMarkdownFragments([
		fragment("Before "),
		fragment("## Embedded", {
			sourcePath: "note.md",
			blockBoundaryBefore: true,
			blockBoundaryAfter: true,
		}),
		fragment(" after"),
	])).toBe("Before\n\n## Embedded\n\nafter");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/export/FragmentJoiner.test.ts
```

Expected: FAIL because `FragmentJoiner` and `DocumentFragment` do not yet
exist. No existing test should be changed to obtain this failure.

- [ ] **Step 3: Add the shared fragment type**

In `src/types.ts`, add:

```ts
export type DocumentFragment = {
	markdown: string;
	sourcePath: string;
	blockBoundaryBefore?: boolean;
	blockBoundaryAfter?: boolean;
};
```

Change `DocumentSection.fragments` from its inline object type to
`DocumentFragment[]`. Keep the property optional.

- [ ] **Step 4: Implement the smallest passing joiner**

Create `FragmentJoiner.ts` with:

```ts
import type { DocumentFragment } from "@/types";

export function joinMarkdownFragments(
	fragments: DocumentFragment[],
): string {
	// Concatenate exactly unless a neighboring fragment marks a block seam.
}
```

At every seam:

- treat `left.blockBoundaryAfter || right.blockBoundaryBefore` as a required
  block boundary;
- when `right.blockBoundaryBefore` is set, remove only trailing horizontal
  whitespace from the accumulated host content;
- when `left.blockBoundaryAfter` is set, remove only leading horizontal
  whitespace from the next host fragment;
- count existing line breaks across both sides of the seam, allowing horizontal
  whitespace on an existing blank line;
- append zero, one, or two line endings so the seam has at least one blank line;
- choose the nearest existing `\r\n` style when present, otherwise `\n`;
- carry a marked boundary across empty fragments until the nearest nonempty
  content on each side can be joined;
- never add outer whitespace when no nonempty content exists on one side of the
  whole fragment sequence.

Do not trim embedded Markdown or normalize unrelated line endings.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run src/export/FragmentJoiner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add edge-case tests one behavior at a time**

Add tests for:

- one existing LF newline is upgraded to `\n\n`;
- two or more existing LF newlines are preserved exactly;
- CRLF uses `\r\n\r\n` and existing CRLF blank lines are not duplicated;
- a whitespace-only blank line counts as an existing boundary;
- an embedded fragment at document start or end gains no outer whitespace;
- embedded indentation such as `    code` is preserved;
- adjacent/repeated transclusions separated by a host space produce one blank
  boundary, not two blank blocks;
- an empty boundary-marked expansion separates surrounding host text once;
- nested/overlapping boolean flags are idempotent.

Run the focused test after each small cluster. Keep unmarked-fragment exactness
as the regression guard.

- [ ] **Step 7: Commit the joiner**

```bash
git add src/types.ts src/export/FragmentJoiner.ts src/export/FragmentJoiner.test.ts
git commit -m "feat: join transclusion fragments as blocks"
```

### Task 2: Mark successful note transclusion edges

**Files:**

- Modify: `src/export/EmbedExpander.ts`
- Modify: `src/export/EmbedExpander.test.ts`

- [ ] **Step 1: Write failing fragment-metadata tests**

Extend the existing full-note test to assert that only the embedded fragment is
marked:

```ts
expect(result.fragments).toMatchObject([
	{ sourcePath: "main.md" },
	{
		sourcePath: "chapter.md",
		blockBoundaryBefore: true,
		blockBoundaryAfter: true,
	},
	{ sourcePath: "main.md" },
]);
```

Assert explicitly that the host fragments do not own either flag. Add the same
edge assertion for a heading-scoped embed.

- [ ] **Step 2: Add failing nested and fallback tests**

For the recursive `a -> b -> c` fixture, assert:

- the first outer fragment starts a transclusion;
- the last outer fragment ends it;
- the `c` fragment retains both of its inner-boundary flags.

For attachment, unresolved, missing-heading, and block-reference fallbacks at
the requested transclusion level, assert that returned fallback fragments have
neither boundary flag. For circular and depth-limit fallbacks reached inside a
successfully expanded outer note, assert that the fallback does not create an
inner boundary while the first and last fragments still carry the successful
outer note's boundary. Use surrounding outer-note text when needed to make the
two boundary levels distinguishable.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/export/EmbedExpander.test.ts
```

Expected: the new metadata assertions fail because current fragments contain
only `markdown` and `sourcePath`.

- [ ] **Step 4: Mark only successful Markdown note expansions**

Replace the local fragment interface with the shared `DocumentFragment` type.
After a Markdown target has been read, subpath-resolved, recursively expanded,
and code blocks restored:

- clone the first returned fragment with `blockBoundaryBefore: true`;
- clone the last returned fragment with `blockBoundaryAfter: true`;
- preserve any inner flags already present;
- handle a one-fragment and empty-content result without losing either flag.

Keep `keep()` unchanged so every fallback returns unmarked original syntax.
Do not infer success from `sourcePath`; mark the result only on the resolved
Markdown success path.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run src/export/EmbedExpander.test.ts
```

Expected: PASS, including all pre-existing warning and recursion tests.

- [ ] **Step 6: Commit expansion metadata**

```bash
git add src/export/EmbedExpander.ts src/export/EmbedExpander.test.ts
git commit -m "feat: mark note transclusion boundaries"
```

### Task 3: Use the shared joiner during document assembly

**Files:**

- Modify: `src/export/DocumentAssembler.ts`
- Modify: `src/export/DocumentAssembler.test.ts`

- [ ] **Step 1: Write failing assembly tests for approved behavior**

Add an integration test using:

```markdown
Before ![[part]] after
```

with `part.md` containing a heading, list, or fenced block. Expect assembled
Markdown to be:

```markdown
Before

## Part

after
```

Also assert that the embedded fragment still carries its `sourcePath` and both
boundary flags after heading normalization.

- [ ] **Step 2: Add non-regression assembly cases**

Keep the existing blank-line fixture and assert its output remains exactly:

```markdown
Intro

Part body

End
```

Add or retain an expansion-disabled test proving the source embed and its
spacing are byte-for-byte unchanged.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/export/DocumentAssembler.test.ts
```

Expected: the inline assembly test fails because `DocumentAssembler` still
uses `join("")`.

- [ ] **Step 4: Replace exact joining only at the shared assembly seam**

Import `DocumentFragment` and `joinMarkdownFragments`. Type the initial host
fragment array as `DocumentFragment[]`, preserve flags through the existing
`normalizeHeadings` spread, and replace:

```ts
normalized.map((fragment) => fragment.markdown).join("")
```

with:

```ts
joinMarkdownFragments(normalized)
```

Do not change title extraction, source comments, frontmatter, or normalization.

- [ ] **Step 5: Run focused assembly and expander tests**

Run:

```bash
pnpm exec vitest run src/export/FragmentJoiner.test.ts src/export/EmbedExpander.test.ts src/export/DocumentAssembler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit assembly integration**

```bash
git add src/export/DocumentAssembler.ts src/export/DocumentAssembler.test.ts
git commit -m "fix: preserve transclusion blocks during assembly"
```

### Task 4: Preserve boundaries after source-aware link rewriting

**Files:**

- Modify: `src/export/ExportRunner.ts`
- Modify: `src/export/ExportRunner.test.ts`

- [ ] **Step 1: Write a failing final-output integration test**

Under the existing `embed expansion` suite, run an actual export with:

- host: `Before ![[part]] after`;
- embedded note: `## Part\n![alt](./img.png)`;
- embedded image: `notes/img.png`;
- `expandEmbeds: true` and `copyAttachments: true`.

Capture `OutputWriter.writeText` and assert the rendered/exported content
contains both:

```markdown
Before

## Part
```

and:

```markdown
assets/img.png

after
```

The precise wrapper depends on the selected existing test profile; assert the
Markdown boundary before rendering or the equivalent sibling block structure
after rendering, without snapshotting unrelated boilerplate.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/export/ExportRunner.test.ts
```

Expected: the boundary assertion fails because `ExportRunner` discards fragment
metadata into a `string[]` and performs a second `join("")`. The existing
relative-image assertion should remain green.

- [ ] **Step 3: Preserve metadata through rewriting**

Import `DocumentFragment` and `joinMarkdownFragments`. Replace the rewritten
`string[]` with `DocumentFragment[]`. For each source fragment:

```ts
rewritten.push({
	...fragment,
	markdown: result.markdown,
});
```

Then set:

```ts
section.markdown = joinMarkdownFragments(rewritten);
```

Keep warning collection, `sawUnexpandedEmbed`, and per-fragment `sourcePath`
arguments unchanged.

- [ ] **Step 4: Run focused pipeline tests and verify GREEN**

Run:

```bash
pnpm exec vitest run src/export/FragmentJoiner.test.ts src/export/EmbedExpander.test.ts src/export/DocumentAssembler.test.ts src/export/ExportRunner.test.ts
```

Expected: PASS. The final output is block-safe and the embedded image still
resolves relative to `notes/part.md`.

- [ ] **Step 5: Commit runner integration**

```bash
git add src/export/ExportRunner.ts src/export/ExportRunner.test.ts
git commit -m "fix: retain transclusion boundaries after rewriting"
```

### Task 5: Complete the automated adjacency and regression matrix

**Files:**

- Modify as needed: `src/export/FragmentJoiner.test.ts`
- Modify as needed: `src/export/EmbedExpander.test.ts`
- Modify as needed: `src/export/DocumentAssembler.test.ts`
- Modify as needed: `src/export/ExportRunner.test.ts`

- [ ] **Step 1: Audit coverage against the approved matrix**

Confirm automated coverage exists for:

- ordinary paragraphs on both sides;
- H1-H6-equivalent heading syntax;
- unordered and ordered lists;
- blockquotes;
- tables;
- fenced and indented code blocks;
- horizontal rules;
- repeated heading transclusions;
- nested transclusions;
- LF, CRLF, existing blank lines, and whitespace-only blank lines;
- empty expanded notes;
- attachment and every unexpanded fallback path;
- expansion disabled;
- embedded-note relative links and attachments.

Use table-driven joiner tests for Markdown constructs whose correctness depends
only on the shared blank-line invariant. Do not duplicate renderer tests for
the same separator behavior.

- [ ] **Step 2: Add only missing regression tests**

For each missing case, first add the assertion, run it, and confirm either the
intended current implementation passes or exposes a real boundary defect. If a
new defect appears, fix it in `FragmentJoiner` or `EmbedExpander`; do not add a
format-specific special case.

- [ ] **Step 3: Run every touched test file**

```bash
pnpm exec vitest run src/export/FragmentJoiner.test.ts src/export/EmbedExpander.test.ts src/export/DocumentAssembler.test.ts src/export/ExportRunner.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit matrix completion if it produces changes**

```bash
git add src/export/FragmentJoiner.test.ts src/export/EmbedExpander.test.ts src/export/DocumentAssembler.test.ts src/export/ExportRunner.test.ts src/export/FragmentJoiner.ts src/export/EmbedExpander.ts
git commit -m "test: cover note transclusion boundaries"
```

Skip this commit when Task 1-4 already cover the full matrix and there is no
diff.

### Task 6: Run repository verification

**Files:**

- No planned source changes.

- [ ] **Step 1: Run the full unit suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run Obsidian warning lint**

```bash
pnpm lint:obsidian-warnings
```

Expected: zero ESLint errors and no new Obsidian API warnings.

- [ ] **Step 3: Run type-check and production build**

```bash
pnpm build
```

Expected: TypeScript succeeds and the production bundle is rebuilt.

- [ ] **Step 4: Review the complete diff**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff main...HEAD -- src/types.ts src/export docs/superpowers
```

Confirm:

- only expected fragment, expander, assembler, runner, tests, and documentation
  changed;
- attachment logic is untouched;
- no generated or vault fixture files are staged;
- no credentials, machine-specific output paths, attribution, or unrelated
  cleanup appear in commits.

### Task 7: Verify runtime exports in Obsidian

**Files:**

- Temporary fixture files under `/Users/Roger/my-vault` only.
- Generated export artifacts outside the repository only.

- [ ] **Step 1: Confirm the development-plugin symlink**

```bash
readlink /Users/Roger/my-vault/.obsidian/plugins/document-exporter
```

Expected:

```text
/Users/Roger/Code/personal/document-exporter
```

Do not create a second plugin directory or backup under `.obsidian/plugins`.

- [ ] **Step 2: Create a focused fixture family**

Create host and embedded notes covering:

- inline `Before ![[note]] after`;
- two heading transclusions separated by a source space;
- nested note transclusion;
- adjacent paragraph, heading, list, quote, table, rule, and fenced code;
- an embedded note with an indented code block;
- an embedded relative image.

Keep attachments small and fixture names unique to this PR.

- [ ] **Step 3: Reload the plugin and export representative formats**

In desktop Obsidian, reload/disable-enable the plugin after the production
build. Export the fixture as:

- Markdown bundle;
- HTML;
- DOCX;
- EPUB;
- PDF.

- [ ] **Step 4: Inspect artifacts at the correct boundary**

- Markdown bundle: inspect `document.md` and copied relative assets.
- HTML: inspect sibling block structure and rendered appearance.
- DOCX/EPUB: inspect headings, lists, code, ordering, and whitespace.
- PDF: visually inspect in desktop Obsidian/Electron for block separation,
  heading styles, ordering, and unintended empty space.

Do not claim PDF completion from headless tests alone.

- [ ] **Step 5: Clean only PR-specific fixtures and artifacts**

Move the temporary fixture family and generated exports to Trash after evidence
is recorded. Preserve the development-plugin symlink and all unrelated vault
content.

### Task 8: Final verification and delivery

**Files:**

- Modify only if implementation evidence requires a design clarification:
  `docs/superpowers/specs/2026-08-24-note-transclusion-block-boundaries-design.md`

- [ ] **Step 1: Re-run final automated verification after any runtime fix**

```bash
pnpm test
pnpm lint:obsidian-warnings
pnpm build
git diff --check main...HEAD
```

Expected: every command succeeds on the final tree.

- [ ] **Step 2: Confirm branch and commit hygiene**

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
```

Expected: clean feature branch with small conventional commits and no unrelated
files.

- [ ] **Step 3: Push and open the independent PR**

Use an English PR title and body focused on the note-transclusion family. The
body must include:

- the root cause: exact source-aware fragments were joined without block
  semantics;
- the fix: explicit successful-transclusion boundary metadata plus one shared
  joiner before and after link rewriting;
- scope exclusions: attachment embeds and block-reference expansion;
- automated commands and desktop Obsidian artifact results;
- any remaining runtime limitation.

Do not include tool attribution, co-author trailers, generated-by text, or
vendor/model names.

- [ ] **Step 4: Watch CI and fix in-scope failures**

Run:

```bash
gh pr checks --watch
```

If a check fails, inspect the failing log, reproduce locally, fix the root
cause, rerun verification, and push the minimal correction.

## Completion Criteria

- All successful note transclusions, including inline and nested cases, have
  stable Markdown block boundaries after final link rewriting.
- Attachments and all unexpanded fallback paths keep their existing behavior.
- Source-relative links and attachments inside embedded notes still resolve
  correctly.
- Full automated verification and desktop runtime artifact inspection pass.
- The PR contains only the independent note-transclusion boundary family.
