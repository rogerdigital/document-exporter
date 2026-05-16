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
});
