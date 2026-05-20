import { describe, it, expect } from "vitest";
import {
	normalizePath,
	containsTraversal,
	extractCodeBlocks,
	restoreCodeBlocks,
	longestCommonDirPrefix,
} from "./utils";

describe("normalizePath", () => {
	it("collapses parent directory segments", () => {
		expect(normalizePath("a/b/../c")).toBe("a/c");
	});

	it("collapses multiple .. segments", () => {
		expect(normalizePath("a/b/c/../../d")).toBe("a/d");
	});

	it("removes single dot segments", () => {
		expect(normalizePath("a/./b/./c")).toBe("a/b/c");
	});

	it("handles leading ..", () => {
		expect(normalizePath("../a/b")).toBe("a/b");
	});

	it("handles empty segments from double slashes", () => {
		expect(normalizePath("a//b")).toBe("a/b");
	});

	it("returns empty string for entirely collapsed path", () => {
		expect(normalizePath("a/..")).toBe("");
	});
});

describe("containsTraversal", () => {
	it("detects .. at start", () => {
		expect(containsTraversal("../foo")).toBe(true);
	});

	it("detects .. in middle", () => {
		expect(containsTraversal("foo/../bar")).toBe(true);
	});

	it("detects single dot segment", () => {
		expect(containsTraversal("./foo")).toBe(true);
	});

	it("returns false for normal paths", () => {
		expect(containsTraversal("foo/bar/baz")).toBe(false);
	});

	it("does not false-positive on dots in filenames", () => {
		expect(containsTraversal("foo/file.name.md")).toBe(false);
	});
});

describe("extractCodeBlocks / restoreCodeBlocks", () => {
	it("extracts and restores fenced code blocks", () => {
		const md = "before\n```js\nconst x = 1;\n```\nafter";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).not.toContain("```");
		expect(blocks.length).toBe(1);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("extracts and restores inline code", () => {
		const md = "use `foo()` and `bar()`";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).not.toContain("`");
		expect(blocks.length).toBe(2);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("handles mixed fenced and inline code", () => {
		const md = "text `inline` more\n```\nblock\n```\nend";
		const { text, blocks } = extractCodeBlocks(md);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("returns unchanged text when no code present", () => {
		const md = "plain text with no code";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).toBe(md);
		expect(blocks.length).toBe(0);
	});
});

describe("longestCommonDirPrefix", () => {
	it("returns empty string for empty array", () => {
		expect(longestCommonDirPrefix([])).toBe("");
	});

	it("returns directory for single path", () => {
		expect(longestCommonDirPrefix(["dir/file.md"])).toBe("dir/");
	});

	it("returns common directory for multiple paths", () => {
		expect(longestCommonDirPrefix(["dir/a.md", "dir/b.md"])).toBe("dir/");
	});

	it("returns empty string when no common directory", () => {
		expect(longestCommonDirPrefix(["a/file.md", "b/file.md"])).toBe("");
	});

	it("handles nested common directories", () => {
		expect(longestCommonDirPrefix(["a/b/c.md", "a/b/d.md"])).toBe("a/b/");
	});

	it("returns empty string when all paths are in root", () => {
		expect(longestCommonDirPrefix(["a.md", "b.md"])).toBe("");
	});
});
