import { App, TFile } from "obsidian";
import { AssembledDocument, DocumentSection, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { renderMarkdownNative, extractObsidianStyles, rewriteAppProtocolUrls } from "@/formats/native-renderer";
import { markdownToBasicHtml, escapeHtml, buildHtmlDoc } from "@/formats/html-document";

export async function renderSingleFileHtml(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App | null = null,
): Promise<string[]> {
	const warnings: string[] = [];

	await writer.ensureFolder(plan.outputRoot);

	const toc = doc.sections.length > 1 ? generateToc(doc.sections) : "";
	const { html: body, warnings: renderWarnings } = await renderSections(doc.sections, app, doc.title);
	warnings.push(...renderWarnings);

	// Embed attachments as base64 data URIs
	let finalBody = body;
	if (app && doc.attachments.length > 0) {
		const dataUriMap = new Map<string, string>();
		for (const att of doc.attachments) {
			try {
				const file = app.vault.getAbstractFileByPath(att.sourcePath);
				if (file && "extension" in file) {
					const buffer = await app.vault.readBinary(file as TFile);
					const base64 = arrayBufferToBase64(buffer);
					const ext = att.sourcePath.split(".").pop()?.toLowerCase() ?? "";
					const mime = mimeFromExt(ext);
					dataUriMap.set(att.outputRelativePath, `data:${mime};base64,${base64}`);
				}
			} catch {
				warnings.push(`Failed to embed attachment: ${att.sourcePath}`);
			}
		}

		for (const [relPath, dataUri] of dataUriMap) {
			finalBody = finalBody.split(relPath).join(dataUri);
		}
	}

	const customCss = app && typeof document !== "undefined" ? extractObsidianStyles() : null;
	const html = buildHtmlDoc(doc.title, toc, finalBody, false, customCss);

	const filename = plan.outputFilename.replace(/\.(md|html|htm)$/i, '');
	await writer.writeText(`${plan.outputRoot}/${filename}.html`, html);

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

function mimeFromExt(ext: string): string {
	const map: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		bmp: "image/bmp",
		pdf: "application/pdf",
		mp3: "audio/mpeg",
		mp4: "video/mp4",
		wav: "audio/wav",
		ogg: "audio/ogg",
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
