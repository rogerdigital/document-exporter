import { App } from "obsidian";
import { AssembledDocument, ExportPlan, DocumentSection } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { renderMarkdownNative, extractObsidianStyles, rewriteAppProtocolUrls } from "@/formats/native-renderer";

export async function renderHtmlDocument(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	printReady = false,
	app: App | null = null,
	outputFilePath?: string,
): Promise<string[]> {
	const warnings: string[] = [];

	await writer.ensureFolder(plan.outputRoot);
	if (doc.attachments.length > 0) {
		await writer.ensureFolder(`${plan.outputRoot}/assets`);
	}

	const toc = doc.sections.length > 1 ? generateToc(doc.sections) : "";
	const { html: body, warnings: renderWarnings } = await renderSections(doc.sections, app, doc.title);
	warnings.push(...renderWarnings);

	const customCss = app ? extractObsidianStyles() : null;
	const html = buildHtmlDoc(doc.title, toc, body, printReady, customCss);

	const resolvedOutput = outputFilePath ?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm)$/i, '')}.html`;
	await writer.ensureFolder(resolvedOutput.substring(0, resolvedOutput.lastIndexOf("/")));
	await writer.writeText(resolvedOutput, html);

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

async function renderSections(
	sections: DocumentSection[],
	app: App | null,
	docTitle: string,
): Promise<{ html: string; warnings: string[] }> {
	const allWarnings: string[] = [];
	const parts: string[] = [];
	const isSingleSection = sections.length === 1;

	for (let i = 0; i < sections.length; i++) {
		const s = sections[i];
		const id = `section-${i}`;
		let sectionHtml: string;

		if (app && typeof document !== "undefined") {
			try {
				const result = await renderMarkdownNative(app, s.markdown, s.sourcePath);
				sectionHtml = rewriteAppProtocolUrls(result.html, []);
				allWarnings.push(...result.warnings);
			} catch {
				sectionHtml = markdownToBasicHtml(s.markdown);
				allWarnings.push(`Native rendering failed for "${s.sourcePath}", using basic converter`);
			}
		} else {
			sectionHtml = markdownToBasicHtml(s.markdown);
		}

		const skipHeading = isSingleSection && s.title === docTitle;
		const heading = skipHeading ? "" : `<h2>${escapeHtml(s.title)}</h2>`;
		parts.push(`<section id="${id}">${heading}${sectionHtml}</section>`);
	}

	return { html: parts.join("\n"), warnings: allWarnings };
}

export function markdownToBasicHtml(md: string): string {
	// 1. Extract fenced code blocks
	const codeBlocks: string[] = [];
	let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match: string, _lang: string, code: string) => {
		codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
		return `CB${codeBlocks.length - 1}`;
	});

	// 2. Extract inline code
	const inlineCode: string[] = [];
	html = html.replace(/`([^`\n]+)`/g, (_match: string, code: string) => {
		inlineCode.push(`<code>${escapeHtml(code)}</code>`);
		return `IC${inlineCode.length - 1}`;
	});

	// 3. Escape remaining HTML
	html = escapeHtml(html);

	// 4. Tables
	html = html.replace(/^(\|.+\|)\n(\|[-:| ]+\|)\n((?:\|.+\|\n?)+)/gm, (_, header: string, _align: string, body: string) => {
		const ths = header.split("|").slice(1, -1).map(c => `<th>${c.trim()}</th>`).join("");
		const rows = body.trim().split("\n").map(row => {
			const tds = row.split("|").slice(1, -1).map(c => `<td>${c.trim()}</td>`).join("");
			return `<tr>${tds}</tr>`;
		}).join("");
		return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
	});

	// 5. Blockquotes
	html = html.replace(/^(&gt; .+(?:\n&gt; .+)*)/gm, (match) => {
		const content = match.replace(/^&gt; /gm, "");
		return `<blockquote>${content}</blockquote>`;
	});

	// 6. Task lists
	html = html.replace(/^- \[x\] (.+)$/gm, '<li class="task-done"><input type="checkbox" checked disabled> $1</li>');
	html = html.replace(/^- \[ \] (.+)$/gm, '<li class="task"><input type="checkbox" disabled> $1</li>');

	// 7. Unordered lists
	html = html.replace(/^(?:[*-] .+(?:\n[*-] .+)*)/gm, (match) => {
		const items = match.split("\n").map(line => `<li>${line.replace(/^[*-] /, "")}</li>`).join("");
		return `<ul>${items}</ul>`;
	});

	// 8. Ordered lists
	html = html.replace(/^(?:\d+\. .+(?:\n\d+\. .+)*)/gm, (match) => {
		const items = match.split("\n").map(line => `<li>${line.replace(/^\d+\. /, "")}</li>`).join("");
		return `<ol>${items}</ol>`;
	});

	// 9. Horizontal rules
	html = html.replace(/^[-*_]{3,}\s*$/gm, "<hr>");

	// 10. Headers
	html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
	html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
	html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
	html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

	// 11. Inline formatting (strikethrough, bold, italic)
	html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
	html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

	// 12. Images and links
	html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

	// 13. Paragraphs
	html = html
		.split("\n\n")
		.map((block) => {
			const trimmed = block.trim();
			if (!trimmed) return "";
			if (/^<(h[1-6]|pre|ul|ol|li|section|div|img|blockquote|table|nav|hr)/.test(trimmed)) {
				return trimmed;
			}
			return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
		})
		.join("\n");

	// 14. Restore inline code
	html = html.replace(/IC(\d+)/g, (_match: string, idx: string) => inlineCode[parseInt(idx)]);

	// 15. Restore code blocks
	html = html.replace(/CB(\d+)/g, (_match: string, idx: string) => codeBlocks[parseInt(idx)]);

	return html;
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const DEFAULT_CSS = `body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #1a1a1a; }
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
blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; }`;

export function buildHtmlDoc(
	title: string,
	toc: string,
	body: string,
	printReady: boolean,
	customCss: string | null = null,
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

	const css = customCss ?? DEFAULT_CSS;
	const bodyClass = customCss ? "app-container markdown-rendered" : "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${css}
${printCss}
${customCss ? `body { padding: 2rem; max-width: 800px; margin: 0 auto; }` : ""}
</style>
</head>
<body class="${bodyClass}">
<h1>${escapeHtml(title)}</h1>
${titlePage}
${toc}
${body}
</body>
</html>`;
}
