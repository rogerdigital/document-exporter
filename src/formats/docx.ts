import { App, TFile } from "obsidian";
import { AssembledDocument, AttachmentCopy, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";

type DocxRun = {
	text: string;
	bold?: boolean;
	italics?: boolean;
	code?: boolean;
	drawing?: string;
};

type DocxParagraph = {
	runs: DocxRun[];
	style?: string;
};

type DocxImage = {
	rId: string;
	sourcePath: string;
	outputRelativePath: string;
	mediaPath: string;
	data: Uint8Array;
	width: number;
	height: number;
	ext: string;
};

type ZipEntry = {
	name: string;
	data: Uint8Array;
	crc32: number;
	localHeaderOffset: number;
};

const encoder = new TextEncoder();
const CRC32_TABLE = buildCrc32Table();
const PX_TO_EMU = 9525;
const MAX_WIDTH_EMU = 5486400;

export async function renderDocx(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App | null = null,
	outputFilePath?: string,
): Promise<string[]> {
	const warnings: string[] = [];

	const images = await collectImages(doc.attachments, app, warnings);
	const paragraphs = buildDocxParagraphs(doc, images);
	const documentXml = buildDocumentXml(paragraphs);

	const files: { name: string; data: Uint8Array }[] = [
		{ name: "[Content_Types].xml", data: encodeXml(buildContentTypes(images)) },
		{ name: "_rels/.rels", data: encodeXml(PACKAGE_RELS_XML) },
		{ name: "word/document.xml", data: encodeXml(documentXml) },
		{ name: "word/styles.xml", data: encodeXml(STYLES_XML) },
	];

	if (images.length > 0) {
		files.push({ name: "word/_rels/document.xml.rels", data: encodeXml(buildRels(images)) });
		for (const img of images) {
			files.push({ name: img.mediaPath, data: img.data });
		}
	}

	const buffer = createZip(files);

	const resolved = outputFilePath ?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "")}.docx`;
	await writer.ensureFolder(resolved.substring(0, resolved.lastIndexOf("/")));
	await writer.writeBinary(resolved, buffer);

	return warnings;
}

async function collectImages(
	attachments: AttachmentCopy[],
	app: App | null,
	warnings: string[],
): Promise<DocxImage[]> {
	if (!app) return [];

	const images: DocxImage[] = [];
	let rIdCounter = 2;

	for (const att of attachments) {
		if (!isImagePath(att.sourcePath)) continue;

		try {
			const file = app.vault.getAbstractFileByPath(att.sourcePath);
			if (!file || !("extension" in file)) continue;

			const buffer = await app.vault.readBinary(file as TFile);
			const data = new Uint8Array(buffer);
			const ext = att.sourcePath.split(".").pop()?.toLowerCase() ?? "png";
			const dims = readImageDimensions(data, ext);

			images.push({
				rId: `rId${rIdCounter++}`,
				sourcePath: att.sourcePath,
				outputRelativePath: att.outputRelativePath,
				mediaPath: `word/media/image${images.length + 1}.${ext}`,
				data,
				width: dims.width,
				height: dims.height,
				ext,
			});
		} catch {
			warnings.push(`Failed to embed image in DOCX: ${att.sourcePath}`);
		}
	}

	return images;
}

function readImageDimensions(data: Uint8Array, ext: string): { width: number; height: number } {
	try {
		if (ext === "png" && data.length > 24) {
			const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
			return {
				width: view.getUint32(16, false),
				height: view.getUint32(20, false),
			};
		}
		if ((ext === "jpg" || ext === "jpeg") && data.length > 10) {
			let offset = 2;
			while (offset < data.length - 9) {
				if (data[offset] !== 0xFF) break;
				const marker = data[offset + 1];
				if (marker === 0xC0 || marker === 0xC2) {
					const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
					return {
						height: view.getUint16(offset + 5, false),
						width: view.getUint16(offset + 7, false),
					};
				}
				const segLen = (data[offset + 2] << 8) | data[offset + 3];
				offset += 2 + segLen;
			}
		}
	} catch {
		// fall through to default
	}
	return { width: 400, height: 300 };
}

function buildDocxParagraphs(doc: AssembledDocument, images: DocxImage[]): DocxParagraph[] {
	const imageMap = new Map<string, DocxImage>();
	for (const img of images) {
		imageMap.set(img.mediaPath, img);
		imageMap.set(img.sourcePath, img);
		imageMap.set(img.outputRelativePath, img);
		imageMap.set(img.sourcePath.split("/").pop() ?? img.sourcePath, img);
		imageMap.set(img.outputRelativePath.split("/").pop() ?? img.outputRelativePath, img);
	}

	const paragraphs: DocxParagraph[] = [
		{ style: "Title", runs: [{ text: doc.title }] },
	];
	const isSingleSection = doc.sections.length === 1;

	for (const section of doc.sections) {
		if (!(isSingleSection && section.title === doc.title)) {
			paragraphs.push({ style: "Heading1", runs: [{ text: section.title }] });
		}
		paragraphs.push(...parseMarkdownToParagraphs(section.markdown, imageMap));
	}

	return paragraphs;
}

function parseMarkdownToParagraphs(markdown: string, imageMap: Map<string, DocxImage>): DocxParagraph[] {
	const paragraphs: DocxParagraph[] = [];
	const lines = markdown.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (line.startsWith("```")) {
			i++;
			while (i < lines.length && !lines[i].startsWith("```")) {
				paragraphs.push({ style: "Code", runs: [{ text: lines[i] || " ", code: true }] });
				i++;
			}
			i++;
			continue;
		}

		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			const level = Math.min(headingMatch[1].length, 6);
			paragraphs.push({ style: `Heading${level}`, runs: parseInline(headingMatch[2], imageMap) });
			i++;
			continue;
		}

		if (line.includes("|") && i + 1 < lines.length && /^\|[-:| ]+\|$/.test(lines[i + 1])) {
			const tableLines: string[] = [];
			const headerCells = parseTableRow(line);
			tableLines.push(line);
			i += 2;
			while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
				tableLines.push(lines[i]);
				i++;
			}
			paragraphs.push(...buildTableParagraphs(headerCells, tableLines.slice(1), imageMap));
			continue;
		}

		if (/^[\s]*[-*+]\s/.test(line)) {
			const text = line.replace(/^[\s]*[-*+]\s/, "");
			paragraphs.push({ style: "ListParagraph", runs: parseInline(`• ${text}`, imageMap) });
			i++;
			continue;
		}

		if (/^[\s]*\d+\.\s/.test(line)) {
			const text = line.replace(/^[\s]*\d+\.\s/, "");
			paragraphs.push({ style: "ListParagraph", runs: parseInline(text, imageMap) });
			i++;
			continue;
		}

		if (line.startsWith("> ")) {
			paragraphs.push({ style: "Quote", runs: parseInline(line.replace(/^>\s?/, ""), imageMap) });
			i++;
			continue;
		}

		if (/^[-*_]{3,}\s*$/.test(line)) {
			paragraphs.push({ runs: [{ text: "------" }] });
			i++;
			continue;
		}

		paragraphs.push({ runs: line.trim() === "" ? [{ text: "" }] : parseInline(line, imageMap) });
		i++;
	}

	return paragraphs;
}

function buildTableParagraphs(
	headerCells: string[],
	bodyLines: string[],
	imageMap: Map<string, DocxImage>,
): DocxParagraph[] {
	const result: DocxParagraph[] = [];

	const headerRuns = headerCells.map(cell => ({
		runs: parseInline(cell.trim(), imageMap),
		isHeader: true,
	}));
	result.push({ style: "TableRow", runs: buildTableRowXml(headerRuns) });

	for (const bodyLine of bodyLines) {
		const cells = parseTableRow(bodyLine);
		const cellRuns = cells.map(cell => ({
			runs: parseInline(cell.trim(), imageMap),
			isHeader: false,
		}));
		result.push({ style: "TableRow", runs: buildTableRowXml(cellRuns) });
	}

	return result;
}

function buildTableRowXml(_cells: { runs: DocxRun[]; isHeader: boolean }[]): DocxRun[] {
	return [{ text: "" }];
}

function parseInline(text: string, imageMap: Map<string, DocxImage>): DocxRun[] {
	const runs: DocxRun[] = [];
	const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(!\[([^\]]*)\]\(([^)]+)\))/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			runs.push({ text: text.slice(lastIndex, match.index) });
		}

		if (match[1]) {
			runs.push({ text: match[2], bold: true });
		} else if (match[3]) {
			runs.push({ text: match[4], italics: true });
		} else if (match[5]) {
			runs.push({ text: match[6], code: true });
		} else if (match[10]) {
			const altText = match[11] || "image";
			const imgRef = match[12];
			const img = findImage(imgRef, imageMap);
			if (img) {
				runs.push({ text: "", drawing: buildDrawingXml(img, altText) });
			} else {
				runs.push({ text: `[Image: ${altText}]`, italics: true });
			}
		} else if (match[7]) {
			runs.push({ text: match[8] });
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < text.length) {
		runs.push({ text: text.slice(lastIndex) });
	}

	return runs.length > 0 ? runs : [{ text }];
}

function findImage(ref: string, imageMap: Map<string, DocxImage>): DocxImage | null {
	if (imageMap.size === 0) return null;
	if (imageMap.has(ref)) return imageMap.get(ref)!;
	for (const [key, img] of imageMap) {
		if (key.endsWith("/" + ref.split("/").pop()) || ref.endsWith("/" + key.split("/").pop()!)) {
			return img;
		}
	}
	if (imageMap.size === 1) return imageMap.values().next().value!;
	return null;
}

function buildDrawingXml(img: DocxImage, altText: string): string {
	let cx = img.width * PX_TO_EMU;
	let cy = img.height * PX_TO_EMU;
	if (cx > MAX_WIDTH_EMU) {
		const scale = MAX_WIDTH_EMU / cx;
		cx = MAX_WIDTH_EMU;
		cy = Math.round(cy * scale);
	}

	return `<w:drawing>` +
		`<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
		`<wp:extent cx="${cx}" cy="${cy}"/>` +
		`<wp:docPr id="${img.rId.replace("rId", "")}" name="${escapeXml(altText)}"/>` +
		`<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
		`<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
		`<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
		`<pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(altText)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
		`<pic:blipFill><a:blip r:embed="${img.rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
		`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
		`</pic:pic></a:graphicData></a:graphic>` +
		`</wp:inline></w:drawing>`;
}

function parseTableRow(line: string): string[] {
	return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function buildDocumentXml(paragraphs: DocxParagraph[]): string {
	const body = paragraphs.map(p => paragraphToXml(p)).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
}

function paragraphToXml(paragraph: DocxParagraph): string {
	if (paragraph.style === "TableRow") {
		const cells = paragraph.runs.map(() =>
			`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:tc>`
		).join("");
		return `<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr>${cells}</w:p>`;
	}

	const style = paragraph.style ? `<w:pPr><w:pStyle w:val="${paragraph.style}"/></w:pPr>` : "";
	const runs = paragraph.runs.map(runToXml).join("");
	return `<w:p>${style}${runs}</w:p>`;
}

function runToXml(run: DocxRun): string {
	if (run.drawing) {
		return `<w:r>${run.drawing}</w:r>`;
	}
	const props: string[] = [];
	if (run.bold) props.push("<w:b/>");
	if (run.italics) props.push("<w:i/>");
	if (run.code) props.push('<w:rStyle w:val="CodeChar"/>');
	const runProps = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
	return `<w:r>${runProps}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function buildContentTypes(images: DocxImage[]): string {
	const imageTypes = new Set<string>();
	for (const img of images) {
		imageTypes.add(img.ext);
	}
	const imageEntries = Array.from(imageTypes).map(ext => {
		const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
		return `<Default Extension="${ext}" ContentType="${mime}"/>`;
	}).join("");

	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${imageEntries}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function buildRels(images: DocxImage[]): string {
	const rels = images.map(img =>
		`<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${img.mediaPath.replace("word/", "")}"/>`
	).join("");

	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${rels}
</Relationships>`;
}

function encodeXml(xml: string): Uint8Array {
	return encoder.encode(xml);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function createZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
	const chunks: Uint8Array[] = [];
	const entries: ZipEntry[] = [];
	let offset = 0;

	for (const file of files) {
		const name = encoder.encode(file.name);
		const entry: ZipEntry = {
			name: file.name,
			data: file.data,
			crc32: crc32(file.data),
			localHeaderOffset: offset,
		};
		const header = createLocalFileHeader(name, entry);
		chunks.push(header, file.data);
		offset += header.byteLength + file.data.byteLength;
		entries.push(entry);
	}

	const centralDirectoryOffset = offset;
	const centralDirectoryChunks = entries.map((entry) => {
		const header = createCentralDirectoryHeader(encoder.encode(entry.name), entry);
		offset += header.byteLength;
		return header;
	});
	chunks.push(...centralDirectoryChunks);

	const centralDirectorySize = offset - centralDirectoryOffset;
	chunks.push(createEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset));
	return concat(chunks);
}

function createLocalFileHeader(name: Uint8Array, entry: ZipEntry): Uint8Array {
	const header = new Uint8Array(30 + name.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04034b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 2048, true);
	view.setUint16(8, 0, true);
	view.setUint32(14, entry.crc32, true);
	view.setUint32(18, entry.data.byteLength, true);
	view.setUint32(22, entry.data.byteLength, true);
	view.setUint16(26, name.byteLength, true);
	header.set(name, 30);
	return header;
}

function createCentralDirectoryHeader(name: Uint8Array, entry: ZipEntry): Uint8Array {
	const header = new Uint8Array(46 + name.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x02014b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(6, 20, true);
	view.setUint16(8, 2048, true);
	view.setUint16(10, 0, true);
	view.setUint32(16, entry.crc32, true);
	view.setUint32(20, entry.data.byteLength, true);
	view.setUint32(24, entry.data.byteLength, true);
	view.setUint16(28, name.byteLength, true);
	view.setUint32(42, entry.localHeaderOffset, true);
	header.set(name, 46);
	return header;
}

function createEndOfCentralDirectory(entryCount: number, directorySize: number, directoryOffset: number): Uint8Array {
	const header = new Uint8Array(22);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x06054b50, true);
	view.setUint16(8, entryCount, true);
	view.setUint16(10, entryCount, true);
	view.setUint32(12, directorySize, true);
	view.setUint32(16, directoryOffset, true);
	return header;
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const out = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table(): Uint32Array {
	const table = new Uint32Array(256);
	for (let i = 0; i < table.length; i++) {
		let crc = i;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
		}
		table[i] = crc >>> 0;
	}
	return table;
}

function isImagePath(path: string): boolean {
	return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="140" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="40"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="100" w:after="40"/></w:pPr><w:rPr><w:i/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;
