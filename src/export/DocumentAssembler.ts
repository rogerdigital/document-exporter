import { App, TFile } from "obsidian";
import { AssembledDocument, DocumentSection } from "@/types";

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
		let sectionTitle = deriveTitle(file, frontmatter);
		let contentBody = body;

		const extracted = extractLeadingH1(contentBody);
		if (extracted) {
			if (typeof frontmatter.title !== "string") {
				sectionTitle = extracted.title;
				contentBody = extracted.remaining;
			} else if (extracted.title.trim() === frontmatter.title.trim()) {
				contentBody = extracted.remaining;
			}
		}

		const normalized = normalizeHeadings(contentBody, 1);
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
	const match = content.match(/^---\r?\n((?:[\s\S]*?\r?\n)?)---(?:\r?\n|$)/);
	if (!match) {
		return { body: content, frontmatter: {} };
	}

	const yamlBlock = match[1].replace(/\r?\n$/, "");
	const body = content.slice(match[0].length);

	const frontmatter: Record<string, unknown> = {};
	for (const line of yamlBlock.split(/\r?\n/)) {
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
): string {
	// Prefer an explicit frontmatter title; otherwise fall back to the file
	// basename. The body's leading H1 is handled separately by
	// extractLeadingH1 in buildSection so it can be removed from the body.
	if (typeof frontmatter.title === "string") {
		return frontmatter.title;
	}

	return file.basename;
}

/**
 * If the markdown body begins with a level-1 heading (`# Title`), extract that
 * heading's text as the document title and return the body with that line
 * removed. Returns null when the body does not start with an H1, so the caller
 * falls back to the filename-derived title.
 */
export function extractLeadingH1(
	body: string,
): { title: string; remaining: string } | null {
	const match = body.match(/^#\s+(.+?)\s*(?:\n|$)/);
	if (!match) return null;
	const title = match[1].trim();
	// Remove the matched H1 line (and its trailing newline) from the body.
	const remaining = body.slice(match[0].length);
	return { title, remaining };
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
