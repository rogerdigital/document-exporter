import { App } from "obsidian";
import { ExportProfileId, AttachmentCopy } from "@/types";
import { normalizePath, extractCodeBlocks, restoreCodeBlocks, relativePathBetween } from "@/export/utils";

const WIKI_LINK_RE = /\[\[([^\]]+)]]/g;
const WIKI_EMBED_RE = /!\[\[([^\]]+)]]/g;
const MARKDOWN_INLINE_LINK_RE =
	/(!?)\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const EMBED_PLACEHOLDER = "\uE000WE";

export interface RewriteResult {
	markdown: string;
	warnings: string[];
}

export class LinkRewriter {
	private app: App;
	private exportedPaths: Set<string>;
	private attachments: Map<string, AttachmentCopy>;
	private profile: ExportProfileId;
	private outputRoot: string;
	private outputPathMap: Map<string, string>;
	private currentOutputPath: string;

	constructor(
		app: App,
		exportedPaths: Set<string>,
		attachments: AttachmentCopy[],
		profile: ExportProfileId,
		outputPathMap: Map<string, string> = new Map(),
		currentOutputPath: string = "",
		outputRoot: string = "",
	) {
		this.app = app;
		this.exportedPaths = exportedPaths;
		this.attachments = new Map(
			attachments.map((a) => [a.sourcePath, a]),
		);
		this.profile = profile;
		this.outputPathMap = outputPathMap;
		this.currentOutputPath = currentOutputPath;
		this.outputRoot = outputRoot;
	}

	rewrite(markdown: string, sourcePath: string): RewriteResult {
		const warnings: string[] = [];

		const { text, blocks } = extractCodeBlocks(markdown);
		const embedReplacements: string[] = [];

		// Protect every embed result from the later wiki and Markdown link passes.
		let result = text.replace(WIKI_EMBED_RE, (match, link: string) => {
			const [rawTarget, alias] = link.split("|");
			const [target, heading] = rawTarget.split("#");
			const displayText = alias || target;
			const dest = this.resolvePath(target, sourcePath);
			if (!dest) {
				warnings.push(`Unresolved embed: ${target}`);
				return storeReplacement(embedReplacements, match);
			}

			const attachment = this.attachments.get(dest);
			if (attachment) {
				const relPath = this.rewriteAttachmentPath(attachment.outputRelativePath);
				return storeReplacement(
					embedReplacements,
					this.formatEmbed(relPath, target),
				);
			}

			if (this.exportedPaths.has(dest)) {
				return storeReplacement(
					embedReplacements,
					this.formatExportedNoteLink(dest, displayText, target, heading),
				);
			}

			if (dest.toLowerCase().endsWith(".md")) {
				return storeReplacement(embedReplacements, `[[${link}]]`);
			}

			warnings.push(`Unresolved embed: ${target}`);
			return storeReplacement(embedReplacements, match);
		});

		// Rewrite standard inline links and images before generating Markdown
		// links from wiki syntax, so generated output is not processed twice.
		result = result.replace(
			MARKDOWN_INLINE_LINK_RE,
			(
				match,
				imagePrefix: string,
				label: string,
				hrefToken: string,
				titleSuffix = "",
			) => {
				const wrapped = hrefToken.startsWith("<") && hrefToken.endsWith(">");
				const href = wrapped ? hrefToken.slice(1, -1) : hrefToken;
				if (isExternalOrFragmentLink(href)) return match;

				const [target, heading] = href.split("#");
				const dest = this.resolvePath(target, sourcePath);
				if (dest && this.exportedPaths.has(dest)) {
					const destination = this.exportedNoteDestination(
						dest,
						target,
						heading,
					);
					return `${imagePrefix}[${label}](${destination}${titleSuffix})`;
				}

				const relativeDest = this.resolveRelativePath(target, sourcePath);
				const attachmentDest = dest && this.attachments.has(dest)
					? dest
					: relativeDest;
				const attachment = attachmentDest
					? this.attachments.get(attachmentDest)
					: undefined;
				if (attachment) {
					const rewrittenPath = this.rewriteAttachmentPath(
						attachment.outputRelativePath,
					);
					return `${imagePrefix}[${label}](${rewrittenPath}${titleSuffix})`;
				}

				warnings.push(`Unresolved local link: ${href}`);
				return match;
			},
		);

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
				return this.formatExportedNoteLink(dest, displayText, target, heading);
			}

			const attachment = this.attachments.get(dest);
			if (attachment) {
				return `[${displayText}](${this.rewriteAttachmentPath(attachment.outputRelativePath)})`;
			}

			warnings.push(`Unresolved link: ${target}`);
			return displayText;
		});

		result = restoreReplacements(result, embedReplacements);
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

	private formatExportedNoteLink(
		dest: string,
		displayText: string,
		target: string,
		heading?: string,
	): string {
		return `[${displayText}](${this.exportedNoteDestination(dest, target, heading)})`;
	}

	private exportedNoteDestination(
		dest: string,
		target: string,
		heading?: string,
	): string {
		const targetOutput = this.outputPathMap.get(dest);
		if (targetOutput && this.currentOutputPath) {
			const relPath = relativePathBetween(this.currentOutputPath, targetOutput);
			const hash = heading ? `#${slugify(heading)}` : "";
			return `${relPath}${hash}`;
		}

		return heading
			? `#${slugify(target)}-${slugify(heading)}`
			: `#${slugify(target)}`;
	}

	private rewriteAttachmentPath(attRelativePath: string): string {
		if (!this.currentOutputPath || !this.outputRoot) return attRelativePath;
		// attRelativePath is relative to outputRoot (e.g., "assets/image.png")
		// currentOutputPath is e.g., "exports/a/note1.pdf", outputRoot is "exports"
		// We need the relative path from the output file's directory to the attachment
		const dirAfterRoot = this.currentOutputPath.startsWith(this.outputRoot + "/")
			? this.currentOutputPath.slice(this.outputRoot.length + 1)
			: this.currentOutputPath;
		const depth = dirAfterRoot.split("/").length - 1; // -1 for the filename
		if (depth <= 0) return attRelativePath;
		return "../".repeat(depth) + attRelativePath;
	}

	private formatEmbed(relPath: string, link: string): string {
		const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
		const safeRelPath = escapeHtmlAttr(relPath);
		const safeLabel = escapeHtmlText(link);

		if (this.profile === "html-document" || this.profile === "pdf") {
			if (isImageExtension(ext)) {
				return `<img src="${safeRelPath}" alt="${escapeHtmlAttr(link)}" />`;
			}
			if (isVideoExtension(ext)) {
				return `<video controls src="${safeRelPath}">${safeLabel}</video>`;
			}
			if (isAudioExtension(ext)) {
				return `<audio controls src="${safeRelPath}">${safeLabel}</audio>`;
			}
			if (ext === "pdf") {
				return `<object data="${safeRelPath}" type="application/pdf"><a href="${safeRelPath}">${safeLabel}</a></object>`;
			}
			return `<a href="${safeRelPath}">${safeLabel}</a>`;
		}

		if (this.profile === "docx" && isImageExtension(ext)) {
			return `![${link}](${relPath})`;
		}

		// markdown-bundle: use the link text as alt. An empty alt (![](path))
		// is not rendered as an image by Obsidian and many Markdown viewers.
		return `![${link}](${relPath})`;
	}
}

function storeReplacement(values: string[], value: string): string {
	values.push(value);
	return `${EMBED_PLACEHOLDER}${values.length - 1}${EMBED_PLACEHOLDER}`;
}

function restoreReplacements(text: string, values: string[]): string {
	return text.replace(
		new RegExp(`${EMBED_PLACEHOLDER}(\\d+)${EMBED_PLACEHOLDER}`, "g"),
		(_match, index: string) => values[Number(index)],
	);
}

function isExternalOrFragmentLink(href: string): boolean {
	return /^(?:https?:|mailto:|data:|#)/i.test(href);
}

function isImageExtension(ext: string): boolean {
	return ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext);
}

function isVideoExtension(ext: string): boolean {
	return ["mp4", "webm", "mov", "m4v"].includes(ext);
}

function isAudioExtension(ext: string): boolean {
	return ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext);
}

function escapeHtmlAttr(value: string): string {
	return escapeHtmlText(value).replace(/"/g, "&quot;");
}

function escapeHtmlText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9一-鿿぀-ゟ゠-ヿ가-힯_-]+/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}
