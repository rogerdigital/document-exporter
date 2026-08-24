import { describe, expect, it } from "vitest";
import { EmbedExpander } from "@/export/EmbedExpander";

type HeadingSub = {
	type: "heading";
	start: { offset: number };
	end: { offset: number } | null;
};

function headingSub(raw: string, startMarker: string, endMarker: string): HeadingSub {
	const end = raw.indexOf(endMarker);
	return {
		type: "heading",
		start: { offset: raw.indexOf(startMarker) },
		end: end === -1 ? null : { offset: end },
	};
}

function makeApp(
	files: Record<string, string>,
	caches: Record<string, Record<string, HeadingSub>> = {},
) {
	return {
		vault: {
			read: async (file: { path: string }) => {
				const content = files[file.path];
				if (content === undefined) throw new Error(`No such file: ${file.path}`);
				return content;
			},
			getAbstractFileByPath: (path: string) =>
				files[path] !== undefined ? { path, extension: "md" } : null,
		},
		metadataCache: {
			getFirstLinkpathDest: (link: string, _sourcePath: string) => {
				if (files[link] !== undefined) return { path: link };
				if (files[`${link}.md`] !== undefined) return { path: `${link}.md` };
				return null;
			},
			getFileCache: (file: { path: string }) => caches[file.path] ?? {},
		},
	} as never;
}

describe("EmbedExpander", () => {
	it("expands a file-level wiki embed and returns host + embedded fragments", async () => {
		const app = makeApp({
			"main.md": "Intro\n\n![[chapter]]\n\nOutro",
			"chapter.md": "## Chapter one\nBody",
		});
		const result = await new EmbedExpander(app).expand("Intro\n\n![[chapter]]\n\nOutro", "main.md");

		expect(result.fragments.map((f) => f.sourcePath)).toEqual(["main.md", "chapter.md", "main.md"]);
		expect(result.fragments.map((f) => f.markdown)).toEqual(["Intro\n\n", "## Chapter one\nBody", "\n\nOutro"]);
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryBefore");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryAfter");
		expect(result.fragments[1]).toMatchObject({
			blockBoundaryBefore: true,
			blockBoundaryAfter: true,
		});
		expect(result.fragments[2]).not.toHaveProperty("blockBoundaryBefore");
		expect(result.fragments[2]).not.toHaveProperty("blockBoundaryAfter");
		expect(result.embeddedPaths).toEqual(["chapter.md"]);
		expect(result.warnings).toEqual([]);
	});

	it("strips frontmatter from the embedded note", async () => {
		const app = makeApp({
			"main.md": "![[note]]",
			"note.md": "---\ntitle: X\n---\nBody",
		});
		const result = await new EmbedExpander(app).expand("![[note]]", "main.md");
		expect(result.fragments[0].markdown).toBe("Body");
	});

	it("extracts the heading line and its section for ![[Note#Heading]]", async () => {
		const raw = "# Title\nAlpha text\n## Beta\nBeta text\n### Gamma\nGamma text\n## Delta\nDelta text";
		const app = makeApp(
			{ "main.md": "![[note#Beta]]", "note.md": raw },
			{ "note.md": { "#Beta": headingSub(raw, "## Beta", "## Delta") } },
		);
		const result = await new EmbedExpander(app).expand("![[note#Beta]]", "main.md");
		expect(result.fragments[0].markdown).toBe("## Beta\nBeta text\n### Gamma\nGamma text");
		expect(result.fragments[0]).toMatchObject({
			blockBoundaryBefore: true,
			blockBoundaryAfter: true,
		});
	});

	it("supports self-embeds with ![[#Heading]]", async () => {
		const raw = "# Doc\nIntro\n## Section\nContent";
		const app = makeApp(
			{ "main.md": raw },
			{ "main.md": { "#Section": headingSub(raw, "## Section", "\u0000") } }, // section runs to EOF (end: null)
		);
		const result = await new EmbedExpander(app).expand("Intro\n\n![[#Section]]", "main.md");
		expect(result.fragments.map((f) => f.markdown).join("")).toBe("Intro\n\n## Section\nContent");
	});

	it("recursively expands nested embeds", async () => {
		const app = makeApp({
			"a.md": "![[b]]",
			"b.md": "B start\n![[c]]\nB end",
			"c.md": "C body",
		});
		const result = await new EmbedExpander(app).expand("![[a]]", "root.md");
		expect(result.fragments.map((f) => f.markdown).join("")).toBe("B start\nC body\nB end");
		expect(result.fragments[0].blockBoundaryBefore).toBe(true);
		expect(result.fragments.at(-1)?.blockBoundaryAfter).toBe(true);
		const nested = result.fragments.find((f) => f.sourcePath === "c.md");
		expect(nested).toMatchObject({
			blockBoundaryBefore: true,
			blockBoundaryAfter: true,
		});
		expect(result.embeddedPaths.sort()).toEqual(["a.md", "b.md", "c.md"]);
	});

	it("keeps the embed and warns on circular references", async () => {
		const app = makeApp({
			"a.md": "![[b]]",
			"b.md": "![[a]]",
		});
		const result = await new EmbedExpander(app).expand("![[a]]", "root.md");
		// a expands → b expands → a is on the stack → survives as text
		expect(result.fragments.map((f) => f.markdown).join("")).toBe("![[a]]");
		// The fallback does not create a boundary, but it still occupies the
		// successfully expanded outer note's block.
		expect(result.fragments[0]).toMatchObject({
			blockBoundaryBefore: true,
			blockBoundaryAfter: true,
		});
		expect(result.warnings[0]).toMatch(/Circular embed/i);
	});

	it("allows the same note embedded twice via different subpaths", async () => {
		const raw = "# T\n## One\nA\n## Two\nB";
		const app = makeApp(
			{ "main.md": "![[note#One]] ![[note#Two]]", "note.md": raw },
			{ "note.md": {
				"#One": headingSub(raw, "## One", "## Two"),
				"#Two": { type: "heading", start: { offset: raw.indexOf("## Two") }, end: null },
			} },
		);
		const result = await new EmbedExpander(app).expand("![[note#One]] ![[note#Two]]", "main.md");
		expect(result.warnings).toEqual([]);
		expect(result.fragments.map((f) => f.markdown).join("")).toBe("## One\nA ## Two\nB");
	});

	it("keeps the embed and warns at the depth limit", async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 8; i++) files[`n${i}.md`] = `![[n${i + 1}]]`;
		const app = makeApp(files);
		const result = await new EmbedExpander(app).expand("![[n0]]", "root.md");
		expect(result.warnings.some((w) => /depth limit/i.test(w))).toBe(true);
		const fallback = result.fragments.find((f) => f.markdown.includes("![["));
		expect(fallback).toMatchObject({
			blockBoundaryBefore: true,
			blockBoundaryAfter: true,
		});
	});

	it("does not give an inner fallback its own boundary", async () => {
		const app = makeApp({
			"wrapper.md": "Before ![[missing]] after",
		});
		const result = await new EmbedExpander(app).expand("![[wrapper]]", "root.md");
		const fallback = result.fragments.find((f) => f.markdown === "![[missing]]");

		expect(fallback).toBeDefined();
		expect(fallback).not.toHaveProperty("blockBoundaryBefore");
		expect(fallback).not.toHaveProperty("blockBoundaryAfter");
		expect(result.fragments[0].blockBoundaryBefore).toBe(true);
		expect(result.fragments.at(-1)?.blockBoundaryAfter).toBe(true);
	});

	it("leaves non-markdown embeds untouched", async () => {
		const app = makeApp({ "main.md": "![[image.png]]" });
		const result = await new EmbedExpander(app).expand("![[image.png]]", "main.md");
		expect(result.fragments[0].markdown).toBe("![[image.png]]");
		expect(result.fragments[0].sourcePath).toBe("main.md");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryBefore");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryAfter");
		expect(result.embeddedPaths).toEqual([]);
	});

	it("does not expand embeds inside fenced code blocks — including inside embedded notes", async () => {
		const app = makeApp({
			"main.md": "```\n![[note]]\n```",
			"note.md": "~~~\n![[inner]]\n~~~",
			"inner.md": "Inner body",
		});
		const top = await new EmbedExpander(app).expand("```\n![[note]]\n```", "main.md");
		expect(top.fragments[0].markdown).toBe("```\n![[note]]\n```");

		const nested = await new EmbedExpander(app).expand("![[note]]", "main.md");
		expect(nested.fragments.map((f) => f.markdown).join("")).toBe("~~~\n![[inner]]\n~~~");
	});

	it("keeps the embed and warns when the heading is not found", async () => {
		const app = makeApp({ "main.md": "![[note#Missing]]", "note.md": "# Title\nBody" });
		const result = await new EmbedExpander(app).expand("![[note#Missing]]", "main.md");
		expect(result.fragments[0].markdown).toBe("![[note#Missing]]");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryBefore");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryAfter");
		expect(result.warnings[0]).toMatch(/Heading not found/i);
	});

	it("keeps canonical block-reference embeds and warns", async () => {
		const app = makeApp({ "main.md": "![[note#^abc]]", "note.md": "Body" });
		const result = await new EmbedExpander(app).expand("![[note#^abc]]", "main.md");
		expect(result.fragments[0].markdown).toBe("![[note#^abc]]");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryBefore");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryAfter");
		expect(result.warnings[0]).toMatch(/Block reference embeds are not supported/i);
	});

	it("keeps unresolved embeds unmarked", async () => {
		const app = makeApp({ "main.md": "![[missing]]" });
		const result = await new EmbedExpander(app).expand("![[missing]]", "main.md");

		expect(result.fragments[0].markdown).toBe("![[missing]]");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryBefore");
		expect(result.fragments[0]).not.toHaveProperty("blockBoundaryAfter");
		expect(result.warnings[0]).toMatch(/Unresolved embed/i);
	});

	it("strips display aliases before resolving targets", async () => {
		const app = makeApp({ "main.md": "![[chapter|the chapter]]", "chapter.md": "Body" });
		const result = await new EmbedExpander(app).expand("![[chapter|the chapter]]", "main.md");
		expect(result.fragments[0].markdown).toBe("Body");
	});
});
