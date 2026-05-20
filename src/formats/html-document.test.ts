import { describe, it, expect, vi } from "vitest";

describe("HTML Document rendering", () => {
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

	describe("XSS prevention", () => {
		it("escapes HTML in markdown body content", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "Safe", markdown: '<img src=x onerror="alert(1)">', frontmatter: {} },
			]);

			expect(html).not.toContain('onerror="alert(1)"');
			expect(html).toContain("&lt;img");
		});

		it("preserves code block content unmangled", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "Code", markdown: "```html\n<div>hi</div>\n```", frontmatter: {} },
			]);

			expect(html).toContain("<pre><code>");
			expect(html).toContain("&lt;div&gt;hi&lt;/div&gt;");
		});
	});

	describe("markdown features", () => {
		it("renders bold and italic", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "A", markdown: "**bold** and *italic*", frontmatter: {} },
			]);

			expect(html).toContain("<strong>bold</strong>");
			expect(html).toContain("<em>italic</em>");
		});

		it("renders blockquotes", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "A", markdown: "> quoted text", frontmatter: {} },
			]);

			expect(html).toContain("<blockquote>");
		});

		it("renders unordered lists", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "A", markdown: "- item one\n- item two", frontmatter: {} },
			]);

			expect(html).toContain("<ul>");
			expect(html).toContain("<li>item one</li>");
		});

		it("renders ordered lists", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "A", markdown: "1. first\n2. second", frontmatter: {} },
			]);

			expect(html).toContain("<ol>");
			expect(html).toContain("<li>first</li>");
		});

		it("renders horizontal rules", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "A", markdown: "above\n\n---\n\nbelow", frontmatter: {} },
			]);

			expect(html).toContain("<hr>");
		});

		it("renders strikethrough", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "A", markdown: "~~deleted~~", frontmatter: {} },
			]);

			expect(html).toContain("<del>deleted</del>");
		});

		it("renders task lists", async () => {
			const { html } = await renderTestHtml([
				{ sourcePath: "a.md", title: "A", markdown: "- [x] done\n- [ ] todo", frontmatter: {} },
			]);

			expect(html).toContain("checked");
			expect(html).toContain("task-done");
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

async function renderTestHtml(sections: TestSection[]) {
	const writtenFiles: string[] = [];
	const writer = createTestWriter(writtenFiles);

	const doc = {
		title: "Test Document",
		sections,
		attachments: [],
	};
	const plan = { outputRoot: "exports", outputFilename: "index", profile: "html-document" as const };

	await invokeRenderHtml(doc, plan, writer);

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
) {
	const mod = await import("@/formats/html-document");
	return mod.renderHtmlDocument(doc, plan as unknown as Parameters<typeof mod.renderHtmlDocument>[1], writer as unknown as Parameters<typeof mod.renderHtmlDocument>[2]);
}
