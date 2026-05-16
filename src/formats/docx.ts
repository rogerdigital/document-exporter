import { AssembledDocument, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";

type DocxRun = {
	text: string;
	bold?: boolean;
	italics?: boolean;
	code?: boolean;
};

type DocxParagraph = {
	runs: DocxRun[];
	style?: string;
};

type ZipEntry = {
	name: string;
	data: Uint8Array;
	crc32: number;
	localHeaderOffset: number;
};

const encoder = new TextEncoder();
const CRC32_TABLE = buildCrc32Table();

export async function renderDocx(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	_app: unknown = null,
	outputFilePath?: string,
): Promise<string[]> {
	const warnings: string[] = [];
	const paragraphs = buildDocxParagraphs(doc);
	const documentXml = buildDocumentXml(paragraphs);
	const buffer = createZip([
		{ name: "[Content_Types].xml", data: encodeXml(CONTENT_TYPES_XML) },
		{ name: "_rels/.rels", data: encodeXml(PACKAGE_RELS_XML) },
		{ name: "word/document.xml", data: encodeXml(documentXml) },
		{ name: "word/styles.xml", data: encodeXml(STYLES_XML) },
	]);

	if (doc.attachments.some((att) => isImagePath(att.sourcePath))) {
		warnings.push("DOCX export currently preserves image references as text placeholders.");
	}

	const resolved = outputFilePath ?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "")}.docx`;
	await writer.ensureFolder(resolved.substring(0, resolved.lastIndexOf("/")));
	await writer.writeBinary(resolved, buffer);

	return warnings;
}

function buildDocxParagraphs(doc: AssembledDocument): DocxParagraph[] {
	const paragraphs: DocxParagraph[] = [
		{ style: "Title", runs: [{ text: doc.title }] },
	];
	const isSingleSection = doc.sections.length === 1;

	for (const section of doc.sections) {
		if (!(isSingleSection && section.title === doc.title)) {
			paragraphs.push({ style: "Heading1", runs: [{ text: section.title }] });
		}
		paragraphs.push(...parseMarkdownToParagraphs(section.markdown));
	}

	return paragraphs;
}

function parseMarkdownToParagraphs(markdown: string): DocxParagraph[] {
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
			const level = Math.min(headingMatch[1].length, 3);
			paragraphs.push({ style: `Heading${level}`, runs: parseInline(headingMatch[2]) });
			i++;
			continue;
		}

		if (line.includes("|") && i + 1 < lines.length && /^\|[-:| ]+\|$/.test(lines[i + 1])) {
			paragraphs.push({ runs: parseInline(parseTableRow(line).join(" | ")) });
			i += 2;
			while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
				paragraphs.push({ runs: parseInline(parseTableRow(lines[i]).join(" | ")) });
				i++;
			}
			continue;
		}

		if (/^[\s]*[-*+]\s/.test(line)) {
			const text = line.replace(/^[\s]*[-*+]\s/, "");
			paragraphs.push({ style: "ListParagraph", runs: parseInline(`• ${text}`) });
			i++;
			continue;
		}

		if (/^[\s]*\d+\.\s/.test(line)) {
			const text = line.replace(/^[\s]*\d+\.\s/, "");
			paragraphs.push({ style: "ListParagraph", runs: parseInline(text) });
			i++;
			continue;
		}

		if (line.startsWith("> ")) {
			paragraphs.push({ style: "Quote", runs: parseInline(line.replace(/^>\s?/, "")) });
			i++;
			continue;
		}

		if (/^[-*_]{3,}\s*$/.test(line)) {
			paragraphs.push({ runs: [{ text: "------" }] });
			i++;
			continue;
		}

		const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
		if (imgMatch) {
			paragraphs.push({ runs: [{ text: `[Image: ${imgMatch[1] || imgMatch[2]}]`, italics: true }] });
			i++;
			continue;
		}

		const htmlImgMatch = line.match(/^<img src="([^"]+)" alt="([^"]*)" \/>$/);
		if (htmlImgMatch) {
			paragraphs.push({ runs: [{ text: `[Image: ${htmlImgMatch[2] || htmlImgMatch[1]}]`, italics: true }] });
			i++;
			continue;
		}

		paragraphs.push({ runs: line.trim() === "" ? [{ text: "" }] : parseInline(line) });
		i++;
	}

	return paragraphs;
}

function parseInline(text: string): DocxRun[] {
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
			runs.push({ text: `[Image: ${match[11] || match[12]}]`, italics: true });
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

function parseTableRow(line: string): string[] {
	return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function buildDocumentXml(paragraphs: DocxParagraph[]): string {
	const body = paragraphs.map(paragraphToXml).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
}

function paragraphToXml(paragraph: DocxParagraph): string {
	const style = paragraph.style ? `<w:pPr><w:pStyle w:val="${paragraph.style}"/></w:pPr>` : "";
	const runs = paragraph.runs.map(runToXml).join("");
	return `<w:p>${style}${runs}</w:p>`;
}

function runToXml(run: DocxRun): string {
	const props: string[] = [];
	if (run.bold) props.push("<w:b/>");
	if (run.italics) props.push("<w:i/>");
	if (run.code) props.push('<w:rStyle w:val="CodeChar"/>');
	const runProps = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
	return `<w:r>${runProps}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
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

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

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
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;
