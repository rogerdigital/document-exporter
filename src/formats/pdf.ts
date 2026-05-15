import { App, Platform, TFile } from "obsidian";
import { AssembledDocument, DocumentSection, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { renderMarkdownNative, rewriteAppProtocolUrls } from "@/formats/native-renderer";
import { markdownToBasicHtml, escapeHtml } from "@/formats/html-document";

export async function renderPdf(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App,
	outputFilePath?: string,
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
				if (file instanceof TFile) {
					const buffer = await app.vault.readBinary(file);
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

	const cssText = DEFAULT_CSS;
	const printCss = PRINT_CSS;

	const htmlBody = `<h1>${escapeHtml(doc.title)}</h1>\n${toc}\n${finalBody}`;

	try {
		const pdfBuffer = await printViaBrowserWindow(htmlBody, cssText + "\n" + printCss);
		if (pdfBuffer.byteLength < MIN_VALID_PDF_BYTES) {
			throw new Error("generated PDF is unexpectedly small; the print page may be blank");
		}
		const resolved = outputFilePath ?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "")}.pdf`;
		await writer.ensureFolder(resolved.substring(0, resolved.lastIndexOf("/")));
		await writer.writeBinary(resolved, pdfBuffer);
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

export function buildPdfHtml(htmlBody: string, css: string): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Export</title><style>${css}
${PDF_PAGE_RESET_CSS}</style></head>
<body><main class="pdf-export-page markdown-rendered">${htmlBody}</main></body></html>`;
}

interface ElectronWebContents {
	printToPDF(options: Record<string, unknown>): Promise<ArrayBuffer>;
	executeJavaScript<T>(code: string): Promise<T>;
}

interface ElectronBrowserWindow {
	webContents: ElectronWebContents;
	loadURL(url: string): Promise<void>;
	showInactive(): void;
	close(): void;
}

type ElectronBrowserWindowCtor = new (options: Record<string, unknown>) => ElectronBrowserWindow;

function getBrowserWindowCtor(): ElectronBrowserWindowCtor {
	// @ts-expect-error — Electron remote not in browser type definitions
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Electron remote only available at runtime in Obsidian desktop
	const electron = window.electron ?? window.require?.("electron");
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Electron remote module not in type definitions
	if (!electron?.remote?.BrowserWindow) {
		throw new Error("electron.remote.BrowserWindow not available");
	}
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Electron BrowserWindow constructor from runtime remote module
	return electron.remote.BrowserWindow;
}

async function printViaBrowserWindow(htmlBody: string, css: string): Promise<Uint8Array> {
	const fullHtml = buildPdfHtml(htmlBody, css);

	// eslint-disable-next-line import/no-nodejs-modules -- PDF export requires filesystem access in Electron
	const fs = await import("fs");
	// eslint-disable-next-line import/no-nodejs-modules -- tmpdir for intermediate HTML file
	const path = await import("path");
	// eslint-disable-next-line import/no-nodejs-modules -- tmpdir for intermediate HTML file
	const os = await import("os");

	const tmpFile = path.join(os.tmpdir(), `obsidian-pdf-export-${Date.now()}.html`);
	fs.writeFileSync(tmpFile, fullHtml, "utf-8");

	const BrowserWindowCtor = getBrowserWindowCtor();
	const win = new BrowserWindowCtor({
		show: true,
		frame: false,
		skipTaskbar: true,
		focusable: false,
		transparent: true,
		backgroundColor: "#ffffff",
		opacity: 0.01,
		width: 800,
		height: 1200,
		webPreferences: {
			contextIsolation: false,
			nodeIntegration: false,
		},
	});

	try {
		await win.loadURL(`file://${tmpFile}`);
		if (typeof win.showInactive === "function") {
			win.showInactive();
		}

		await waitForPrintableContent(win);

		const pdfData = await win.webContents.printToPDF({
			printBackground: true,
			pageSize: "A4",
			margins: {
				top: 0,
				bottom: 0,
				left: 0,
				right: 0,
			},
		});

		return new Uint8Array(pdfData);
	} finally {
		win.close();
		try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
	}
}

async function waitForPrintableContent(win: { webContents: { executeJavaScript: <T>(code: string) => Promise<T> } }): Promise<void> {
	const printable = await win.webContents.executeJavaScript<{
		textLength: number;
		width: number;
		height: number;
	}>(
		`new Promise((resolve) => {
			const done = () => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						const rect = document.body.getBoundingClientRect();
						resolve({
							textLength: document.body.innerText.trim().length,
							width: rect.width,
							height: rect.height,
						});
					});
				});
			};
			if (document.readyState === "complete") {
				done();
			} else {
				window.addEventListener("load", done, { once: true });
			}
		})`,
	);

	if (printable.textLength === 0 || printable.width === 0 || printable.height === 0) {
		throw new Error("print page has no visible content");
	}
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

const PDF_PAGE_RESET_CSS = `
@page {
	margin: 0;
}

html,
body {
	width: auto !important;
	height: auto !important;
	min-height: 100% !important;
	margin: 0 !important;
	padding: 0 !important;
	overflow: visible !important;
	contain: none !important;
	user-select: text !important;
	background: #fff !important;
	color: #1a1a1a !important;
}

body,
.pdf-export-page {
	display: block !important;
}

.pdf-export-page {
	box-sizing: border-box;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	line-height: 1.6;
	max-width: 800px;
	margin: 0 auto;
	padding: 1.35cm 1.6cm;
}
`;

const MIN_VALID_PDF_BYTES = 1024;

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
