import { App, TAbstractFile, TFile } from "obsidian";
import { AssembledDocument, AttachmentCopy, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { createZip } from "@/formats/zip";
import { DEFAULT_CSS, markdownToBasicHtml, escapeHtml } from "@/formats/html-document";

const encoder = new TextEncoder();

export function toXhtml(html: string): string {
	return html
		.replace(/<br>/g, "<br/>")
		.replace(/<hr>/g, "<hr/>")
		.replace(/<input type="checkbox" checked disabled>/g, "☑")
		.replace(/<input type="checkbox" disabled>/g, "☐");
}

export function buildContainerXml(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

export function buildContentOpf(
	title: string,
	chapterIds: string[],
	images: { name: string; mediaType: string }[],
	uuid: string = crypto.randomUUID(),
	modified: string = new Date().toISOString(),
): string {
	const manifest = [
		'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
		'<item id="css" href="styles.css" media-type="text/css"/>',
		...chapterIds.map((id) =>
			`<item id="${id}" href="chapter-${id.slice(2)}.xhtml" media-type="application/xhtml+xml"/>`),
		// Sequential ids + generated filenames: raw attachment names with
		// spaces/&/quotes/CJK never become XML ids or hrefs.
		...images.map((img, i) =>
			`<item id="img${i + 1}" href="images/${img.name}" media-type="${img.mediaType}"/>`),
	].join("\n    ");
	// EPUB 3.3 requires seconds precision (YYYY-MM-DDThh:mm:ssZ); trim any
	// millisecond component the caller (or Date#toISOString) provides.
	const modifiedUtc = modified.replace(/\.\d+Z$/, "Z");
	const spine = ["nav", ...chapterIds]
		.map((id) => `<itemref idref="${id}"/>`)
		.join("\n    ");
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modifiedUtc}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;
}

export function buildNavXhtml(title: string, chapterTitles: string[]): string {
	const items = chapterTitles
		.map((t, i) => `<li><a href="chapter-${i + 1}.xhtml">${escapeXml(t)}</a></li>`)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>${escapeXml(title)}</h1>
    <ol>${items}</ol>
  </nav>
</body>
</html>`;
}

export function buildChapterXhtml(title: string, bodyHtml: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeXml(value: string): string {
	return escapeHtml(value);
}

export function imageMediaType(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	const types: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		bmp: "image/bmp",
	};
	return types[ext] ?? "application/octet-stream";
}

type EpubImage = {
	sourcePath: string;
	outputRelativePath: string;
	name: string;
	mediaType: string;
	data: Uint8Array;
};

export async function renderEpub(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App | null = null,
	outputFilePath?: string,
): Promise<string[]> {
	const warnings: string[] = [];

	const images = await collectEpubImages(doc.attachments, app, warnings);
	const chapters = buildChapters(doc, images);
	const chapterIds = chapters.map((_, i) => `ch${i + 1}`);

	const files: { name: string; data: Uint8Array }[] = [
		{ name: "mimetype", data: encoder.encode("application/epub+zip") },
		{ name: "META-INF/container.xml", data: encoder.encode(buildContainerXml()) },
		{ name: "OEBPS/content.opf", data: encoder.encode(
			buildContentOpf(
				doc.title,
				chapterIds,
				images.map((img) => ({ name: img.name, mediaType: img.mediaType })),
			)) },
		{ name: "OEBPS/nav.xhtml", data: encoder.encode(
			buildNavXhtml(doc.title, chapters.map((c) => c.title))) },
		{ name: "OEBPS/styles.css", data: encoder.encode(DEFAULT_CSS) },
	];
	chapters.forEach((chapter, i) => {
		files.push({
			name: `OEBPS/chapter-${i + 1}.xhtml`,
			data: encoder.encode(
				buildChapterXhtml(chapter.title, finalizeChapterHtml(chapter.html, images))),
		});
	});
	for (const img of images) {
		files.push({ name: `OEBPS/images/${img.name}`, data: img.data });
	}

	const buffer = createZip(files);
	const resolved = outputFilePath
		?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm|pdf|docx|epub)$/i, "")}.epub`;
	await writer.ensureFolder(resolved.substring(0, resolved.lastIndexOf("/")));
	await writer.writeBinary(resolved, buffer);

	return warnings;
}

function buildChapters(doc: AssembledDocument, images: EpubImage[]): { title: string; html: string }[] {
	const isSingle = doc.sections.length === 1;
	return doc.sections.map((section, i) => {
		const skipHeading = isSingle && section.title === doc.title;
		const heading = skipHeading ? "" : `<h2>${escapeHtml(section.title)}</h2>`;
		const body = toXhtml(markdownToBasicHtml(rewriteImageRefsMarkdown(section.markdown, images)));
		return { title: section.title || `Chapter ${i + 1}`, html: `${heading}${body}` };
	});
}

/**
 * Rewrite markdown image refs to generated package names BEFORE conversion:
 * LinkRewriter emits the attachment path verbatim inside `](path)`, so an
 * exact-match replace handles spaces and parentheses that regex-based
 * markdown parsing cannot survive.
 */
function rewriteImageRefsMarkdown(markdown: string, images: EpubImage[]): string {
	let result = markdown;
	for (const img of images) {
		const target = escapeRegex(img.outputRelativePath);
		result = result.replace(
			new RegExp(`\\]\\((?:\\.\\./)*${target}\\)`, "g"),
			`](images/${img.name})`,
		);
	}
	return result;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectEpubImages(
	attachments: AttachmentCopy[],
	app: App | null,
	warnings: string[],
): Promise<EpubImage[]> {
	if (!app) return [];
	const images: EpubImage[] = [];
	for (const att of attachments) {
		const ext = att.sourcePath.split(".").pop()?.toLowerCase() ?? "";
		if (!isImageExtension(ext)) continue;
		try {
			const file = app.vault.getAbstractFileByPath(att.sourcePath);
			if (!isTFile(file)) continue;
			const buffer = await app.vault.readBinary(file);
			images.push({
				sourcePath: att.sourcePath,
				outputRelativePath: att.outputRelativePath,
				name: `image-${images.length + 1}.${ext}`,
				mediaType: imageMediaType(`x.${ext}`),
				data: new Uint8Array(buffer),
			});
		} catch {
			warnings.push(`Failed to embed image in EPUB: ${att.sourcePath}`);
		}
	}
	return images;
}

function finalizeChapterHtml(html: string, images: EpubImage[]): string {
	const byKey = new Map<string, string>();
	for (const img of images) {
		byKey.set(img.outputRelativePath, img.name);
		byKey.set(img.outputRelativePath.split("/").pop() ?? img.name, img.name);
	}

	let result = html.replace(
		/<img src="([^"]+)" alt="([^"]*)" \/>/g,
		(match, src: string, alt: string) => {
			// Already rewritten to a package path by rewriteImageRefsMarkdown.
			if (src.startsWith("images/")) return match;
			const key = src.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
			const name = byKey.get(key) ?? byKey.get(key.split("/").pop() ?? key);
			if (name) return `<img src="images/${name}" alt="${alt}" />`;
			// Stray non-image reference (e.g. ![](video.mp4)): no dead links in the package.
			const label = alt || key.split("/").pop() || "attachment";
			return `<em>${label}</em>`;
		},
	);

	// Relative hrefs that survived LinkRewriter (unresolved local links) have
	// no target inside the package; keep the text, drop the anchor.
	result = result.replace(
		/<a href="([^"]*)">([\s\S]*?)<\/a>/g,
		(match, href: string, text: string) => {
			if (/^(?:https?:|mailto:|data:|#)/i.test(href)) return match;
			return text;
		},
	);

	return result;
}

function isImageExtension(ext: string): boolean {
	return ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext);
}

function isTFile(file: TAbstractFile | null): file is TFile {
	return file !== null && "extension" in file;
}
