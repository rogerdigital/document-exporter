import { describe, it, expect } from "vitest";
import {
	stripFrontmatter,
	deriveTitle,
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
});

describe("deriveTitle", () => {
	const mockFile = {
		path: "test.md",
		basename: "test",
		extension: "md",
		name: "test.md",
	} as any;

	it("uses frontmatter title when present", () => {
		const result = deriveTitle(mockFile, { title: "My Title" }, "body");
		expect(result).toBe("My Title");
	});

	it("falls back to first heading", () => {
		const result = deriveTitle(mockFile, {}, "# Heading One\nSome text");
		expect(result).toBe("Heading One");
	});

	it("falls back to file basename when no frontmatter title or heading", () => {
		const result = deriveTitle(mockFile, {}, "Just plain text");
		expect(result).toBe("test");
	});

	it("prefers frontmatter title over heading", () => {
		const result = deriveTitle(
			mockFile,
			{ title: "From Frontmatter" },
			"# Heading",
		);
		expect(result).toBe("From Frontmatter");
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
});
