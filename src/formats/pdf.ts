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
	const { html: body, warnings: renderWarnings } = await renderSections(doc.sections, app, doc.title, doc.attachments);
	warnings.push(...renderWarnings);

	let finalBody = body;
	if (doc.attachments.length > 0) {
		for (const att of doc.attachments) {
			try {
				const file = app.vault.getAbstractFileByPath(att.sourcePath);
				if (file instanceof TFile) {
					const buffer = await app.vault.readBinary(file);
					const ext = att.sourcePath.split(".").pop()?.toLowerCase() ?? "";
					const dataUri = encodeAttachmentDataUri(buffer, ext);
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

	const pdfBuffer = await printViaBrowserWindow(htmlBody, cssText + "\n" + printCss);
	if (pdfBuffer.byteLength < MIN_VALID_PDF_BYTES) {
		throw new Error("PDF generation failed: generated PDF is unexpectedly small; the print page may be blank");
	}
	const resolved = outputFilePath ?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "")}.pdf`;
	await writer.ensureFolder(resolved.substring(0, resolved.lastIndexOf("/")));
	await writer.writeBinary(resolved, pdfBuffer);

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
	attachments: AssembledDocument["attachments"],
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
				sectionHtml = rewriteAppProtocolUrls(result.html, attachments);
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

type PdfData = ArrayBuffer | Uint8Array;

interface PdfWebContents {
	executeJavaScript: <T>(code: string) => Promise<T>;
	printToPDF: (options: {
		printBackground: boolean;
		pageSize: "A4";
		margins: {
			top: number;
			bottom: number;
			left: number;
			right: number;
		};
	}) => Promise<PdfData>;
}

interface PdfBrowserWindow {
	loadURL: (url: string) => Promise<void>;
	close: () => void;
	webContents: PdfWebContents;
}

interface PdfBrowserWindowConstructor {
	new (options: {
		show: boolean;
		frame: boolean;
		skipTaskbar: boolean;
		focusable: boolean;
		transparent: boolean;
		backgroundColor: string;
		opacity: number;
		width: number;
		height: number;
		webPreferences: {
			contextIsolation: boolean;
			nodeIntegration: boolean;
		};
	}): PdfBrowserWindow;
}

interface ElectronModule {
	remote?: {
		BrowserWindow?: PdfBrowserWindowConstructor;
	};
}

interface DesktopWindow extends Window {
	electron?: unknown;
	require?: (moduleId: string) => unknown;
}

export function buildPdfHtml(htmlBody: string, css: string): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Export</title><style>${css}
${PDF_PAGE_RESET_CSS}</style></head>
<body><main class="pdf-export-page markdown-rendered">${htmlBody}</main></body></html>`;
}

export function buildPdfDocumentWriteScript(html: string): string {
	return `document.open(); document.write(${JSON.stringify(html)}); document.close();`;
}

export function createPdfBrowserWindowOptions(): ConstructorParameters<PdfBrowserWindowConstructor>[0] {
	return {
		show: false,
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
	};
}

async function printViaBrowserWindow(htmlBody: string, css: string): Promise<Uint8Array> {
	if (!Platform.isDesktop) {
		throw new Error("PDF export requires the desktop app.");
	}

	const fullHtml = buildPdfHtml(htmlBody, css);

	const electron = getElectronModule();
	const remote = electron.remote;
	if (!remote) {
		throw new Error("electron.remote not available - cannot create BrowserWindow");
	}

	const BrowserWindow = remote.BrowserWindow;
	if (!BrowserWindow) {
		throw new Error("BrowserWindow not found on electron.remote");
	}

	const win = new BrowserWindow(createPdfBrowserWindowOptions());

	try {
		await win.loadURL("about:blank");
		await win.webContents.executeJavaScript(buildPdfDocumentWriteScript(fullHtml));
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

		return pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
	} finally {
		win.close();
	}
}

function getElectronModule(): ElectronModule {
	const desktopWindow = window as DesktopWindow;
	const electron = desktopWindow.electron ?? desktopWindow.require?.("electron");
	if (!isElectronModule(electron)) {
		throw new Error("electron module not available");
	}
	return electron;
}

function isElectronModule(value: unknown): value is ElectronModule {
	if (!value || typeof value !== "object") return false;
	const remote = (value as { remote?: unknown }).remote;
	if (!remote || typeof remote !== "object") return false;
	const BrowserWindow = (remote as { BrowserWindow?: unknown }).BrowserWindow;
	return typeof BrowserWindow === "function";
}

async function waitForPrintableContent(win: { webContents: Pick<PdfWebContents, "executeJavaScript"> }): Promise<void> {
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

.pdf-export-page img {
	display: block;
	max-width: min(100%, 384px);
	height: auto;
	margin: 1rem 0;
	page-break-inside: avoid;
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

export function encodeAttachmentDataUri(buffer: ArrayBuffer, ext: string): string {
	const bytes = new Uint8Array(buffer);
	const base64 = Buffer.from(bytes).toString("base64");
	return `data:${mimeFromExt(ext)};base64,${base64}`;
}
