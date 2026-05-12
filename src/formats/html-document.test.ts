import { describe, it, expect, vi } from "vitest";

// Test the internal rendering functions by testing through the exported renderHtmlDocument
// We need to test the generated HTML structure

describe("HTML Document rendering", () => {
	// Since the rendering functions are private, we test through the output
	// by examining the generated HTML string

	describe("TOC generation", () => {
		it("generates TOC with section links", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "Section A", markdown: "Content A", frontmatter: {} },
				{ sourcePath: "b.md", title: "Section B", markdown: "Content B", frontmatter: {} },
			]);

			expect(html).toContain("Table of Contents");
			expect(html).toContain('href="#section-0"');
			expect(html).toContain('href="#section-1"');
			expect(html).toContain("Section A");
			expect(html).toContain("Section B");
		});
	});

	describe("section rendering", () => {
		it("wraps each section with id", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "Test", markdown: "Hello", frontmatter: {} },
			]);

			expect(html).toContain('id="section-0"');
		});

		it("escapes HTML in titles", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "<script>alert(1)</script>", markdown: "x", frontmatter: {} },
			]);

			expect(html).toContain("&lt;script&gt;");
			expect(html).not.toContain("<script>alert(1)</script>");
		});
	});

	describe("asset URLs", () => {
		it("copies attachments to assets folder", async () => {
			const writtenFiles: string[] = [];
			const writer = createTestWriter(writtenFiles);

			const doc = {
				title: "Test",
				sections: [{ sourcePath: "a.md", title: "A", markdown: "x", frontmatter: {} }],
				attachments: [{ sourcePath: "img.png", outputRelativePath: "assets/img.png" }],
			};
			const plan = { outputRoot: "exports", outputFilename: "index", profile: "html-document" as const };

			await invokeRenderHtml(doc, plan, writer);

			expect(writtenFiles).toContain("exports/assets");
		});
	});

	describe("print-ready mode", () => {
		it("includes print stylesheet", async () => {
			const { html } = await renderTestHtml(
				[{ sourcePath: "a.md", title: "A", markdown: "x", frontmatter: {} }],
				true,
			);

			expect(html).toContain("@media print");
			expect(html).toContain("title-page");
		});

		it("regular mode excludes print stylesheet", async () => {
			const { html } = await renderTestHtml(
				[{ sourcePath: "a.md", title: "A", markdown: "x", frontmatter: {} }],
				false,
			);

			expect(html).not.toContain("@media print");
			expect(html).not.toContain("title-page");
		});
	});
});

// Test helpers

function createTestWriter(writtenFiles: string[]) {
	return {
		ensureFolder: vi.fn((path: string) => { writtenFiles.push(path); return Promise.resolve(); }),
		writeText: vi.fn((path: string, content: string) => { writtenFiles.push(path); return Promise.resolve(); }),
		copyBinaryFile: vi.fn((src: string, dest: string) => { writtenFiles.push(dest); return Promise.resolve(); }),
		folderExists: vi.fn(() => Promise.resolve(false)),
		timestampedFolder: vi.fn((base: string) => Promise.resolve(`${base}-ts`)),
	};
}

interface TestSection {
	sourcePath: string;
	title: string;
	markdown: string;
	frontmatter: Record<string, unknown>;
}

async function renderTestHtml(sections: TestSection[], printReady = false) {
	const writtenFiles: string[] = [];
	const writer = createTestWriter(writtenFiles);

	const doc = {
		title: "Test Document",
		sections,
		attachments: [],
	};
	const plan = { outputRoot: "exports", outputFilename: "index", profile: "html-document" as const };

	await invokeRenderHtml(doc, plan, writer, printReady);

	const writeCall = (writer.writeText as unknown as { mock: { calls: string[][] } }).mock.calls.find(
		(c) => c[0].endsWith(".html"),
	);
	const html = writeCall ? writeCall[1] : "";

	return { html, writtenFiles };
}

async function invokeRenderHtml(
	doc: { title: string; sections: TestSection[]; attachments: { sourcePath: string; outputRelativePath: string }[] },
	plan: { outputRoot: string; outputFilename: string; profile: "html-document" },
	writer: ReturnType<typeof createTestWriter>,
	printReady = false,
) {
	// Inline the import to avoid circular issues
	const mod = await import("@/formats/html-document");
	return mod.renderHtmlDocument(doc, plan as unknown as Parameters<typeof mod.renderHtmlDocument>[1], writer as unknown as Parameters<typeof mod.renderHtmlDocument>[2], printReady);
}
