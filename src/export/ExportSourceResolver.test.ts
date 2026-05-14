import { describe, it, expect, vi } from "vitest";
import { ExportSourceResolver } from "@/export/ExportSourceResolver";
import { ExportSort } from "@/types";

interface MockTFile {
	path: string;
	basename: string;
	extension: string;
	name: string;
}

interface MockTFolder {
	path: string;
	name: string;
	children: (MockTFile | MockTFolder)[];
}

function makeTFile(path: string): MockTFile {
	const basename = path.split("/").pop()!.replace(/\.md$/, "");
	return {
		path,
		basename,
		extension: "md",
		name: basename + ".md",
	};
}

function makeTFolder(path: string, children: (MockTFile | MockTFolder)[] = []): MockTFolder {
	return {
		path,
		name: path.split("/").pop()!,
		children,
	};
}

interface TagCache {
	[path: string]: string[];
}

function createMockApp(
	fileTree: MockTFile | MockTFolder | (MockTFile | MockTFolder)[] | null,
	tagCache: TagCache = {},
) {
	const filesByPath = new Map<string, MockTFile>();
	const foldersByPath = new Map<string, MockTFolder>();
	const allMdFiles: MockTFile[] = [];

	function index(item: MockTFile | MockTFolder) {
		if ("extension" in item) {
			filesByPath.set(item.path, item);
			if (item.extension === "md") allMdFiles.push(item);
		} else if ("children" in item) {
			foldersByPath.set(item.path, item);
			for (const child of item.children) {
				index(child);
			}
		}
	}

	const items = Array.isArray(fileTree) ? fileTree : fileTree ? [fileTree] : [];
	for (const item of items) {
		index(item);
	}

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => {
				return filesByPath.get(path) ?? foldersByPath.get(path) ?? null;
			}),
			getMarkdownFiles: vi.fn(() => allMdFiles),
		},
		metadataCache: {
			getFileCache: vi.fn((file: MockTFile) => {
				const tags = tagCache[file.path];
				if (tags) {
					return {
						frontmatter: {},
						tags: tags.map((t: string) => ({ tag: t, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } })),
					};
				}
				return { frontmatter: {}, tags: [] };
			}),
		},
	};
}

describe("ExportSourceResolver", () => {
	const sortAsc: ExportSort = { mode: "path", direction: "asc" };

	describe("current-file", () => {
		it("returns the file if it exists and is markdown", async () => {
			const file = makeTFile("notes/a.md");
			const app = createMockApp(file);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "current-file", path: "notes/a.md" },
				sortAsc,
			);

			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("notes/a.md");
		});

		it("returns empty for missing file", async () => {
			const app = createMockApp([]);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "current-file", path: "missing.md" },
				sortAsc,
			);

			expect(result).toHaveLength(0);
		});

		it("returns empty for non-markdown file", async () => {
			const app = createMockApp([]);
			(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValueOnce({
				path: "image.png",
				extension: "png",
			});
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "current-file", path: "image.png" },
				sortAsc,
			);

			expect(result).toHaveLength(0);
		});
	});

	describe("files", () => {
		it("returns only existing markdown files", async () => {
			const a = makeTFile("a.md");
			const b = makeTFile("b.md");
			const app = createMockApp([a, b]);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "files", paths: ["a.md", "b.md", "missing.md"] },
				sortAsc,
			);

			expect(result).toHaveLength(2);
		});
	});

	describe("folder", () => {
		it("returns markdown files in folder", async () => {
			const a = makeTFile("notes/a.md");
			const b = makeTFile("notes/b.md");
			const folder = makeTFolder("notes", [a, b]);
			const app = createMockApp(folder);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "folder", path: "notes", recursive: false },
				sortAsc,
			);

			expect(result).toHaveLength(2);
		});

		it("includes nested files when recursive", async () => {
			const a = makeTFile("notes/a.md");
			const b = makeTFile("notes/sub/b.md");
			const sub = makeTFolder("notes/sub", [b]);
			const folder = makeTFolder("notes", [a, sub]);
			const app = createMockApp(folder);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "folder", path: "notes", recursive: true },
				sortAsc,
			);

			expect(result).toHaveLength(2);
		});

		it("excludes nested files when not recursive", async () => {
			const a = makeTFile("notes/a.md");
			const b = makeTFile("notes/sub/b.md");
			const sub = makeTFolder("notes/sub", [b]);
			const folder = makeTFolder("notes", [a, sub]);
			const app = createMockApp(folder);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "folder", path: "notes", recursive: false },
				sortAsc,
			);

			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("notes/a.md");
		});

		it("returns empty for missing folder", async () => {
			const app = createMockApp([]);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "folder", path: "missing", recursive: true },
				sortAsc,
			);

			expect(result).toHaveLength(0);
		});
	});


	describe("sorting", () => {
		it("sorts by path ascending", async () => {
			const a = makeTFile("notes/a.md");
			const b = makeTFile("notes/b.md");
			const c = makeTFile("z.md");
			const app = createMockApp([a, c, b]);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "files", paths: ["z.md", "notes/a.md", "notes/b.md"] },
				{ mode: "path", direction: "asc" },
			);

			expect(result.map((f) => f.path)).toEqual([
				"notes/a.md",
				"notes/b.md",
				"z.md",
			]);
		});

		it("sorts by path descending", async () => {
			const a = makeTFile("notes/a.md");
			const b = makeTFile("notes/b.md");
			const c = makeTFile("z.md");
			const app = createMockApp([a, b, c]);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "files", paths: ["notes/a.md", "notes/b.md", "z.md"] },
				{ mode: "path", direction: "desc" },
			);

			expect(result.map((f) => f.path)).toEqual([
				"z.md",
				"notes/b.md",
				"notes/a.md",
			]);
		});

		it("sorts by name", async () => {
			const a = makeTFile("notes/a.md");
			const b = makeTFile("notes/b.md");
			const app = createMockApp([b, a]);
			const resolver = new ExportSourceResolver(app as never);

			const result = resolver.resolve(
				{ type: "files", paths: ["notes/b.md", "notes/a.md"] },
				{ mode: "name", direction: "asc" },
			);

			expect(result.map((f) => f.basename)).toEqual(["a", "b"]);
		});
	});
});
