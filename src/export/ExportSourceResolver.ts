import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { ExportSource } from "@/types";

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

	resolve(source: ExportSource): TFile[] {
		return this.collectFiles(source);
	}

	private collectFiles(source: ExportSource): TFile[] {
		switch (source.type) {
			case "current-file":
				return this.resolveCurrentFile(source.path);
			case "files":
				return this.resolveFiles(source.paths);
			case "folder":
				return this.resolveFolder(source.path, source.recursive);
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

}
