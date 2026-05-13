import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { OutputWriter } from "@/export/OutputWriter";

function createMockApp(files: Record<string, { extension: string; content?: ArrayBuffer }> = {}) {
	const mockFiles = new Map<string, TFile>();
	const binaryContents = new Map<string, ArrayBuffer>();

	for (const [path, opts] of Object.entries(files)) {
		const f = new TFile();
		f.path = path;
		f.extension = opts.extension;
		mockFiles.set(path, f);
		if (opts.content) binaryContents.set(path, opts.content);
	}

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => mockFiles.get(path) ?? null),
			createFolder: vi.fn(),
			create: vi.fn(),
			modify: vi.fn(),
			createBinary: vi.fn(),
			modifyBinary: vi.fn(),
			readBinary: vi.fn((file: TFile) => binaryContents.get(file.path) ?? new ArrayBuffer(0)),
			adapter: {},
		},
	};
}

describe("OutputWriter", () => {
	describe("isExternal", () => {
		it("detects unix absolute paths", () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			expect(writer.isExternal("/home/user/docs")).toBe(true);
		});

		it("detects windows absolute paths", () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			expect(writer.isExternal("C:\\Users\\docs")).toBe(true);
		});

		it("returns false for relative paths", () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			expect(writer.isExternal("Exports/output")).toBe(false);
		});
	});

	describe("supportsExternalPaths", () => {
		it("returns true on desktop", () => {
			expect(OutputWriter.supportsExternalPaths()).toBe(true);
		});
	});

	describe("ensureFolder", () => {
		it("creates nested vault folders", async () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			await writer.ensureFolder("a/b/c");
			expect(app.vault.createFolder).toHaveBeenCalledTimes(3);
			expect(app.vault.createFolder).toHaveBeenCalledWith("a");
			expect(app.vault.createFolder).toHaveBeenCalledWith("a/b");
			expect(app.vault.createFolder).toHaveBeenCalledWith("a/b/c");
		});

		it("skips existing folders", async () => {
			const app = createMockApp();
			app.vault.getAbstractFileByPath = vi.fn((path: string) =>
				path === "a" ? { path: "a", children: [] } : null,
			) as never;
			const writer = new OutputWriter(app as never);
			await writer.ensureFolder("a/b");
			expect(app.vault.createFolder).toHaveBeenCalledTimes(1);
			expect(app.vault.createFolder).toHaveBeenCalledWith("a/b");
		});
	});

	describe("writeText", () => {
		it("creates new vault file", async () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			await writer.writeText("output/doc.md", "# Hello");
			expect(app.vault.create).toHaveBeenCalledWith("output/doc.md", "# Hello");
		});
	});

	describe("copyBinaryFile", () => {
		it("copies binary within vault using vault API", async () => {
			const buf = new ArrayBuffer(8);
			const app = createMockApp({
				"assets/img.png": { extension: "png", content: buf },
			});
			const writer = new OutputWriter(app as never);
			await writer.copyBinaryFile("assets/img.png", "output/img.png");
			expect(app.vault.readBinary).toHaveBeenCalled();
			expect(app.vault.createBinary).toHaveBeenCalledWith("output/img.png", buf);
		});

		it("skips when source file not found", async () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			await writer.copyBinaryFile("missing.png", "output/missing.png");
			expect(app.vault.readBinary).not.toHaveBeenCalled();
			expect(app.vault.createBinary).not.toHaveBeenCalled();
		});
	});

	describe("folderExists", () => {
		it("returns true for existing vault folder", () => {
			const app = createMockApp();
			app.vault.getAbstractFileByPath = vi.fn(() => ({ path: "folder", children: [] })) as never;
			const writer = new OutputWriter(app as never);
			expect(writer.folderExists("folder")).toBe(true);
		});

		it("returns false for non-existing path", () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			expect(writer.folderExists("nope")).toBe(false);
		});
	});

	describe("timestampedFolder", () => {
		it("appends ISO timestamp to base path", () => {
			const app = createMockApp();
			const writer = new OutputWriter(app as never);
			const result = writer.timestampedFolder("Exports/my-export");
			expect(result).toMatch(/^Exports\/my-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
		});
	});
});
