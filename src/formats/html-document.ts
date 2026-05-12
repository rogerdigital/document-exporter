import { AssembledDocument, ExportPlan, DocumentSection } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";

export async function renderHtmlDocument(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	printReady = false,
): Promise<string[]> {
	const warnings: string[] = [];

	await writer.ensureFolder(plan.outputRoot);
	if (doc.attachments.length > 0) {
		await writer.ensureFolder(`${plan.outputRoot}/assets`);
	}

	const toc = generateToc(doc.sections);
	const body = renderSections(doc.sections);
	const html = buildHtmlDoc(doc.title, toc, body, printReady);

	const filename = plan.outputFilename.replace(/\.(md|html|htm)$/i, '');
	await writer.writeText(`${plan.outputRoot}/${filename}.html`, html);

	for (const att of doc.attachments) {
		try {
			await writer.copyBinaryFile(
				att.sourcePath,
				`${plan.outputRoot}/${att.outputRelativePath}`,
			);
		} catch {
			warnings.push(`Failed to copy attachment: ${att.sourcePath}`);
		}
	}

	return warnings;
}

function generateToc(sections: DocumentSection[]): string {
	const items = sections.map((s, i) => {
		const id = `section-${i}`;
		return `<li><a href="#${id}">${escapeHtml(s.title)}</a></li>`;
	});
	return `<nav class="toc"><h2>Table of Contents</h2><ol>${items.join("")}</ol></nav>`;
}

function renderSections(sections: DocumentSection[]): string {
	return sections
		.map((s, i) => {
			const id = `section-${i}`;
			const html = markdownToBasicHtml(s.markdown);
			return `<section id="${id}"><h2>${escapeHtml(s.title)}</h2>${html}</section>`;
		})
		.join("\n");
}

function markdownToBasicHtml(md: string): string {
	let html = md;

	// Headers
	html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
	html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
	html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
	html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

	// Bold and italic
	html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

	// Images
	html = html.replace(/<img\s+src="([^"]+)"\s+alt="([^"]*)"\s*\/>/g, '<img src="$1" alt="$2" />');

	// Links
	html = html.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		'<a href="$2">$1</a>',
	);

	// Code blocks
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");

	// Inline code
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

	// Paragraphs: wrap lines that aren't already in block elements
	html = html
		.split("\n\n")
		.map((block) => {
			const trimmed = block.trim();
			if (!trimmed) return "";
			if (/^<(h[1-6]|pre|ul|ol|section|div|img|blockquote|table|nav)/.test(trimmed)) {
				return trimmed;
			}
			return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
		})
		.join("\n");

	return html;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function buildHtmlDoc(
	title: string,
	toc: string,
	body: string,
	printReady: boolean,
): string {
	const printCss = printReady
		? `
	@media print {
		body { max-width: 100%; margin: 0; padding: 2cm; }
		section { page-break-before: auto; }
		section:first-of-type { page-break-before: avoid; }
		h2 { page-break-after: avoid; }
		img { max-width: 100%; page-break-inside: avoid; }
		.toc { page-break-after: always; }
	}
	.title-page { text-align: center; padding: 30vh 0; page-break-after: always; }
	`
		: "";

	const titlePage = printReady
		? `<div class="title-page"><h1>${escapeHtml(title)}</h1></div>`
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #1a1a1a; }
h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
section { margin-top: 2em; }
pre { background: #f5f5f5; padding: 1em; overflow-x: auto; border-radius: 4px; }
code { background: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
img { max-width: 100%; height: auto; }
a { color: #0366d6; }
.toc { background: #f8f9fa; padding: 1em 1.5em; border-radius: 4px; margin-bottom: 2em; }
.toc h2 { margin-top: 0; }
.toc ol { padding-left: 1.5em; }
.toc li { margin: 0.3em 0; }
blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; }
${printCss}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${titlePage}
${toc}
${body}
</body>
</html>`;
}
