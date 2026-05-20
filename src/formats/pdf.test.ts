import { describe, expect, it } from "vitest";
import { buildPdfHtml, createPdfBrowserWindowOptions } from "@/formats/pdf";

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

	it("creates the print window hidden and non-focusable", () => {
		const options = createPdfBrowserWindowOptions();

		expect(options.show).toBe(false);
		expect(options.focusable).toBe(false);
		expect(options.skipTaskbar).toBe(true);
	});
});
