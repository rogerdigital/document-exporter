import { App, TFile, TFolder, TAbstractFile, FileSystemAdapter } from "obsidian";
import * as fs from "fs";
import * as path from "path";

export class OutputWriter {
	private app: App;
	private vaultRoot: string;

	constructor(app: App) {
		this.app = app;
		this.vaultRoot = this.resolveVaultRoot();
	}

	async ensureFolder(folderPath: string): Promise<void> {
		if (this.isExternal(folderPath)) {
			fs.mkdirSync(folderPath, { recursive: true });
			return;
		}

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
		if (this.isExternal(filePath)) {
			fs.writeFileSync(filePath, content, "utf-8");
			return;
		}

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(filePath, content);
		}
	}

	async copyBinaryFile(sourcePath: string, destPath: string): Promise<void> {
		// Source is always vault-internal
		const absSource = path.join(this.vaultRoot, sourcePath);
		if (!fs.existsSync(absSource)) return;

		const content = fs.readFileSync(absSource);

		if (this.isExternal(destPath)) {
			fs.writeFileSync(destPath, content);
		} else {
			const existing = this.app.vault.getAbstractFileByPath(destPath);
			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, content as unknown as ArrayBuffer);
			} else {
				await this.app.vault.createBinary(destPath, content as unknown as ArrayBuffer);
			}
		}
	}

	async folderExists(folderPath: string): Promise<boolean> {
		if (this.isExternal(folderPath)) {
			return fs.existsSync(folderPath);
		}
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder !== null && "children" in folder;
	}

	async timestampedFolder(basePath: string): Promise<string> {
		const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		return `${basePath}-${ts}`;
	}

	async isFolderEmpty(folderPath: string): Promise<boolean> {
		if (this.isExternal(folderPath)) {
			const entries = fs.readdirSync(folderPath);
			return entries.length === 0;
		}
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder || !("children" in folder)) return true;
		return (folder as any).children.length === 0;
	}

	isExternal(p: string): boolean {
		if (p.startsWith("/")) return true;
		if (/^[A-Za-z]:/.test(p)) return true;
		return false;
	}

	private resolveVaultRoot(): string {
		if (this.app.vault.adapter instanceof FileSystemAdapter) {
			return (this.app.vault.adapter as FileSystemAdapter).getBasePath();
		}
		return "";
	}
}
