# EPUB Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add EPUB 3 as a fifth export profile — a self-contained, spec-conformant `.epub` (XHTML chapters, embedded images, navigable TOC) produced entirely in-process, no external tools.

**Architecture (v2, revised after review):** The ZIP writer that `docx.ts` hand-rolls (CRC32 + stored entries) is extracted into a shared `src/formats/zip.ts`; `docx.ts` becomes a consumer (pure refactor, zero behavior change). A new `src/formats/epub.ts` builds an EPUB 3 container — `mimetype` (first entry, uncompressed — already how the shared ZIP writer works), `META-INF/container.xml`, `OEBPS/content.opf`, `OEBPS/nav.xhtml`, `OEBPS/styles.css`, one `OEBPS/chapter-N.xhtml` per section, and images under `OEBPS/images/`. **Self-containment is enforced by degradation, not by packaging more asset types:** images are embedded; every other internal reference (video/audio/PDF attachments, links to sibling notes in batch exports) degrades to plain text at the `LinkRewriter` level, and `renderEpub` post-processes any stray `<img>`/relative `<a>` that slipped through. Internal asset names are generated (`image-N.ext`) and manifest ids sequential (`img1`, `img2`, …), so raw attachment filenames with spaces, `&`, quotes, or CJK characters never reach XML ids or hrefs. `dcterms:modified` is emitted at seconds precision. EPUB runs on desktop and mobile (no Electron dependency), and the runner skips external attachment copying for this profile.

**Tech Stack:** TypeScript, EPUB 3.0 (OPF package + nav document, [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/)), existing internal ZIP writer, Vitest, EPUBCheck (manual verification only). No new runtime dependencies.

**Review-driven changes vs v1:**

1. Self-containment: v1 linked non-image attachments to `assets/…` paths that were never packaged (spec violation) *and* still had the runner copy attachments outside the `.epub`. Now: degrade to text + skip the copy.
2. OPF safety: v1 built `id="img-${attachmentBasename}"` and raw hrefs — invalid NCName/unencoded URL for common filenames. Now: generated names + sequential ids.
3. `dcterms:modified`: `toISOString()` milliseconds trimmed to the spec's `YYYY-MM-DDThh:mm:ssZ` form.
4. Structural test assertions: mimetype must be the *first* local entry, stored, with zero extra field; EPUBCheck added to manual verification.
5. Version bump lands in the PR (`check-version.mjs` requires tag == `package.json`); tag is cut from merged `main`.

**Scope decisions (YAGNI):**

- One `.epub` per input note, mirroring how DOCX/HTML handle batch exports.
- Only images are embedded. Video/audio/PDF attachments and links to other exported notes degrade to plain text — readers can't play them and cross-`.epub` links can't resolve, so a link would be dead weight and a spec violation.
- Reuses `DEFAULT_CSS` from `html-document.ts` (exported in Task 3).
- Metadata: `dc:title` from the document title, generated `urn:uuid`, `dc:language` fixed to `en` (future refinement), `dcterms:modified` at seconds precision.
- No EPUB 2 NCX fallback.

---

### Task 1: Extract the shared ZIP writer (pure refactor)

**Files:**
- Create: `src/formats/zip.ts`
- Create: `src/formats/testZip.ts` (shared test helper, moved from `docx.test.ts`)
- Modify: `src/formats/docx.ts:51-61` (type), `src/formats/docx.ts:58-61` (constants), `src/formats/docx.ts:620-724` (functions move out)
- Modify: `src/formats/docx.test.ts:15-53` (helper replaced by import)

- [ ] **Step 1: Create `src/formats/zip.ts`**

Move these verbatim from `docx.ts` (then delete them there): the `ZipEntry` type, `createZip`, `createLocalFileHeader`, `createCentralDirectoryHeader`, `createEndOfCentralDirectory`, `concat`, `crc32`, `buildCrc32Table`, plus a module-local `encoder` and `CRC32_TABLE`. Add `export` to `createZip` and the `ZipEntry` type; everything else stays module-private:

```ts
export type ZipEntry = {
	name: string;
	data: Uint8Array;
	crc32: number;
	localHeaderOffset: number;
};

const encoder = new TextEncoder();
const CRC32_TABLE = buildCrc32Table();

// … createLocalFileHeader / createCentralDirectoryHeader /
// createEndOfCentralDirectory / concat / crc32 / buildCrc32Table pasted
// unchanged from src/formats/docx.ts:620-724 …

export function createZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
	// … body unchanged from src/formats/docx.ts:620-650 …
}
```

Keep the remaining helpers (`encodeXml`, `escapeXml`, `containsEmoji`, `isImagePath`) in `docx.ts` — they are OOXML-specific.

- [ ] **Step 2: Point docx.ts at the shared module**

In `src/formats/docx.ts`, delete the moved code and add:

```ts
import { createZip } from "@/formats/zip";
```

(`ZipEntry` is no longer referenced by name in docx.ts once `createZip` moves out — verify with `grep -n "ZipEntry" src/formats/docx.ts`, expect no hits.)

- [ ] **Step 3: Create the shared test helper**

Create `src/formats/testZip.ts` with the `readStoredZipEntry` function moved verbatim from `src/formats/docx.test.ts:15-53`, exported:

```ts
export function readStoredZipEntry(data: Uint8Array, targetName: string): string {
	// … body unchanged from docx.test.ts:16-52 …
}
```

In `src/formats/docx.test.ts`, delete the local copy and add:

```ts
import { readStoredZipEntry } from "@/formats/testZip";
```

(`testZip.ts` is test-only — never imported from `src/main.ts`, so esbuild never bundles it.)

- [ ] **Step 4: Verify refactor**

```bash
npx vitest run src/formats/docx.test.ts && npx tsc -noEmit -skipLibCheck && npm run build
```

Expected: all DOCX tests pass unchanged; build output size roughly unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/formats/zip.ts src/formats/testZip.ts src/formats/docx.ts src/formats/docx.test.ts
git commit -m "refactor: extract shared ZIP writer from docx renderer"
```

---

### Task 2: Register the epub profile with EPUB-safe link degradation

**Files:**
- Modify: `src/types.ts:1`
- Modify: `src/export/ProfileCapabilities.ts:3-8`
- Modify: `src/export/utils.ts:51-58` (`extensionForProfile`)
- Modify: `src/settings/settings.ts:4`
- Modify: `src/settings/settings-tab.ts` (`PROFILE_LABELS`, `SETTING_META.defaultProfile.aliases`)
- Modify: `src/ui/ExportModal.ts:8-13`
- Modify: `src/export/LinkRewriter.ts:101-109` (inline-link exported-note pass), `:119-124` (inline-link attachment pass), `:143-150` (wiki-link pass), `:219-247` (`formatEmbed`)

- [ ] **Step 1: Add the profile id everywhere it is enumerated**

`src/types.ts`:

```ts
export type ExportProfileId = "markdown-bundle" | "html-document" | "pdf" | "docx" | "epub";
```

`src/export/ProfileCapabilities.ts` — add to `ALL_PROFILES` (order = dropdown order):

```ts
const ALL_PROFILES: ExportProfileId[] = [
	"pdf",
	"docx",
	"epub",
	"markdown-bundle",
	"html-document",
];
```

`isProfileSupported` needs no change (`profile !== "pdf" || isDesktopApp` already allows epub everywhere, including mobile).

`src/export/utils.ts` — `ExportPlan.computeOutputFiles` derives every output filename through this function, so the new profile needs an extension or batch exports produce `note.undefined` paths:

```ts
export function extensionForProfile(profile: ExportProfileId): string {
	switch (profile) {
		case "markdown-bundle": return "md";
		case "html-document": return "html";
		case "pdf": return "pdf";
		case "docx": return "docx";
		case "epub": return "epub";
	}
}
```

`src/settings/settings.ts`:

```ts
const VALID_PROFILES: Set<string> = new Set<ExportProfileId>(["markdown-bundle", "html-document", "pdf", "docx", "epub"]);
```

`src/settings/settings-tab.ts`:

```ts
const PROFILE_LABELS: Record<ExportProfileId, string> = {
	pdf: "PDF",
	docx: "Word document",
	epub: "EPUB e-book",
	"markdown-bundle": "Markdown bundle",
	"html-document": "HTML document",
};
```

and extend `SETTING_META.defaultProfile.aliases` with `"epub"` / `"e-book"`.

`src/ui/ExportModal.ts`:

```ts
const PROFILE_OPTIONS: Record<ExportProfileId, string> = {
	pdf: "PDF",
	docx: "Word document",
	epub: "EPUB e-book",
	"markdown-bundle": "Markdown bundle",
	"html-document": "HTML document",
};
```

- [ ] **Step 2: EPUB degradation in LinkRewriter**

An `.epub` cannot contain live links to sibling notes (each note becomes its own book) or to non-image attachments (not packaged). Four touch points, all keyed on `this.profile === "epub"`:

Inline-link pass, exported-note branch (`LinkRewriter.ts:103-110`) — keep the label, drop the link:

```ts
				if (dest && this.exportedPaths.has(dest)) {
					if (this.profile === "epub") return `${imagePrefix}${label}`;
					const destination = this.exportedNoteDestination(
						dest,
						target,
						heading,
					);
					return `${imagePrefix}[${label}](${destination}${titleSuffix})`;
				}
```

Inline-link pass, attachment branch (`LinkRewriter.ts:112-124`):

```ts
				const attachment = attachmentDest
					? this.attachments.get(attachmentDest)
					: undefined;
				if (attachment) {
					if (this.profile === "epub" && !imagePrefix) {
						return label;
					}
					const rewrittenPath = this.rewriteAttachmentPath(
						attachment.outputRelativePath,
					);
					return `${imagePrefix}[${label}](${rewrittenPath}${titleSuffix})`;
				}
```

(`imagePrefix === "!"` cases fall through to `formatEmbed`-equivalent handling in Task's `formatEmbed` below; non-image `![](video.mp4)` markdown-image syntax is degraded by the renderer backstop in Task 4.)

Wiki-link pass, exported-note branch (`LinkRewriter.ts:143-145`):

```ts
			if (this.exportedPaths.has(dest)) {
				if (this.profile === "epub") return displayText;
				return this.formatExportedNoteLink(dest, displayText, target, heading);
			}
```

Wiki-link pass, attachment branch (`LinkRewriter.ts:147-150`):

```ts
			const attachment = this.attachments.get(dest);
			if (attachment) {
				if (this.profile === "epub") return displayText;
				return `[${displayText}](${this.rewriteAttachmentPath(attachment.outputRelativePath)})`;
			}
```

`formatEmbed` (`LinkRewriter.ts:219-247`) — after the `docx` branch, before the markdown-bundle fallback:

```ts
		if (this.profile === "epub") {
			if (isImageExtension(ext)) {
				return `![${link}](${relPath})`;
			}
			// Non-image attachments are not packaged; emit text, not a dead link.
			return `*${relPath.split("/").pop()} (not embedded in EPUB)*`;
		}
```

- [ ] **Step 3: Compile-driven exhaustive checks**

```bash
npx tsc -noEmit -skipLibCheck
```

Every `Record<ExportProfileId, …>` and `switch (profile)` over the union errors where `"epub"` is missing — that is the checklist. Expected remaining error site: the render switch in `src/export/ExportRunner.ts:162-175` (implemented in Task 5; temporarily satisfy it with a stub case that throws).

- [ ] **Step 4: Update tests that enumerate profiles**

```bash
npx vitest run
```

The settings-tab tests assert exact dropdown key sets — add `"epub"` to the expected desktop list (now `["docx", "epub", "html-document", "markdown-bundle", "pdf"]`). Extend `LinkRewriter.test.ts` with degradation cases:

```ts
it("degrades non-image attachment embeds to text for EPUB", () => {
	// exportedPaths empty, attachments contain "assets/clip.mp4"
	const result = rewriter.rewrite("![[clip.mp4]]", "note.md");
	expect(result.markdown).toBe("*clip.mp4 (not embedded in EPUB)*");
});

it("degrades links to exported notes for EPUB", () => {
	// exportedPaths contains "other.md", outputPathMap maps it
	const result = rewriter.rewrite("[[other]]", "note.md");
	expect(result.markdown).toBe("other");
});
```

(Adapt to that file's existing app/attachment fixture helpers.)

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: register epub profile with self-contained link handling"
```

---

### Task 3: EPUB document builders (TDD, pure functions)

**Files:**
- Create: `src/formats/epub.test.ts`
- Create: `src/formats/epub.ts`
- Modify: `src/formats/html-document.ts:216` (export `DEFAULT_CSS`)

- [ ] **Step 1: Write the failing tests**

Create `src/formats/epub.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	toXhtml,
	buildContainerXml,
	buildContentOpf,
	buildNavXhtml,
	buildChapterXhtml,
} from "@/formats/epub";

describe("toXhtml", () => {
	it("self-closes void elements", () => {
		expect(toXhtml("a<br>b<hr>c")).toBe("a<br/>b<hr/>c");
	});

	it("replaces checkbox inputs with characters", () => {
		expect(toXhtml('<li class="task-done"><input type="checkbox" checked disabled> x</li>'))
			.toBe('<li class="task-done">☑ x</li>');
		expect(toXhtml('<li class="task"><input type="checkbox" disabled> x</li>'))
			.toBe('<li class="task">☐ x</li>');
	});
});

describe("buildContainerXml", () => {
	it("points at the OEBPS package", () => {
		expect(buildContainerXml()).toContain('full-path="OEBPS/content.opf"');
	});
});

describe("buildContentOpf", () => {
	it("declares nav, css, chapters, and images with a spine", () => {
		const opf = buildContentOpf("My Book", ["ch1", "ch2"], [
			{ name: "image-1.png", mediaType: "image/png" },
		]);
		expect(opf).toContain('<dc:title>My Book</dc:title>');
		expect(opf).toContain('properties="nav"');
		expect(opf).toContain('href="chapter-1.xhtml"');
		expect(opf).toContain('href="chapter-2.xhtml"');
		expect(opf).toContain('<item id="img1" href="images/image-1.png" media-type="image/png"/>');
		expect(opf).toContain('idref="ch1"');
		expect(opf).toContain("<spine>");
	});

	it("emits spec-formatted dcterms:modified at seconds precision", () => {
		const opf = buildContentOpf("T", ["ch1"], [], "uuid-1", "2026-08-20T04:05:06.789Z");
		expect(opf).toMatch(/<meta property="dcterms:modified">2026-08-20T04:05:06Z<\/meta>/);
	});

	it("escapes XML in the title", () => {
		const opf = buildContentOpf("A & B <book>", ["ch1"], []);
		expect(opf).toContain("<dc:title>A &amp; B &lt;book&gt;</dc:title>");
	});
});

describe("buildNavXhtml", () => {
	it("lists chapter links", () => {
		const nav = buildNavXhtml("My Book", ["Intro", "Second"]);
		expect(nav).toContain('epub:type="toc"');
		expect(nav).toContain('href="chapter-1.xhtml">Intro</a>');
		expect(nav).toContain('href="chapter-2.xhtml">Second</a>');
	});
});

describe("buildChapterXhtml", () => {
	it("wraps body html in an XHTML skeleton with the stylesheet", () => {
		const chapter = buildChapterXhtml("Intro", "<h2>Intro</h2><p>Hi</p>");
		expect(chapter).toContain("<!DOCTYPE html>");
		expect(chapter).toContain('xmlns="http://www.w3.org/1999/xhtml"');
		expect(chapter).toContain('href="styles.css"');
		expect(chapter).toContain("<h2>Intro</h2>");
	});
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/formats/epub.test.ts
```

Expected: FAIL — module `@/formats/epub` does not exist.

- [ ] **Step 3: Export DEFAULT_CSS from html-document.ts**

In `src/formats/html-document.ts:216`, change `const DEFAULT_CSS =` to `export const DEFAULT_CSS =`.

- [ ] **Step 4: Implement the builders**

Create `src/formats/epub.ts`:

```ts
import { markdownToBasicHtml, escapeHtml } from "@/formats/html-document";

export function toXhtml(html: string): string {
	return html
		.replace(/<br>/g, "<br/>")
		.replace(/<hr>/g, "<hr/>")
		.replace(/<input type="checkbox" checked disabled>/g, "☑")
		.replace(/<input type="checkbox" disabled>/g, "☐");
}

export function buildContainerXml(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

export function buildContentOpf(
	title: string,
	chapterIds: string[],
	images: { name: string; mediaType: string }[],
	uuid = crypto.randomUUID(),
	modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
): string {
	const manifest = [
		'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
		'<item id="css" href="styles.css" media-type="text/css"/>',
		...chapterIds.map((id) =>
			`<item id="${id}" href="chapter-${id.slice(2)}.xhtml" media-type="application/xhtml+xml"/>`),
		// Sequential ids + generated filenames: raw attachment names with
		// spaces/&/quotes/CJK never become XML ids or hrefs.
		...images.map((img, i) =>
			`<item id="img${i + 1}" href="images/${img.name}" media-type="${img.mediaType}"/>`),
	].join("\n    ");
	const spine = ["nav", ...chapterIds]
		.map((id) => `<itemref idref="${id}"/>`)
		.join("\n    ");
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;
}

export function buildNavXhtml(title: string, chapterTitles: string[]): string {
	const items = chapterTitles
		.map((t, i) => `<li><a href="chapter-${i + 1}.xhtml">${escapeXml(t)}</a></li>`)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>${escapeXml(title)}</h1>
    <ol>${items}</ol>
  </nav>
</body>
</html>`;
}

export function buildChapterXhtml(title: string, bodyHtml: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeXml(value: string): string {
	return escapeHtml(value);
}

export function imageMediaType(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	const types: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		bmp: "image/bmp",
	};
	return types[ext] ?? "application/octet-stream";
}
```

Note the chapter-id convention: ids are `ch1`, `ch2`, … and `chapter-${id.slice(2)}.xhtml` yields `chapter-1.xhtml`. `buildContentOpf`, `buildNavXhtml`, and the renderer all derive from the same index arrays.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/formats/epub.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/formats/epub.ts src/formats/epub.test.ts src/formats/html-document.ts
git commit -m "feat: add EPUB 3 document builders"
```

---

### Task 4: The renderEpub pipeline

**Files:**
- Modify: `src/formats/epub.ts` (append renderer)
- Test: `src/formats/epub.test.ts` (append)

- [ ] **Step 1: Write the failing integration tests**

Append to `src/formats/epub.test.ts`:

```ts
import { vi } from "vitest";
import { renderEpub } from "@/formats/epub";
import { AssembledDocument, AttachmentCopy, ExportPlan } from "@/types";
import { readStoredZipEntry } from "@/formats/testZip";

function makeWriter() {
	let written: Uint8Array | null = null;
	return {
		writer: {
			ensureFolder: vi.fn().mockResolvedValue(undefined),
			writeBinary: vi.fn((_path: string, data: Uint8Array) => {
				written = data;
				return Promise.resolve();
			}),
		},
		get written() { return written; },
	};
}

function makeDoc(markdown: string, attachments: AttachmentCopy[] = []): AssembledDocument {
	return {
		title: "Fixture",
		sections: [{
			sourcePath: "fixture.md",
			title: "Fixture",
			markdown,
			frontmatter: {},
		}],
		attachments,
	};
}

const PLAN = {
	outputRoot: "output",
	outputFilename: "fixture.epub",
} as ExportPlan;

describe("renderEpub", () => {
	it("writes a single .epub", async () => {
		const w = makeWriter();
		const paths: string[] = [];
		w.writer.writeBinary.mockImplementation((path: string) => {
			paths.push(path);
			return Promise.resolve();
		});
		await renderEpub(makeDoc("# Hello\n\nWorld"), PLAN, w.writer as never, null);

		expect(paths).toEqual(["output/fixture.epub"]);
	});

	it("mimetype is the first entry, stored, with no extra field", async () => {
		const w = makeWriter();
		await renderEpub(makeDoc("Body"), PLAN, w.writer as never, null);
		const data = w.written!;

		const view = new DataView(data.buffer, data.byteOffset, 30);
		expect(view.getUint32(0, true)).toBe(0x04034b50); // local file header
		const nameLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		expect(new TextDecoder().decode(data.slice(30, 30 + nameLength))).toBe("mimetype");
		expect(view.getUint16(8, true)).toBe(0); // stored, no compression
		expect(extraLength).toBe(0);
	});

	it("produces container, package, nav, chapter, and stylesheet entries", async () => {
		const w = makeWriter();
		await renderEpub(makeDoc("Body"), PLAN, w.writer as never, null);
		const data = w.written!;

		expect(readStoredZipEntry(data, "mimetype")).toBe("application/epub+zip");
		expect(readStoredZipEntry(data, "META-INF/container.xml")).toContain("OEBPS/content.opf");
		expect(readStoredZipEntry(data, "OEBPS/content.opf")).toContain("<dc:title>Fixture</dc:title>");
		expect(readStoredZipEntry(data, "OEBPS/nav.xhtml")).toContain('epub:type="toc"');
		expect(readStoredZipEntry(data, "OEBPS/chapter-1.xhtml")).toContain("<p>Body</p>");
		expect(readStoredZipEntry(data, "OEBPS/styles.css")).toContain("body");
	});

	it("embeds images under generated names and rewrites references", async () => {
		const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "vault/my image (1).png" ? { path, extension: "png" } : null,
				readBinary: async () => pngBytes.buffer,
			},
		} as never;
		const w = makeWriter();
		const doc = makeDoc("![img](assets/my image (1).png)", [{
			sourcePath: "vault/my image (1).png",
			outputRelativePath: "assets/my image (1).png",
		}]);

		await renderEpub(doc, PLAN, w.writer as never, app);
		const data = w.written!;

		// Raw filename never reaches the package path or the OPF
		expect(readStoredZipEntry(data, "OEBPS/images/image-1.png")).toBeDefined();
		expect(readStoredZipEntry(data, "OEBPS/content.opf")).toContain('id="img1" href="images/image-1.png"');
		expect(readStoredZipEntry(data, "OEBPS/chapter-1.xhtml")).toContain('src="images/image-1.png"');
	});

	it("rewrites ../assets/ references from batch exports", async () => {
		const app = {
			vault: {
				getAbstractFileByPath: () => ({ path: "vault/img.png", extension: "png" }),
				readBinary: async () => new Uint8Array([1]).buffer,
			},
		} as never;
		const w = makeWriter();
		const doc = makeDoc("![img](../assets/img.png)", [{
			sourcePath: "vault/img.png",
			outputRelativePath: "assets/img.png",
		}]);
		const plan = { ...PLAN, outputRoot: "output/nested" } as ExportPlan;

		await renderEpub(doc, plan, w.writer as never, app);
		expect(readStoredZipEntry(w.written!, "OEBPS/chapter-1.xhtml")).toContain('src="images/image-1.png"');
	});

	it("degrades stray non-image <img> tags to text instead of dead links", async () => {
		const w = makeWriter();
		// No app → no images collected; the markdown image survives rewriting
		await renderEpub(makeDoc("![clip](assets/clip.mp4)"), PLAN, w.writer as never, null);

		const chapter = readStoredZipEntry(w.written!, "OEBPS/chapter-1.xhtml");
		expect(chapter).not.toContain("<img");
		expect(chapter).toContain("<em>");
	});

	it("strips relative <a> links that have no package target", async () => {
		const w = makeWriter();
		await renderEpub(makeDoc("[dead](notes/other.md)"), PLAN, w.writer as never, null);

		const chapter = readStoredZipEntry(w.written!, "OEBPS/chapter-1.xhtml");
		expect(chapter).not.toContain("<a href=\"notes/other.md\"");
		expect(chapter).toContain("dead");
	});
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/formats/epub.test.ts
```

Expected: new tests FAIL — `renderEpub` is not exported.

- [ ] **Step 3: Implement renderEpub**

Append to `src/formats/epub.ts` (adding the imports the renderer needs alongside the Task 3 ones):

```ts
import { App, TFile } from "obsidian";
import { AssembledDocument, AttachmentCopy, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { createZip } from "@/formats/zip";
import { DEFAULT_CSS } from "@/formats/html-document";

const encoder = new TextEncoder();

type EpubImage = {
	sourcePath: string;
	outputRelativePath: string;
	name: string;
	mediaType: string;
	data: Uint8Array;
};

export async function renderEpub(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App | null = null,
	outputFilePath?: string,
): Promise<string[]> {
	const warnings: string[] = [];

	const images = await collectEpubImages(doc.attachments, app, warnings);
	const chapters = buildChapters(doc);
	const chapterIds = chapters.map((_, i) => `ch${i + 1}`);

	const files: { name: string; data: Uint8Array }[] = [
		{ name: "mimetype", data: encoder.encode("application/epub+zip") },
		{ name: "META-INF/container.xml", data: encoder.encode(buildContainerXml()) },
		{ name: "OEBPS/content.opf", data: encoder.encode(
			buildContentOpf(
				doc.title,
				chapterIds,
				images.map((img) => ({ name: img.name, mediaType: img.mediaType })),
			)) },
		{ name: "OEBPS/nav.xhtml", data: encoder.encode(
			buildNavXhtml(doc.title, chapters.map((c) => c.title))) },
		{ name: "OEBPS/styles.css", data: encoder.encode(DEFAULT_CSS) },
	];
	chapters.forEach((chapter, i) => {
		files.push({
			name: `OEBPS/chapter-${i + 1}.xhtml`,
			data: encoder.encode(
				buildChapterXhtml(chapter.title, finalizeChapterHtml(chapter.html, images))),
		});
	});
	for (const img of images) {
		files.push({ name: `OEBPS/images/${img.name}`, data: img.data });
	}

	const buffer = createZip(files);
	const resolved = outputFilePath
		?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm|pdf|docx|epub)$/i, "")}.epub`;
	await writer.ensureFolder(resolved.substring(0, resolved.lastIndexOf("/")));
	await writer.writeBinary(resolved, buffer);

	return warnings;
}

function buildChapters(doc: AssembledDocument): { title: string; html: string }[] {
	const isSingle = doc.sections.length === 1;
	return doc.sections.map((section, i) => {
		const skipHeading = isSingle && section.title === doc.title;
		const heading = skipHeading ? "" : `<h2>${escapeHtml(section.title)}</h2>`;
		const body = toXhtml(markdownToBasicHtml(section.markdown));
		return { title: section.title || `Chapter ${i + 1}`, html: `${heading}${body}` };
	});
}

async function collectEpubImages(
	attachments: AttachmentCopy[],
	app: App | null,
	warnings: string[],
): Promise<EpubImage[]> {
	if (!app) return [];
	const images: EpubImage[] = [];
	for (const att of attachments) {
		const ext = att.sourcePath.split(".").pop()?.toLowerCase() ?? "";
		if (!isImageExtension(ext)) continue;
		try {
			const file = app.vault.getAbstractFileByPath(att.sourcePath);
			if (!file || !("extension" in file)) continue;
			const buffer = await app.vault.readBinary(file as TFile);
			images.push({
				sourcePath: att.sourcePath,
				outputRelativePath: att.outputRelativePath,
				name: `image-${images.length + 1}.${ext}`,
				mediaType: imageMediaType(`x.${ext}`),
				data: new Uint8Array(buffer),
			});
		} catch {
			warnings.push(`Failed to embed image in EPUB: ${att.sourcePath}`);
		}
	}
	return images;
}

function finalizeChapterHtml(html: string, images: EpubImage[]): string {
	const byKey = new Map<string, string>();
	for (const img of images) {
		byKey.set(img.outputRelativePath, img.name);
		byKey.set(img.outputRelativePath.split("/").pop() ?? img.name, img.name);
	}

	let result = html.replace(
		/<img src="([^"]+)" alt="([^"]*)" \/>/g,
		(match, src: string, alt: string) => {
			const key = src.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
			const name = byKey.get(key) ?? byKey.get(key.split("/").pop() ?? key);
			if (name) return `<img src="images/${name}" alt="${alt}" />`;
			// Stray non-image reference (e.g. ![](video.mp4)): no dead links in the package.
			const label = alt || key.split("/").pop() || "attachment";
			return `<em>${label}</em>`;
		},
	);

	// Relative hrefs that survived LinkRewriter (unresolved local links) have
	// no target inside the package; keep the text, drop the anchor.
	result = result.replace(
		/<a href="([^"]*)">([\s\S]*?)<\/a>/g,
		(match, href: string, text: string) => {
			if (/^(?:https?:|mailto:|data:|#)/i.test(href)) return match;
			return text;
		},
	);

	return result;
}

function isImageExtension(ext: string): boolean {
	return ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext);
}
```

Key correctness points:
- `mimetype` is the first array entry and the ZIP writer preserves order with zero compression — both EPUB spec requirements already satisfied by the shared writer (now asserted in tests).
- Internal image names are generated (`image-N.ext`) — raw attachment filenames with spaces/`&`/CJK never reach package paths, XML ids, or hrefs, so no sanitization or URL-encoding layer is needed.
- `finalizeChapterHtml` matches both `assets/img.png` (single-file at root) and `../assets/img.png` (batch, nested) forms produced by `LinkRewriter.rewriteAttachmentPath`, mirroring the key map `docx.ts` builds at `src/formats/docx.ts:179-181`. Duplicate basenames across folders are pre-deduplicated by `AttachmentCollector.uniqueName`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/formats/epub.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/formats/epub.ts src/formats/epub.test.ts
git commit -m "feat: render self-contained EPUB 3 packages"
```

---

### Task 5: Runner wiring, docs, verification, release

**Files:**
- Modify: `src/export/ExportRunner.ts:162-175` (switch), `:187-209` (Step 6 skip)
- Modify: `README.md:1-14` (description + features), `README.md:71-76` (limitations)

- [ ] **Step 1: Add the runner case**

In `src/export/ExportRunner.ts`, import the renderer:

```ts
import { renderEpub } from "@/formats/epub";
```

Replace the Task 2 stub case in the Step 5 switch with:

```ts
					case "epub":
						formatWarnings = await renderEpub(doc, effectivePlan, writer, this.app, outputFilePath);
						break;
```

Batch output filenames already resolve correctly: `ExportPlan.computeOutputFiles` builds them via `extensionForProfile(layout.profile)` (`src/export/ExportPlan.ts:36`), which gained the epub case in Task 2.

- [ ] **Step 2: Skip external attachment copying for EPUB**

Everything the `.epub` needs is inside the ZIP; copying attachments next to it would produce stray `assets/` folders and dangling duplicates. Guard Step 6 (`ExportRunner.ts:187`):

```ts
			// Step 6: Copy attachments (deduplicate across files) — not for EPUB,
			// whose images are packaged inside the .epub itself.
			if (effectivePlan.profile !== "epub" && doc.attachments.length > 0) {
```

(The whole block — `ensureFolder`, the copy loop — sits behind this condition.)

- [ ] **Step 3: Update README**

Description line — extend to mention EPUB:

```markdown
Export single notes, entire folders, or hand-picked files into PDF, Word, EPUB, Markdown bundles, and HTML documents. Supports batch export with directory structure preservation.
```

Features list — add:

```markdown
- EPUB e-books with embedded images and a navigable table of contents (desktop and mobile)
```

Limitations — add:

```markdown
- EPUB embeds images only; other attachments and links between notes are omitted
```

- [ ] **Step 4: Full CI matrix**

```bash
npm run check:version && npm run lint:obsidian-warnings && npx tsc -noEmit -skipLibCheck && npm run build && npm test
```

Expected: all pass.

- [ ] **Step 5: Manual smoke test with EPUBCheck**

1. Build, reload Obsidian.
2. Export three fixture notes to EPUB: one plain (headings, task list), one with images and a video attachment, one batch of three notes. Also export once with a note containing `![[embedded note]]` (requires the v0.6 embed plan landed) to check combined behavior.
3. Validate with EPUBCheck — the reference conformance checker:

```bash
curl -sL https://github.com/w3c/epubcheck/releases/download/v5.1.0/epubcheck-5.1.0.zip -o /tmp/epubcheck.zip
unzip -o /tmp/epubcheck.zip -d /tmp
java -jar /tmp/epubcheck-5.1.0/epubcheck.jar "exports/plain note.epub"
```

Expected: `No errors or warnings detected.` (or only warnings you have consciously accepted). Repeat for the image/video fixture and one batch output — the video must appear as text, not a link.
4. Open the plain fixture in Apple Books and Thorium Reader — TOC navigates, image renders, task checkboxes show as ☑/☐.
5. Confirm no `assets/` folder is created next to any `.epub`.
6. Mobile path: with `Platform.isDesktopApp = false` logic (or a real mobile device), EPUB appears in the format dropdown and completes.

- [ ] **Step 6: Bump the version inside the PR**

```bash
npm version 0.7.0 --no-git-tag-version
git add package.json package-lock.json   # manifest.json + versions.json already staged by the version script
git commit -m "chore: bump version to 0.7.0"
```

- [ ] **Step 7: Release**

```bash
git checkout -b feat/epub-export
git push -u origin feat/epub-export
# PR → review → merge, then from the updated main:
git checkout main && git pull
git tag -a 0.7.0
git push origin 0.7.0   # CI creates the release
```

---

## Self-Review Notes

- Review coverage: self-containment via degradation + Step 6 skip (Tasks 2, 4, 5), generated internal names + sequential ids so raw filenames never reach XML/URLs (Tasks 3–4), seconds-precision `dcterms:modified` (Task 3, with test), mimetype-first/stored/no-extra structural assertion (Task 4), EPUBCheck gate (Task 5), version bump before tag (Task 5).
- Ordering dependencies: Task 2's exhaustive-union errors intentionally point at the Task 5 runner case — the temporary throwing stub keeps `tsc` green between commits. Task 2 assumes the declarative-settings `SETTING_META` exists (v0.5.0); executed standalone, only the `aliases` extension step needs adaptation.
- Type consistency: chapter ids `ch1…chN` ↔ `chapter-N.xhtml` ↔ `idref` stay aligned across `buildContentOpf`, `buildNavXhtml`, and `renderEpub` — all derive from the same index arrays. `imageMediaType("x." + ext)` reuses the exported mapper by extension.
- `escapeXml` reuses `escapeHtml` (`& < > "`, sufficient for XML text and attribute contexts).
- Batch output filenames route through `extensionForProfile` (verified at `src/export/ExportPlan.ts:36` / `src/export/utils.ts:51`), so the Task 2 switch case is the only filename plumbing the new profile needs.
- Residual known gap (accepted): external `http(s)` links are kept as live anchors — spec-valid since they're absolute URLs, though readers may be offline.
