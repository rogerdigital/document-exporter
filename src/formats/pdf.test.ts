import { describe, expect, it } from "vitest";
import { buildPdfHtml, buildPdfDocumentWriteScript, createPdfBrowserWindowOptions } from "@/formats/pdf";

describe("PDF rendering", () => {
	it("appends page reset styles after app styles", () => {
		const html = buildPdfHtml(
			"<h1>Title</h1><p>Content</p>",
			"body { overflow: clip; contain: strict; }\nbody.app-container { display: flex; }",
		);

		const appStyleIndex = html.indexOf("contain: strict");
		const resetIndex = html.indexOf("contain: none !important");

		expect(resetIndex).toBeGreaterThan(appStyleIndex);
		expect(html).not.toContain('<body class="app-container markdown-rendered">');
		expect(html).toContain('<main class="pdf-export-page markdown-rendered">');
		expect(html).toContain("display: block !important");
		expect(html).toContain("<p>Content</p>");
	});

	it("adds PDF-specific image sizing rules", () => {
		const html = buildPdfHtml("<p><img src=\"image.png\"></p>", "");

		expect(html).toContain(".pdf-export-page img");
		expect(html).toContain("max-width: min(100%, 420px)");
		expect(html).toContain("display: block");
		expect(html).toContain("margin: 1rem auto");
	});

	it("creates the print window hidden and non-focusable", () => {
		const options = createPdfBrowserWindowOptions();

		expect(options.show).toBe(false);
		expect(options.focusable).toBe(false);
		expect(options.skipTaskbar).toBe(true);
	});

	it("builds a document-write script instead of relying on data URLs", () => {
		const html = '<!DOCTYPE html><html><body><img src="data:image/png;base64,abc"></body></html>';

		const script = buildPdfDocumentWriteScript(html);

		expect(script).toContain("document.open()");
		expect(script).toContain("document.write(");
		expect(script).toContain(JSON.stringify(html));
		expect(script).not.toContain("data:text/html");
	});
});
