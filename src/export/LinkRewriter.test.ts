import { describe, it, expect, vi } from "vitest";
import { LinkRewriter, slugify } from "@/export/LinkRewriter";
import { AttachmentCopy, ExportProfileId } from "@/types";
import { extensionForProfile } from "@/export/utils";

function createMockApp() {
	return {
		metadataCache: {
			getFirstLinkpathDest: vi.fn((link: string) => {
				const map: Record<string, string> = {
					Note1: "notes/note1.md",
					Note2: "notes/note2.md",
					"Note2.md": "notes/note2.md",
					"image.png": "assets/image.png",
					"clip.mp4": "assets/clip.mp4",
					"reference.pdf": "assets/reference.pdf",
					"song.mp3": "assets/song.mp3",
					"archive.zip": "assets/archive.zip",
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
					"assets/clip.mp4",
					"assets/reference.pdf",
					"assets/song.mp3",
					"assets/archive.zip",
				];
				return known.includes(path) ? { path } : null;
			}),
		},
	} as never;
}

describe("LinkRewriter", () => {
	const exportedPaths = new Set(["notes/note1.md", "notes/note2.md"]);
	const attachments: AttachmentCopy[] = [
		{ sourcePath: "assets/image.png", outputRelativePath: "attachments/image.png" },
		{ sourcePath: "assets/clip.mp4", outputRelativePath: "attachments/clip.mp4" },
		{ sourcePath: "assets/reference.pdf", outputRelativePath: "assets/reference.pdf" },
		{ sourcePath: "assets/song.mp3", outputRelativePath: "attachments/song.mp3" },
		{ sourcePath: "assets/archive.zip", outputRelativePath: "attachments/archive.zip" },
	];

	function makeRewriter(profile: ExportProfileId = "markdown-bundle") {
		return new LinkRewriter(createMockApp(), exportedPaths, attachments, profile);
	}

	function makeMappedRewriter(
		profile: ExportProfileId,
		mappedExportedPaths = new Set(["notes/note1.md", "notes/note2.md"]),
	) {
		const extension = extensionForProfile(profile);
		return new LinkRewriter(
			createMockApp(),
			mappedExportedPaths,
			attachments,
			profile,
			new Map([
				["notes/note1.md", `exports/note1.${extension}`],
				["notes/note2.md", `exports/note2.${extension}`],
			]),
			`exports/note1.${extension}`,
			"exports",
		);
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

	it("turns an included note embed into a normal relative link", () => {
		const result = makeMappedRewriter("html-document")
			.rewrite("![[Note2]]", "notes/note1.md");

		expect(result.markdown).toBe("[Note2](note2.html)");
		expect(result.warnings).toEqual([]);
	});

	it("preserves a non-exported note embed as a wiki link without embed syntax", () => {
		const result = makeMappedRewriter(
			"markdown-bundle",
			new Set(["notes/note1.md"]),
		).rewrite("![[Note2]]", "notes/note1.md");

		expect(result.markdown).toBe("[[Note2]]");
		expect(result.warnings).toEqual([]);
	});

	describe("markdown links", () => {
		it("rewrites a local note link to the exported extension and relative path", () => {
			const result = makeMappedRewriter("html-document").rewrite(
				"See [Note 2](Note2.md)",
				"notes/note1.md",
			);
			expect(result.markdown).toBe("See [Note 2](note2.html)");
		});

		it("rewrites a local attachment link to the copied asset", () => {
			const result = makeMappedRewriter("html-document").rewrite(
				"[Reference](../assets/reference.pdf)",
				"notes/note1.md",
			);
			expect(result.markdown).toBe("[Reference](assets/reference.pdf)");
		});

		it("preserves external and fragment-only links", () => {
			const markdown = "[Web](https://example.com) [Section](#heading)";
			const result = makeMappedRewriter("html-document")
				.rewrite(markdown, "notes/note1.md");
			expect(result.markdown).toBe(markdown);
			expect(result.warnings).toEqual([]);
		});

		it("preserves an unknown local link and warns once", () => {
			const result = makeMappedRewriter("html-document").rewrite(
				"[Missing](missing.md)",
				"notes/note1.md",
			);
			expect(result.markdown).toBe("[Missing](missing.md)");
			expect(result.warnings).toEqual(["Unresolved local link: missing.md"]);
		});

		it("does not rewrite markdown links inside inline code", () => {
			const markdown = "`[Note 2](Note2.md)`";
			const result = makeMappedRewriter("html-document")
				.rewrite(markdown, "notes/note1.md");
			expect(result.markdown).toBe(markdown);
			expect(result.warnings).toEqual([]);
		});
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

		it("preserves an optional title while rewriting the destination", () => {
			const result = makeRewriter("markdown-bundle").rewrite(
				'![alt](image.png "caption")',
				"assets/something.md",
			);
			expect(result.markdown).toBe('![alt](attachments/image.png "caption")');
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
			// alt text must be populated (the link text); empty alt is not
			// rendered as an image by Obsidian and many Markdown viewers.
			expect(markdown).toBe("![image.png](attachments/image.png)");
		});

		it("rewrites wiki embed for attachment as img tag in html-document profile", () => {
			const rewriter = makeRewriter("html-document");
			const { markdown } = rewriter.rewrite("![[image.png]]", "notes/note1.md");
			expect(markdown).toBe('<img src="attachments/image.png" alt="image.png" />');
		});

		it("keeps image embeds as markdown image syntax for docx profile", () => {
			const rewriter = makeRewriter("docx");
			const { markdown } = rewriter.rewrite("![[image.png]]", "notes/note1.md");
			expect(markdown).toBe("![image.png](attachments/image.png)");
		});

		it("rewrites video embeds as video tags for html-document profile", () => {
			const rewriter = makeRewriter("html-document");
			const { markdown } = rewriter.rewrite("![[clip.mp4]]", "notes/note1.md");
			expect(markdown).toBe('<video controls src="attachments/clip.mp4">clip.mp4</video>');
		});

		describe("standalone attachment boundaries", () => {
			it.each([
				["html-document", "image.png", '<img src="attachments/image.png" alt="image.png" />'],
				["pdf", "clip.mp4", '<video controls src="attachments/clip.mp4">clip.mp4</video>'],
				["html-document", "song.mp3", '<audio controls src="attachments/song.mp3">song.mp3</audio>'],
				["pdf", "reference.pdf", '<object data="assets/reference.pdf" type="application/pdf"><a href="assets/reference.pdf">reference.pdf</a></object>'],
				["html-document", "archive.zip", '<a href="attachments/archive.zip">archive.zip</a>'],
			] as const)("separates a standalone %s attachment from a following heading", (profile, link, replacement) => {
				const result = makeRewriter(profile).rewrite(
					`![[${link}]]\n## Title`,
					"notes/note1.md",
				);

				expect(result.markdown).toBe(`${replacement}\n\n## Title`);
			});

			it("adds a leading boundary when standalone media follows content", () => {
				const result = makeRewriter("pdf").rewrite(
					"Intro\n![[clip.mp4]]",
					"notes/note1.md",
				);

				expect(result.markdown).toBe(
					'Intro\n\n<video controls src="attachments/clip.mp4">clip.mp4</video>',
				);
			});

			it("separates a standalone attachment from a following fenced code block", () => {
				const result = makeRewriter("pdf").rewrite(
					"![[image.png]]\n```text\ncode\n```",
					"notes/note1.md",
				);

				expect(result.markdown).toBe([
					'<img src="attachments/image.png" alt="image.png" />',
					"```text\ncode\n```",
				].join("\n\n"));
			});

			it("separates a standalone attachment from a preceding fenced code block", () => {
				const result = makeRewriter("pdf").rewrite(
					"```text\ncode\n```\n![[image.png]]",
					"notes/note1.md",
				);

				expect(result.markdown).toBe([
					"```text\ncode\n```",
					'<img src="attachments/image.png" alt="image.png" />',
				].join("\n\n"));
			});

			it("does not duplicate existing blank boundaries", () => {
				const source = "Intro\n\n![[clip.mp4]]\n\n## Title";
				const result = makeRewriter("pdf").rewrite(source, "notes/note1.md");

				expect(result.markdown).toBe(
					'Intro\n\n<video controls src="attachments/clip.mp4">clip.mp4</video>\n\n## Title',
				);
			});

			it("uses one blank boundary between consecutive standalone attachments", () => {
				const result = makeRewriter("pdf").rewrite(
					"![[image.png]]\n![[clip.mp4]]\n## Title",
					"notes/note1.md",
				);

				expect(result.markdown).toBe([
					'<img src="attachments/image.png" alt="image.png" />',
					'<video controls src="attachments/clip.mp4">clip.mp4</video>',
					"## Title",
				].join("\n\n"));
			});

			it("does not add outer whitespace to a document-only embed", () => {
				const result = makeRewriter("pdf").rewrite("![[clip.mp4]]", "notes/note1.md");

				expect(result.markdown).toBe(
					'<video controls src="attachments/clip.mp4">clip.mp4</video>',
				);
			});

			it.each([
				"Text ![[clip.mp4]] after",
				"- ![[clip.mp4]]",
				"> ![[clip.mp4]]",
			])("does not inject top-level boundaries for %s", (source) => {
				const result = makeRewriter("pdf").rewrite(source, "notes/note1.md");

				expect(result.markdown).not.toContain("\n\n");
			});

			it("does not change markdown-bundle attachment spacing", () => {
				const result = makeRewriter("markdown-bundle").rewrite(
					"![[image.png]]\n## Title",
					"notes/note1.md",
				);

				expect(result.markdown).toBe(
					"![image.png](attachments/image.png)\n## Title",
				);
			});
		});
	});

	describe("code block protection", () => {
		it("does not rewrite wiki links inside fenced code blocks", () => {
			const rewriter = makeRewriter("markdown-bundle");
			const md = "```\n[[Note1]]\n```";
			const { markdown } = rewriter.rewrite(md, "notes/note1.md");
			expect(markdown).toBe(md);
		});

		it("does not rewrite wiki links inside inline code", () => {
			const rewriter = makeRewriter("markdown-bundle");
			const md = "see `[[Note1]]` for details";
			const { markdown } = rewriter.rewrite(md, "notes/note1.md");
			expect(markdown).toBe(md);
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

	it("handles Japanese kana", () => {
		expect(slugify("テスト")).toBe("テスト");
	});

	it("handles empty string", () => {
		expect(slugify("")).toBe("");
	});
});

describe("epub degradation", () => {
	const exportedPaths = new Set(["notes/note1.md", "notes/note2.md"]);
	const attachments: AttachmentCopy[] = [
		{ sourcePath: "assets/image.png", outputRelativePath: "attachments/image.png" },
		{ sourcePath: "assets/clip.mp4", outputRelativePath: "attachments/clip.mp4" },
		{ sourcePath: "assets/reference.pdf", outputRelativePath: "assets/reference.pdf" },
	];

	function makeRewriter(profile: ExportProfileId) {
		return new LinkRewriter(createMockApp(), exportedPaths, attachments, profile);
	}

	it("degrades non-image attachment embeds to text, not dead links", () => {
		const result = makeRewriter("epub").rewrite("![[clip.mp4]]", "notes/note1.md");
		expect(result.markdown).toBe("*clip.mp4 (not embedded in EPUB)*");
	});

	it("keeps image embeds as markdown images", () => {
		const result = makeRewriter("epub").rewrite("![[image.png]]", "notes/note1.md");
		expect(result.markdown).toBe("![image.png](attachments/image.png)");
	});

	it("degrades wiki links to exported notes to plain text", () => {
		const result = makeRewriter("epub").rewrite("[[Note2|Other]]", "notes/note1.md");
		expect(result.markdown).toBe("Other");
	});

	it("degrades wiki links to attachments to plain text", () => {
		const result = makeRewriter("epub").rewrite("[[clip.mp4]]", "notes/note1.md");
		expect(result.markdown).toBe("clip.mp4");
	});

	it("degrades inline markdown links to attachments to plain text", () => {
		const result = makeRewriter("epub").rewrite("[clip](clip.mp4)", "notes/note1.md");
		expect(result.markdown).toBe("clip");
	});
});
