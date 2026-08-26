import { App, TAbstractFile, TFile, parseLinktext, resolveSubpath } from "obsidian";
import { stripFrontmatter } from "@/export/DocumentAssembler";
import { extractCodeBlocks, restoreCodeBlocks } from "@/export/utils";
import type { DocumentFragment } from "@/types";

const WIKI_EMBED_RE = /!\[\[([^\]]+)]]/g;
const MAX_EMBED_DEPTH = 5;

export interface ExpandResult {
	fragments: DocumentFragment[];
	warnings: string[];
	embeddedPaths: string[];
}

export class EmbedExpander {
	private app: App;
	private embeddedPaths = new Set<string>();

	constructor(app: App) {
		this.app = app;
	}

	async expand(markdown: string, sourcePath: string): Promise<ExpandResult> {
		const warnings: string[] = [];
		const { text, blocks } = extractCodeBlocks(markdown);
		const fragments = await this.expandText(text, sourcePath, [], warnings);
		const restored = fragments.map((f) => ({
			...f,
			markdown: restoreCodeBlocks(f.markdown, blocks),
		}));
		return {
			fragments: coalesceAdjacentFragments(restored),
			warnings,
			embeddedPaths: [...this.embeddedPaths],
		};
	}

	private async expandText(
		text: string,
		sourcePath: string,
		stack: string[],
		warnings: string[],
	): Promise<DocumentFragment[]> {
		// Materialize matches BEFORE awaiting: a shared module-level /g regex
		// interleaved with async recursion resets lastIndex mid-scan and
		// loops forever. matchAll() reads from a cloned regex.
		const matches = [...text.matchAll(WIKI_EMBED_RE)];
		if (matches.length === 0) return [{ markdown: text, sourcePath }];

		const fragments: DocumentFragment[] = [];
		let lastIndex = 0;
		for (const match of matches) {
			const before = text.slice(lastIndex, match.index);
			if (before !== "") fragments.push({ markdown: before, sourcePath });
			fragments.push(...await this.expandEmbed(match[1], sourcePath, stack, warnings));
			lastIndex = match.index + match[0].length;
		}
		const after = text.slice(lastIndex);
		if (after !== "") fragments.push({ markdown: after, sourcePath });
		return fragments;
	}

	private async expandEmbed(
		link: string,
		sourcePath: string,
		stack: string[],
		warnings: string[],
	): Promise<DocumentFragment[]> {
		const keep = (): DocumentFragment[] => [{ markdown: `![[${link}]]`, sourcePath }];
		const [rawTarget] = link.split("|");
		const { path: target, subpath } = parseLinktext(rawTarget);

		if (/^#?\^/.test(subpath)) {
			warnings.push(`Block reference embeds are not supported: ${link}`);
			return keep();
		}

		let dest: string | null;
		if (target === "") {
			dest = sourcePath;
		} else {
			dest = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null;
		}
		if (!dest) {
			warnings.push(`Unresolved embed: ${link}`);
			return keep();
		}

		if (!dest.toLowerCase().endsWith(".md")) {
			// Attachments (images, PDFs, …) stay embeds — LinkRewriter owns them.
			return keep();
		}

		const identity = `${dest}${subpath}`;
		if (stack.includes(identity)) {
			warnings.push(`Circular embed skipped: ${link}`);
			return keep();
		}
		if (stack.length >= MAX_EMBED_DEPTH) {
			warnings.push(`Embed depth limit reached at: ${link}`);
			return keep();
		}

		const file = this.app.vault.getAbstractFileByPath(dest);
		if (!isTFile(file)) {
			warnings.push(`Unresolved embed: ${link}`);
			return keep();
		}

		const raw = await this.app.vault.read(file);
		let content: string;
		if (subpath) {
			const cache = this.app.metadataCache.getFileCache(file);
			const sub = cache ? resolveSubpath(cache, subpath) : null;
			if (!sub || sub.type !== "heading") {
				warnings.push(`Heading not found in embed: ${link}`);
				return keep();
			}
			// End is null when the section runs to the end of the file; trim the
			// trailing newline so the section never gains a blank line it didn't have.
			const start = sub.start.offset;
			const end = sub.end?.offset ?? raw.length;
			content = raw.slice(start, end).trimEnd();
		} else {
			content = stripFrontmatter(raw).body;
		}

		this.embeddedPaths.add(dest);
		// Per-level code-fence protection: an embed inside a fenced block
		// *within* the embedded note must not be expanded either.
		const { text, blocks } = extractCodeBlocks(content);
		const inner = await this.expandText(text, dest, [...stack, identity], warnings);
		const restored = inner.map((f) => ({
			...f,
			markdown: restoreCodeBlocks(f.markdown, blocks),
		}));
		return markBlockBoundaries(restored);
	}
}

function markBlockBoundaries(
	fragments: DocumentFragment[],
): DocumentFragment[] {
	if (fragments.length === 0) return fragments;

	const marked = [...fragments];
	marked[0] = { ...marked[0], blockBoundaryBefore: true };
	const lastIndex = marked.length - 1;
	marked[lastIndex] = { ...marked[lastIndex], blockBoundaryAfter: true };
	return marked;
}

function coalesceAdjacentFragments(
	fragments: DocumentFragment[],
): DocumentFragment[] {
	const result: DocumentFragment[] = [];

	for (const fragment of fragments) {
		const previous = result.at(-1);
		if (
			previous
			&& previous.sourcePath === fragment.sourcePath
			&& !previous.blockBoundaryAfter
			&& !fragment.blockBoundaryBefore
		) {
			previous.markdown += fragment.markdown;
			if (fragment.blockBoundaryAfter) previous.blockBoundaryAfter = true;
			continue;
		}

		result.push({ ...fragment });
	}

	return result;
}

function isTFile(file: TAbstractFile | null): file is TFile {
	return file !== null && "extension" in file;
}
