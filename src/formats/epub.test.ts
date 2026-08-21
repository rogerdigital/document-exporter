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

import { vi } from "vitest";
import { renderEpub } from "@/formats/epub";
import type { AssembledDocument, AttachmentCopy, ExportPlan } from "@/types";
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

	it("puts mimetype first, stored, with no extra field", async () => {
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
		const plan = { ...PLAN, outputRoot: "output/nested" };

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
		expect(chapter).not.toContain('<a href="notes/other.md"');
		expect(chapter).toContain("dead");
	});
});
