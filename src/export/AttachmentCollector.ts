import { App, TAbstractFile, TFile } from "obsidian";
import { AttachmentCopy } from "@/types";
import { normalizePath } from "@/export/utils";

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function isFileLike(f: TAbstractFile | null): f is TFile {
	return f !== null && "extension" in f;
}

function isAttachmentExt(ext: string): boolean {
	const exts = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "pdf", "mp3", "mp4", "wav", "ogg"];
	return exts.includes(ext);
}

export interface CollectResult {
	attachments: AttachmentCopy[];
	warnings: string[];
}

export class AttachmentCollector {
	private app: App;
	private exportedPaths: Set<string>;

	constructor(app: App, exportedPaths: Set<string>) {
		this.app = app;
		this.exportedPaths = exportedPaths;
	}

	async collect(files: TFile[]): Promise<CollectResult> {
		const seen = new Map<string, AttachmentCopy>();
		const usedNames = new Set<string>();
		const warnings: string[] = [];

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const cache = this.app.metadataCache.getFileCache(file);

			if (cache?.embeds) {
				for (const embed of cache.embeds) {
					const target = this.resolveLink(embed.link, file.path);
					if (!target || this.exportedPaths.has(target)) continue;

					const targetFile = this.app.vault.getAbstractFileByPath(target);
					if (isFileLike(targetFile) && targetFile.extension !== "md") {
						if (!seen.has(target)) {
							const outputName = this.uniqueName(targetFile, usedNames);
							seen.set(target, {
								sourcePath: target,
								outputRelativePath: `assets/${outputName}`,
							});
						}
					}
				}
			}

			if (cache?.links) {
				for (const link of cache.links) {
					const target = this.resolveLink(link.link, file.path);
					if (!target || this.exportedPaths.has(target)) continue;

					const targetFile = this.app.vault.getAbstractFileByPath(target);
					if (isFileLike(targetFile) && isAttachmentExt(targetFile.extension)) {
						if (!seen.has(target)) {
							const outputName = this.uniqueName(targetFile, usedNames);
							seen.set(target, {
								sourcePath: target,
								outputRelativePath: `assets/${outputName}`,
							});
						}
					}
				}
			}

			this.collectFromMarkdownImages(content, file.path, seen, usedNames, warnings);
		}

		return { attachments: Array.from(seen.values()), warnings };
	}

	private collectFromMarkdownImages(
		content: string,
		sourcePath: string,
		seen: Map<string, AttachmentCopy>,
		usedNames: Set<string>,
		warnings: string[],
	): void {
		let match: RegExpExecArray | null;

		MARKDOWN_IMAGE_RE.lastIndex = 0;
		while ((match = MARKDOWN_IMAGE_RE.exec(content)) !== null) {
			const href = match[2];
			if (href.startsWith("http://") || href.startsWith("https://")) continue;
			if (seen.has(href)) continue;

			const target = this.resolveRelativePath(href, sourcePath);
			if (!target) {
				warnings.push(`Missing attachment: ${href} (referenced from ${sourcePath})`);
				continue;
			}
			if (this.exportedPaths.has(target)) continue;

			const targetFile = this.app.vault.getAbstractFileByPath(target);
			if (isFileLike(targetFile)) {
				if (!seen.has(target)) {
					const outputName = this.uniqueName(targetFile, usedNames);
					seen.set(target, {
						sourcePath: target,
						outputRelativePath: `assets/${outputName}`,
					});
				}
			}
		}
	}

	private resolveLink(link: string, sourcePath: string): string | null {
		const cleanLink = link.split("#")[0].split("|")[0];
		if (!cleanLink) return null;

		const dest = this.app.metadataCache.getFirstLinkpathDest(
			cleanLink,
			sourcePath,
		);
		return dest?.path ?? null;
	}

	private resolveRelativePath(
		href: string,
		sourcePath: string,
	): string | null {
		const dir = sourcePath.includes("/")
			? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
			: "";
		const resolved = dir ? `${dir}/${href}` : href;
		const normalized = normalizePath(resolved);

		const file = this.app.vault.getAbstractFileByPath(normalized);
		return file ? normalized : null;
	}

	private uniqueName(file: TFile, usedNames: Set<string>): string {
		if (!usedNames.has(file.name)) {
			usedNames.add(file.name);
			return file.name;
		}
		const dir = file.path.includes("/")
			? file.path.substring(0, file.path.lastIndexOf("/")).split("/").pop()!
			: "";
		const prefixed = dir ? `${dir}-${file.name}` : file.name;
		usedNames.add(prefixed);
		return prefixed;
	}
}
