import { describe, expect, it } from "vitest";
import { joinMarkdownFragments } from "@/export/FragmentJoiner";
import type { DocumentFragment } from "@/types";

const fragment = (
	markdown: string,
	overrides: Partial<DocumentFragment> = {},
): DocumentFragment => ({
	markdown,
	sourcePath: "host.md",
	...overrides,
});

describe("joinMarkdownFragments", () => {
	it("concatenates unmarked fragments exactly", () => {
		expect(joinMarkdownFragments([
			fragment("Before "),
			fragment("middle"),
			fragment(" after"),
		])).toBe("Before middle after");
	});

	it("turns an inline note transclusion into an independent block", () => {
		expect(joinMarkdownFragments([
			fragment("Before "),
			fragment("## Embedded", {
				sourcePath: "note.md",
				blockBoundaryBefore: true,
				blockBoundaryAfter: true,
			}),
			fragment(" after"),
		])).toBe("Before\n\n## Embedded\n\nafter");
	});

	it("upgrades a single LF newline to a blank-line boundary", () => {
		expect(joinMarkdownFragments([
			fragment("Before\n"),
			fragment("Embedded", { blockBoundaryBefore: true }),
		])).toBe("Before\n\nEmbedded");
	});

	it("preserves existing LF blank lines exactly", () => {
		expect(joinMarkdownFragments([
			fragment("Before\n\n\n"),
			fragment("Embedded", { blockBoundaryBefore: true }),
		])).toBe("Before\n\n\nEmbedded");
	});

	it("uses CRLF and preserves an existing CRLF blank line", () => {
		expect(joinMarkdownFragments([
			fragment("Before\r\n"),
			fragment("Embedded", { blockBoundaryBefore: true }),
		])).toBe("Before\r\n\r\nEmbedded");
		expect(joinMarkdownFragments([
			fragment("Before\r\n\r\n"),
			fragment("Embedded", { blockBoundaryBefore: true }),
		])).toBe("Before\r\n\r\nEmbedded");
	});

	it("recognizes a whitespace-only blank line", () => {
		expect(joinMarkdownFragments([
			fragment("Before\n \n"),
			fragment("Embedded", { blockBoundaryBefore: true }),
		])).toBe("Before\n \nEmbedded");
	});

	it("does not add outer whitespace at document edges", () => {
		expect(joinMarkdownFragments([
			fragment("Embedded", {
				blockBoundaryBefore: true,
				blockBoundaryAfter: true,
			}),
		])).toBe("Embedded");
		expect(joinMarkdownFragments([
			fragment("Embedded", { blockBoundaryAfter: true }),
			fragment(" after"),
		])).toBe("Embedded\n\nafter");
	});

	it("preserves indentation inside the embedded note", () => {
		expect(joinMarkdownFragments([
			fragment("Before "),
			fragment("    code", { blockBoundaryBefore: true }),
		])).toBe("Before\n\n    code");
	});

	it("counts a leading embedded newline without losing following indentation", () => {
		expect(joinMarkdownFragments([
			fragment("Before"),
			fragment("\n    code", { blockBoundaryBefore: true }),
		])).toBe("Before\n\n    code");
	});

	it("joins repeated transclusions through one blank-line boundary", () => {
		expect(joinMarkdownFragments([
			fragment("One", { blockBoundaryAfter: true }),
			fragment(" "),
			fragment("Two", { blockBoundaryBefore: true }),
		])).toBe("One\n\nTwo");
	});

	it("carries an empty transclusion boundary between host fragments", () => {
		expect(joinMarkdownFragments([
			fragment("Before "),
			fragment("", {
				blockBoundaryBefore: true,
				blockBoundaryAfter: true,
			}),
			fragment(" after"),
		])).toBe("Before\n\nafter");
	});

	it("keeps overlapping nested boundary flags idempotent", () => {
		expect(joinMarkdownFragments([
			fragment("Outer", { blockBoundaryAfter: true }),
			fragment("Inner", {
				blockBoundaryBefore: true,
				blockBoundaryAfter: true,
			}),
		])).toBe("Outer\n\nInner");
	});

	it.each([
		"# H1",
		"## H2",
		"### H3",
		"#### H4",
		"##### H5",
		"###### H6",
		"- unordered",
		"1. ordered",
		"> quote",
		"| A | B |\n| --- | --- |\n| 1 | 2 |",
		"```ts\nconst value = 1;\n```",
		"    indented code",
		"---",
		"ordinary paragraph",
	])("separates embedded Markdown block %s from host content", (markdown) => {
		expect(joinMarkdownFragments([
			fragment("Before "),
			fragment(markdown, {
				blockBoundaryBefore: true,
				blockBoundaryAfter: true,
			}),
			fragment(" after"),
		])).toBe(`Before\n\n${markdown}\n\nafter`);
	});

	it("uses the embedded fragment's CRLF style when the seam has no newline", () => {
		expect(joinMarkdownFragments([
			fragment("Before"),
			fragment("Part\r\nBody", { blockBoundaryBefore: true }),
		])).toBe("Before\r\n\r\nPart\r\nBody");
	});
});
