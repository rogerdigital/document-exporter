import { describe, expect, it } from "vitest";
import {
	buildPdfHtml,
	buildPdfDocumentWriteScript,
	createPdfBrowserWindowOptions,
	createPdfPrintOptions,
	encodeAttachmentDataUri,
} from "@/formats/pdf";

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
		expect(html).toContain("max-width: min(100%, 384px)");
		expect(html).toContain("display: block");
		expect(html).toContain("margin: 0.25rem 0");
	});

	it("owns page margins via @page so every page keeps a printable area", () => {
		const html = buildPdfHtml("<h1>Title</h1><p>Content</p>", "");

		expect(html).toContain("@page {");
		expect(html).toContain("margin: 52px 60px 52px 60px;");
	});

	it("prefers CSS page size so @page margins are authoritative", () => {
		const options = createPdfPrintOptions();

		expect(options.preferCSSPageSize).toBe(true);
	});

	it("zeroes printToPDF margins so they don't override @page", () => {
		const options = createPdfPrintOptions();

		// Non-zero printToPDF margins make Chromium use them for the page box,
		// which drops the top margin on continuation pages. Zero lets @page win.
		expect(options.margins).toEqual({
			marginType: "custom",
			top: 0,
			bottom: 0,
			left: 0,
			right: 0,
		});
	});

	it("tightens media-only paragraph spacing in PDF output", () => {
		const html = buildPdfHtml("<p><img src=\"a.png\"></p><p><img src=\"b.png\"></p>", "");

		expect(html).toContain(".pdf-export-page p:has(img)");
		expect(html).toContain(".pdf-export-page p:has(.internal-embed)");
		expect(html).toContain("margin: 0.25rem 0;");
		expect(html).toContain("line-height: 1;");
	});

	it("preserves soft line breaks in media paragraphs instead of hiding <br>", () => {
		const html = buildPdfHtml("<p>text<br><img src=\"a.png\"><br><img src=\"b.png\"></p>", "");

		// Hiding all <br> in a media paragraph also kills legitimate soft line
		// breaks when text and media share one <p>. Media spacing is controlled
		// by line-height:1 (shrinks the <br> line-box) + per-media margin, not by
		// display:none on <br>.
		expect(html).not.toContain("p:has(img) > br");
		expect(html).not.toContain("display: none;");
	});

	it("never hides <br> anywhere in PDF output (regression: soft breaks)", () => {
		const html = buildPdfHtml("<p>line one<br>line two<br>line three</p>", "");

		// Absolute guard: no rule in the PDF stylesheet may set display:none on
		// <br>, because Obsidian merges adjacent non-blank lines into one <p>
		// separated by <br>. Hiding <br> silently collapses soft line breaks.
		expect(html).not.toMatch(/br\s*\{[^}]*display:\s*none/);
		expect(html).not.toMatch(/> br\s*\{/);
	});

	it("normalizes Obsidian native image embed spacing for PDF output", () => {
		const html = buildPdfHtml('<p><span class="internal-embed media-embed image-embed"><img src="a.png"></span></p>', "");

		expect(html).toContain(".pdf-export-page .internal-embed");
		expect(html).toContain("margin: 0.25rem 0 !important;");
		expect(html).toContain(".pdf-export-page .internal-embed img");
		expect(html).toContain("margin: 0;");
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

	it("encodes binary attachments as PDF data URIs", () => {
		const buffer = new Uint8Array([0, 255, 16, 128]).buffer;

		const dataUri = encodeAttachmentDataUri(buffer, "png");

		expect(dataUri).toBe("data:image/png;base64,AP8QgA==");
	});
});
