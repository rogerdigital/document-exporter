import { App, TFile, TFolder, Vault } from "obsidian";
import { Notice, FileSystemAdapter } from "obsidian";
import * as path from "path";

export class OutputWriter {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async ensureFolder(folderPath: string): Promise<void> {
		const parts = folderPath.split("/").filter(Boolean);
		let current = "";

		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	async writeText(filePath: string, content: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(filePath, content);
		}
	}

	async copyBinaryFile(sourcePath: string, destPath: string): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		const content = await this.app.vault.readBinary(sourceFile);

		const existing = this.app.vault.getAbstractFileByPath(destPath);
		if (existing instanceof TFile) {
			await this.app.vault.modifyBinary(existing, content);
		} else {
			await this.app.vault.createBinary(destPath, content);
		}
	}

	async folderExists(folderPath: string): Promise<boolean> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder !== null && "children" in folder;
	}

	async timestampedFolder(basePath: string): Promise<string> {
		const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		return `${basePath}-${ts}`;
	}
}
