# Embed Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `![[Note]]` and `![[Note#Heading]]` wiki embeds inline during export (transclusion), so exported documents contain the embedded content instead of a link. This removes the top fidelity limitation for the academic-writing audience.

**Architecture (v2, revised after review):** Expansion produces **source-aware fragments** — `{ markdown, sourcePath }[]` — instead of flat markdown. `EmbedExpander` splits the host body at embed boundaries and recurses per fragment; each fragment keeps the vault path of the note it came from, so `LinkRewriter` resolves relative links and attachments against the *embedded* note's directory, not the host's. Embed target parsing uses Obsidian's `parseLinktext`, and heading-scoped embeds extract content via `metadataCache.getFileCache` + `resolveSubpath` offsets (no hand-rolled heading scanner). The host's title/frontmatter/leading-H1 are extracted **before** expansion so embedded H1s cannot hijack the document title. Embed detection materializes matches with `matchAll()` before any `await` — a shared `/g` regex interleaved with async recursion resets `lastIndex` and loops forever. Cycle identity is `path + subpath`. Gated by a new `expandEmbeds` setting (default on).

**Tech Stack:** TypeScript, Obsidian API (`parseLinktext`, `MetadataCache.resolveSubpath`, `getFirstLinkpathDest`), Vitest. No new dependencies.

**Review-driven changes vs v1:**

1. P0: `matchAll()` before `await` — v1's shared-regex `exec` loop with async recursion is an infinite loop.
2. Fragments carry `sourcePath` — v1's flat markdown made `ExportRunner.ts:147` rewrite embedded content against the host's directory (`./img.png` inside an embedded note would resolve to the wrong folder).
3. Host title/H1 extraction moved before expansion — v1 let `# Chapter` inside an embedded note replace the document title.
4. `parseLinktext` + `resolveSubpath` replace `split("#")` and the line-scan — v1 missed canonical `![[note#^block]]` block syntax, matched pseudo-headings inside code fences, and `extractCodeBlocks` itself didn't cover `~~~`/4-backtick fences or double-backtick inline code (fixed in Task 1).
5. Cycle test expectation corrected: for `a → b → a` starting at `![[a]]`, the surviving text is `![[a]]`, not `![[b]]`.

**Scope decisions (YAGNI):**

- Wiki-style embeds only. Markdown-style `.md` embeds (`![](note.md)`) stay unexpanded.
- Block-reference embeds (`![[Note#^block]]`) warn and stay unexpanded — `resolveSubpath` returns block ranges, so future support is cheap, but it's out of scope for v0.6.
- Headings inside embedded content keep their original level (matches Obsidian's transclusion). Heading-scoped embeds include the heading line itself (also Obsidian's behavior).
- Links inside expanded content to non-exported notes surface the existing "Unresolved link" warning — same policy as links in top-level files.
- `Dataview`/dynamic embeds remain out of scope.

---

### Task 1: Upgrade `extractCodeBlocks` fence and inline-code coverage

Both `LinkRewriter` and the new `EmbedExpander` rely on this helper to avoid rewriting/expanding syntax inside code spans. Current `src/export/utils.ts:19-30` only recognizes triple-backtick fences and single-backtick inline code.

**Files:**
- Modify: `src/export/utils.ts:19-30`
- Create: `src/export/utils.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/export/utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractCodeBlocks, restoreCodeBlocks } from "@/export/utils";

describe("extractCodeBlocks", () => {
	it("protects triple-backtick fences", () => {
		const { text, blocks } = extractCodeBlocks("a\n```\n[[x]]\n```\nb");
		expect(text).not.toContain("[[x]]");
		expect(blocks[0]).toContain("[[x]]");
		expect(restoreCodeBlocks(text, blocks)).toBe("a\n```\n[[x]]\n```\nb");
	});

	it("protects tilde fences", () => {
		const { text, blocks } = extractCodeBlocks("a\n~~~\n[[x]]\n~~~\nb");
		expect(text).not.toContain("[[x]]");
		expect(restoreCodeBlocks(text, blocks)).toBe("a\n~~~\n[[x]]\n~~~\nb");
	});

	it("protects four-backtick fences containing triple-backtick content", () => {
		const src = "a\n````\n```js\ncode\n```\n````\nb";
		const { text, blocks } = extractCodeBlocks(src);
		expect(text).not.toContain("```js");
		expect(restoreCodeBlocks(text, blocks)).toBe(src);
	});

	it("protects double-backtick inline code", () => {
		const { text, blocks } = extractCodeBlocks("say `` ![[x]] `` aloud");
		expect(text).not.toContain("![[x]]");
		expect(restoreCodeBlocks(text, blocks)).toBe("say `` ![[x]] `` aloud");
	});

	it("leaves regular text untouched", () => {
		const { text, blocks } = extractCodeBlocks("plain [[link]] text");
		expect(text).toBe("plain [[link]] text");
		expect(blocks).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/export/utils.test.ts
```

Expected: the tilde-fence, four-backtick, and double-backtick cases FAIL.

- [ ] **Step 3: Implement the upgrade**

Replace `extractCodeBlocks` in `src/export/utils.ts:19-30` with:

```ts
const FENCE_BLOCK_RE = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[`~]*(?=\n|$)/g;
const INLINE_CODE_RE = /(`{1,2})(?!`)((?:(?!\1)[^`])*(?:`(?!\1)(?:(?!\1)[^`])*)*)\1(?!`)/g;

export function extractCodeBlocks(md: string): { text: string; blocks: string[] } {
	const blocks: string[] = [];
	let text = md.replace(FENCE_BLOCK_RE, (match) => {
		blocks.push(match);
		return `${CODE_BLOCK_PLACEHOLDER}${blocks.length - 1}${CODE_BLOCK_PLACEHOLDER}`;
	});
	text = text.replace(INLINE_CODE_RE, (match) => {
		blocks.push(match);
		return `${INLINE_CODE_PLACEHOLDER}${blocks.length - 1}${INLINE_CODE_PLACEHOLDER}`;
	});
	return { text, blocks };
}
```

Known accepted approximation (document in a comment above the regexes): a closing fence longer than its opener with a different character mix isn't recognized, and unclosed fences fall through — both strictly narrower failure modes than v1, which missed entire fence *types*.

- [ ] **Step 4: Run the full suite for regressions**

```bash
npm test
```

Expected: all pass — `LinkRewriter` and `DocumentAssembler` tests consume the upgraded helper through the same placeholders. If any LinkRewriter test regresses on an edge the old regex accepted, fix the regex, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/export/utils.ts src/export/utils.test.ts
git commit -m "fix: harden code block extraction for tilde and longer fences"
```

---

### Task 2: EmbedExpander with source-aware fragments (TDD)

**Files:**
- Create: `src/export/EmbedExpander.test.ts`
- Create: `src/export/EmbedExpander.ts`
- Modify: `src/__mocks__/obsidian.ts` (add `parseLinktext`)

- [ ] **Step 1: Add `parseLinktext` to the module mock**

Append to `src/__mocks__/obsidian.ts`:

```ts
export function parseLinktext(linktext: string): { path: string; subpath: string } {
	const index = linktext.indexOf("#");
	if (index === -1) return { path: linktext, subpath: "" };
	return { path: linktext.slice(0, index), subpath: linktext.slice(index) };
}
```

(The real API splits on the first `#`; the subpath keeps its leading `#`/`^`.)

- [ ] **Step 2: Write the failing tests**

Create `src/export/EmbedExpander.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EmbedExpander } from "@/export/EmbedExpander";

type HeadingSub = {
	type: "heading";
	position: { start: { offset: number }; end: { offset: number } };
};

function headingSub(raw: string, startMarker: string, endMarker: string): HeadingSub {
	const end = raw.indexOf(endMarker);
	return {
		type: "heading",
		position: {
			start: { offset: raw.indexOf(startMarker) },
			end: { offset: end === -1 ? raw.length : end },
		},
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
			resolveSubpath: (cache: Record<string, HeadingSub>, subpath: string) =>
				cache[subpath] ?? null,
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
	});

	it("supports self-embeds with ![[#Heading]]", async () => {
		const raw = "# Doc\nIntro\n## Section\nContent";
		const app = makeApp(
			{ "main.md": raw },
			{ "main.md": { "#Section": headingSub(raw, "## Section", "\u0000") } }, // section runs to EOF
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
		expect(result.warnings[0]).toMatch(/Circular embed/i);
	});

	it("allows the same note embedded twice via different subpaths", async () => {
		const raw = "# T\n## One\nA\n## Two\nB";
		const app = makeApp(
			{ "main.md": "![[note#One]] ![[note#Two]]", "note.md": raw },
			{ "note.md": {
				"#One": headingSub(raw, "## One", "## Two"),
				"#Two": { type: "heading", position: { start: { offset: raw.indexOf("## Two") }, end: { offset: raw.length } } },
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
	});

	it("leaves non-markdown embeds untouched", async () => {
		const app = makeApp({ "main.md": "![[image.png]]" });
		const result = await new EmbedExpander(app).expand("![[image.png]]", "main.md");
		expect(result.fragments[0].markdown).toBe("![[image.png]]");
		expect(result.fragments[0].sourcePath).toBe("main.md");
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
		expect(result.warnings[0]).toMatch(/Heading not found/i);
	});

	it("keeps canonical block-reference embeds and warns", async () => {
		const app = makeApp({ "main.md": "![[note#^abc]]", "note.md": "Body" });
		const result = await new EmbedExpander(app).expand("![[note#^abc]]", "main.md");
		expect(result.fragments[0].markdown).toBe("![[note#^abc]]");
		expect(result.warnings[0]).toMatch(/Block reference embeds are not supported/i);
	});

	it("strips display aliases before resolving targets", async () => {
		const app = makeApp({ "main.md": "![[chapter|the chapter]]", "chapter.md": "Body" });
		const result = await new EmbedExpander(app).expand("![[chapter|the chapter]]", "main.md");
		expect(result.fragments[0].markdown).toBe("Body");
	});
});
```

(The `\u0000` sentinel never occurs in the fixture, so the fake reports the section ending at EOF.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/export/EmbedExpander.test.ts
```

Expected: FAIL — module `@/export/EmbedExpander` does not exist.

- [ ] **Step 4: Implement EmbedExpander**

Create `src/export/EmbedExpander.ts`:

```ts
import { App, parseLinktext } from "obsidian";
import { stripFrontmatter } from "@/export/DocumentAssembler";
import { extractCodeBlocks, restoreCodeBlocks } from "@/export/utils";

const WIKI_EMBED_RE = /!\[\[([^\]]+)]]/g;
const MAX_EMBED_DEPTH = 5;

export interface Fragment {
	markdown: string;
	sourcePath: string;
}

export interface ExpandResult {
	fragments: Fragment[];
	warnings: string[];
	embeddedPaths: string[];
}

export class EmbedExpander {
	private app: App;
	private embeddedPaths = new Set<string>();

	constructor(app: App) {
		this.app = app;
	}

	async expand(markdown: string, sourcePath: string): Promise<ExpandResult> {
		const warnings: string[] = [];
		const { text, blocks } = extractCodeBlocks(markdown);
		const fragments = await this.expandText(text, sourcePath, [], warnings);
		return {
			fragments: fragments.map((f) => ({
				...f,
				markdown: restoreCodeBlocks(f.markdown, blocks),
			})),
			warnings,
			embeddedPaths: [...this.embeddedPaths],
		};
	}

	private async expandText(
		text: string,
		sourcePath: string,
		stack: string[],
		warnings: string[],
	): Promise<Fragment[]> {
		// Materialize matches BEFORE awaiting: a shared module-level /g regex
		// interleaved with async recursion resets lastIndex mid-scan and
		// loops forever. matchAll() reads from a cloned regex.
		const matches = [...text.matchAll(WIKI_EMBED_RE)];
		if (matches.length === 0) return [{ markdown: text, sourcePath }];

		const fragments: Fragment[] = [];
		let lastIndex = 0;
		for (const match of matches) {
			const before = text.slice(lastIndex, match.index);
			if (before !== "") fragments.push({ markdown: before, sourcePath });
			fragments.push(...await this.expandEmbed(match[1], sourcePath, stack, warnings));
			lastIndex = match.index + match[0].length;
		}
		const after = text.slice(lastIndex);
		if (after !== "") fragments.push({ markdown: after, sourcePath });
		return fragments;
	}

	private async expandEmbed(
		link: string,
		sourcePath: string,
		stack: string[],
		warnings: string[],
	): Promise<Fragment[]> {
		const keep = (): Fragment[] => [{ markdown: `![[${link}]]`, sourcePath }];
		const [rawTarget] = link.split("|");
		const { path: target, subpath } = parseLinktext(rawTarget);

		if (subpath.startsWith("^")) {
			warnings.push(`Block reference embeds are not supported: ${link}`);
			return keep();
		}

		let dest: string | null;
		if (target === "") {
			dest = sourcePath;
		} else {
			dest = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null;
		}
		if (!dest) {
			warnings.push(`Unresolved embed: ${link}`);
			return keep();
		}

		if (!dest.toLowerCase().endsWith(".md")) {
			// Attachments (images, PDFs, …) stay embeds — LinkRewriter owns them.
			return keep();
		}

		const identity = `${dest}${subpath}`;
		if (stack.includes(identity)) {
			warnings.push(`Circular embed skipped: ${link}`);
			return keep();
		}
		if (stack.length >= MAX_EMBED_DEPTH) {
			warnings.push(`Embed depth limit reached at: ${link}`);
			return keep();
		}

		const file = this.app.vault.getAbstractFileByPath(dest);
		if (!file || !("extension" in file)) {
			warnings.push(`Unresolved embed: ${link}`);
			return keep();
		}

		const raw = await this.app.vault.read(file as never);
		let content: string;
		if (subpath) {
			const cache = this.app.metadataCache.getFileCache(file as never);
			const sub = cache
				? this.app.metadataCache.resolveSubpath(cache as never, subpath)
				: null;
			if (!sub || sub.type !== "heading") {
				warnings.push(`Heading not found in embed: ${link}`);
				return keep();
			}
			content = raw.slice(sub.position.start.offset, sub.position.end.offset);
		} else {
			content = stripFrontmatter(raw).body;
		}

		this.embeddedPaths.add(dest);
		// Per-level code-fence protection: an embed inside a fenced block
		// *within* the embedded note must not be expanded either.
		const { text, blocks } = extractCodeBlocks(content);
		const inner = await this.expandText(text, dest, [...stack, identity], warnings);
		return inner.map((f) => ({ ...f, markdown: restoreCodeBlocks(f.markdown, blocks) }));
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/export/EmbedExpander.test.ts
```

Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add src/export/EmbedExpander.ts src/export/EmbedExpander.test.ts src/__mocks__/obsidian.ts
git commit -m "feat: add source-aware EmbedExpander for note transclusion"
```

---

### Task 3: DocumentAssembler — title first, then expansion, fragments out

**Files:**
- Modify: `src/types.ts:32-37` (`DocumentSection`)
- Modify: `src/export/DocumentAssembler.ts`
- Test: `src/export/DocumentAssembler.test.ts` (existing — extend)

- [ ] **Step 1: Add `fragments` to DocumentSection**

In `src/types.ts`, change:

```ts
export type DocumentSection = {
	sourcePath: string;
	title: string;
	markdown: string;
	frontmatter: Record<string, unknown>;
};
```

to:

```ts
export type DocumentSection = {
	sourcePath: string;
	title: string;
	markdown: string;
	frontmatter: Record<string, unknown>;
	/** Source-aware pieces from embed expansion; each is rewritten against its own sourcePath. */
	fragments?: { markdown: string; sourcePath: string }[];
};
```

(The inline literal avoids an import cycle — `EmbedExpander` already imports from `DocumentAssembler`.)

- [ ] **Step 2: Write the failing assembler tests**

Append to `src/export/DocumentAssembler.test.ts`, adapting to that file's existing app/file helpers:

```ts
describe("embed expansion", () => {
	it("expands embeds, reports embedded paths, and keeps fragments source-aware", async () => {
		const app = {
			vault: {
				read: async (file: { path: string }) =>
					file.path === "main.md" ? "Intro\n\n![[part]]\n\nEnd" : "Part body",
				getAbstractFileByPath: (p: string) => ({ path: p, extension: "md" }),
			},
			metadataCache: {
				getFirstLinkpathDest: (link: string) => (link === "part" ? { path: "part.md" } : null),
				getFileCache: () => ({}),
				resolveSubpath: () => null,
			},
		} as never;
		const assembler = new DocumentAssembler(app, false, true);
		const doc = await assembler.assemble([makeTFile("main.md", "md")]);

		expect(doc.sections[0].fragments?.map((f) => f.sourcePath)).toEqual(["main.md", "part.md", "main.md"]);
		expect(doc.embeddedPaths).toEqual(["part.md"]);
	});

	it("keeps embeds as-is when disabled", async () => {
		const app = {
			vault: { read: async (_f: { path: string }) => "![[part]]" },
		} as never;
		const assembler = new DocumentAssembler(app, false, false);
		const doc = await assembler.assemble([makeTFile("main.md", "md")]);

		expect(doc.sections[0].markdown).toBe("![[part]]");
		expect(doc.embeddedPaths).toEqual([]);
	});

	it("does not let an embedded leading H1 steal the host title", async () => {
		const app = {
			vault: {
				read: async (file: { path: string }) =>
					file.path === "main.md" ? "![[chapter]]" : "# Chapter\nBody",
				getAbstractFileByPath: (p: string) => ({ path: p, extension: "md" }),
			},
			metadataCache: {
				getFirstLinkpathDest: (link: string) => (link === "chapter" ? { path: "chapter.md" } : null),
				getFileCache: () => ({}),
				resolveSubpath: () => null,
			},
		} as never;
		const assembler = new DocumentAssembler(app, false, true);
		const doc = await assembler.assemble([makeTFile("main.md", "md")]);

		expect(doc.title).toBe("main");
		expect(doc.sections[0].markdown).toBe("# Chapter\nBody");
	});
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/export/DocumentAssembler.test.ts
```

Expected: FAIL — constructor arity / `fragments` undefined / title is "Chapter".

- [ ] **Step 4: Implement in DocumentAssembler**

In `src/export/DocumentAssembler.ts`:

```ts
import { EmbedExpander } from "@/export/EmbedExpander";

export class DocumentAssembler {
	private app: App;
	private includeSourcePaths: boolean;
	private expandEmbeds: boolean;

	constructor(app: App, includeSourcePaths = false, expandEmbeds = false) {
		this.app = app;
		this.includeSourcePaths = includeSourcePaths;
		this.expandEmbeds = expandEmbeds;
	}
```

`assemble` gains per-call accumulation (fresh `EmbedExpander` per call so `embeddedPaths` never leak across exports) and the optional result fields:

```ts
	async assemble(files: TFile[], title?: string): Promise<AssembledDocument> {
		const sections: DocumentSection[] = [];
		const warnings: string[] = [];
		const embeddedPaths = new Set<string>();
		const expander = this.expandEmbeds ? new EmbedExpander(this.app) : null;

		for (const file of files) {
			const section = await this.buildSection(file, expander, warnings, embeddedPaths);
			sections.push(section);
		}

		const docTitle = title ?? sections[0]?.title ?? "Untitled Export";

		return {
			title: docTitle,
			sections,
			attachments: [],
			warnings,
			embeddedPaths: [...embeddedPaths],
		};
	}
```

`buildSection` — host title/H1 extraction now happens **before** expansion (see test 3):

```ts
	private async buildSection(
		file: TFile,
		expander: EmbedExpander | null,
		warnings: string[],
		embeddedPaths: Set<string>,
	): Promise<DocumentSection> {
		const raw = await this.app.vault.read(file);
		const { body, frontmatter } = stripFrontmatter(raw);
		let sectionTitle = deriveTitle(file, frontmatter);
		let contentBody = body;

		// Host title first: an embedded note's leading H1 must not hijack it.
		const extracted = extractLeadingH1(contentBody);
		if (extracted) {
			if (typeof frontmatter.title !== "string") {
				sectionTitle = extracted.title;
				contentBody = extracted.remaining;
			} else if (extracted.title.trim() === frontmatter.title.trim()) {
				contentBody = extracted.remaining;
			}
		}

		let fragments = [{ markdown: contentBody, sourcePath: file.path }];
		if (expander) {
			const expanded = await expander.expand(contentBody, file.path);
			fragments = expanded.fragments;
			warnings.push(...expanded.warnings);
			for (const path of expanded.embeddedPaths) embeddedPaths.add(path);
		}

		const normalized = fragments.map((f) => ({
			...f,
			markdown: normalizeHeadings(f.markdown, 1),
		}));
		const joined = normalized.map((f) => f.markdown).join("");
		const markdown = this.includeSourcePaths
			? `<!-- source: ${file.path} -->\n${joined}`
			: joined;

		return {
			sourcePath: file.path,
			title: sectionTitle,
			markdown,
			frontmatter,
			fragments: normalized,
		};
	}
```

Fragments join with `""` — they carry exact slices of the original text, so a single-fragment section reproduces today's output byte-for-byte.

Also add the optional `AssembledDocument` fields (same shape as the v1 plan):

```ts
	export type AssembledDocument = {
		title: string;
		sections: DocumentSection[];
		attachments: AttachmentCopy[];
		/** Warnings raised while assembling (e.g. embed resolution). */
		warnings?: string[];
		/** Vault paths of notes inlined via embed expansion. */
		embeddedPaths?: string[];
	};
```

- [ ] **Step 5: Run assembler tests**

```bash
npx vitest run src/export/DocumentAssembler.test.ts
```

Expected: PASS, including all pre-existing tests (default `expandEmbeds = false`, single fragment → identical output).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/export/DocumentAssembler.ts src/export/DocumentAssembler.test.ts
git commit -m "feat: assemble embed expansions as source-aware fragments"
```

---

### Task 4: ExportRunner — per-fragment rewriting, embedded-note attachments

**Files:**
- Modify: `src/export/ExportRunner.ts:103` (assembler construction), `:120-133` (Steps 1–2), `:136-152` (Step 3)
- Test: `src/export/ExportRunner.test.ts` (existing — extend)

- [ ] **Step 1: Write the failing runner tests**

Append to `src/export/ExportRunner.test.ts`, adapting `makeRunnerApp`/`runExport`/writer-capture helpers to the file's existing conventions. The app fake needs `metadataCache.getFirstLinkpathDest`, `getFileCache`, `resolveSubpath`, and `vault.getAbstractFileByPath`:

```ts
it("resolves relative links inside expanded embeds against the embedded note's folder", async () => {
	// notes/main.md embeds notes/part.md; part.md references ./img.png.
	// The image must resolve against notes/, not the vault root.
	const app = makeRunnerApp({
		"notes/main.md": "![[part]]",
		"notes/part.md": "![alt](./img.png)",
		"notes/img.png": "",
	}, {
		linkmap: { part: "notes/part.md" },
	});

	const result = await runExport(app, { profile: "markdown-bundle" }, {
		expandEmbeds: true,
		copyAttachments: true,
	});

	expect(result.success).toBe(true);
	const exported = readWrittenFile("notes/main.md.md");
	expect(exported).toContain("](assets/img.png)");
	// and the image itself must have been collected + copied
	expect(writerCopiedPaths()).toContain("assets/img.png");
});

it("renders expanded embeds into HTML output with resolved image paths", async () => {
	const app = makeRunnerApp({
		"notes/main.md": "![[part]]",
		"notes/part.md": "![alt](./img.png)",
		"notes/img.png": "",
	}, {
		linkmap: { part: "notes/part.md" },
	});

	const result = await runExport(app, { profile: "html-document" }, {
		expandEmbeds: true,
		copyAttachments: true,
	});

	expect(result.success).toBe(true);
	expect(readWrittenFile("notes/main.html")).toContain('src="assets/img.png"');
});
```

(`readWrittenFile` captures `writer.writeText` payloads; both helpers follow whatever mock-writer pattern the file already uses.)

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/export/ExportRunner.test.ts
```

Expected: FAIL — with v1-style flat rewriting the embedded `./img.png` resolves against `notes/main.md`'s directory *only by luck* here (same folder); to make the test actually discriminate, place the host one level up (`"main.md"` at root embedding `"notes/part.md"`) so flat rewriting resolves `./img.png` to the vault root and the assertion on `assets/img.png` fails.

- [ ] **Step 3: Implement in ExportRunner**

Assembler construction (~line 103):

```ts
		const assembler = new DocumentAssembler(
			this.app,
			settings.includeSourcePathComments,
			settings.expandEmbeds,
		);
```

(If Task 5 hasn't landed yet when executing, use `settings.expandEmbeds ?? false` and drop the fallback there.)

After Step 1's `assemble` (~line 122):

```ts
			allWarnings.push(...(doc.warnings ?? []));
```

Step 2 (~line 129) — feed embedded notes to the collector:

```ts
				const embeddedFiles = (doc.embeddedPaths ?? [])
					.map((p) => this.app.vault.getAbstractFileByPath(p))
					.filter(
						(f): f is import("obsidian").TFile =>
							f !== null && "extension" in f && (f as import("obsidian").TFile).extension === "md",
					);
				const collectResult = await collector.collect([file, ...embeddedFiles]);
```

Step 3 (~lines 147-151) — rewrite per fragment, then rejoin:

```ts
			for (const section of doc.sections) {
				const fragments = section.fragments
					?? [{ markdown: section.markdown, sourcePath: section.sourcePath }];
				const rewritten: string[] = [];
				for (const fragment of fragments) {
					const result = rewriter.rewrite(fragment.markdown, fragment.sourcePath);
					rewritten.push(result.markdown);
					allWarnings.push(...result.warnings);
				}
				section.markdown = rewritten.join("");
			}
```

`AttachmentCollector.collect` only adds non-`.md` targets as attachments, so passing markdown files is safe — it lets their links and image references be scanned with their own paths.

- [ ] **Step 4: Run runner tests**

```bash
npx vitest run src/export/ExportRunner.test.ts
```

Expected: PASS (existing + the two new tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/ExportRunner.ts src/export/ExportRunner.test.ts
git commit -m "feat: rewrite expanded fragments against their own source paths"
```

---

### Task 5: The expandEmbeds setting

**Files:**
- Modify: `src/types.ts:3-9` and `src/types.ts:45-51`
- Modify: `src/settings/settings-tab.ts` (`SETTING_META`, `getSettingDefinitions`, `display`)

- [ ] **Step 1: Add the type and default**

In `src/types.ts`, add `expandEmbeds: boolean;` to `ExportSettings` (after `defaultOutputFolder`) and `expandEmbeds: true,` to `DEFAULT_SETTINGS`. Existing installs get the default through `Object.assign` in `loadSettings` — expansion turns on for everyone on upgrade (the point of the feature; call it out in release notes).

- [ ] **Step 2: Remove the `?? false` fallback from Task 4**

`settings.expandEmbeds` is now always defined.

- [ ] **Step 3: Expose in both settings UI paths**

In `src/settings/settings-tab.ts` add to `SETTING_META` (this file has the structure from the declarative-settings plan):

```ts
	expandEmbeds: {
		name: "Expand note embeds",
		desc: "Inline ![[Note]] embeds into the exported document instead of keeping them as links.",
		aliases: ["transclusion", "include notes", "inline"],
	},
```

In `getSettingDefinitions()`, insert a third top-level item before the Advanced group:

```ts
			{
				name: SETTING_META.expandEmbeds.name,
				desc: SETTING_META.expandEmbeds.desc,
				aliases: [...SETTING_META.expandEmbeds.aliases],
				control: {
					type: "toggle",
					key: "expandEmbeds",
					defaultValue: DEFAULT_SETTINGS.expandEmbeds,
				},
			},
```

Adjust the declarative-settings tests that index `defs[2]` as the Advanced group to `defs[3]`, and the aliases test which flattens top-level items to include the new one.

In `display()`, add the toggle between the format dropdown and the Advanced heading:

```ts
		new Setting(containerEl)
			.setName(SETTING_META.expandEmbeds.name)
			.setDesc(SETTING_META.expandEmbeds.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.expandEmbeds);
				toggle.onChange(async (v) => {
					this.plugin.settings.expandEmbeds = v;
					await this.plugin.saveSettings();
				});
			});
```

- [ ] **Step 4: Run settings tests and type check**

```bash
npx vitest run src/settings/settings-tab.test.ts && npx tsc -noEmit -skipLibCheck
```

Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/settings/settings-tab.ts src/settings/settings-tab.test.ts src/export/ExportRunner.ts
git commit -m "feat: add expandEmbeds setting (default on)"
```

---

### Task 6: Docs, full verification, release

**Files:**
- Modify: `README.md:9-14` (features), `README.md:63-69` (settings table), `README.md:71-76` (limitations)

- [ ] **Step 1: Update README**

Features list — add:

```markdown
- Note embeds (`![[Note]]`) are expanded inline, with heading-level embeds (`![[Note#Heading]]`), cycle detection, and a depth limit
```

Settings table — add:

```markdown
| Expand note embeds | Inline `![[Note]]` embeds into exported documents | On |
```

Limitations — replace the first line `- Inline note embeds (![[Note]]`) are preserved as links, not expanded` with:

```markdown
- Block-reference embeds (`![[Note#^block]]`) are not expanded
```

- [ ] **Step 2: Full CI matrix**

```bash
npm run check:version && npm run lint:obsidian-warnings && npx tsc -noEmit -skipLibCheck && npm run build && npm test
```

Expected: all pass.

- [ ] **Step 3: Manual smoke test**

1. Build, reload Obsidian.
2. Export a note containing `![[Other Note]]` and `![[Other Note#Section]]` to PDF and Markdown bundle — embedded content appears inline; a warning entry appears in `export-report.md` for a deliberately broken embed.
3. Embed a note in a *different folder* whose body references an image via a relative path (`![](./img.png)`) — the image resolves and is copied to `assets/` in all formats.
4. Create `a.md` embedding `b.md` embedding `a.md` — export completes with a "Circular embed skipped" warning, no hang. Confirm with a deep chain (7+ notes) that the depth limit also terminates.
5. A note whose body is only `![[chapter]]` where `chapter.md` starts with `# Chapter` — the export title stays the host note's name.
6. Toggle "Expand note embeds" off — export keeps `![[Note]]` as a link (0.5.x behavior).

- [ ] **Step 4: Bump the version inside the PR**

`check-version.mjs` requires the tag to match `package.json`/`manifest.json`/`versions.json`, so the bump lands in the PR:

```bash
npm version 0.6.0 --no-git-tag-version
git add package.json package-lock.json   # manifest.json + versions.json already staged by the version script
git commit -m "chore: bump version to 0.6.0"
```

- [ ] **Step 5: Release**

```bash
git checkout -b feat/embed-expansion
git push -u origin feat/embed-expansion
# PR → review → merge, then from the updated main:
git checkout main && git pull
git tag -a 0.6.0
git push origin 0.6.0   # CI creates the release
```

Release notes must state: embeds now expand by default; users who want link-preserving behavior can turn off "Expand note embeds".

---

## Self-Review Notes

- Review coverage: infinite-loop P0 (matchAll, Task 2), source-aware fragments (Tasks 2–4), title-before-expansion (Task 3), `parseLinktext`/`resolveSubpath` + canonical block syntax + cycle identity `path+subpath` + corrected cycle expectation (Task 2), fence-helper gaps (Task 1), version bump before tag (Task 6), format-level assertions (Task 4: markdown-bundle content + HTML output).
- Fragment join uses `""` with exact slices — byte-identical output when no embeds exist, so every existing format test remains valid.
- Module cycle `EmbedExpander.ts` ↔ `DocumentAssembler.ts` (via `stripFrontmatter`): function-level cycle, call-time only — esbuild and ESM tolerate it. If lint objects, move `stripFrontmatter` into `src/export/utils.ts` and re-export.
- Duck-typing (`"extension" in file`) per CLAUDE.md; no `instanceof TFile` in new code.
- Real-runtime caveat: `resolveSubpath` positions are computed by the metadata cache on the *raw* file content — the plan slices `raw` directly with those offsets (never the frontmatter-stripped body), so offsets always line up.
- `getFileCache` may return null for brand-new files mid-indexing; the implementation treats that as "heading not found" with a warning rather than throwing.
