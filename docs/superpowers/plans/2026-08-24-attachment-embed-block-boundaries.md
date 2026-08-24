# Attachment Embed Block Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Markdown block structure after standalone attachment embeds in PDF and HTML exports without changing inline embeds, note transclusion, attachment paths, or other export formats.

**Architecture:** Keep the existing safe HTML emitted by `LinkRewriter`, but classify resolved attachment embeds from their original line context. Add exactly one intermediate Markdown blank-line boundary around top-level standalone replacements when adjacent content exists. Make the basic HTML fallback treat protected attachment and fenced-code placeholders as blocks when they occupy an entire blank-line-delimited block.

**Tech Stack:** TypeScript, Vitest, Obsidian `MarkdownRenderer`, Electron PDF printing, existing regex-based fallback converter.

---

## File Map

- Modify `src/export/LinkRewriter.ts`: detect top-level standalone attachment embeds and add non-duplicating Markdown block boundaries.
- Modify `src/export/LinkRewriter.test.ts`: prove standalone/inline/container behavior for image, video, audio, PDF, and generic attachment replacements.
- Modify `src/formats/html-document.ts`: protect generated generic attachment anchors and keep standalone protected placeholders outside paragraphs.
- Modify `src/formats/html-document.test.ts`: prove fallback sibling-block structure, inline behavior, consecutive attachments, and unsafe-anchor escaping.
- Modify `docs/superpowers/specs/2026-08-24-attachment-embed-block-boundaries-design.md`: record the approved implementation correction that retains safe HTML rather than introducing Markdown path encoding.

### Task 1: Add failing attachment-boundary tests

**Files:**
- Modify: `src/export/LinkRewriter.test.ts`

- [ ] **Step 1: Extend the attachment fixtures**

Add audio and generic attachment resolutions to `createMockApp()`:

```ts
const map: Record<string, string> = {
	Note1: "notes/note1.md",
	Note2: "notes/note2.md",
	"Note2.md": "notes/note2.md",
	"image.png": "assets/image.png",
	"clip.mp4": "assets/clip.mp4",
	"reference.pdf": "assets/reference.pdf",
	"song.mp3": "assets/song.mp3",
	"archive.zip": "assets/archive.zip",
};
```

Add the same paths to the mock vault's `known` array and add copies to the shared `attachments` fixture:

```ts
{ sourcePath: "assets/song.mp3", outputRelativePath: "attachments/song.mp3" },
{ sourcePath: "assets/archive.zip", outputRelativePath: "attachments/archive.zip" },
```

- [ ] **Step 2: Write the issue #76 and attachment-family tests**

Add a nested `describe("standalone attachment boundaries", ...)` under `embedded attachments` with exact expectations:

```ts
it.each([
	["html-document", "image.png", '<img src="attachments/image.png" alt="image.png" />'],
	["pdf", "clip.mp4", '<video controls src="attachments/clip.mp4">clip.mp4</video>'],
	["html-document", "song.mp3", '<audio controls src="attachments/song.mp3">song.mp3</audio>'],
	["pdf", "reference.pdf", '<object data="assets/reference.pdf" type="application/pdf"><a href="assets/reference.pdf">reference.pdf</a></object>'],
	["html-document", "archive.zip", '<a href="attachments/archive.zip">archive.zip</a>'],
] as const)("separates a standalone %s attachment from a following heading", (profile, link, replacement) => {
	const result = makeRewriter(profile).rewrite(
		`![[${link}]]\n## Title`,
		"notes/note1.md",
	);
	expect(result.markdown).toBe(`${replacement}\n\n## Title`);
});
```

Add exact tests for preceding content, existing blank lines, document edges, inline prose, list items, and blockquotes:

```ts
it("adds a leading boundary when standalone media follows content", () => {
	const result = makeRewriter("pdf").rewrite(
		"Intro\n![[clip.mp4]]",
		"notes/note1.md",
	);
	expect(result.markdown).toBe(
		'Intro\n\n<video controls src="attachments/clip.mp4">clip.mp4</video>',
	);
});

it("does not duplicate existing blank boundaries", () => {
	const source = "Intro\n\n![[clip.mp4]]\n\n## Title";
	const result = makeRewriter("pdf").rewrite(source, "notes/note1.md");
	expect(result.markdown).toBe(
		'Intro\n\n<video controls src="attachments/clip.mp4">clip.mp4</video>\n\n## Title',
	);
});

it("does not add outer whitespace to a document-only embed", () => {
	const result = makeRewriter("pdf").rewrite("![[clip.mp4]]", "notes/note1.md");
	expect(result.markdown).toBe(
		'<video controls src="attachments/clip.mp4">clip.mp4</video>',
	);
});

it.each([
	"Text ![[clip.mp4]] after",
	"- ![[clip.mp4]]",
	"> ![[clip.mp4]]",
])("does not inject top-level boundaries for %s", (source) => {
	const result = makeRewriter("pdf").rewrite(source, "notes/note1.md");
	expect(result.markdown).not.toContain("\n\n");
});
```

- [ ] **Step 3: Run the focused tests and verify they fail for the right reason**

Run:

```bash
pnpm exec vitest run src/export/LinkRewriter.test.ts
```

Expected: the new adjacency expectations fail because current replacements preserve only the original single newline. Existing tests remain green.

### Task 2: Preserve standalone attachment block boundaries

**Files:**
- Modify: `src/export/LinkRewriter.ts`
- Test: `src/export/LinkRewriter.test.ts`

- [ ] **Step 1: Pass replacement offsets into attachment formatting**

Change the wiki-embed replacement callback signature from:

```ts
let result = text.replace(WIKI_EMBED_RE, (match, link: string) => {
```

to:

```ts
let result = text.replace(WIKI_EMBED_RE, (match, link: string, offset: number) => {
```

Then replace only the existing resolved-attachment branch with this complete branch:

```ts
const attachment = this.attachments.get(dest);
if (attachment) {
	const relPath = this.rewriteAttachmentPath(attachment.outputRelativePath);
	const replacement = this.formatEmbed(relPath, target);
	const preservesBlocks = this.profile === "html-document"
		|| this.profile === "pdf";
	return storeReplacement(
		embedReplacements,
		preservesBlocks && isStandaloneEmbed(text, offset, match.length)
			? withBlockBoundaries(text, offset, match.length, replacement)
			: replacement,
	);
}
```

- [ ] **Step 2: Add line-context helpers**

Add pure helpers below `restoreReplacements`:

```ts
function lineBounds(
	text: string,
	start: number,
	length: number,
): { lineStart: number; lineEnd: number } {
	const lineStart = text.lastIndexOf("\n", start - 1) + 1;
	const nextLf = text.indexOf("\n", start + length);
	const lineEnd = nextLf === -1
		? text.length
		: nextLf > 0 && text[nextLf - 1] === "\r"
			? nextLf - 1
			: nextLf;
	return { lineStart, lineEnd };
}

function isStandaloneEmbed(text: string, start: number, length: number): boolean {
	const { lineStart, lineEnd } = lineBounds(text, start, length);
	return text.slice(lineStart, start).trim() === ""
		&& text.slice(start + length, lineEnd).trim() === "";
}

function withBlockBoundaries(
	text: string,
	start: number,
	length: number,
	replacement: string,
): string {
	const { lineStart, lineEnd } = lineBounds(text, start, length);
	const before = text.slice(0, lineStart);
	const after = text.slice(lineEnd);
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const hasLeadingBoundary = before === ""
		|| /(?:\r?\n)[\t ]*(?:\r?\n)[\t ]*$/.test(before);
	const hasTrailingBoundary = after === ""
		|| /^[\t ]*\r?\n[\t ]*\r?\n/.test(after);
	return `${hasLeadingBoundary ? "" : eol}${replacement}${hasTrailingBoundary ? "" : eol}`;
}
```

These helpers inspect the original protected Markdown, not the partially rewritten output. Note embeds and unresolved attachment embeds do not pass through them.

Add one explicit regression assertion showing that a non-PDF/HTML profile keeps its original single newline:

```ts
it("does not change markdown-bundle attachment spacing", () => {
	const result = makeRewriter("markdown-bundle").rewrite(
		"![[image.png]]\n## Title",
		"notes/note1.md",
	);
	expect(result.markdown).toBe(
		"![image.png](attachments/image.png)\n## Title",
	);
});
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm exec vitest run src/export/LinkRewriter.test.ts
```

Expected: all `LinkRewriter` tests pass, including exact issue #76 output and no-boundary container cases.

- [ ] **Step 4: Commit the boundary behavior**

```bash
git add src/export/LinkRewriter.ts src/export/LinkRewriter.test.ts
git commit -m "fix: preserve attachment embed block boundaries"
```

### Task 3: Add failing fallback-structure tests

**Files:**
- Modify: `src/formats/html-document.test.ts`

- [ ] **Step 1: Import the fallback converter directly**

Change the existing import to:

```ts
import { buildHtmlDoc, markdownToBasicHtml } from "@/formats/html-document";
```

- [ ] **Step 2: Add an attachment-block adjacency matrix**

Add tests under a new `describe("fallback attachment block boundaries", ...)`:

```ts
const video = '<video controls src="assets/clip.mp4">clip.mp4</video>';

it.each([
	["heading", "## Title", "<h2>Title</h2>"],
	["unordered list", "- one\n- two", "<ul><li>one</li><li>two</li></ul>"],
	["ordered list", "1. one\n2. two", "<ol><li>one</li><li>two</li></ol>"],
	["blockquote", "> quote", "<blockquote>quote</blockquote>"],
	["table", "| A |\n|---|\n| B |", "<table>"],
	["fenced code", "```text\ncode\n```", "<pre><code>code\n</code></pre>"],
	["horizontal rule", "---", "<hr>"],
	["paragraph", "After", "<p>After</p>"],
] as const)("keeps standalone media separate from a following %s", (_name, markdown, expected) => {
	const html = markdownToBasicHtml(`${video}\n\n${markdown}`);
	expect(html).toContain(`${video}\n${expected}`);
	expect(html).not.toContain(`<p>${video}`);
});
```

Add inline, consecutive attachment, generic relative-anchor, and unsafe-anchor cases:

```ts
it("keeps inline media inside its paragraph", () => {
	const html = markdownToBasicHtml(`Before ${video} after`);
	expect(html).toBe(`<p>Before ${video} after</p>`);
});

it("keeps consecutive standalone attachments as sibling blocks", () => {
	const image = '<img src="assets/image.png" alt="image.png" />';
	expect(markdownToBasicHtml(`${video}\n\n${image}`)).toBe(`${video}\n${image}`);
});

it("preserves a generated relative attachment anchor", () => {
	const anchor = '<a href="assets/archive.zip">archive.zip</a>';
	expect(markdownToBasicHtml(`${anchor}\n\n## Files`)).toBe(
		`${anchor}\n<h2>Files</h2>`,
	);
});

it("still escapes unsafe absolute or scripted anchors", () => {
	const html = markdownToBasicHtml('<a href="javascript:alert(1)">click</a>');
	expect(html).toContain("&lt;a href=&quot;javascript:alert(1)&quot;&gt;");
	expect(html).not.toContain('<a href="javascript:');
});
```

- [ ] **Step 3: Run the focused tests and verify structural failures**

Run:

```bash
pnpm exec vitest run src/formats/html-document.test.ts
```

Expected: standalone media is wrapped in `<p>`, fenced-code placeholders are nested in paragraphs, and generated generic anchors are escaped.

### Task 4: Make fallback placeholders block-aware

**Files:**
- Modify: `src/formats/html-document.ts`
- Test: `src/formats/html-document.test.ts`

- [ ] **Step 1: Protect generated relative attachment anchors**

Replace `SAFE_MEDIA_TAG_RE` with a named attachment-tag expression that retains the existing exact tags and only accepts relative anchors without a URI scheme or protocol-relative prefix:

```ts
const SAFE_ATTACHMENT_TAG_RE = /<img src="[^"]+" alt="[^"]*" \/>|<video controls src="[^"]+">[^<]*<\/video>|<audio controls src="[^"]+">[^<]*<\/audio>|<object data="[^"]+" type="application\/pdf"><a href="[^"]+">[^<]*<\/a><\/object>|<a href="(?!(?:[a-z][a-z0-9+.-]*:|\/\/))[^"]+">[^<]*<\/a>/gi;
```

Use this expression in the existing attachment placeholder extraction step. Keep the placeholder prefix `MB` to minimize production changes.

- [ ] **Step 2: Keep standalone protected placeholders outside paragraphs**

Before the existing HTML-tag check in paragraph construction, recognize a block containing exactly one protected attachment or fenced-code placeholder:

```ts
if (/^(?:MB|CB)\d+$/.test(trimmed)) {
	return trimmed;
}
if (/^<(h[1-6]|pre|ul|ol|li|section|div|img|blockquote|table|nav|hr)/.test(trimmed)) {
	return trimmed;
}
```

Do not treat placeholders mixed with other text as blocks; those must continue through paragraph wrapping and restore inline.

- [ ] **Step 3: Run fallback and related EPUB tests**

Run:

```bash
pnpm exec vitest run src/formats/html-document.test.ts src/formats/epub.test.ts
```

Expected: all fallback structure tests pass, existing XSS tests remain green, and EPUB continues to use the shared converter successfully.

- [ ] **Step 4: Commit the fallback behavior**

```bash
git add src/formats/html-document.ts src/formats/html-document.test.ts
git commit -m "fix: preserve fallback attachment block structure"
```

### Task 5: Verify the complete change

**Files:**
- Verify: `src/export/LinkRewriter.ts`
- Verify: `src/formats/html-document.ts`
- Verify: generated `main.js`
- Runtime fixture: `/Users/Roger/my-vault`

- [ ] **Step 1: Run static and automated verification**

Run:

```bash
pnpm exec vitest run
npm run lint:obsidian-warnings
npm run build
git diff --check
```

Expected: all tests pass, lint reports no errors, TypeScript and production bundling succeed, and `git diff --check` is silent.

- [ ] **Step 2: Inspect scope and regression boundaries**

Run:

```bash
git diff origin/main...HEAD -- src/export/LinkRewriter.ts src/formats/html-document.ts
git status --short --branch
```

Expected: production changes are limited to attachment boundary classification and fallback placeholder structure. There are no changes to `EmbedExpander`, `DocumentAssembler`, DOCX, EPUB, Markdown bundle, attachment collection, native URL restoration, or PDF CSS.

- [ ] **Step 3: Verify in desktop Obsidian**

Create `/Users/Roger/my-vault/99-Document Exporter Manual Test/attachment-embed-boundaries.md`. Reuse these existing valid vault assets:

```text
98-Attachments/images/partner-readiness-scorecard.png
98-Attachments/reports/partner-readiness-summary.pdf
```

Create valid one-second media fixtures and a generic archive in the same manual-test folder:

```bash
ffmpeg -f lavfi -i color=c=black:s=32x32:d=1 -an -c:v libx264 -pix_fmt yuv420p -y "/Users/Roger/my-vault/99-Document Exporter Manual Test/boundary-video.mp4"
ffmpeg -f lavfi -i sine=frequency=440:duration=1 -c:a libmp3lame -y "/Users/Roger/my-vault/99-Document Exporter Manual Test/boundary-audio.mp3"
zip -j "/Users/Roger/my-vault/99-Document Exporter Manual Test/boundary-archive.zip" docs/superpowers/specs/2026-08-24-attachment-embed-block-boundaries-design.md
```

The note must contain this exact structural matrix, using Obsidian-resolved basenames:

````markdown
# Attachment Embed Boundaries

![[partner-readiness-scorecard.png]]
## Heading after image

![[partner-readiness-summary.pdf]]
### Heading after PDF

![[boundary-video.mp4]]
### Heading after video

![[boundary-audio.mp3]]
### Heading after audio

![[boundary-archive.zip]]
### Heading after generic attachment

![[partner-readiness-scorecard.png]]
- list after image
- second item

![[partner-readiness-scorecard.png]]
> quote after image

![[partner-readiness-scorecard.png]]
| Column |
| --- |
| value |

![[partner-readiness-scorecard.png]]
```text
code after image
```

![[partner-readiness-scorecard.png]]
---

![[partner-readiness-scorecard.png]]
ordinary paragraph after image

![[partner-readiness-scorecard.png]]
![[partner-readiness-scorecard.png]]

Inline before ![[partner-readiness-scorecard.png]] inline after.

- ![[partner-readiness-scorecard.png]]

> ![[partner-readiness-scorecard.png]]
````

Export the fixture to PDF and HTML. Verify:

- headings retain heading styling;
- later Markdown constructs remain separate blocks;
- attachments retain order and load correctly;
- inline, list-item, and blockquote embeds are not split by top-level blank paragraphs;
- no new visible blank paragraph appears around standalone attachments.

Expected: both artifacts satisfy the design acceptance criteria. If desktop automation is unavailable, report runtime verification as pending rather than claiming PDF completion.

- [ ] **Step 4: Commit the approved spec correction and implementation plan**

```bash
git add docs/superpowers/specs/2026-08-24-attachment-embed-block-boundaries-design.md docs/superpowers/plans/2026-08-24-attachment-embed-block-boundaries.md
git commit -m "docs: plan attachment embed boundary fix"
```

This documentation commit may be made before Task 1 when executing the plan in the same session; the implementation commit order remains Task 2, then Task 4.
