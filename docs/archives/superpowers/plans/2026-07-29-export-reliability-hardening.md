# Document Exporter Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the confirmed overwrite, false-success, broken-link, content-loss, cancellation, naming, metadata, and release-safety defects without expanding Document Exporter beyond its current export scope.

**Architecture:** Make `ExportPlan` the single source of truth for every effective output path, then validate and relocate the entire plan atomically before rendering. Keep parsing and rendering fixes inside their existing modules, but replace DOCX's paragraph-only representation with a small block model so tables and hyperlinks can be emitted as valid OOXML. Centralize format capability and attachment-path decisions so the UI, runner, and renderers cannot disagree.

**Tech Stack:** TypeScript, Obsidian API, esbuild, Vitest, jsdom, OOXML/ZIP generation, GitHub Actions.

---

## Scope and non-goals

This plan covers every confirmed issue from the 2026-07-29 review:

1. Timestamped `outputRoot` not propagated to `outputFiles`.
2. External paths bypassing `overwriteExisting=false`.
3. Batch conflict detection checking the parent instead of the real target.
4. Output file/folder names allowing traversal or invalid cross-platform characters.
5. Cancellation being ignored while attachments are copied.
6. Mobile PDF returning success without producing a PDF.
7. Inline note embeds becoming images or broken text.
8. Standard local Markdown links not being rewritten.
9. Markdown image destinations with optional titles not being rewritten.
10. Frontmatter stripping removing indentation, failing on CRLF, and duplicating a matching leading H1.
11. DOCX tables losing all content and emitting invalid OOXML structure.
12. DOCX ordered lists losing their numbers.
13. DOCX links losing their targets.
14. Native HTML/PDF attachment URL rewriting colliding on equal basenames.
15. File-context exports deriving the filename from the wrong active note.
16. Product metadata claiming unsupported query-result export.
17. Repository version documentation and release validation drifting from release metadata.

Non-goals:

- Do not add Dataview execution, Canvas export, query-result sources, localization, or new output formats.
- Do not replace the current export pipeline or introduce a general Markdown parser dependency.
- Do not claim PDF visual fidelity from Node-only tests; final PDF acceptance remains an Obsidian desktop check.
- Do not refactor unrelated UI, settings, or build configuration.

## Target file map

**Create**

- `src/export/ProfileCapabilities.ts` — single source of truth for desktop-only format availability.
- `src/export/ProfileCapabilities.test.ts` — mobile/desktop capability tests.
- `src/ui/ExportModal.test.ts` — preselected-file and mobile-profile regression tests.
- `scripts/check-version.mjs` — release metadata and optional tag consistency check.

**Modify**

- `src/types.ts` — keep profile/settings types aligned with capability helpers.
- `src/export/ExportPlan.ts` and `.test.ts` — output-name validation and atomic plan relocation.
- `src/export/OutputWriter.ts` and `.test.ts` — external/vault existence checks and UNC recognition.
- `src/export/ExportRunner.ts` and `.test.ts` — resolve the effective plan once, enforce platform support, and honor cancellation during attachment copies.
- `src/export/LinkRewriter.ts` and `.test.ts` — non-overlapping wiki embed handling plus local Markdown link/image rewriting.
- `src/export/AttachmentCollector.ts` and `.test.ts` — align the media extension matrix used for normal links.
- `src/export/DocumentAssembler.ts` and `.test.ts` — lossless frontmatter boundary handling and title/H1 de-duplication.
- `src/formats/pdf.ts` and `.test.ts` — unsupported-platform failure semantics.
- `src/formats/docx.ts` and `.test.ts` — valid table blocks, visible ordered-list markers, and hyperlink relationships.
- `src/formats/native-renderer.ts` and `.test.ts` — full-path attachment resolution with collision-safe basename fallback.
- `src/ui/ExportModal.ts` — correct constructor order and mobile format filtering.
- `src/settings/settings-tab.ts` — mobile format filtering.
- `README.md`, `CLAUDE.md`, `manifest.json`, `package.json` — current capability and version-source wording.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml` — version consistency gates.

## Task 1: Make output destination resolution atomic and safe

**Covers:** timestamp mismatch, external overwrite bypass, batch parent false conflicts, traversal, invalid names, Windows UNC paths.

**Files:**

- Modify: `src/export/ExportPlan.ts`
- Modify: `src/export/ExportPlan.test.ts`
- Modify: `src/export/OutputWriter.ts`
- Modify: `src/export/OutputWriter.test.ts`
- Modify: `src/export/ExportRunner.ts`
- Modify: `src/export/ExportRunner.test.ts`

- [ ] **Step 1: Add failing validation tests for output leaf names**

Add cases to `src/export/ExportPlan.test.ts` asserting that `validatePlan()` rejects:

```ts
it.each([
	"../outside",
	"nested/name",
	"nested\\name",
	".",
	"..",
	"bad:name",
	"bad\u0000name",
])("rejects unsafe output filename %j", (outputFilename) => {
	const result = validatePlan(makePlan({ outputFilename }));
	expect(result).toMatch(/file name/i);
});

it.each(["../outside", "nested/name", "nested\\name", ".", ".."])(
	"rejects unsafe batch folder name %j",
	(outputFolderName) => {
		const result = validatePlan(makePlan({
			source: { type: "folder", path: "notes", recursive: true },
			outputFolderName,
		}));
		expect(result).toMatch(/folder name/i);
	},
);
```

- [ ] **Step 2: Run the validation tests and confirm they fail**

Run:

```bash
npx vitest run src/export/ExportPlan.test.ts
```

Expected: the new cases fail because only `outputRoot` is currently checked.

- [ ] **Step 3: Add a leaf-name validator and pure output-file builder**

Refactor `src/export/ExportPlan.ts` so output paths can be recomputed from an updated root or batch folder name:

```ts
const INVALID_OUTPUT_NAME_RE = /[<>:"/\\|?*\u0000-\u001F]/;

export function validateOutputLeafName(
	value: string,
	label: "File name" | "Folder name",
): string | null {
	const trimmed = value.trim();
	if (!trimmed) return `${label} cannot be empty.`;
	if (trimmed === "." || trimmed === ".." || INVALID_OUTPUT_NAME_RE.test(trimmed)) {
		return `${label} contains invalid path characters.`;
	}
	return null;
}

type OutputLayout = Pick<
	ExportPlan,
	"profile" | "source" | "inputFiles" | "outputRoot" | "outputFilename" | "outputFolderName"
>;

export function computeOutputFiles(layout: OutputLayout): string[] {
	const ext = extensionForProfile(layout.profile);
	if (layout.source.type === "current-file") {
		const baseName = layout.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "");
		return [`${layout.outputRoot}/${baseName}.${ext}`];
	}

	const root = layout.outputFolderName
		? `${layout.outputRoot}/${layout.outputFolderName}`
		: layout.outputRoot;

	if (layout.source.type === "folder") {
		const prefix = layout.source.path ? `${layout.source.path}/` : "";
		return layout.inputFiles.map((path) => {
			const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
			return `${root}/${relative.replace(/\.md$/i, `.${ext}`)}`;
		});
	}

	const prefix = longestCommonDirPrefix(layout.inputFiles);
	return layout.inputFiles.map((path) => {
		const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
		return `${root}/${relative.replace(/\.md$/i, `.${ext}`)}`;
	});
}

export function relocatePlan(
	plan: ExportPlan,
	outputRoot: string,
	outputFolderName = plan.outputFolderName,
): ExportPlan {
	const relocated = { ...plan, outputRoot, outputFolderName };
	return { ...relocated, outputFiles: computeOutputFiles(relocated) };
}
```

Update `ExportPlanBuilder.build()` to call `computeOutputFiles()` instead of maintaining a private duplicate implementation.

- [ ] **Step 4: Extend `validatePlan()` to validate the final user-controlled names**

Use the new helper:

```ts
const filenameError = validateOutputLeafName(plan.outputFilename, "File name");
if (filenameError) return filenameError;

if (plan.source.type !== "current-file") {
	const folderError = validateOutputLeafName(plan.outputFolderName ?? "", "Folder name");
	if (folderError) return folderError;
}
```

Keep the existing `outputRoot` traversal check as defense in depth.

- [ ] **Step 5: Add failing writer tests for file existence and UNC paths**

Add to `src/export/OutputWriter.test.ts`:

```ts
it("recognizes Windows UNC paths as external", () => {
	expect(writer.isExternal("\\\\server\\share\\exports")).toBe(true);
});

it("checks whether a vault file path exists", () => {
	app.vault.getAbstractFileByPath.mockReturnValue({ path: "exports/note.pdf" });
	expect(writer.pathExists("exports/note.pdf")).toBe(true);
});
```

- [ ] **Step 6: Implement `pathExists()` and UNC recognition**

Add to `OutputWriter`:

```ts
pathExists(path: string): boolean {
	if (this.isExternal(path)) {
		return nodeFs?.existsSync(path) ?? false;
	}
	return this.app.vault.getAbstractFileByPath(path) !== null;
}

isExternal(path: string): boolean {
	if (path.startsWith("/") || path.startsWith("\\\\")) return true;
	if (/^[A-Za-z]:[\\/]/.test(path)) return true;
	return false;
}
```

- [ ] **Step 7: Add failing runner tests for all collision cases**

Add tests to `src/export/ExportRunner.test.ts`:

```ts
function createPathAwareMockApp(
	files: string[],
	existingFolders: string[] = [],
	existingFiles: string[] = [],
) {
	const pathMap = new Map<string, unknown>();
	for (const path of files) pathMap.set(path, createFile(path));
	for (const path of existingFolders) pathMap.set(path, { path, children: [] });
	for (const path of existingFiles) pathMap.set(path, createFile(path));

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => pathMap.get(path) ?? null),
			read: vi.fn(() => Promise.resolve("content")),
			createFolder: vi.fn().mockResolvedValue(undefined),
			create: vi.fn().mockResolvedValue(undefined),
			modify: vi.fn().mockResolvedValue(undefined),
			createBinary: vi.fn().mockResolvedValue(undefined),
			modifyBinary: vi.fn().mockResolvedValue(undefined),
			readBinary: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
			adapter: {},
		},
		metadataCache: {
			getFileCache: vi.fn(() => ({ frontmatter: {}, links: [], embeds: [] })),
			getFirstLinkpathDest: vi.fn(() => null),
		},
	};
}

it("keeps the original root when the directory exists but the target file does not", async () => {
	const app = createPathAwareMockApp(["note.md"], ["exports"]);
	const runner = new ExportRunner(app as never);
	const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
		.mockResolvedValue(undefined);

	await runner.run(makePlan(["note.md"]), defaultSettings());

	expect(writeSpy).toHaveBeenCalledWith(
		"exports/note.md",
		expect.any(String),
	);
	writeSpy.mockRestore();
});

it("relocates every document, attachment, link map, and report when a single target exists", async () => {
	const app = createPathAwareMockApp(
		["note.md"],
		["exports"],
		["exports/note.md"],
	);
	const runner = new ExportRunner(app as never);
	vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
	const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
		.mockResolvedValue(undefined);

	const result = await runner.run(makePlan(["note.md"]), defaultSettings());

	expect(result.outputRoot).toBe("exports-2026-07-29");
	expect(writeSpy).toHaveBeenCalledWith(
		"exports-2026-07-29/note.md",
		expect.any(String),
	);
	expect(writeSpy).not.toHaveBeenCalledWith(
		"exports/note.md",
		expect.any(String),
	);
	vi.restoreAllMocks();
});

it("timestamps the batch leaf only when the actual batch target exists", async () => {
	const plan = {
		...makePlan(["notes/a.md"]),
		source: { type: "folder" as const, path: "notes", recursive: true },
		outputFolderName: "notes",
		outputFiles: ["exports/notes/a.md"],
	};
	vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
	const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
		.mockResolvedValue(undefined);

	const noConflictApp = createPathAwareMockApp(["notes/a.md"], ["exports"]);
	await new ExportRunner(noConflictApp as never).run(plan, defaultSettings());
	expect(writeSpy).toHaveBeenCalledWith(
		"exports/notes/a.md",
		expect.any(String),
	);

	writeSpy.mockClear();
	const conflictApp = createPathAwareMockApp(
		["notes/a.md"],
		["exports", "exports/notes"],
	);
	await new ExportRunner(conflictApp as never).run(plan, defaultSettings());
	expect(writeSpy).toHaveBeenCalledWith(
		"exports/notes-2026-07-29/a.md",
		expect.any(String),
	);
	vi.restoreAllMocks();
});

it("applies collision protection to external output paths", async () => {
	const app = createPathAwareMockApp(["note.md"]);
	const plan = {
		...makePlan(["note.md"]),
		outputRoot: "/tmp/exports",
		outputFiles: ["/tmp/exports/note.md"],
	};
	vi.spyOn(OutputWriter.prototype, "pathExists").mockReturnValue(true);
	vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
	vi.spyOn(OutputWriter.prototype, "ensureFolder").mockResolvedValue(undefined);
	const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
		.mockResolvedValue(undefined);

	const result = await new ExportRunner(app as never).run(plan, defaultSettings());

	expect(result.outputRoot).toBe("/tmp/exports-2026-07-29");
	expect(writeSpy).toHaveBeenCalledWith(
		"/tmp/exports-2026-07-29/note.md",
		expect.any(String),
	);
	vi.restoreAllMocks();
});
```

Use deterministic time by mocking `Date` or by spying on a new `timestampSuffix()` helper. Do not assert a live clock value.

- [ ] **Step 8: Resolve one effective plan before creating maps or renderers**

Add a private helper in `ExportRunner`:

```ts
private resolveEffectivePlan(
	plan: ExportPlan,
	settings: ExportSettings,
	writer: OutputWriter,
): ExportPlan {
	if (settings.overwriteExisting) return plan;

	if (plan.source.type === "current-file") {
		if (!writer.pathExists(plan.outputFiles[0])) return plan;
		return relocatePlan(plan, writer.timestampedFolder(plan.outputRoot));
	}

	const batchRoot = plan.outputFolderName
		? `${plan.outputRoot}/${plan.outputFolderName}`
		: plan.outputRoot;
	if (!writer.folderExists(batchRoot)) return plan;

	const suffix = writer.timestampSuffix();
	const folderName = `${plan.outputFolderName ?? "files"}-${suffix}`;
	return relocatePlan(plan, plan.outputRoot, folderName);
}
```

Add `timestampSuffix()` to `OutputWriter`, and implement `timestampedFolder()` by composing it:

```ts
timestampSuffix(): string {
	return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

timestampedFolder(basePath: string): string {
	return `${basePath}-${this.timestampSuffix()}`;
}
```

In `run()`, replace the current `outputRoot` mutation with:

```ts
const effectivePlan = this.resolveEffectivePlan(plan, settings, writer);
const outputRoot = effectivePlan.outputRoot;
const outputPathMap = new Map(
	effectivePlan.inputFiles.map((path, index) => [path, effectivePlan.outputFiles[index]]),
);
```

Every later reference must use `effectivePlan.outputFiles`, `effectivePlan.outputRoot`, and `effectivePlan.outputFolderName`; no later reference may use `plan.outputFiles`.

- [ ] **Step 9: Run the focused output tests**

Run:

```bash
npx vitest run src/export/ExportPlan.test.ts src/export/OutputWriter.test.ts src/export/ExportRunner.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 10: Commit the output-safety unit**

```bash
git add src/export/ExportPlan.ts src/export/ExportPlan.test.ts src/export/OutputWriter.ts src/export/OutputWriter.test.ts src/export/ExportRunner.ts src/export/ExportRunner.test.ts
git commit -m "fix: make export destinations collision safe"
```

## Task 2: Enforce format capability consistently on mobile

**Covers:** PDF selectable/default on mobile, PDF returning warning-only success, UI/runner disagreement.

**Files:**

- Create: `src/export/ProfileCapabilities.ts`
- Create: `src/export/ProfileCapabilities.test.ts`
- Modify: `src/export/ExportRunner.ts`
- Modify: `src/export/ExportRunner.test.ts`
- Modify: `src/formats/pdf.ts`
- Modify: `src/formats/pdf.test.ts`
- Modify: `src/ui/ExportModal.ts`
- Modify: `src/settings/settings-tab.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing capability tests**

Create `src/export/ProfileCapabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAvailableProfiles, resolveSupportedProfile } from "@/export/ProfileCapabilities";

describe("profile capabilities", () => {
	it("removes PDF on mobile", () => {
		expect(getAvailableProfiles(false)).toEqual([
			"docx",
			"markdown-bundle",
			"html-document",
		]);
	});

	it("keeps PDF on desktop", () => {
		expect(getAvailableProfiles(true)).toContain("pdf");
	});

	it("falls back from a stored PDF default on mobile", () => {
		expect(resolveSupportedProfile("pdf", false)).toBe("markdown-bundle");
	});
});
```

- [ ] **Step 2: Run the new test and verify it fails**

```bash
npx vitest run src/export/ProfileCapabilities.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure capability helper**

Create `src/export/ProfileCapabilities.ts`:

```ts
import { ExportProfileId } from "@/types";

const ALL_PROFILES: ExportProfileId[] = [
	"pdf",
	"docx",
	"markdown-bundle",
	"html-document",
];

export function isProfileSupported(
	profile: ExportProfileId,
	isDesktopApp: boolean,
): boolean {
	return profile !== "pdf" || isDesktopApp;
}

export function getAvailableProfiles(isDesktopApp: boolean): ExportProfileId[] {
	return ALL_PROFILES.filter((profile) => isProfileSupported(profile, isDesktopApp));
}

export function resolveSupportedProfile(
	profile: ExportProfileId,
	isDesktopApp: boolean,
): ExportProfileId {
	return isProfileSupported(profile, isDesktopApp) ? profile : "markdown-bundle";
}
```

- [ ] **Step 4: Add failing runner and PDF tests for unsupported platforms**

In `ExportRunner.test.ts`, temporarily set the mocked `Platform.isDesktopApp` to `false`, then assert:

```ts
expect(result.success).toBe(false);
expect(result.warnings).toEqual(["PDF export requires the desktop app."]);
expect(app.vault.create).not.toHaveBeenCalled();
expect(app.vault.createBinary).not.toHaveBeenCalled();
```

In `pdf.test.ts`, call `renderPdf()` with mobile platform state and assert that it rejects:

```ts
await expect(renderPdf(doc, plan, writer, app)).rejects.toThrow(
	"PDF export requires the desktop app.",
);
```

Restore platform state in `afterEach()`.

- [ ] **Step 5: Fail unsupported plans before folders or reports are created**

At the beginning of `ExportRunner.run()`:

```ts
if (!isProfileSupported(plan.profile, Platform.isDesktopApp)) {
	return {
		success: false,
		outputRoot: plan.outputRoot,
		warnings: ["PDF export requires the desktop app."],
	};
}
```

Change `renderPdf()` to throw if it is invoked on a non-desktop platform:

```ts
if (!Platform.isDesktopApp) {
	throw new Error("PDF export requires the desktop app.");
}
```

The runner check is the user-facing guard; the renderer exception is defense in depth.

- [ ] **Step 6: Filter UI profiles and resolve stored defaults**

In `ExportModal`, build dropdown entries from `getAvailableProfiles(Platform.isDesktopApp)` and initialize:

```ts
this.profile = resolveSupportedProfile(
	settings.defaultProfile,
	Platform.isDesktopApp,
);
```

In `DocumentExporterSettingTab`, only add available options. Do not rewrite the persisted desktop preference merely because the same vault is opened on mobile.

- [ ] **Step 7: Run focused capability tests**

```bash
npx vitest run src/export/ProfileCapabilities.test.ts src/export/ExportRunner.test.ts src/formats/pdf.test.ts
```

Expected: all pass; the mobile runner test records zero output writes.

- [ ] **Step 8: Commit the platform-capability unit**

```bash
git add src/export/ProfileCapabilities.ts src/export/ProfileCapabilities.test.ts src/export/ExportRunner.ts src/export/ExportRunner.test.ts src/formats/pdf.ts src/formats/pdf.test.ts src/ui/ExportModal.ts src/settings/settings-tab.ts src/types.ts
git commit -m "fix: gate PDF export to desktop"
```

## Task 3: Rewrite note embeds and local Markdown links without overlap

**Covers:** `![[Note]]` becoming an image/broken text, local Markdown links retaining source paths/extensions, optional image titles, media extension mismatch.

**Files:**

- Modify: `src/export/LinkRewriter.ts`
- Modify: `src/export/LinkRewriter.test.ts`
- Modify: `src/export/AttachmentCollector.ts`
- Modify: `src/export/AttachmentCollector.test.ts`

- [ ] **Step 1: Add failing note-embed tests**

Add to `LinkRewriter.test.ts`:

```ts
import { extensionForProfile } from "@/export/utils";

// Extend createMockApp()'s destination map with:
// "Note2.md": "notes/note2.md"
// "reference.pdf": "assets/reference.pdf"
// Extend its known vault paths with "assets/reference.pdf".
const referenceAttachment: AttachmentCopy = {
	sourcePath: "assets/reference.pdf",
	outputRelativePath: "assets/reference.pdf",
};
attachments.push(referenceAttachment);

function makeMappedRewriter(
	profile: ExportProfileId,
	exportedPaths = new Set(["notes/note1.md", "notes/note2.md"]),
) {
	const extension = extensionForProfile(profile);
	return new LinkRewriter(
		createMockApp(),
		exportedPaths,
		attachments,
		profile,
		new Map([
			["notes/note1.md", `exports/note1.${extension}`],
			["notes/note2.md", `exports/note2.${extension}`],
		]),
		`exports/note1.${extension}`,
		"exports",
	);
}

it("turns an included note embed into a normal relative link", () => {
	const rewriter = makeMappedRewriter("html-document");
	const result = rewriter.rewrite("![[Note2]]", "notes/note1.md");
	expect(result.markdown).toBe("[Note2](note2.html)");
	expect(result.warnings).toEqual([]);
});

it("preserves a non-exported note embed as a wiki link without embed syntax", () => {
	const rewriter = makeMappedRewriter(
		"markdown-bundle",
		new Set(["notes/note1.md"]),
	);
	const result = rewriter.rewrite("![[Note2]]", "notes/note1.md");
	expect(result.markdown).toBe("[[Note2]]");
});
```

- [ ] **Step 2: Add failing standard Markdown link tests**

```ts
it("rewrites a local note link to the exported extension and relative path", () => {
	const result = makeMappedRewriter("html-document").rewrite(
		"See [Note 2](Note2.md)",
		"notes/note1.md",
	);
	expect(result.markdown).toBe("See [Note 2](note2.html)");
});

it("rewrites a local attachment link to the copied asset", () => {
	const result = makeMappedRewriter("html-document").rewrite(
		"[Reference](../assets/reference.pdf)",
		"notes/note1.md",
	);
	expect(result.markdown).toBe("[Reference](assets/reference.pdf)");
});

it("preserves external and fragment-only links", () => {
	const markdown = "[Web](https://example.com) [Section](#heading)";
	expect(makeMappedRewriter("html-document").rewrite(markdown, "notes/note1.md").markdown)
		.toBe(markdown);
});
```

- [ ] **Step 3: Add failing image-title and media-matrix tests**

```ts
it("rewrites an image destination while preserving its optional title", () => {
	const result = makeRewriter("markdown-bundle").rewrite(
		'![alt](image.png "caption")',
		"assets/something.md",
	);
	expect(result.markdown).toBe('![alt](attachments/image.png "caption")');
});
```

Add collector tests proving that `m4a`, `flac`, `webm`, `mov`, and `m4v` normal wiki links are collected when the target exists.

- [ ] **Step 4: Run the focused tests and confirm failure**

```bash
npx vitest run src/export/LinkRewriter.test.ts src/export/AttachmentCollector.test.ts
```

Expected: note embeds retain `!`, local Markdown links remain unchanged, image-title resolution fails, and the extra media extensions are skipped.

- [ ] **Step 5: Protect rewritten wiki embeds from the wiki-link pass**

Add final-output placeholders:

```ts
const EMBED_PLACEHOLDER = "\x00WE";

function storeReplacement(values: string[], value: string): string {
	values.push(value);
	return `${EMBED_PLACEHOLDER}${values.length - 1}${EMBED_PLACEHOLDER}`;
}

function restoreReplacements(text: string, values: string[]): string {
	return text.replace(/\x00WE(\d+)\x00WE/g, (_match, index: string) => {
		return values[Number(index)];
	});
}
```

When an embed targets an exported Markdown note, create a normal link using the same output-path helper as wiki links. When it targets a non-exported Markdown note, store `[[displayText]]`. Restore these replacements only after the wiki-link and Markdown-link passes.

- [ ] **Step 6: Parse standard inline Markdown destinations once**

Add a shared inline-link pattern that distinguishes images and preserves an optional quoted title:

```ts
const MARKDOWN_INLINE_LINK_RE =
	/(!?)\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
```

For each match:

1. Leave `http:`, `https:`, `mailto:`, `data:`, and fragment-only destinations unchanged.
2. Remove `< >` only for path resolution, then restore them only when leaving the original match unchanged.
3. Resolve notes through `metadataCache.getFirstLinkpathDest()`.
4. Resolve relative attachment paths through `normalizePath()`.
5. Use `outputPathMap` for exported notes.
6. Use `AttachmentCopy.outputRelativePath` for copied attachments.
7. Preserve the optional title suffix exactly.
8. Preserve unknown local links and add one warning; do not collapse them to display text.

Delete the separate `MARKDOWN_IMAGE_RE` pass after the unified pass is covered.

- [ ] **Step 7: Share the supported attachment extension set**

Export one constant from `AttachmentCollector.ts`:

```ts
export const ATTACHMENT_EXTENSIONS = new Set([
	"png", "jpg", "jpeg", "gif", "bmp", "svg", "webp",
	"pdf",
	"mp3", "mp4", "wav", "ogg", "m4a", "flac", "webm", "mov", "m4v",
]);
```

Use it for normal cached links. Keep embed collection permissive for every non-Markdown file.

- [ ] **Step 8: Run the complete link and attachment suites**

```bash
npx vitest run src/export/LinkRewriter.test.ts src/export/AttachmentCollector.test.ts
```

Expected: all existing and new cases pass, including fenced/inline code protection.

- [ ] **Step 9: Commit the link-integrity unit**

```bash
git add src/export/LinkRewriter.ts src/export/LinkRewriter.test.ts src/export/AttachmentCollector.ts src/export/AttachmentCollector.test.ts
git commit -m "fix: preserve links across export formats"
```

## Task 4: Make frontmatter removal lossless

**Covers:** CRLF frontmatter leakage, closing delimiter at EOF, stripped indented code, duplicate matching H1.

**Files:**

- Modify: `src/export/DocumentAssembler.ts`
- Modify: `src/export/DocumentAssembler.test.ts`

- [ ] **Step 1: Add failing frontmatter boundary tests**

```ts
it("parses CRLF frontmatter without leaking delimiters", () => {
	const result = stripFrontmatter("---\r\ntitle: Hello\r\n---\r\nBody");
	expect(result.frontmatter).toEqual({ title: "Hello" });
	expect(result.body).toBe("Body");
});

it("accepts a closing delimiter at end of file", () => {
	const result = stripFrontmatter("---\ntitle: Hello\n---");
	expect(result.frontmatter).toEqual({ title: "Hello" });
	expect(result.body).toBe("");
});

it("preserves indentation at the beginning of the body", () => {
	const result = stripFrontmatter("---\ntitle: Hello\n---\n    code");
	expect(result.body).toBe("    code");
});
```

- [ ] **Step 2: Add failing title/H1 integration tests**

Build a real `DocumentAssembler` with a mocked vault read:

```ts
it("removes a leading H1 that duplicates the frontmatter title", async () => {
	app.vault.read.mockResolvedValue("---\ntitle: Same\n---\n# Same\nBody");
	const document = await new DocumentAssembler(app as never).assemble([file as never]);
	expect(document.title).toBe("Same");
	expect(document.sections[0].markdown).toBe("Body");
});

it("keeps a leading H1 that differs from the frontmatter title", async () => {
	app.vault.read.mockResolvedValue("---\ntitle: Document\n---\n# Section\nBody");
	const document = await new DocumentAssembler(app as never).assemble([file as never]);
	expect(document.sections[0].markdown).toContain("# Section");
});
```

- [ ] **Step 3: Run the assembler tests and confirm failure**

```bash
npx vitest run src/export/DocumentAssembler.test.ts
```

- [ ] **Step 4: Replace delimiter search and remove `trimStart()`**

Use one anchored expression:

```ts
const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
if (!match) {
	return { body: content, frontmatter: {} };
}

const yamlBlock = match[1];
const body = content.slice(match[0].length);
```

Split frontmatter lines with `/\r?\n/`. Do not trim, normalize, or otherwise mutate `body`.

- [ ] **Step 5: Remove only a matching duplicate H1**

Always inspect a leading H1. If frontmatter provides a title, remove the H1 only when normalized strings are equal:

```ts
const extracted = extractLeadingH1(contentBody);
if (extracted) {
	if (typeof frontmatter.title !== "string") {
		sectionTitle = extracted.title;
		contentBody = extracted.remaining;
	} else if (extracted.title.trim() === frontmatter.title.trim()) {
		contentBody = extracted.remaining;
	}
}
```

- [ ] **Step 6: Run the assembler suite**

```bash
npx vitest run src/export/DocumentAssembler.test.ts
```

Expected: every old and new test passes.

- [ ] **Step 7: Commit the frontmatter unit**

```bash
git add src/export/DocumentAssembler.ts src/export/DocumentAssembler.test.ts
git commit -m "fix: preserve document content around frontmatter"
```

## Task 5: Make native attachment URL rewriting collision-safe

**Covers:** equal attachment basenames resolving to the wrong image in HTML/PDF.

**Files:**

- Modify: `src/formats/native-renderer.ts`
- Modify: `src/formats/native-renderer.test.ts`

- [ ] **Step 1: Add failing same-basename tests**

```ts
it("uses the full source path when attachment basenames collide", () => {
	const html = [
		'<img src="app://local/vault/a/image.png">',
		'<img src="app://local/vault/b/image.png">',
	].join("");
	const attachments = [
		{ sourcePath: "a/image.png", outputRelativePath: "assets/image.png" },
		{ sourcePath: "b/image.png", outputRelativePath: "assets/b-image.png" },
	];

	expect(rewriteAppProtocolUrls(html, attachments)).toBe([
		'<img src="assets/image.png">',
		'<img src="assets/b-image.png">',
	].join(""));
});

it("does not guess when an app URL exposes only an ambiguous basename", () => {
	const html = '<img src="app://local/image.png">';
	const attachments = [
		{ sourcePath: "a/image.png", outputRelativePath: "assets/image.png" },
		{ sourcePath: "b/image.png", outputRelativePath: "assets/b-image.png" },
	];
	expect(rewriteAppProtocolUrls(html, attachments)).toBe(html);
});
```

- [ ] **Step 2: Run the native renderer test and confirm failure**

```bash
npx vitest run src/formats/native-renderer.test.ts
```

- [ ] **Step 3: Match full decoded URL paths before basename fallback**

Replace the basename-only map with:

```ts
function resolveAttachmentUrl(
	rawUrl: string,
	attachments: AttachmentCopy[],
): string | null {
	const decodedPath = decodeURIComponent(new URL(rawUrl).pathname)
		.replace(/^\/+/, "");

	const exact = attachments.find((attachment) => {
		return decodedPath === attachment.sourcePath
			|| decodedPath.endsWith(`/${attachment.sourcePath}`);
	});
	if (exact) return exact.outputRelativePath;

	const basename = decodedPath.split("/").pop() ?? "";
	const matches = attachments.filter((attachment) => {
		return attachment.sourcePath.split("/").pop() === basename;
	});
	return matches.length === 1 ? matches[0].outputRelativePath : null;
}
```

Rewrite complete `app://` `src` values:

```ts
return html.replace(/src="(app:\/\/[^"]+)"/g, (match, rawUrl: string) => {
	const outputPath = resolveAttachmentUrl(rawUrl, attachments);
	return outputPath ? `src="${outputPath}"` : match;
});
```

- [ ] **Step 4: Run native, HTML, and PDF tests**

```bash
npx vitest run src/formats/native-renderer.test.ts src/formats/html-document.test.ts src/formats/pdf.test.ts
```

- [ ] **Step 5: Commit the attachment-identity unit**

```bash
git add src/formats/native-renderer.ts src/formats/native-renderer.test.ts
git commit -m "fix: disambiguate rendered attachment URLs"
```

## Task 6: Replace the DOCX paragraph-only table placeholder with valid blocks

**Covers:** table text loss and invalid `<w:tc>` placement.

**Files:**

- Modify: `src/formats/docx.ts`
- Modify: `src/formats/docx.test.ts`

- [ ] **Step 1: Add a reusable DOCX package extractor in tests**

Reuse the existing captured `Uint8Array`, then parse ZIP entries with a test helper that locates the local file header and returns UTF-8 text for `word/document.xml`. Keep the helper in `docx.test.ts`; do not add a production ZIP dependency.

```ts
function readStoredZipEntry(data: Uint8Array, targetName: string): string {
	const decoder = new TextDecoder();
	let offset = 0;

	while (offset + 30 <= data.byteLength) {
		const view = new DataView(
			data.buffer,
			data.byteOffset + offset,
			data.byteLength - offset,
		);
		const signature = view.getUint32(0, true);
		if (signature !== 0x04034b50) break;

		const compressionMethod = view.getUint16(8, true);
		const compressedSize = view.getUint32(18, true);
		const nameLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const nameStart = offset + 30;
		const nameEnd = nameStart + nameLength;
		const contentStart = nameEnd + extraLength;
		const contentEnd = contentStart + compressedSize;

		if (contentEnd > data.byteLength) {
			throw new Error(`Invalid ZIP entry bounds for ${targetName}`);
		}

		const name = decoder.decode(data.slice(nameStart, nameEnd));
		if (name === targetName) {
			if (compressionMethod !== 0) {
				throw new Error(`Expected stored ZIP entry for ${targetName}`);
			}
			return decoder.decode(data.slice(contentStart, contentEnd));
		}

		offset = contentEnd;
	}

	throw new Error(`ZIP entry not found: ${targetName}`);
}

async function renderAndReadDocxPackage(markdown: string): Promise<{
	documentXml: string;
	relationshipsXml: string | null;
}> {
	let writtenData: Uint8Array | null = null;
	const writer = {
		ensureFolder: vi.fn().mockResolvedValue(undefined),
		writeBinary: vi.fn((_path: string, data: Uint8Array) => {
			writtenData = data;
			return Promise.resolve();
		}),
	};
	const doc: AssembledDocument = {
		title: "Fixture",
		sections: [{
			sourcePath: "fixture.md",
			title: "Fixture",
			markdown,
			frontmatter: {},
		}],
		attachments: [],
	};
	const plan = {
		outputRoot: "output",
		outputFilename: "fixture.docx",
	} as ExportPlan;

	await renderDocx(doc, plan, writer as never, null);
	if (!writtenData) throw new Error("DOCX was not written");

	let relationshipsXml: string | null = null;
	try {
		relationshipsXml = readStoredZipEntry(
			writtenData,
			"word/_rels/document.xml.rels",
		);
	} catch (error) {
		if (!(error instanceof Error) || !error.message.startsWith("ZIP entry not found:")) {
			throw error;
		}
	}

	return {
		documentXml: readStoredZipEntry(writtenData, "word/document.xml"),
		relationshipsXml,
	};
}

async function renderAndReadDocumentXml(markdown: string): Promise<string> {
	return (await renderAndReadDocxPackage(markdown)).documentXml;
}
```

- [ ] **Step 2: Add a failing table artifact test**

```ts
it("writes valid table rows and preserves every cell value", async () => {
	const markdown = [
		"| Name | Value |",
		"| --- | --- |",
		"| Alpha | 42 |",
	].join("\n");

	const documentXml = await renderAndReadDocumentXml(markdown);
	expect(documentXml).toContain("<w:tbl>");
	expect(documentXml).toContain("<w:tr>");
	expect(documentXml).toContain("<w:tc>");
	expect(documentXml).toContain(">Name<");
	expect(documentXml).toContain(">Value<");
	expect(documentXml).toContain(">Alpha<");
	expect(documentXml).toContain(">42<");
	expect(documentXml).not.toMatch(/<w:p[^>]*>\s*<w:tc>/);
});
```

- [ ] **Step 3: Run the DOCX test and confirm failure**

```bash
npx vitest run src/formats/docx.test.ts
```

- [ ] **Step 4: Introduce a small DOCX block union**

Replace the fake `TableRow` paragraph style with:

```ts
type DocxParagraph = {
	kind: "paragraph";
	runs: DocxRun[];
	style?: string;
};

type DocxTableCell = {
	runs: DocxRun[];
	header: boolean;
};

type DocxTable = {
	kind: "table";
	rows: DocxTableCell[][];
};

type DocxBlock = DocxParagraph | DocxTable;
```

Change `parseMarkdownToParagraphs()` to `parseMarkdownToBlocks()` and return one `DocxTable` for each Markdown table. All normal paragraphs receive `kind: "paragraph"`.

- [ ] **Step 5: Emit valid OOXML tables**

Add:

```ts
function tableToXml(table: DocxTable): string {
	const rows = table.rows.map((row) => {
		const cells = row.map((cell) => {
			const runs = cell.runs.map((run) => {
				return runToXml(cell.header ? { ...run, bold: true } : run);
			}).join("");
			return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${runs}</w:p></w:tc>`;
		}).join("");
		return `<w:tr>${cells}</w:tr>`;
	}).join("");

	return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows}</w:tbl>`;
}

function blockToXml(block: DocxBlock): string {
	return block.kind === "table" ? tableToXml(block) : paragraphToXml(block);
}
```

Update `buildDocumentXml()` to call `blockToXml()`.

- [ ] **Step 6: Run the DOCX suite and validate the ZIP**

```bash
npx vitest run src/formats/docx.test.ts
```

Also generate one fixture under a temporary directory and run:

```bash
unzip -t /tmp/document-exporter-table.docx
```

Expected: no ZIP errors and all table text present in `word/document.xml`.

- [ ] **Step 7: Commit the DOCX-table unit**

```bash
git add src/formats/docx.ts src/formats/docx.test.ts
git commit -m "fix: preserve tables in DOCX exports"
```

## Task 7: Preserve ordered-list numbers and hyperlink targets in DOCX

**Covers:** ordered lists becoming unnumbered paragraphs and links becoming unrecoverable plain text.

**Files:**

- Modify: `src/formats/docx.ts`
- Modify: `src/formats/docx.test.ts`

- [ ] **Step 1: Add failing ordered-list and hyperlink artifact tests**

```ts
it("preserves explicit ordered-list markers", async () => {
	const xml = await renderAndReadDocumentXml("1. First\n2. Second");
	expect(xml).toContain(">1. First<");
	expect(xml).toContain(">2. Second<");
});

it("emits hyperlink relationships and clickable runs", async () => {
	const result = await renderAndReadDocxPackage(
		"[Example](https://example.com) and [Other](other.docx)",
	);
	const relationshipsXml = result.relationshipsXml ?? "";
	expect(result.documentXml).toContain("<w:hyperlink");
	expect(relationshipsXml).toContain('Target="https://example.com"');
	expect(relationshipsXml).toContain('Target="other.docx"');
	expect(relationshipsXml).toContain('TargetMode="External"');
});
```

- [ ] **Step 2: Run the DOCX tests and confirm failure**

```bash
npx vitest run src/formats/docx.test.ts
```

- [ ] **Step 3: Preserve ordered markers with the current lightweight model**

Do not introduce Word numbering definitions in this repair. Keep the source marker as visible text:

```ts
const orderedMatch = line.match(/^[\s]*(\d+)\.\s+(.+)$/);
if (orderedMatch) {
	blocks.push({
		kind: "paragraph",
		style: "ListParagraph",
		runs: parseInline(`${orderedMatch[1]}. ${orderedMatch[2]}`, imageMap),
	});
	i++;
	continue;
}
```

This fixes semantic content loss while avoiding a larger editable-numbering feature.

- [ ] **Step 4: Represent hyperlinks explicitly**

Extend `DocxRun`:

```ts
type DocxRun = {
	text: string;
	bold?: boolean;
	italics?: boolean;
	code?: boolean;
	emoji?: boolean;
	drawing?: string;
	break?: boolean;
	hyperlink?: string;
	relationshipId?: string;
};
```

When parsing `[label](target)`, retain both values:

```ts
runs.push(createTextRun(match[8], { hyperlink: match[9] }));
```

Before building XML, collect unique hyperlink targets, assign relationship IDs after the image relationship IDs, and copy those IDs back to their runs.

- [ ] **Step 5: Emit hyperlink OOXML and relationships**

For non-anchor targets:

```ts
function hyperlinkRunToXml(run: DocxRun): string {
	const textRun = runToXml({ ...run, hyperlink: undefined, relationshipId: undefined });
	return `<w:hyperlink r:id="${run.relationshipId}">${textRun}</w:hyperlink>`;
}
```

At the top of `runToXml()`, route hyperlink runs without recursing:

```ts
if (run.hyperlink?.startsWith("#")) {
	const textRun = runToXml({ ...run, hyperlink: undefined });
	return `<w:hyperlink w:anchor="${escapeXml(run.hyperlink.slice(1))}">${textRun}</w:hyperlink>`;
}
if (run.hyperlink && run.relationshipId) {
	return hyperlinkRunToXml(run);
}
```

Extend `buildRels()` with:

```ts
const hyperlinkRels = hyperlinks.map((link) => {
	return `<Relationship Id="${link.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(link.target)}" TargetMode="External"/>`;
}).join("");
```

Keep image and hyperlink relationship IDs unique.

- [ ] **Step 6: Run the DOCX artifact suite**

```bash
npx vitest run src/formats/docx.test.ts
```

Expected: numbers remain visible, URLs appear in `document.xml.rels`, and image tests still pass.

- [ ] **Step 7: Commit the DOCX-semantics unit**

```bash
git add src/formats/docx.ts src/formats/docx.test.ts
git commit -m "fix: preserve DOCX list and link semantics"
```

## Task 8: Correct file-context defaults and cancellation behavior

**Covers:** right-click export using the active file's name and cancellation being ignored during attachment copies.

**Files:**

- Create: `src/ui/ExportModal.test.ts`
- Modify: `src/ui/ExportModal.ts`
- Modify: `src/export/ExportRunner.ts`
- Modify: `src/export/ExportRunner.test.ts`

- [ ] **Step 1: Add a failing preselected-file modal test**

Export the default-name calculation as a pure helper and create `src/ui/ExportModal.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { deriveDefaultFilename } from "@/ui/ExportModal";

describe("deriveDefaultFilename", () => {
	it("prefers the context-menu file over the active editor file", () => {
		const activeFile = { path: "active.md", basename: "active", extension: "md" };
		const selectedFile = { path: "selected.md", basename: "selected", extension: "md" };
		const app = {
			workspace: { getActiveFile: vi.fn(() => activeFile) },
		};

		expect(deriveDefaultFilename(app as never, selectedFile as never)).toBe("selected");
	});
});
```

- [ ] **Step 2: Run the UI test and confirm failure**

```bash
npx vitest run src/ui/ExportModal.test.ts
```

- [ ] **Step 3: Assign preselected fields before deriving defaults**

Add the pure helper:

```ts
export function deriveDefaultFilename(
	app: App,
	preselectedFile?: TFile,
	preselectedFolder?: TFolder,
): string {
	if (preselectedFile) return preselectedFile.basename;
	if (preselectedFolder) return preselectedFolder.name;
	return app.workspace.getActiveFile()?.basename ?? "export";
}
```

Then change the constructor order and call the helper:

```ts
this.settings = settings;
this.preselectedFile = preselectedFile;
this.preselectedFolder = preselectedFolder;
this.profile = resolveSupportedProfile(
	settings.defaultProfile,
	Platform.isDesktopApp,
);
this.outputFolder = settings.defaultOutputFolder;
this.outputFilename = deriveDefaultFilename(
	app,
	preselectedFile,
	preselectedFolder,
);
```

- [ ] **Step 4: Add failing cancellation tests for attachment copying**

In `ExportRunner.test.ts`, add:

```ts
import { AttachmentCollector } from "@/export/AttachmentCollector";

it("stops before the next attachment after cancellation", async () => {
	const app = createMockApp(["a.md"]);
	const plan = {
		...makePlan(["a.md"]),
		attachmentCopies: [
			{ sourcePath: "one.png", outputRelativePath: "assets/one.png" },
			{ sourcePath: "two.png", outputRelativePath: "assets/two.png" },
		],
	};
	const runner = new ExportRunner(app as never);
	const copySpy = vi.spyOn(OutputWriter.prototype, "copyBinaryFile")
		.mockImplementationOnce(async () => {
			runner.cancel();
		})
		.mockResolvedValue(undefined);

	const result = await runner.run(plan, defaultSettings());

	expect(copySpy).toHaveBeenCalledTimes(1);
	expect(result.success).toBe(false);
	expect(result.warnings[0]).toContain("cancelled");
	copySpy.mockRestore();
});

it("reports partial success when cancellation happens after an earlier file", async () => {
	const app = createMockApp(["a.md", "b.md"]);
	const plan = makePlan(["a.md", "b.md"]);
	const runner = new ExportRunner(app as never);
	vi.spyOn(AttachmentCollector.prototype, "collect")
		.mockResolvedValueOnce({
			attachments: [
				{ sourcePath: "a-one.png", outputRelativePath: "assets/a-one.png" },
				{ sourcePath: "a-two.png", outputRelativePath: "assets/a-two.png" },
			],
			warnings: [],
		})
		.mockResolvedValueOnce({
			attachments: [
				{ sourcePath: "b-one.png", outputRelativePath: "assets/b-one.png" },
				{ sourcePath: "b-two.png", outputRelativePath: "assets/b-two.png" },
			],
			warnings: [],
		});
	let copies = 0;
	const copySpy = vi.spyOn(OutputWriter.prototype, "copyBinaryFile")
		.mockImplementation(async () => {
			copies++;
			if (copies === 3) runner.cancel();
		});

	const result = await runner.run(
		plan,
		{ ...defaultSettings(), copyAttachments: true },
	);

	expect(copySpy).toHaveBeenCalledTimes(3);
	expect(result.success).toBe(true);
	expect(result.warnings[0]).toContain("1 of 2 file(s) exported");
	vi.restoreAllMocks();
});
```

- [ ] **Step 5: Check cancellation before and between attachment copies**

In `ExportRunner`:

```ts
if (this.cancelled) {
	return this.cancelledResult(outputRoot, completedFiles, files.length);
}

for (const attachment of doc.attachments) {
	if (this.cancelled) {
		return this.cancelledResult(outputRoot, completedFiles, files.length);
	}
	await writer.copyBinaryFile(
		attachment.sourcePath,
		`${assetsRoot}/${attachment.outputRelativePath}`,
	);
}
```

An in-progress `readBinary()` cannot be aborted, but no subsequent attachment may begin after cancellation.

- [ ] **Step 6: Run focused UI and runner tests**

```bash
npx vitest run src/ui/ExportModal.test.ts src/export/ExportRunner.test.ts
```

- [ ] **Step 7: Commit the interaction unit**

```bash
git add src/ui/ExportModal.ts src/ui/ExportModal.test.ts src/export/ExportRunner.ts src/export/ExportRunner.test.ts
git commit -m "fix: align export defaults and cancellation"
```

## Task 9: Align documentation and guard release metadata

**Covers:** unsupported query-result claims, stale hard-coded project version, README batch wording, release tag/manifest drift risk.

**Files:**

- Create: `scripts/check-version.mjs`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Correct current capability wording**

Use the same description in `package.json` and `manifest.json`:

```text
Export notes, folders, and selected Markdown files to PDF, Word, Markdown bundles, and HTML.
```

In `README.md`:

- State that batch Markdown export creates one `.md` per source file plus a shared `assets/` directory.
- Keep query results out of the feature list.
- Keep the explicit Dataview and Canvas limitations.
- State that mobile does not offer PDF.

In `CLAUDE.md`, replace the hard-coded current version with:

```text
- Current version: see `manifest.json`
```

- [ ] **Step 2: Create a version consistency script**

Create `scripts/check-version.mjs`:

```js
import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

const expected = packageJson.version;
const errors = [];

if (manifest.version !== expected) {
	errors.push(`manifest.json=${manifest.version}, package.json=${expected}`);
}
if (!Object.hasOwn(versions, expected)) {
	errors.push(`versions.json is missing ${expected}`);
}

const tag = process.env.RELEASE_TAG;
if (tag && tag !== expected) {
	errors.push(`release tag=${tag}, package.json=${expected}`);
}

if (errors.length > 0) {
	process.stderr.write(`${errors.join("\n")}\n`);
	process.exit(1);
}

process.stdout.write(`Version metadata is consistent: ${expected}\n`);
```

- [ ] **Step 3: Add and run the package script**

Add to `package.json`:

```json
"check:version": "node scripts/check-version.mjs"
```

Run:

```bash
npm run check:version
```

Expected:

```text
Version metadata is consistent: 0.4.9
```

- [ ] **Step 4: Add version checks to CI and release**

In `.github/workflows/ci.yml`, run `npm run check:version` after `npm ci`.

In `.github/workflows/release.yml`, run:

```yaml
- name: Verify version metadata
  env:
    RELEASE_TAG: ${{ github.ref_name }}
  run: npm run check:version
```

Place this before the production build and release creation.

- [ ] **Step 5: Validate workflows and documentation diffs**

Run:

```bash
npm run check:version
npm run build
git diff --check
```

Expected: every command succeeds and no whitespace errors are reported.

- [ ] **Step 6: Commit the metadata unit**

```bash
git add README.md CLAUDE.md manifest.json package.json scripts/check-version.mjs .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "chore: align export metadata and release checks"
```

## Task 10: Run artifact-level and runtime acceptance

**Covers:** proof that the repaired pipeline works beyond unit-level helper assertions.

**Files:**

- Modify only if a regression is found: the smallest source/test pair responsible for that regression.
- Do not commit generated fixtures or exported documents.

- [ ] **Step 1: Run the complete automated gate**

```bash
npm run lint:obsidian-warnings
npx tsc -noEmit -skipLibCheck
npm run build
npm test
npm run check:version
git diff --check
```

Expected:

- All test files pass.
- The test count is greater than the original 165 because every confirmed defect has a regression case.
- Build and lint complete without warnings promoted to failures.
- Version metadata is consistent.

- [ ] **Step 2: Verify the focused regression matrix**

Run:

```bash
npx vitest run \
	src/export/ExportPlan.test.ts \
	src/export/OutputWriter.test.ts \
	src/export/ExportRunner.test.ts \
	src/export/ProfileCapabilities.test.ts \
	src/export/LinkRewriter.test.ts \
	src/export/AttachmentCollector.test.ts \
	src/export/DocumentAssembler.test.ts \
	src/formats/native-renderer.test.ts \
	src/formats/docx.test.ts \
	src/formats/pdf.test.ts \
	src/ui/ExportModal.test.ts
```

Expected: all focused suites pass.

- [ ] **Step 3: Generate headless Markdown, HTML, and DOCX artifacts**

Use a temporary fixture vault containing:

```text
notes/
  A.md
  B.md
  Frontmatter-CRLF.md
  Table-And-List.md
assets/
  a/image.png
  b/image.png
  reference.pdf
```

Fixture content must include:

- `A.md` linking to `B.md` with both wiki and standard Markdown syntax.
- `A.md` embedding `B.md` with `![[B]]`.
- Two images with the same basename but different content.
- A local PDF link.
- CRLF frontmatter followed by an indented code block.
- A table, ordered list, external URL, Chinese text, and emoji.

For each headless format, inspect:

- Every source note has one expected output file.
- No output is written outside the selected root.
- Re-running with overwrite disabled produces a collision-free sibling.
- Rewritten note links use the target output extension.
- Attachment links resolve to files that exist.
- DOCX `document.xml` contains all table cells, ordered markers, Chinese text, emoji, and hyperlink elements.
- DOCX relationships contain external and relative link targets.

- [ ] **Step 4: Verify mobile capability behavior**

With platform state mocked as mobile:

- PDF does not appear in the modal or settings dropdown.
- A stored PDF default resolves to Markdown bundle for the current mobile session.
- Directly invoking a PDF plan returns `success: false`.
- No PDF, assets directory, or warning report is created.

- [ ] **Step 5: Perform Obsidian desktop PDF acceptance**

Build the plugin:

```bash
npm run build
```

In the real Obsidian desktop test vault:

1. Export the fixture set to PDF.
2. Confirm every expected PDF exists and is larger than the minimum validity threshold.
3. Open each PDF and inspect page margins, page breaks, headings, soft line breaks, tables as rendered by Obsidian, both same-name images, Chinese text, and emoji.
4. Confirm note embeds appear as links rather than images.
5. Confirm cancel stops before the next attachment or file.
6. Repeat one export with overwrite disabled and verify the original output remains byte-for-byte unchanged.

PDF visual acceptance is mandatory before declaring the overall repair complete.

- [ ] **Step 6: Confirm repository cleanliness and commit boundaries**

Run:

```bash
git status --short --branch
git log --oneline -10
```

Expected:

- No generated export artifacts or temporary vault files are tracked.
- The worktree is clean.
- The logical commits from Tasks 1-9 remain separately reviewable.

## Completion criteria

The repair is complete only when all of the following are true:

- No overwrite-disabled path can replace an existing vault or external export.
- `ExportResult.outputRoot`, document paths, attachment paths, reports, and rewritten links all describe the same effective destination.
- Mobile UI cannot select PDF, and direct mobile PDF execution fails without creating artifacts.
- Included note embeds become normal links; standard local Markdown links target exported paths and extensions.
- Frontmatter parsing preserves body bytes after the delimiter, including indentation and CRLF-origin content.
- DOCX tables contain every source cell in valid `<w:tbl>` structure.
- DOCX ordered-list numbers and hyperlink targets remain present.
- Equal attachment basenames resolve by full source path.
- File-context export names come from the selected file.
- Cancellation prevents the next attachment copy from starting.
- Product descriptions contain no query-result claim.
- CI and release workflows reject inconsistent version metadata.
- Automated tests, artifact inspection, and desktop PDF acceptance all pass.
