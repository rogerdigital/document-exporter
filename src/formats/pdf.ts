import { App, Platform } from "obsidian";
import { AssembledDocument, DocumentSection, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { renderMarkdownNative, extractObsidianStyles, rewriteAppProtocolUrls } from "@/formats/native-renderer";
import { markdownToBasicHtml, escapeHtml } from "@/formats/html-document";

export async function renderPdf(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App,
): Promise<string[]> {
	const warnings: string[] = [];

	if (!Platform.isDesktopApp) {
		warnings.push("PDF export requires the desktop app.");
		return warnings;
	}

	await writer.ensureFolder(plan.outputRoot);

	const toc = doc.sections.length > 1 ? generateToc(doc.sections) : "";
	const { html: body, warnings: renderWarnings } = await renderSections(doc.sections, app, doc.title);
	warnings.push(...renderWarnings);

	let finalBody = body;
	if (doc.attachments.length > 0) {
		for (const att of doc.attachments) {
			try {
				const file = app.vault.getAbstractFileByPath(att.sourcePath);
				if (file && "extension" in file) {
					const buffer = await app.vault.readBinary(file as import("obsidian").TFile);
					const base64 = arrayBufferToBase64(buffer);
					const ext = att.sourcePath.split(".").pop()?.toLowerCase() ?? "";
					const mime = mimeFromExt(ext);
					const dataUri = `data:${mime};base64,${base64}`;
					finalBody = finalBody.split(att.outputRelativePath).join(dataUri);
				}
			} catch {
				warnings.push(`Failed to embed attachment for PDF: ${att.sourcePath}`);
			}
		}
	}

	const customCss = typeof document !== "undefined" ? extractObsidianStyles() : null;
	const cssText = customCss ?? DEFAULT_CSS;
	const printCss = PRINT_CSS;

	const htmlBody = `<h1>${escapeHtml(doc.title)}</h1>\n${toc}\n${finalBody}`;

	try {
		const pdfBuffer = await printViaWebview(htmlBody, cssText + "\n" + printCss);
		const filename = plan.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "");
		await writer.writeBinary(`${plan.outputRoot}/${filename}.pdf`, pdfBuffer);
	} catch (err) {
		warnings.push(`PDF generation failed: ${err instanceof Error ? err.message : String(err)}`);
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
	app: App,
	docTitle: string,
): Promise<{ html: string; warnings: string[] }> {
	const allWarnings: string[] = [];
	const parts: string[] = [];
	const isSingleSection = sections.length === 1;

	for (let i = 0; i < sections.length; i++) {
		const s = sections[i];
		const id = `section-${i}`;
		let sectionHtml: string;

		if (typeof document !== "undefined") {
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

interface WebviewElement extends HTMLElement {
	src: string;
	nodeintegration: boolean;
	insertCSS(css: string): Promise<string>;
	executeJavaScript(code: string): Promise<unknown>;
	printToPDF(opts: Record<string, unknown>): Promise<Buffer>;
	addEventListener(event: string, cb: (e: unknown) => void): void;
	remove(): void;
}

async function printViaWebview(htmlBody: string, css: string): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		const webview = document.createElement("webview") as unknown as WebviewElement;
		webview.setAttribute("style", "position:fixed;left:-9999px;top:-9999px;width:800px;height:1200px;");
		webview.nodeintegration = true;
		webview.src = "app://obsidian.md/help.html";
		document.body.appendChild(webview);

		let settled = false;
		const cleanup = () => {
			try { webview.remove(); } catch { /* ignore */ }
		};
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};

		webview.addEventListener("dom-ready", async () => {
			try {
				// Inject CSS
				await webview.insertCSS(css);

				// Inject HTML body content
				const encoded = encodeContent(htmlBody);
				await webview.executeJavaScript(`
					document.body.className = "app-container markdown-rendered";
					document.body.innerHTML = decodeURIComponent("${encoded}");
				`);

				// Wait for rendering to complete
				await sleep(1500);

				// Generate PDF
				const pdfBuffer = await webview.printToPDF({
					printBackground: true,
					pageSize: "A4",
				});

				settle(() => { cleanup(); resolve(pdfBuffer); });
			} catch (err) {
				settle(() => { cleanup(); reject(err); });
			}
		});

		webview.addEventListener("did-fail-load", () => {
			settle(() => { cleanup(); reject(new Error("Webview failed to load")); });
		});

		// Timeout
		setTimeout(() => {
			settle(() => { cleanup(); reject(new Error("PDF generation timed out (20s)")); });
		}, 20000);
	});
}

function encodeContent(html: string): string {
	return encodeURIComponent(html);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

const PRINT_CSS = `
@media print {
	body { max-width: 100%; margin: 0; padding: 1cm; }
	section { page-break-before: auto; }
	h2 { page-break-after: avoid; }
	img { max-width: 100%; page-break-inside: avoid; }
	.toc { page-break-after: always; }
}`;

function mimeFromExt(ext: string): string {
	const map: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		bmp: "image/bmp",
	};
	return map[ext] ?? "application/octet-stream";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
