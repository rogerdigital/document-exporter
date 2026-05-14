import { App } from "obsidian";
import { ExportProfileId, AttachmentCopy } from "@/types";
import { normalizePath, extractCodeBlocks, restoreCodeBlocks } from "@/export/utils";

const WIKI_LINK_RE = /\[\[([^\]]+)]]/g;
const WIKI_EMBED_RE = /!\[\[([^\]]+)]]/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export interface RewriteResult {
	markdown: string;
	warnings: string[];
}

export class LinkRewriter {
	private app: App;
	private exportedPaths: Set<string>;
	private attachments: Map<string, AttachmentCopy>;
	private profile: ExportProfileId;

	constructor(
		app: App,
		exportedPaths: Set<string>,
		attachments: AttachmentCopy[],
		profile: ExportProfileId,
	) {
		this.app = app;
		this.exportedPaths = exportedPaths;
		this.attachments = new Map(
			attachments.map((a) => [a.sourcePath, a]),
		);
		this.profile = profile;
	}

	rewrite(markdown: string, sourcePath: string): RewriteResult {
		const warnings: string[] = [];

		const { text, blocks } = extractCodeBlocks(markdown);

		// Rewrite embedded attachments: ![[image.png]]
		let result = text.replace(WIKI_EMBED_RE, (match, link: string) => {
			const cleanLink = link.split("|")[0].split("#")[0];
			const dest = this.resolvePath(cleanLink, sourcePath);
			if (!dest) return match;

			const attachment = this.attachments.get(dest);
			if (attachment) {
				return this.formatEmbed(attachment.outputRelativePath, cleanLink);
			}

			// If it's an included markdown note, leave as link anchor
			if (this.exportedPaths.has(dest)) {
				return match;
			}

			warnings.push(`Unresolved embed: ${cleanLink}`);
			return match;
		});

		// Rewrite wiki links: [[Note]] or [[Note|Alias]]
		result = result.replace(WIKI_LINK_RE, (match, link: string) => {
			const [rawTarget, alias] = link.split("|");
			const [target, heading] = rawTarget.split("#");
			const displayText = alias || target;

			const dest = this.resolvePath(target, sourcePath);
			if (!dest) {
				warnings.push(`Unresolved link: ${target}`);
				return displayText;
			}

			if (this.exportedPaths.has(dest)) {
				// Link to included note -> convert to anchor
				const anchor = heading
					? `#${slugify(target)}-${slugify(heading)}`
					: `#${slugify(target)}`;
				return `[${displayText}](${anchor})`;
			}

			const attachment = this.attachments.get(dest);
			if (attachment) {
				return `[${displayText}](${attachment.outputRelativePath})`;
			}

			warnings.push(`Unresolved link: ${target}`);
			return displayText;
		});

		// Rewrite markdown image links: ![alt](path)
		result = result.replace(MARKDOWN_IMAGE_RE, (match, alt: string, href: string) => {
			if (href.startsWith("http://") || href.startsWith("https://")) {
				return match;
			}

			const resolved = this.resolveRelativePath(href, sourcePath);
			if (!resolved) return match;

			const attachment = this.attachments.get(resolved);
			if (attachment) {
				return `![${alt}](${attachment.outputRelativePath})`;
			}

			return match;
		});

		result = restoreCodeBlocks(result, blocks);

		return { markdown: result, warnings };
	}

	private resolvePath(link: string, sourcePath: string): string | null {
		const dest = this.app.metadataCache.getFirstLinkpathDest(
			link,
			sourcePath,
		);
		return dest?.path ?? null;
	}

	private resolveRelativePath(href: string, sourcePath: string): string | null {
		const dir = sourcePath.includes("/")
			? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
			: "";
		const resolved = dir ? `${dir}/${href}` : href;
		const normalized = normalizePath(resolved);
		const file = this.app.vault.getAbstractFileByPath(normalized);
		return file ? normalized : null;
	}

	private formatEmbed(relPath: string, link: string): string {
		if (this.profile === "html-document" || this.profile === "print-html" || this.profile === "single-file-html") {
			const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
			if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext)) {
				return `<img src="${relPath}" alt="${link}" />`;
			}
			return `<a href="${relPath}">${link}</a>`;
		}
		return `![](${relPath})`;
	}
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9一-鿿぀-ゟ゠-ヿ가-힯_-]+/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}
