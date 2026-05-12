import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { ExportSource, ExportSort } from "@/types";

function isTFile(f: TAbstractFile | null): f is TFile {
	return f !== null && "extension" in f;
}

function isTFolder(f: TAbstractFile | null): f is TFolder {
	return f !== null && "children" in f;
}

export class ExportSourceResolver {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	resolve(source: ExportSource, sort: ExportSort): TFile[] {
		const files = this.collectFiles(source);
		const sorted = this.sortFiles(files, sort);
		return sorted;
	}

	private collectFiles(source: ExportSource): TFile[] {
		switch (source.type) {
			case "current-file":
				return this.resolveCurrentFile(source.path);
			case "files":
				return this.resolveFiles(source.paths);
			case "folder":
				return this.resolveFolder(source.path, source.recursive);
			case "filter":
				return this.resolveFilter(source.tag);
		}
	}

	private resolveCurrentFile(path: string): TFile[] {
		if (!path) return [];
		const file = this.app.vault.getAbstractFileByPath(path);
		if (isTFile(file) && file.extension === "md") {
			return [file];
		}
		return [];
	}

	private resolveFiles(paths: string[]): TFile[] {
		const files: TFile[] = [];
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (isTFile(file) && file.extension === "md") {
				files.push(file);
			}
		}
		return files;
	}

	private resolveFolder(folderPath: string, recursive: boolean): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!isTFolder(folder)) return [];

		return this.collectMarkdownFiles(folder, recursive);
	}

	private collectMarkdownFiles(folder: TFolder, recursive: boolean): TFile[] {
		const files: TFile[] = [];

		for (const child of folder.children) {
			if (isTFile(child) && child.extension === "md") {
				files.push(child);
			} else if (recursive && isTFolder(child)) {
				files.push(...this.collectMarkdownFiles(child, true));
			}
		}

		return files;
	}

	private resolveFilter(tag?: string): TFile[] {
		if (!tag) return [];

		const cleanTag = tag.startsWith("#") ? tag.slice(1) : tag;
		const result: TFile[] = [];
		const mdFiles = this.app.vault.getMarkdownFiles();

		for (const file of mdFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.tags) continue;

			const hasTag = cache.tags.some(
				(t) => t.tag === cleanTag || t.tag === `#${cleanTag}`,
			);
			if (hasTag) {
				result.push(file);
			}
		}

		return result;
	}

	private sortFiles(files: TFile[], sort: ExportSort): TFile[] {
		const sorted = [...files];

		const compare = (a: TFile, b: TFile): number => {
			let result = 0;

			switch (sort.mode) {
				case "path":
					result = a.path.localeCompare(b.path);
					break;
				case "name":
					result = a.basename.localeCompare(b.basename);
					break;
				case "frontmatter": {
					const key = sort.frontmatterKey ?? "title";
					const aVal = this.getFrontmatterValue(a, key);
					const bVal = this.getFrontmatterValue(b, key);
					const toStr = (v: unknown) => v != null ? (typeof v === "string" ? v : JSON.stringify(v)) : "";
					result = toStr(aVal).localeCompare(toStr(bVal));
					break;
				}
			}

			return sort.direction === "desc" ? -result : result;
		};

		sorted.sort(compare);
		return sorted;
	}

	private getFrontmatterValue(file: TFile, key: string): unknown {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?.[key];
	}
}
