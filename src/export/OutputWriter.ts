import { App, Platform, TFile } from "obsidian";

const g = typeof window !== "undefined" ? window : undefined;
const nodeFs = g && "require" in g
	? (g as unknown as Record<string, (id: string) => unknown>)["require"]("fs") as typeof import("fs")
	: null;

export class OutputWriter {
	private app: App;
	private readonly overwriteExisting: boolean;

	constructor(app: App, overwriteExisting = true) {
		this.app = app;
		this.overwriteExisting = overwriteExisting;
	}

	static supportsExternalPaths(): boolean {
		return Platform.isDesktopApp;
	}

	async ensureFolder(folderPath: string): Promise<void> {
		if (this.isExternal(folderPath)) {
			const fs = this.getExternalFs();
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
			const fs = this.getExternalFs();
			fs.writeFileSync(filePath, content, {
				encoding: "utf-8",
				flag: this.overwriteExisting ? "w" : "wx",
			});
			return;
		}

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing) {
			if (!this.overwriteExisting || !(existing instanceof TFile)) {
				throw new Error(`Output already exists: ${filePath}`);
			}
			await this.app.vault.modify(existing, content);
			return;
		}
		await this.app.vault.create(filePath, content);
	}

	async writeBinary(filePath: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		if (this.isExternal(filePath)) {
			const fs = this.getExternalFs();
			fs.writeFileSync(
				filePath,
				data instanceof Uint8Array ? data : new Uint8Array(data),
				{ flag: this.overwriteExisting ? "w" : "wx" },
			);
			return;
		}

		const buffer = data instanceof ArrayBuffer ? data : uint8ArrayToArrayBuffer(data);
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing) {
			if (!this.overwriteExisting || !(existing instanceof TFile)) {
				throw new Error(`Output already exists: ${filePath}`);
			}
			await this.app.vault.modifyBinary(existing, buffer);
			return;
		}
		await this.app.vault.createBinary(filePath, buffer);
	}

	async copyBinaryFile(sourcePath: string, destPath: string): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(sourceFile instanceof TFile)) {
			throw new Error(`Attachment source not found: ${sourcePath}`);
		}

		const content = await this.app.vault.readBinary(sourceFile);
		await this.writeBinary(destPath, content);
	}

	folderExists(folderPath: string): boolean {
		if (this.isExternal(folderPath)) {
			return nodeFs?.existsSync(folderPath) ?? false;
		}
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder !== null && "children" in folder;
	}

	pathExists(path: string): boolean {
		if (this.isExternal(path)) {
			return nodeFs?.existsSync(path) ?? false;
		}
		return this.app.vault.getAbstractFileByPath(path) !== null;
	}

	timestampSuffix(): string {
		return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	}

	timestampedFolder(basePath: string): string {
		return `${basePath}-${this.timestampSuffix()}`;
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
		if (p.startsWith("/") || p.startsWith("\\\\")) return true;
		if (/^[A-Za-z]:[\\/]/.test(p)) return true;
		return false;
	}

	private getExternalFs(): typeof import("fs") {
		if (!nodeFs) {
			throw new Error("External file system access is not available");
		}
		return nodeFs;
	}
}

function uint8ArrayToArrayBuffer(data: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(data.byteLength);
	new Uint8Array(buffer).set(data);
	return buffer;
}
