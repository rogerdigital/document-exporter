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
		const pdfBuffer = await printViaBrowserWindow(htmlBody, cssText + "\n" + printCss);
		const filename = plan.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "");
		await writer.writeBinary(`${plan.outputRoot}/${filename}.pdf`, pdfBuffer);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		warnings.push(`PDF generation failed: ${msg}`);
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

async function printViaBrowserWindow(htmlBody: string, css: string): Promise<Buffer> {
	const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Export</title><style>${css}</style></head>
<body class="app-container markdown-rendered">${htmlBody}</body></html>`;

	const fs = require("fs") as typeof import("fs");
	const path = require("path") as typeof import("path");
	const os = require("os") as typeof import("os");

	const tmpFile = path.join(os.tmpdir(), `obsidian-pdf-export-${Date.now()}.html`);
	fs.writeFileSync(tmpFile, fullHtml, "utf-8");

	// Access Electron remote module
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const electron = (window as any).electron || require("electron");
	const remote = electron.remote;
	if (!remote) {
		throw new Error("electron.remote not available — cannot create BrowserWindow");
	}

	const BrowserWindow = remote.BrowserWindow;
	if (!BrowserWindow) {
		throw new Error("BrowserWindow not found on electron.remote");
	}

	const win = new BrowserWindow({
		show: false,
		width: 800,
		height: 1200,
		webPreferences: {
			contextIsolation: false,
			nodeIntegration: false,
		},
	});

	try {
		await win.loadURL(`file://${tmpFile}`);

		// Wait for page to finish loading and painting
		await new Promise<void>((resolve) => {
			win.webContents.on("did-finish-load", () => resolve());
			setTimeout(resolve, 3000);
		});
		await sleep(500);

		const pdfData = await win.webContents.printToPDF({
			printBackground: true,
			pageSize: "A4",
		});

		return Buffer.from(pdfData);
	} finally {
		win.close();
		try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
	}
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
