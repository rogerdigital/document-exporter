import { describe, it, expect, vi } from "vitest";
import { LinkRewriter, slugify } from "@/export/LinkRewriter";
import { AttachmentCopy, ExportProfileId } from "@/types";

function createMockApp() {
	return {
		metadataCache: {
			getFirstLinkpathDest: vi.fn((link: string) => {
				const map: Record<string, string> = {
					Note1: "notes/note1.md",
					Note2: "notes/note2.md",
					"image.png": "assets/image.png",
				};
				const p = map[link];
				return p ? { path: p } : null;
			}),
		},
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => {
				const known = [
					"notes/note1.md",
					"notes/note2.md",
					"assets/image.png",
				];
				return known.includes(path) ? { path } : null;
			}),
		},
	} as unknown as ConstructorParameters<typeof LinkRewriter>[0];
}

describe("LinkRewriter", () => {
	const exportedPaths = new Set(["notes/note1.md", "notes/note2.md"]);
	const attachments: AttachmentCopy[] = [
		{ sourcePath: "assets/image.png", outputRelativePath: "attachments/image.png" },
	];

	function makeRewriter(profile: ExportProfileId = "markdown-bundle") {
		return new LinkRewriter(createMockApp(), exportedPaths, attachments, profile);
	}

	it("rewrites wiki link to included note as anchor", () => {
		const rewriter = makeRewriter();
		const { markdown } = rewriter.rewrite("See [[Note1]] for details", "notes/note1.md");
		expect(markdown).toBe("See [Note1](#note1) for details");
	});

	it("preserves alias text in wiki links", () => {
		const rewriter = makeRewriter();
		const { markdown } = rewriter.rewrite("See [[Note1|My Alias]]", "notes/note1.md");
		expect(markdown).toBe("See [My Alias](#note1)");
	});

	it("leaves external http links unchanged", () => {
		const rewriter = makeRewriter();
		const { markdown, warnings } = rewriter.rewrite(
			"Visit [example](http://example.com) and [secure](https://example.com)",
			"notes/note1.md",
		);
		expect(markdown).toBe("Visit [example](http://example.com) and [secure](https://example.com)");
		expect(warnings).toHaveLength(0);
	});

	it("warns on unresolved links", () => {
		const rewriter = makeRewriter();
		const { markdown, warnings } = rewriter.rewrite(
			"[[NonExistent]] is missing",
			"notes/note1.md",
		);
		expect(markdown).toBe("NonExistent is missing");
		expect(warnings).toEqual(
			expect.arrayContaining([expect.stringContaining("Unresolved link: NonExistent")]),
		);
	});

	it("rewrites wiki link with heading to anchor with heading", () => {
		const rewriter = makeRewriter();
		const { markdown } = rewriter.rewrite("[[Note1#Intro]]", "notes/note1.md");
		expect(markdown).toBe("[Note1](#note1-intro)");
	});

	describe("markdown image links", () => {
		it("rewrites markdown image links to attachment paths", () => {
			const app = createMockApp();
			// resolveRelativePath resolves relative to sourcePath directory
			const rewriter = new LinkRewriter(app, exportedPaths, attachments, "markdown-bundle");
			// Source is in "assets/" dir, so href "image.png" resolves to "assets/image.png"
			const { markdown, warnings } = rewriter.rewrite(
				"![alt](image.png)",
				"assets/something.md",
			);
			expect(markdown).toBe("![alt](attachments/image.png)");
			expect(warnings).toHaveLength(0);
		});

		it("leaves external http image links unchanged", () => {
			const rewriter = makeRewriter();
			const { markdown } = rewriter.rewrite(
				"![alt](https://example.com/img.png)",
				"notes/note1.md",
			);
			expect(markdown).toBe("![alt](https://example.com/img.png)");
		});
	});

	describe("embedded attachments", () => {
		it("rewrites wiki embed for attachment in markdown-bundle profile", () => {
			const rewriter = makeRewriter("markdown-bundle");
			const { markdown } = rewriter.rewrite("![[image.png]]", "notes/note1.md");
			expect(markdown).toBe("![](attachments/image.png)");
		});

		it("rewrites wiki embed for attachment as img tag in html-document profile", () => {
			const rewriter = makeRewriter("html-document");
			const { markdown } = rewriter.rewrite("![[image.png]]", "notes/note1.md");
			expect(markdown).toBe('<img src="attachments/image.png" alt="image.png" />');
		});
	});
});

describe("slugify", () => {
	it("converts text to lowercase hyphenated form", () => {
		expect(slugify("Hello World")).toBe("hello-world");
	});

	it("handles special characters", () => {
		expect(slugify("My Note & Stuff!")).toBe("my-note-stuff");
	});

	it("handles leading and trailing hyphens", () => {
		expect(slugify("--test--")).toBe("test");
	});

	it("handles CJK characters", () => {
		expect(slugify("中文标题")).toBe("中文标题");
	});

	it("handles empty string", () => {
		expect(slugify("")).toBe("");
	});
});
