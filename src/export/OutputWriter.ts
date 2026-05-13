import { App, TFile, FileSystemAdapter } from "obsidian";

const g = typeof window !== "undefined" ? window : undefined;
const nodeFs = g && "require" in g
	? (g as unknown as Record<string, (id: string) => unknown>)["require"]("fs") as typeof import("fs")
	: null;
const nodePath = g && "require" in g
	? (g as unknown as Record<string, (id: string) => unknown>)["require"]("path") as typeof import("path")
	: null;

export class OutputWriter {
	private app: App;
	private vaultRoot: string;

	constructor(app: App) {
		this.app = app;
		this.vaultRoot = this.resolveVaultRoot();
	}

	async ensureFolder(folderPath: string): Promise<void> {
		if (this.isExternal(folderPath)) {
			nodeFs?.mkdirSync(folderPath, { recursive: true });
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
			nodeFs?.writeFileSync(filePath, content, "utf-8");
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
		const absSource = nodePath?.join(this.vaultRoot, sourcePath) ?? sourcePath;
		if (!nodeFs?.existsSync(absSource)) return;

		const content = nodeFs.readFileSync(absSource);

		if (this.isExternal(destPath)) {
			nodeFs.writeFileSync(destPath, content);
		} else {
			const existing = this.app.vault.getAbstractFileByPath(destPath);
			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, content as unknown as ArrayBuffer);
			} else {
				await this.app.vault.createBinary(destPath, content as unknown as ArrayBuffer);
			}
		}
	}

	folderExists(folderPath: string): boolean {
		if (this.isExternal(folderPath)) {
			return nodeFs?.existsSync(folderPath) ?? false;
		}
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder !== null && "children" in folder;
	}

	timestampedFolder(basePath: string): string {
		const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		return `${basePath}-${ts}`;
	}

	isFolderEmpty(folderPath: string): boolean {
		if (this.isExternal(folderPath)) {
			const entries = nodeFs?.readdirSync(folderPath) ?? [];
			return entries.length === 0;
		}
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder || !("children" in folder)) return true;
		return (folder as { children: unknown[] }).children.length === 0;
	}

	isExternal(p: string): boolean {
		if (p.startsWith("/")) return true;
		if (/^[A-Za-z]:/.test(p)) return true;
		return false;
	}

	private resolveVaultRoot(): string {
		if (this.app.vault.adapter instanceof FileSystemAdapter) {
			return this.app.vault.adapter.getBasePath();
		}
		return "";
	}
}
