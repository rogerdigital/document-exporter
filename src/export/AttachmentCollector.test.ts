import { describe, it, expect, vi } from "vitest";
import { AttachmentCollector } from "@/export/AttachmentCollector";

interface MockFile {
	path: string;
	extension: string;
	name: string;
}

interface MockEmbed {
	link: string;
}

interface MockLink {
	link: string;
}

function createMockApp(
	embedResults: Record<string, MockEmbed[]> = {},
	linkResults: Record<string, MockLink[]> = {},
	fileContents: Record<string, string> = {},
) {
	const allFiles = new Map<string, MockFile>();

	for (const [path, ext] of Object.entries({
		"assets/image.png": "png",
		"assets/photo.jpg": "jpg",
		"assets/doc.pdf": "pdf",
	})) {
		allFiles.set(path, { path, extension: ext, name: path.split("/").pop()! });
	}

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => allFiles.get(path) ?? null),
			read: vi.fn((file: MockFile) => fileContents[file.path] ?? ""),
		},
		metadataCache: {
			getFileCache: vi.fn((file: MockFile) => {
				const embeds = embedResults[file.path];
				const links = linkResults[file.path];
				return {
					embeds: embeds ?? undefined,
					links: links ?? undefined,
					tags: [],
					frontmatter: {},
				};
			}),
			getFirstLinkpathDest: vi.fn((link: string) => {
				const resolved: Record<string, string> = {
					"image.png": "assets/image.png",
					"photo.jpg": "assets/photo.jpg",
					"doc.pdf": "assets/doc.pdf",
					"Note": "notes/note.md",
				};
				const p = resolved[link];
				return p ? { path: p } : null;
			}),
		},
	};
}

describe("AttachmentCollector", () => {
	it("collects wiki embeds from metadata cache", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }] },
		);
		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].sourcePath).toBe("assets/image.png");
	});

	it("deduplicates attachments", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }, { link: "image.png" }] },
		);
		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(1);
	});

	it("skips markdown files as attachments", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "Note" }] },
		);
		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(0);
	});

	it("warns on missing markdown image links", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{},
			{},
			{ "notes/a.md": "![alt](missing-image.png)" },
		);
		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("missing-image.png");
	});

	it("ignores external URLs", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{},
			{},
			{ "notes/a.md": "![alt](https://example.com/image.png)" },
		);
		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});

	it("skips exported paths", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }] },
		);
		const exportedPaths = new Set(["assets/image.png"]);
		const collector = new AttachmentCollector(app as never, exportedPaths);
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(0);
	});

	it("generates unique output names on collision", async () => {
		const fileA: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const fileB: MockFile = { path: "notes/b.md", extension: "md", name: "b.md" };

		const app = createMockApp(
			{
				"notes/a.md": [{ link: "image.png" }],
				"notes/b.md": [{ link: "photos/image.png" }],
			},
		);

		const photosFile: MockFile = { path: "photos/image.png", extension: "png", name: "image.png" };
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
			if (path === "assets/image.png") return { path, extension: "png", name: "image.png" };
			if (path === "photos/image.png") return photosFile;
			return null;
		});
		(app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockImplementation((link: string) => {
			if (link === "image.png") return { path: "assets/image.png" };
			if (link === "photos/image.png") return { path: "photos/image.png" };
			return null;
		});

		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([fileA as never, fileB as never]);

		expect(result.attachments).toHaveLength(2);
		const outputPaths = result.attachments.map(a => a.outputRelativePath);
		expect(outputPaths[0]).not.toBe(outputPaths[1]);
	});

	it("handles triple collision with counter suffix", async () => {
		const fileA: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const fileB: MockFile = { path: "notes/b.md", extension: "md", name: "b.md" };
		const fileC: MockFile = { path: "notes/c.md", extension: "md", name: "c.md" };

		const app = createMockApp(
			{
				"notes/a.md": [{ link: "image.png" }],
				"notes/b.md": [{ link: "photos/image.png" }],
				"notes/c.md": [{ link: "images/image.png" }],
			},
		);

		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
			if (path === "assets/image.png") return { path, extension: "png", name: "image.png" };
			if (path === "photos/image.png") return { path, extension: "png", name: "image.png" };
			if (path === "images/image.png") return { path, extension: "png", name: "image.png" };
			return null;
		});
		(app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockImplementation((link: string) => {
			if (link === "image.png") return { path: "assets/image.png" };
			if (link === "photos/image.png") return { path: "photos/image.png" };
			if (link === "images/image.png") return { path: "images/image.png" };
			return null;
		});

		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([fileA as never, fileB as never, fileC as never]);

		expect(result.attachments).toHaveLength(3);
		const outputPaths = result.attachments.map(a => a.outputRelativePath);
		const uniquePaths = new Set(outputPaths);
		expect(uniquePaths.size).toBe(3);
	});

	it("keeps unique attachment names across sequential collections", async () => {
		const fileA: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const fileB: MockFile = { path: "notes/b.md", extension: "md", name: "b.md" };

		const app = createMockApp(
			{
				"notes/a.md": [{ link: "assets/image.png" }],
				"notes/b.md": [{ link: "photos/image.png" }],
			},
		);

		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
			if (path === "assets/image.png") return { path, extension: "png", name: "image.png" };
			if (path === "photos/image.png") return { path, extension: "png", name: "image.png" };
			return null;
		});
		(app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockImplementation((link: string) => {
			if (link === "assets/image.png") return { path: "assets/image.png" };
			if (link === "photos/image.png") return { path: "photos/image.png" };
			return null;
		});

		const collector = new AttachmentCollector(app as never, new Set());
		const first = await collector.collect([fileA as never]);
		const second = await collector.collect([fileB as never]);

		expect(first.attachments[0].outputRelativePath).toBe("assets/image.png");
		expect(second.attachments[0].outputRelativePath).toBe("assets/photos-image.png");
	});
});
