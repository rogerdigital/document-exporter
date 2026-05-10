import { describe, it, expect, vi } from "vitest";
import { AttachmentCollector } from "@/export/AttachmentCollector";

function createMockApp(embedResults: Record<string, any[]> = {}, linkResults: Record<string, any[]> = {}, fileContents: Record<string, string> = {}) {
	const allFiles = new Map<string, any>();

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
			read: vi.fn((file: any) => fileContents[file.path] ?? ""),
		},
		metadataCache: {
			getFileCache: vi.fn((file: any) => {
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
		const mockFile = { path: "notes/a.md", extension: "md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }] },
		) as any;

		const collector = new AttachmentCollector(app, new Set());
		const result = await collector.collect([mockFile as any]);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].sourcePath).toBe("assets/image.png");
	});

	it("deduplicates attachments", async () => {
		const mockFile = { path: "notes/a.md", extension: "md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }, { link: "image.png" }] },
		) as any;

		const collector = new AttachmentCollector(app, new Set());
		const result = await collector.collect([mockFile as any]);

		expect(result.attachments).toHaveLength(1);
	});

	it("skips markdown files as attachments", async () => {
		const mockFile = { path: "notes/a.md", extension: "md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "Note" }] },
		) as any;

		const collector = new AttachmentCollector(app, new Set());
		const result = await collector.collect([mockFile as any]);

		expect(result.attachments).toHaveLength(0);
	});

	it("warns on missing markdown image links", async () => {
		const mockFile = { path: "notes/a.md", extension: "md" };
		const app = createMockApp(
			{},
			{},
			{ "notes/a.md": "![alt](missing-image.png)" },
		) as any;

		const collector = new AttachmentCollector(app, new Set());
		const result = await collector.collect([mockFile as any]);

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("missing-image.png");
	});

	it("ignores external URLs", async () => {
		const mockFile = { path: "notes/a.md", extension: "md" };
		const app = createMockApp(
			{},
			{},
			{ "notes/a.md": "![alt](https://example.com/image.png)" },
		) as any;

		const collector = new AttachmentCollector(app, new Set());
		const result = await collector.collect([mockFile as any]);

		expect(result.attachments).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});

	it("skips exported paths", async () => {
		const mockFile = { path: "notes/a.md", extension: "md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }] },
		) as any;

		const exportedPaths = new Set(["assets/image.png"]);
		const collector = new AttachmentCollector(app, exportedPaths);
		const result = await collector.collect([mockFile as any]);

		expect(result.attachments).toHaveLength(0);
	});
});
