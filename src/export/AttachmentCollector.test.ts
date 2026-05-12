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
		) as unknown as Parameters<typeof AttachmentCollector.prototype["collect"]> extends (files: infer F) => unknown ? { vault: unknown; metadataCache: unknown } : never;

		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(1);
		expect(result.attachments[0].sourcePath).toBe("assets/image.png");
	});

	it("deduplicates attachments", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }, { link: "image.png" }] },
		) as unknown as { vault: unknown; metadataCache: unknown };

		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(1);
	});

	it("skips markdown files as attachments", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "Note" }] },
		) as unknown as { vault: unknown; metadataCache: unknown };

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
		) as unknown as { vault: unknown; metadataCache: unknown };

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
		) as unknown as { vault: unknown; metadataCache: unknown };

		const collector = new AttachmentCollector(app as never, new Set());
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});

	it("skips exported paths", async () => {
		const mockFile: MockFile = { path: "notes/a.md", extension: "md", name: "a.md" };
		const app = createMockApp(
			{ "notes/a.md": [{ link: "image.png" }] },
		) as unknown as { vault: unknown; metadataCache: unknown };

		const exportedPaths = new Set(["assets/image.png"]);
		const collector = new AttachmentCollector(app as never, exportedPaths);
		const result = await collector.collect([mockFile as never]);

		expect(result.attachments).toHaveLength(0);
	});
});
