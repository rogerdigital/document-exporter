import { App, TFile } from "obsidian";
import { AssembledDocument, DocumentSection } from "@/types";

const HEADING_RE = /^(#{1,6})\s+(.+)$/m;

export class DocumentAssembler {
	private app: App;
	private includeSourcePaths: boolean;

	constructor(app: App, includeSourcePaths = false) {
		this.app = app;
		this.includeSourcePaths = includeSourcePaths;
	}

	async assemble(files: TFile[], title?: string): Promise<AssembledDocument> {
		const sections: DocumentSection[] = [];

		for (const file of files) {
			const section = await this.buildSection(file);
			sections.push(section);
		}

		const docTitle =
			title ??
			sections[0]?.title ??
			"Untitled Export";

		return {
			title: docTitle,
			sections,
			attachments: [],
		};
	}

	private async buildSection(file: TFile): Promise<DocumentSection> {
		const raw = await this.app.vault.read(file);
		const { body, frontmatter } = stripFrontmatter(raw);
		const sectionTitle = deriveTitle(file, frontmatter, body);
		const normalized = normalizeHeadings(body, 1);
		const markdown = this.includeSourcePaths
			? `<!-- source: ${file.path} -->\n${normalized}`
			: normalized;

		return {
			sourcePath: file.path,
			title: sectionTitle,
			markdown,
			frontmatter,
		};
	}
}

export function stripFrontmatter(
	content: string,
): { body: string; frontmatter: Record<string, unknown> } {
	if (!content.startsWith("---")) {
		return { body: content, frontmatter: {} };
	}

	const closingIndex = content.indexOf("\n---\n", 3);
	if (closingIndex === -1) {
		return { body: content, frontmatter: {} };
	}

	const yamlBlock = content.slice(3, closingIndex).trim();
	const body = content.slice(closingIndex + 5).trimStart();

	const frontmatter: Record<string, unknown> = {};
	for (const line of yamlBlock.split("\n")) {
		if (/^\s/.test(line) || line.startsWith("-")) continue;
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;
		const key = line.slice(0, colonIndex).trim();
		let value = line.slice(colonIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		frontmatter[key] = parseYamlValue(value);
	}

	return { body, frontmatter };
}

function parseYamlValue(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null" || value === "") return null;
	if (/^-?\d+$/.test(value)) return parseInt(value, 10);
	if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
	return value;
}

export function deriveTitle(
	file: TFile,
	frontmatter: Record<string, unknown>,
	body: string,
): string {
	if (typeof frontmatter.title === "string") {
		return frontmatter.title;
	}

	const headingMatch = body.match(HEADING_RE);
	if (headingMatch) {
		return headingMatch[2].trim();
	}

	return file.basename;
}

export function normalizeHeadings(
	markdown: string,
	minLevel: number,
): string {
	const lines = markdown.split("\n");
	const result: string[] = [];
	let inCodeBlock = false;

	for (const line of lines) {
		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			result.push(line);
			continue;
		}
		if (inCodeBlock) {
			result.push(line);
			continue;
		}
		const match = line.match(/^(#{1,6})\s/);
		if (match) {
			const currentLevel = match[1].length;
			const newLevel = Math.min(currentLevel + minLevel - 1, 6);
			result.push("#".repeat(newLevel) + line.slice(currentLevel));
		} else {
			result.push(line);
		}
	}

	return result.join("\n");
}
