import { describe, expect, it, vi } from "vitest";
import { renderDocx } from "@/formats/docx";
import { AssembledDocument, ExportPlan } from "@/types";

describe("DOCX rendering", () => {
	it("writes a minimal DOCX package without external dependencies", async () => {
		let writtenPath = "";
		let writtenData: Uint8Array | null = null;
		const writer = {
			ensureFolder: vi.fn(),
			writeBinary: vi.fn((path: string, data: Uint8Array) => {
				writtenPath = path;
				writtenData = data;
			}),
		};
		const doc: AssembledDocument = {
			title: "Export title",
			sections: [{
				title: "Export title",
				sourcePath: "Note.md",
				markdown: "# Heading\n\nA **bold** paragraph with `code`.",
				frontmatter: {},
			}],
			attachments: [],
		};
		const plan = {
			outputRoot: "output",
			outputFilename: "document.docx",
		} as ExportPlan;

		const warnings = await renderDocx(doc, plan, writer as never);

		expect(warnings).toEqual([]);
		expect(writtenPath).toBe("output/document.docx");
		expect(writtenData).not.toBeNull();
		expect(writtenData?.[0]).toBe(0x50);
		expect(writtenData?.[1]).toBe(0x4b);
		const packageText = new TextDecoder().decode(writtenData ?? new Uint8Array());
		expect(packageText).toContain("[Content_Types].xml");
		expect(packageText).toContain("word/document.xml");
		expect(packageText).toContain("Export title");
		expect(packageText).toContain("Heading");
		expect(packageText).toContain("bold");
	});

	it("supports heading levels 4-6", async () => {
		let writtenData: Uint8Array | null = null;
		const writer = {
			ensureFolder: vi.fn(),
			writeBinary: vi.fn((_path: string, data: Uint8Array) => {
				writtenData = data;
			}),
		};
		const doc: AssembledDocument = {
			title: "Test",
			sections: [{
				title: "Test",
				sourcePath: "a.md",
				markdown: "#### H4\n##### H5\n###### H6",
				frontmatter: {},
			}],
			attachments: [],
		};
		const plan = { outputRoot: "output", outputFilename: "test.docx" } as ExportPlan;

		await renderDocx(doc, plan, writer as never);

		const packageText = new TextDecoder().decode(writtenData ?? new Uint8Array());
		expect(packageText).toContain("Heading4");
		expect(packageText).toContain("Heading5");
		expect(packageText).toContain("Heading6");
	});

	it("includes image drawing elements when attachments are present", async () => {
		let writtenData: Uint8Array | null = null;
		const writer = {
			ensureFolder: vi.fn(),
			writeBinary: vi.fn((_path: string, data: Uint8Array) => {
				writtenData = data;
			}),
		};

		// Create a minimal valid PNG (1x1 white pixel)
		const pngData = createMinimalPng();

		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === "assets/image.png") {
						return { path, extension: "png", name: "image.png" };
					}
					return null;
				}),
				readBinary: vi.fn(() => Promise.resolve(pngData.buffer)),
			},
		};

		const doc: AssembledDocument = {
			title: "Image Test",
			sections: [{
				title: "Image Test",
				sourcePath: "note.md",
				markdown: "![alt text](assets/image.png)",
				frontmatter: {},
			}],
			attachments: [{
				sourcePath: "assets/image.png",
				outputRelativePath: "assets/image.png",
			}],
		};
		const plan = { outputRoot: "output", outputFilename: "test.docx" } as ExportPlan;

		const warnings = await renderDocx(doc, plan, writer as never, app as never);

		expect(warnings).toEqual([]);
		const packageText = new TextDecoder().decode(writtenData ?? new Uint8Array());
		expect(packageText).toContain("w:drawing");
		expect(packageText).toContain("a:blip");
		expect(packageText).toContain("word/media/image1.png");
		expect(packageText).toContain("word/_rels/document.xml.rels");
		expect(packageText).toContain("image/png");
	});

	it("embeds rewritten wiki image embeds instead of printing html img text", async () => {
		let writtenData: Uint8Array | null = null;
		const writer = {
			ensureFolder: vi.fn(),
			writeBinary: vi.fn((_path: string, data: Uint8Array) => {
				writtenData = data;
			}),
		};
		const pngData = createMinimalPng();
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === "assets/image.png") {
						return { path, extension: "png", name: "image.png" };
					}
					return null;
				}),
				readBinary: vi.fn(() => Promise.resolve(pngData.buffer)),
			},
		};
		const doc: AssembledDocument = {
			title: "Image Test",
			sections: [{
				title: "Image Test",
				sourcePath: "note.md",
				markdown: "![image.png](assets/image.png)",
				frontmatter: {},
			}],
			attachments: [{
				sourcePath: "assets/image.png",
				outputRelativePath: "assets/image.png",
			}],
		};
		const plan = { outputRoot: "output", outputFilename: "test.docx" } as ExportPlan;

		await renderDocx(doc, plan, writer as never, app as never);

		const packageText = new TextDecoder().decode(writtenData ?? new Uint8Array());
		expect(packageText).toContain("w:drawing");
		expect(packageText).not.toContain("&lt;img");
		expect(packageText).not.toContain("src=&quot;");
	});

	it("embeds multiple images by their rewritten attachment paths", async () => {
		let writtenData: Uint8Array | null = null;
		const writer = {
			ensureFolder: vi.fn(),
			writeBinary: vi.fn((_path: string, data: Uint8Array) => {
				writtenData = data;
			}),
		};
		const pngData = createMinimalPng();
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === "attachments/one.png" || path === "attachments/two.png") {
						return { path, extension: "png", name: path.split("/").pop() };
					}
					return null;
				}),
				readBinary: vi.fn(() => Promise.resolve(pngData.buffer)),
			},
		};
		const doc: AssembledDocument = {
			title: "Image Test",
			sections: [{
				title: "Image Test",
				sourcePath: "note.md",
				markdown: "![one](attachments/one.png)\n![two](attachments/two.png)",
				frontmatter: {},
			}],
			attachments: [
				{ sourcePath: "attachments/one.png", outputRelativePath: "attachments/one.png" },
				{ sourcePath: "attachments/two.png", outputRelativePath: "attachments/two.png" },
			],
		};
		const plan = { outputRoot: "output", outputFilename: "test.docx" } as ExportPlan;

		await renderDocx(doc, plan, writer as never, app as never);

		const packageText = new TextDecoder().decode(writtenData ?? new Uint8Array());
		expect(packageText.match(/<w:drawing>/g)).toHaveLength(2);
		expect(packageText).not.toContain("[Image: one]");
		expect(packageText).not.toContain("[Image: two]");
	});

	it("falls back to text placeholder when app is null", async () => {
		let writtenData: Uint8Array | null = null;
		const writer = {
			ensureFolder: vi.fn(),
			writeBinary: vi.fn((_path: string, data: Uint8Array) => {
				writtenData = data;
			}),
		};
		const doc: AssembledDocument = {
			title: "Test",
			sections: [{
				title: "Test",
				sourcePath: "a.md",
				markdown: "![alt](image.png)",
				frontmatter: {},
			}],
			attachments: [{
				sourcePath: "assets/image.png",
				outputRelativePath: "assets/image.png",
			}],
		};
		const plan = { outputRoot: "output", outputFilename: "test.docx" } as ExportPlan;

		await renderDocx(doc, plan, writer as never, null);

		const packageText = new TextDecoder().decode(writtenData ?? new Uint8Array());
		expect(packageText).toContain("[Image: alt]");
	});
});

function createMinimalPng(): Uint8Array {
	// Minimal valid 1x1 white PNG
	const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

	// IHDR chunk: 1x1 8-bit RGB
	const ihdrData = new Uint8Array(13);
	const ihdrView = new DataView(ihdrData.buffer);
	ihdrView.setUint32(0, 1, false); // width
	ihdrView.setUint32(4, 1, false); // height
	ihdrData[8] = 8; // bit depth
	ihdrData[9] = 2; // color type (RGB)
	ihdrData[10] = 0; // compression
	ihdrData[11] = 0; // filter
	ihdrData[12] = 0; // interlace
	const ihdrChunk = makePngChunk("IHDR", ihdrData);

	// IDAT chunk: single white pixel (filter byte 0 + RGB 255,255,255)
	const rawData = new Uint8Array([0, 255, 255, 255]);
	// Simple deflate (store block)
	const idatData = new Uint8Array(2 + 5 + 4);
	idatData[0] = 0x78; // zlib header
	idatData[1] = 0x01;
	idatData[2] = 0x01; // final block, stored
	idatData[3] = 0x04; // length low (rawData.length)
	idatData[4] = 0x00; // length high
	idatData[5] = 0xfb; // ~length low
	idatData[6] = 0xff; // ~length high
	idatData.set(rawData, 7);
	// Adler-32 of rawData
	const adler = adler32(rawData);
	const adlerView = new DataView(idatData.buffer);
	adlerView.setUint32(idatData.length - 4, adler, false);
	const idatChunk = makePngChunk("IDAT", idatData);

	// IEND chunk
	const iendChunk = makePngChunk("IEND", new Uint8Array(0));

	const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
	const result = new Uint8Array(total);
	let offset = 0;
	result.set(signature, offset); offset += signature.length;
	result.set(ihdrChunk, offset); offset += ihdrChunk.length;
	result.set(idatChunk, offset); offset += idatChunk.length;
	result.set(iendChunk, offset);
	return result;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
	const typeBytes = new TextEncoder().encode(type);
	const chunk = new Uint8Array(4 + 4 + data.length + 4);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, data.length, false);
	chunk.set(typeBytes, 4);
	chunk.set(data, 8);
	// CRC of type + data
	const crcInput = new Uint8Array(4 + data.length);
	crcInput.set(typeBytes, 0);
	crcInput.set(data, 4);
	const crc = crc32Simple(crcInput);
	view.setUint32(chunk.length - 4, crc, false);
	return chunk;
}

function crc32Simple(data: Uint8Array): number {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) {
			c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		}
		table[i] = c >>> 0;
	}
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (const byte of data) {
		a = (a + byte) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}
