import { App, parseLinktext, resolveSubpath } from "obsidian";
import { stripFrontmatter } from "@/export/DocumentAssembler";
import { extractCodeBlocks, restoreCodeBlocks } from "@/export/utils";

const WIKI_EMBED_RE = /!\[\[([^\]]+)]]/g;
const MAX_EMBED_DEPTH = 5;

export interface Fragment {
	markdown: string;
	sourcePath: string;
}

export interface ExpandResult {
	fragments: Fragment[];
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
		return {
			fragments: fragments.map((f) => ({
				...f,
				markdown: restoreCodeBlocks(f.markdown, blocks),
			})),
			warnings,
			embeddedPaths: [...this.embeddedPaths],
		};
	}

	private async expandText(
		text: string,
		sourcePath: string,
		stack: string[],
		warnings: string[],
	): Promise<Fragment[]> {
		// Materialize matches BEFORE awaiting: a shared module-level /g regex
		// interleaved with async recursion resets lastIndex mid-scan and
		// loops forever. matchAll() reads from a cloned regex.
		const matches = [...text.matchAll(WIKI_EMBED_RE)];
		if (matches.length === 0) return [{ markdown: text, sourcePath }];

		const fragments: Fragment[] = [];
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
	): Promise<Fragment[]> {
		const keep = (): Fragment[] => [{ markdown: `![[${link}]]`, sourcePath }];
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
		if (!file || !("extension" in file)) {
			warnings.push(`Unresolved embed: ${link}`);
			return keep();
		}

		const raw = await this.app.vault.read(file as never);
		let content: string;
		if (subpath) {
			const cache = this.app.metadataCache.getFileCache(file as never);
			const sub = cache ? resolveSubpath(cache as never, subpath) : null;
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
		return inner.map((f) => ({ ...f, markdown: restoreCodeBlocks(f.markdown, blocks) }));
	}
}
