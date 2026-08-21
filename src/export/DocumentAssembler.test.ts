import { describe, it, expect, vi } from "vitest";
import {
	DocumentAssembler,
	stripFrontmatter,
	deriveTitle,
	extractLeadingH1,
	normalizeHeadings,
} from "@/export/DocumentAssembler";

describe("stripFrontmatter", () => {
	it("strips simple frontmatter and returns body", () => {
		const content = "---\ntitle: Hello\n---\nBody text";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe("Body text");
		expect(frontmatter.title).toBe("Hello");
	});

	it("returns empty frontmatter for content without frontmatter", () => {
		const content = "Just some text\nNo frontmatter";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe(content);
		expect(frontmatter).toEqual({});
	});

	it("returns empty frontmatter when closing delimiter is missing", () => {
		const content = "---\ntitle: Hello\nBody text";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe(content);
		expect(frontmatter).toEqual({});
	});

	it("handles multi-line frontmatter values", () => {
		const content = "---\ntitle: Hello\nauthor: Jane\ndate: 2024-01-01\n---\nBody";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe("Body");
		expect(frontmatter.title).toBe("Hello");
		expect(frontmatter.author).toBe("Jane");
		expect(frontmatter.date).toBe("2024-01-01");
	});

	it("parses basic types: numbers, booleans, strings", () => {
		const content = "---\ncount: 42\nactive: true\nvisible: false\nname: test\npi: 3.14\nempty: null\n---\nBody";
		const { frontmatter } = stripFrontmatter(content);
		expect(frontmatter.count).toBe(42);
		expect(frontmatter.active).toBe(true);
		expect(frontmatter.visible).toBe(false);
		expect(frontmatter.name).toBe("test");
		expect(frontmatter.pi).toBe(3.14);
		expect(frontmatter.empty).toBeNull();
	});

	it("strips surrounding quotes from values", () => {
		const content = '---\ntitle: "Quoted Title"\nauthor: \'Single Quoted\'\n---\nBody';
		const { frontmatter } = stripFrontmatter(content);
		expect(frontmatter.title).toBe("Quoted Title");
		expect(frontmatter.author).toBe("Single Quoted");
	});

	it("skips nested and array lines", () => {
		const content = "---\ntitle: Top\ntags:\n  - tag1\n  - tag2\nnested:\n  key: val\n---\nBody";
		const { frontmatter } = stripFrontmatter(content);
		expect(frontmatter.title).toBe("Top");
		expect(frontmatter.tags).toBeNull();
		expect(frontmatter.nested).toBeNull();
	});

	it("parses CRLF frontmatter without leaking delimiters", () => {
		const result = stripFrontmatter("---\r\ntitle: Hello\r\n---\r\nBody");
		expect(result.frontmatter).toEqual({ title: "Hello" });
		expect(result.body).toBe("Body");
	});

	it("accepts a closing delimiter at end of file", () => {
		const result = stripFrontmatter("---\ntitle: Hello\n---");
		expect(result.frontmatter).toEqual({ title: "Hello" });
		expect(result.body).toBe("");
	});

	it("accepts an empty frontmatter block", () => {
		const result = stripFrontmatter("---\n---\nBody");
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("Body");
	});

	it("preserves indentation at the beginning of the body", () => {
		const result = stripFrontmatter("---\ntitle: Hello\n---\n    code");
		expect(result.body).toBe("    code");
	});
});

describe("DocumentAssembler titles", () => {
	const file = {
		path: "note.md",
		basename: "note",
		extension: "md",
		name: "note.md",
	};

	function createApp(content: string) {
		return {
			vault: {
				read: vi.fn().mockResolvedValue(content),
			},
		};
	}

	it("removes a leading H1 that duplicates the frontmatter title", async () => {
		const app = createApp("---\ntitle: Same\n---\n# Same\nBody");
		const document = await new DocumentAssembler(app as never)
			.assemble([file as never]);

		expect(document.title).toBe("Same");
		expect(document.sections[0].markdown).toBe("Body");
	});

	it("keeps a leading H1 that differs from the frontmatter title", async () => {
		const app = createApp("---\ntitle: Document\n---\n# Section\nBody");
		const document = await new DocumentAssembler(app as never)
			.assemble([file as never]);

		expect(document.title).toBe("Document");
		expect(document.sections[0].markdown).toBe("# Section\nBody");
	});
});

describe("deriveTitle", () => {
	const mockFile = {
		path: "test.md",
		basename: "test",
		extension: "md",
		name: "test.md",
	} as never;

	it("uses frontmatter title when present", () => {
		const result = deriveTitle(mockFile, { title: "My Title" });
		expect(result).toBe("My Title");
	});

	it("falls back to file basename when no frontmatter title", () => {
		const result = deriveTitle(mockFile, {});
		expect(result).toBe("test");
	});

	it("does not infer title from first heading (avoids duplication)", () => {
		// The first heading stays in the body; inferring the title from it
		// would duplicate it as the document title.
		const result = deriveTitle(mockFile, {});
		expect(result).toBe("test");
		expect(result).not.toBe("Heading One");
	});
});

describe("extractLeadingH1", () => {
	it("extracts title and removes the H1 line when body starts with H1", () => {
		const result = extractLeadingH1("# My Real Title\n\nBody text");
		expect(result).not.toBeNull();
		expect(result!.title).toBe("My Real Title");
		expect(result!.remaining).toBe("Body text");
	});

	it("returns null when body does not start with H1", () => {
		expect(extractLeadingH1("Just plain text")).toBeNull();
		expect(extractLeadingH1("## Subtitle only")).toBeNull();
		expect(extractLeadingH1("")).toBeNull();
	});

	it("does not match H1 indented or mid-document", () => {
		// leading spaces → not a heading
		expect(extractLeadingH1("   # Not a heading")).toBeNull();
		// H1 after other content → not leading
		expect(extractLeadingH1("Intro\n# Heading")).toBeNull();
	});

	it("trims trailing whitespace from the title", () => {
		const result = extractLeadingH1("# Spaced Title   \nBody");
		expect(result!.title).toBe("Spaced Title");
	});
});

describe("normalizeHeadings", () => {
	it("shifts headings by specified minLevel", () => {
		const md = "# Title\n## Subtitle\n### Detail";
		const result = normalizeHeadings(md, 2);
		expect(result).toBe("## Title\n### Subtitle\n#### Detail");
	});

	it("does not exceed level 6", () => {
		const md = "##### Five\n###### Six";
		const result = normalizeHeadings(md, 3);
		expect(result).toBe("###### Five\n###### Six");
	});

	it("leaves non-heading lines unchanged", () => {
		const md = "# Title\nSome text\n- list item\n```code```";
		const result = normalizeHeadings(md, 2);
		expect(result).toContain("Some text");
		expect(result).toContain("- list item");
		expect(result).toContain("```code```");
		expect(result).toContain("## Title");
	});

	it("handles empty string", () => {
		const result = normalizeHeadings("", 2);
		expect(result).toBe("");
	});

	it("does not transform headings inside fenced code blocks", () => {
		const md = "# Real Heading\n```\n# Not A Heading\n## Also Not\n```\n## Another Real";
		const result = normalizeHeadings(md, 2);
		expect(result).toContain("## Real Heading");
		expect(result).toContain("# Not A Heading");
		expect(result).toContain("## Also Not");
		expect(result).toContain("### Another Real");
	});
});

describe("DocumentAssembler embed expansion", () => {
	function makeTFile(path: string) {
		const name = path.split("/").pop() ?? path;
		return {
			path,
			basename: name.replace(/\.md$/, ""),
			extension: "md",
			name,
		};
	}

	function createApp(files: Record<string, string>, linkmap: Record<string, string> = {}) {
		return {
			vault: {
				read: vi.fn(async (f: { path: string }) => {
					const content = files[f.path];
					if (content === undefined) throw new Error(`No such file: ${f.path}`);
					return content;
				}),
				getAbstractFileByPath: vi.fn((p: string) =>
					files[p] !== undefined ? { path: p, extension: "md" } : null,
				),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn((link: string) => {
					const dest = linkmap[link];
					return dest ? { path: dest } : null;
				}),
				getFileCache: vi.fn(() => ({})),
			},
		};
	}

	it("expands embeds, reports embedded paths, and keeps fragments source-aware", async () => {
		const app = createApp({
			"main.md": "Intro\n\n![[part]]\n\nEnd",
			"part.md": "Part body",
		}, { part: "part.md" });
		const assembler = new DocumentAssembler(app as never, false, true);
		const doc = await assembler.assemble([makeTFile("main.md") as never]);

		expect(doc.sections[0].fragments?.map((f) => f.sourcePath)).toEqual(["main.md", "part.md", "main.md"]);
		expect(doc.embeddedPaths).toEqual(["part.md"]);
		expect(doc.sections[0].markdown).toBe("Intro\n\nPart body\n\nEnd");
	});

	it("keeps embeds as-is when disabled", async () => {
		const app = createApp({ "main.md": "![[part]]" }, { part: "part.md" });
		const assembler = new DocumentAssembler(app as never, false, false);
		const doc = await assembler.assemble([makeTFile("main.md") as never]);

		expect(doc.sections[0].markdown).toBe("![[part]]");
		expect(doc.embeddedPaths).toEqual([]);
	});

	it("does not let an embedded leading H1 steal the host title", async () => {
		const app = createApp({
			"main.md": "![[chapter]]",
			"chapter.md": "# Chapter\nBody",
		}, { chapter: "chapter.md" });
		const assembler = new DocumentAssembler(app as never, false, true);
		const doc = await assembler.assemble([makeTFile("main.md") as never]);

		expect(doc.title).toBe("main");
		expect(doc.sections[0].markdown).toBe("# Chapter\nBody");
	});
});
