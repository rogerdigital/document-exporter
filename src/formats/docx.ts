import { App, TFile } from "obsidian";
import {
	Document, Packer, Paragraph, TextRun, HeadingLevel,
	ImageRun, ExternalHyperlink, Table, TableRow, TableCell,
	WidthType, BorderStyle,
} from "docx";
import { AssembledDocument, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";

export async function renderDocx(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App | null = null,
	outputFilePath?: string,
): Promise<string[]> {
	const warnings: string[] = [];

	await writer.ensureFolder(plan.outputRoot);

	const imageCache = new Map<string, Uint8Array>();
	if (app && doc.attachments.length > 0) {
		for (const att of doc.attachments) {
			try {
				const file = app.vault.getAbstractFileByPath(att.sourcePath);
				if (file instanceof TFile) {
					const buffer = await app.vault.readBinary(file);
					imageCache.set(att.outputRelativePath, new Uint8Array(buffer));
				}
			} catch {
				warnings.push(`Failed to read attachment: ${att.sourcePath}`);
			}
		}
	}

	const children: Paragraph[] = [];
	const isSingleSection = doc.sections.length === 1;

	children.push(new Paragraph({
		text: doc.title,
		heading: HeadingLevel.TITLE,
	}));

	for (const section of doc.sections) {
		const skipHeading = isSingleSection && section.title === doc.title;
		if (!skipHeading) {
			children.push(new Paragraph({
				text: section.title,
				heading: HeadingLevel.HEADING_1,
			}));
		}

		const sectionElements = parseMarkdownToDocx(section.markdown, imageCache, warnings);
		children.push(...sectionElements);
	}

	const document = new Document({
		sections: [{
			properties: {},
			children,
		}],
	});

	const buffer = new Uint8Array(await Packer.toBuffer(document));
	const resolved = outputFilePath ?? `${plan.outputRoot}/${plan.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "")}.docx`;
	await writer.ensureFolder(resolved.substring(0, resolved.lastIndexOf("/")));
	await writer.writeBinary(resolved, buffer);

	return warnings;
}

function parseMarkdownToDocx(
	markdown: string,
	imageCache: Map<string, Uint8Array>,
	warnings: string[],
): Paragraph[] {
	const paragraphs: Paragraph[] = [];
	const lines = markdown.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Fenced code block
		if (line.startsWith("```")) {
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith("```")) {
				codeLines.push(lines[i]);
				i++;
			}
			i++; // skip closing ```
			for (const codeLine of codeLines) {
				paragraphs.push(new Paragraph({
					children: [new TextRun({
						text: codeLine || " ",
						font: "Courier New",
						size: 20,
					})],
					shading: { fill: "f5f5f5" },
				}));
			}
			continue;
		}

		// Heading
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			const headingLevels = [
				HeadingLevel.HEADING_1, HeadingLevel.HEADING_2,
				HeadingLevel.HEADING_3, HeadingLevel.HEADING_4,
				HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
			];
			paragraphs.push(new Paragraph({
				children: parseInline(headingMatch[2]),
				heading: headingLevels[level - 1],
			}));
			i++;
			continue;
		}

		// Table
		if (line.includes("|") && i + 1 < lines.length && /^\|[-:| ]+\|$/.test(lines[i + 1])) {
			const tableRows: string[][] = [];
			// Header row
			tableRows.push(parseTableRow(line));
			i++; // skip separator
			i++;
			while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
				tableRows.push(parseTableRow(lines[i]));
				i++;
			}
			if (tableRows.length > 0) {
				paragraphs.push(...buildTable(tableRows));
			}
			continue;
		}

		// Unordered list item
		if (/^[\s]*[-*+]\s/.test(line)) {
			const text = line.replace(/^[\s]*[-*+]\s/, "");
			paragraphs.push(new Paragraph({
				children: parseInline(text),
				bullet: { level: 0 },
			}));
			i++;
			continue;
		}

		// Ordered list item
		if (/^[\s]*\d+\.\s/.test(line)) {
			const text = line.replace(/^[\s]*\d+\.\s/, "");
			paragraphs.push(new Paragraph({
				children: parseInline(text),
				numbering: { reference: "default-numbering", level: 0 },
			}));
			i++;
			continue;
		}

		// Blockquote
		if (line.startsWith("> ")) {
			const text = line.replace(/^>\s?/, "");
			paragraphs.push(new Paragraph({
				children: parseInline(text),
				indent: { left: 720 },
				border: { left: { style: BorderStyle.SINGLE, size: 6, color: "cccccc" } },
			}));
			i++;
			continue;
		}

		// Horizontal rule
		if (/^[-*_]{3,}\s*$/.test(line)) {
			paragraphs.push(new Paragraph({
				border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" } },
			}));
			i++;
			continue;
		}

		// Image (standalone line)
		const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
		if (imgMatch) {
			const imgPath = imgMatch[2];
			const imgBuffer = imageCache.get(imgPath) || imageCache.get(`assets/${imgPath}`);
			if (imgBuffer) {
				try {
					paragraphs.push(new Paragraph({
						children: [new ImageRun({
							data: imgBuffer,
							transformation: { width: 500, height: 300 },
							type: "png",
						})],
					}));
				} catch {
					warnings.push(`Failed to embed image in DOCX: ${imgPath}`);
					paragraphs.push(new Paragraph({ children: parseInline(line) }));
				}
			} else {
				paragraphs.push(new Paragraph({
					children: [new TextRun({ text: `[Image: ${imgMatch[1] || imgPath}]`, italics: true })],
				}));
			}
			i++;
			continue;
		}

		// HTML img tag (from link rewriter)
		const htmlImgMatch = line.match(/^<img src="([^"]+)" alt="([^"]*)" \/>$/);
		if (htmlImgMatch) {
			const imgPath = htmlImgMatch[1];
			const imgBuffer = imageCache.get(imgPath) || imageCache.get(`assets/${imgPath}`);
			if (imgBuffer) {
				try {
					paragraphs.push(new Paragraph({
						children: [new ImageRun({
							data: imgBuffer,
							transformation: { width: 500, height: 300 },
							type: "png",
						})],
					}));
				} catch {
					warnings.push(`Failed to embed image in DOCX: ${imgPath}`);
				}
			} else {
				paragraphs.push(new Paragraph({
					children: [new TextRun({ text: `[Image: ${htmlImgMatch[2] || imgPath}]`, italics: true })],
				}));
			}
			i++;
			continue;
		}

		// Empty line
		if (line.trim() === "") {
			paragraphs.push(new Paragraph({}));
			i++;
			continue;
		}

		// Regular paragraph
		paragraphs.push(new Paragraph({
			children: parseInline(line),
		}));
		i++;
	}

	return paragraphs;
}

function parseInline(text: string): (TextRun | ExternalHyperlink)[] {
	const runs: (TextRun | ExternalHyperlink)[] = [];

	// Split by inline patterns: bold, italic, code, links, images
	const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(!\[([^\]]*)\]\(([^)]+)\))/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		// Text before match
		if (match.index > lastIndex) {
			runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
		}

		if (match[1]) {
			// Bold
			runs.push(new TextRun({ text: match[2], bold: true }));
		} else if (match[3]) {
			// Italic
			runs.push(new TextRun({ text: match[4], italics: true }));
		} else if (match[5]) {
			// Inline code
			runs.push(new TextRun({ text: match[6], font: "Courier New", size: 20 }));
		} else if (match[10]) {
			// Inline image — just text placeholder
			runs.push(new TextRun({ text: `[Image: ${match[11] || match[12]}]`, italics: true }));
		} else if (match[7]) {
			// Link
			runs.push(new ExternalHyperlink({
				children: [new TextRun({ text: match[8], style: "Hyperlink" })],
				link: match[9],
			}));
		}

		lastIndex = match.index + match[0].length;
	}

	// Remaining text
	if (lastIndex < text.length) {
		runs.push(new TextRun({ text: text.slice(lastIndex) }));
	}

	if (runs.length === 0) {
		runs.push(new TextRun({ text: text }));
	}

	return runs;
}

function parseTableRow(line: string): string[] {
	return line.split("|").slice(1, -1).map(cell => cell.trim());
}

function buildTable(rows: string[][]): Paragraph[] {
	const result: Paragraph[] = [];
	try {
		const colCount = rows[0]?.length ?? 0;
		if (colCount === 0) return result;

		const tableRows = rows.map((row, rowIdx) =>
			new TableRow({
				children: row.map(cell =>
					new TableCell({
						children: [new Paragraph({ children: parseInline(cell) })],
						width: { size: Math.floor(9000 / colCount), type: WidthType.DXA },
						shading: rowIdx === 0 ? { fill: "f0f0f0" } : undefined,
					}),
				),
			}),
		);

		const table = new Table({
			rows: tableRows,
			width: { size: 9000, type: WidthType.DXA },
		});

		// Table can't be pushed to Paragraph[] directly, but Document sections accept both
		// Workaround: serialize table as paragraphs with text representation
		// Actually the docx library Document.sections.children accepts Table | Paragraph
		// But our return type is Paragraph[]. We'll cast it.
		result.push(table as unknown as Paragraph);
	} catch {
		// Fallback: render as text
		for (const row of rows) {
			result.push(new Paragraph({
				children: [new TextRun({ text: "| " + row.join(" | ") + " |" })],
			}));
		}
	}

	return result;
}
