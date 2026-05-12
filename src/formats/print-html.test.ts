import { describe, it, expect, vi } from "vitest";

describe("print-html", () => {
	it("delegates to renderHtmlDocument with printReady=true", async () => {
		const writer = {
			ensureFolder: vi.fn(),
			writeText: vi.fn((path: string, content: string) => Promise.resolve(content)),
			copyBinaryFile: vi.fn(),
			folderExists: vi.fn(),
			timestampedFolder: vi.fn(),
		};

		const doc = {
			title: "Test",
			sections: [{ sourcePath: "a.md", title: "A", markdown: "Hello", frontmatter: {} }],
			attachments: [],
		};
		const plan = {
			profile: "print-html" as const,
			source: { type: "folder" as const, path: "notes", recursive: true },
			inputFiles: ["a.md"],
			outputRoot: "exports",
			outputFilename: "index",
			outputFiles: ["exports/index.html"],
			attachmentCopies: [],
			sort: { mode: "path" as const, direction: "asc" as const },
		};

		const mod = await import("@/formats/print-html");
		const result = await mod.renderPrintHtml(doc, plan, writer as never);
		expect(result).toEqual([]);

		// Verify the HTML output contains print-specific CSS
		const writeCall = writer.writeText.mock.calls[0];
		expect(writeCall[0]).toBe("exports/index.html");
		expect(writeCall[1]).toContain("@media print");
		expect(writeCall[1]).toContain("title-page");
	});
});
