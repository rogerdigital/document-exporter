import { App, Platform, TFile } from "obsidian";

const g = typeof window !== "undefined" ? window : undefined;
const nodeFs = g && "require" in g
	? (g as unknown as Record<string, (id: string) => unknown>)["require"]("fs") as typeof import("fs")
	: null;

export class OutputWriter {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	static supportsExternalPaths(): boolean {
		return Platform.isDesktopApp;
	}

	async ensureFolder(folderPath: string): Promise<void> {
		if (this.isExternal(folderPath)) {
			if (!nodeFs) return;
			nodeFs.mkdirSync(folderPath, { recursive: true });
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
			if (!nodeFs) return;
			nodeFs.writeFileSync(filePath, content, "utf-8");
			return;
		}

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(filePath, content);
		}
	}

	async writeBinary(filePath: string, data: ArrayBuffer | Buffer | Uint8Array): Promise<void> {
		if (this.isExternal(filePath)) {
			if (!nodeFs) return;
			nodeFs.writeFileSync(filePath, new Uint8Array(data as ArrayBuffer));
			return;
		}

		const buffer = data instanceof ArrayBuffer ? data : (data as Uint8Array).buffer as ArrayBuffer;
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			await this.app.vault.modifyBinary(existing, buffer);
		} else {
			await this.app.vault.createBinary(filePath, buffer);
		}
	}

	async copyBinaryFile(sourcePath: string, destPath: string): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		const content = await this.app.vault.readBinary(sourceFile);

		if (this.isExternal(destPath)) {
			if (!nodeFs) return;
			nodeFs.writeFileSync(destPath, new Uint8Array(content));
		} else {
			const existing = this.app.vault.getAbstractFileByPath(destPath);
			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, content);
			} else {
				await this.app.vault.createBinary(destPath, content);
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
}
