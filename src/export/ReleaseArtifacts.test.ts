import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { env as nodeEnv } from "node:process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { JSDOM } from "jsdom";
import { ExportRunner } from "@/export/ExportRunner";
import { ExportPlanBuilder } from "@/export/ExportPlan";
import { DEFAULT_SETTINGS, ExportSettings, ExportSource, ExportProfileId } from "@/types";
import { createMemoryVault } from "@/test-support/memory-vault";
import { readStoredZipEntry, readStoredZipEntryBytes } from "@/formats/testZip";

// Headless contract suite: the real plan → runner → collector → rewriter →
// renderer → writer pipeline against a persistent in-memory vault. HTML runs
// through the basic/fallback converter here (no Obsidian DOM), and no PDF
// success claim is possible in this environment. Fixture notes mirror the
// marker text of scripts/create-release-fixtures.mjs so native acceptance can
// compare against identical content.

const RED = [210, 30, 30] as const;
const BLUE = [30, 30, 210] as const;

function png(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
	const crc32 = (bytes: Uint8Array): number => {
		let crc = 0xffffffff;
		for (const byte of bytes) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) {
				crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
			}
		}
		return (crc ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer): Buffer => {
		const label = Buffer.from(type, "ascii");
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const checksum = Buffer.alloc(4);
		checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
		return Buffer.concat([length, label, data, checksum]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const pixels = Buffer.alloc(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		const row = y * (1 + width * 3);
		pixels[row] = 0;
		for (let x = 0; x < width; x++) {
			const offset = row + 1 + x * 3;
			pixels[offset] = rgb[0];
			pixels[offset + 1] = rgb[1];
			pixels[offset + 2] = rgb[2];
		}
	}
	return new Uint8Array(Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]));
}

function sha256Hex(data: Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

function buildFixtureVault() {
	const fixture = createMemoryVault();
	fixture.putText("content.md", [
		"---", "title: Release acceptance", "---", "# Release acceptance", "",
		"BEGIN-CONTENT 中文导出 😀 café", "",
		"## Heading two", "### Heading three", "#### Heading four",
		"##### Heading five", "###### Heading six", "",
		"**Bold** and *italic* and `inline code`.", "",
		"1. Ordered one", "2. Ordered two", "", "- Bullet one", "- Bullet two", "",
		"| Name | Value |", "| --- | --- |", "| Alpha | 123 |", "| 中文 | 456 |", "",
		"```ts", "const sentinel = 'CODE-CONTENT';", "```", "",
		"[External link](https://example.com/)", "",
		"![Landscape](images/landscape.png)", "",
		"![Portrait](images/portrait.png)", "", "END-CONTENT", "",
	].join("\n"));
	fixture.putBinary("images/landscape.png", png(640, 240, RED));
	fixture.putBinary("images/portrait.png", png(240, 640, BLUE));
	fixture.putText("folder/index.md", "# Folder index\n\n[[nested/part]]\n\n![[nested/part]]\n\nEND-INDEX\n");
	fixture.putText("folder/nested/part.md", "# Nested part\n\nEMBED-SENTINEL\n\n![Local](../../images/landscape.png)\n\n[[../index]]\n");
	fixture.putText("folder/nested/third.md", "# Third\n\nTHIRD-SENTINEL\n\n[[part]]\n");
	fixture.putText("collision/a/A.md", "# Collision A\n\nRed image:\n\n![[img.png]]\n");
	fixture.putText("collision/b/B.md", "# Collision B\n\nBlue image:\n\n![[img.png]]\n");
	fixture.putBinary("collision/a/img.png", png(160, 100, RED));
	fixture.putBinary("collision/b/img.png", png(160, 100, BLUE));
	fixture.putText("export-report.md", "# Preserve this document\n\nREPORT-DOCUMENT-SENTINEL\n\n[[MissingReportTarget]]\n");
	fixture.putText("tasks.md", "# Tasks\n\n- [ ] Task item\n- [x] Done item\n\nTASK-LIST-SENTINEL\n");
	return fixture;
}

type FixtureVault = ReturnType<typeof buildFixtureVault>;

const SETTINGS: ExportSettings = {
	...DEFAULT_SETTINGS,
	expandEmbeds: true,
	copyAttachments: true,
	overwriteExisting: false,
};

function runExport(
	fixture: FixtureVault,
	source: ExportSource,
	profile: ExportProfileId,
	outputFilename: string,
	outputFolderName?: string,
	callbacks?: Parameters<ExportRunner["run"]>[2],
) {
	const plan = new ExportPlanBuilder(
		fixture.app, source, profile, "exports", outputFilename, outputFolderName,
	).setInputFiles(
		source.type === "folder"
			? ["folder/index.md", "folder/nested/part.md", "folder/nested/third.md"]
			: [source.type === "current-file" ? source.path : source.paths[0]],
	).build();
	return new ExportRunner(fixture.app).run(plan, SETTINGS, callbacks);
}

function parseXml(text: string): Document {
	const dom = new JSDOM(text, { contentType: "text/xml" });
	const errors = dom.window.document.querySelectorAll("parsererror");
	if (errors.length > 0) {
		throw new Error(`XML parse error in: ${errors[0].textContent?.slice(0, 200)}`);
	}
	return dom.window.document;
}

function elementsNamed(doc: Document, localName: string): Element[] {
	const all = doc.querySelectorAll("*");
	const matched: Element[] = [];
	all.forEach((el) => {
		if (el.localName === localName) matched.push(el);
	});
	return matched;
}

// Optional artifact persistence: only this test file writes outputs, only
// when RELEASE_ARTIFACT_DIR names a new or empty directory. Ordinary CI runs
// leave nothing on disk.
const artifactRoot = nodeEnv.RELEASE_ARTIFACT_DIR;
const artifactIndex: Record<string, unknown>[] = [];

beforeAll(() => {
	if (!artifactRoot) return;
	if (nodeFs.existsSync(artifactRoot)) {
		if (!nodeFs.statSync(artifactRoot).isDirectory() || nodeFs.readdirSync(artifactRoot).length > 0) {
			throw new Error(`RELEASE_ARTIFACT_DIR must be a new or empty directory: ${artifactRoot}`);
		}
	} else {
		nodeFs.mkdirSync(artifactRoot, { recursive: true });
	}
});

afterAll(() => {
	if (!artifactRoot) return;
	nodeFs.writeFileSync(
		nodePath.join(artifactRoot, "index.json"),
		JSON.stringify(artifactIndex, null, 2) + "\n",
		{ flag: "wx" },
	);
});

function persistCase(
	caseName: string,
	fixture: FixtureVault,
	result: { outputRoot: string; status: string; warnings: string[]; errors: string[] },
	rendering: string,
) {
	if (!artifactRoot) return;
	const caseDir = nodePath.join(artifactRoot, caseName);
	nodeFs.mkdirSync(caseDir);
	const files: { path: string; sha256: string }[] = [];
	for (const p of fixture.paths()) {
		if (!p.startsWith(`${result.outputRoot}/`) || !fixture.isFile(p)) continue;
		const relative = p.slice(result.outputRoot.length + 1);
		const target = nodePath.join(caseDir, relative);
		nodeFs.mkdirSync(nodePath.dirname(target), { recursive: true });
		let buffer: Buffer;
		try {
			buffer = Buffer.from(fixture.text(p), "utf8");
		} catch {
			buffer = Buffer.from(fixture.bytes(p));
		}
		nodeFs.writeFileSync(target, buffer, { flag: "wx" });
		files.push({ path: relative, sha256: sha256Hex(new Uint8Array(buffer)) });
	}
	artifactIndex.push({
		case: caseName,
		rendering,
		settings: SETTINGS,
		status: result.status,
		outputRoot: result.outputRoot,
		warnings: result.warnings,
		errors: result.errors,
		files,
	});
}

describe("release artifacts (headless)", () => {
	it("exports content.md to Markdown with markers, table, code and identical image bytes", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "content.md" }, "markdown-bundle", "content",
		);

		expect(result.status).toBe("completed");
		const markdown = fixture.text("exports/content.md");
		expect(markdown).toContain("BEGIN-CONTENT 中文导出 😀 café");
		expect(markdown).toContain("END-CONTENT");
		expect(markdown).toContain("| Alpha | 123 |");
		expect(markdown).toContain("| 中文 | 456 |");
		expect(markdown).toContain("CODE-CONTENT");
		expect(markdown).toContain("assets/landscape.png");
		expect(markdown).toContain("assets/portrait.png");
		expect(fixture.bytes("exports/assets/landscape.png"))
			.toEqual(fixture.bytes("images/landscape.png"));
		expect(fixture.bytes("exports/assets/portrait.png"))
			.toEqual(fixture.bytes("images/portrait.png"));
		persistCase("content-markdown", fixture, result, "headless:markdown-bundle");
	});

	it("exports content.md to fallback HTML with parseable tables and resolvable images", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "content.md" }, "html-document", "content",
		);

		expect(result.status).toBe("completed");
		const dom = new JSDOM(fixture.text("exports/content.html"));
		const doc = dom.window.document;
		expect(doc.body.textContent).toContain("BEGIN-CONTENT 中文导出 😀 café");
		expect(doc.body.textContent).toContain("END-CONTENT");
		expect(doc.body.textContent).toContain("CODE-CONTENT");

		const rowTexts: string[] = [];
		doc.querySelectorAll("table tr").forEach((row) => rowTexts.push(row.textContent ?? ""));
		expect(rowTexts.some((row) => row.includes("Alpha") && row.includes("123"))).toBe(true);
		expect(rowTexts.some((row) => row.includes("中文") && row.includes("456"))).toBe(true);

		const imageSources: string[] = [];
		doc.querySelectorAll("img").forEach((img) => imageSources.push(img.getAttribute("src") ?? ""));
		expect(imageSources).toContain("assets/landscape.png");
		expect(imageSources).toContain("assets/portrait.png");
		for (const src of imageSources) {
			expect(fixture.isFile(`exports/${src}`)).toBe(true);
		}
		persistCase("content-html-fallback", fixture, result, "headless-fallback:html-document");
	});

	it("exports content.md to DOCX with valid XML, markers, relationships and embedded images", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "content.md" }, "docx", "content",
		);

		expect(result.status).toBe("completed");
		const zip = fixture.bytes("exports/content.docx");

		const documentXml = readStoredZipEntry(zip, "word/document.xml");
		parseXml(documentXml);
		parseXml(readStoredZipEntry(zip, "[Content_Types].xml"));
		for (const marker of [
			"BEGIN-CONTENT", "END-CONTENT", "CODE-CONTENT",
			"Alpha", "123", "中文", "456",
		]) {
			expect(documentXml).toContain(marker);
		}

		const rels = readStoredZipEntry(zip, "word/_rels/document.xml.rels");
		parseXml(rels);
		expect(rels).toContain('Target="media/image1.png"');
		expect(rels).toContain('Target="media/image2.png"');
		expect(rels).toContain('Target="https://example.com/"');
		expect(rels).toContain('TargetMode="External"');

		expect(readStoredZipEntryBytes(zip, "word/media/image1.png"))
			.toEqual(fixture.bytes("images/landscape.png"));
		expect(readStoredZipEntryBytes(zip, "word/media/image2.png"))
			.toEqual(fixture.bytes("images/portrait.png"));
		persistCase("content-docx", fixture, result, "headless:docx");
	});

	it("exports content.md to EPUB with resolvable spine, markers, identical image bytes and no app:// references", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "content.md" }, "epub", "content",
		);

		expect(result.status).toBe("completed");
		const zip = fixture.bytes("exports/content.epub");
		expect(readStoredZipEntry(zip, "mimetype")).toBe("application/epub+zip");

		const container = parseXml(readStoredZipEntry(zip, "META-INF/container.xml"));
		const rootFiles = elementsNamed(container, "rootfile");
		expect(rootFiles.length).toBeGreaterThan(0);
		const packagePath = rootFiles[0].getAttribute("full-path");
		expect(packagePath).toBe("OEBPS/content.opf");

		const opf = parseXml(readStoredZipEntry(zip, packagePath ?? "OEBPS/content.opf"));
		const manifestIds = new Set(
			elementsNamed(opf, "item").map((item) => item.getAttribute("id")),
		);
		const spineIdrefs = elementsNamed(opf, "itemref")
			.map((ref) => ref.getAttribute("idref"))
			.filter((id): id is string => id !== null);
		expect(spineIdrefs.length).toBeGreaterThan(0);
		expect(spineIdrefs).toContain("nav");
		expect(spineIdrefs).toContain("ch1");
		for (const idref of spineIdrefs) {
			expect(manifestIds.has(idref)).toBe(true);
		}

		const nav = parseXml(readStoredZipEntry(zip, "OEBPS/nav.xhtml"));
		expect(elementsNamed(nav, "nav").length).toBeGreaterThan(0);
		const chapter = readStoredZipEntry(zip, "OEBPS/chapter-1.xhtml");
		parseXml(chapter);
		expect(chapter).toContain("BEGIN-CONTENT");
		expect(chapter).toContain("END-CONTENT");
		expect(chapter).toContain("CODE-CONTENT");

		expect(readStoredZipEntryBytes(zip, "OEBPS/images/image-1.png"))
			.toEqual(fixture.bytes("images/landscape.png"));
		expect(readStoredZipEntryBytes(zip, "OEBPS/images/image-2.png"))
			.toEqual(fixture.bytes("images/portrait.png"));

		expect(chapter).not.toContain("app://");
		expect(readStoredZipEntry(zip, "OEBPS/content.opf")).not.toContain("app://");
		persistCase("content-epub", fixture, result, "headless:epub");
	});

	it("wraps task lists in a ul so EPUB chapters and fallback HTML stay structurally valid", async () => {
		// Regression (native A11): a bare <li> in an EPUB chapter body fails
		// EPUBCheck RSC-005 (element "li" not allowed in body). XML
		// well-formedness alone does not catch this — assert the content model.
		const epubFixture = buildFixtureVault();
		const epubResult = await runExport(
			epubFixture, { type: "current-file", path: "tasks.md" }, "epub", "tasks",
		);

		expect(epubResult.status).toBe("completed");
		const chapter = readStoredZipEntry(epubFixture.bytes("exports/tasks.epub"), "OEBPS/chapter-1.xhtml");
		expect(chapter).toContain("TASK-LIST-SENTINEL");
		expect(chapter).toContain("☐ Task item");
		expect(chapter).toContain("☑ Done item");
		const epubDoc = parseXml(chapter);
		const strayListItems = elementsNamed(epubDoc, "li").filter((li) => {
			const parent = li.parentElement?.localName ?? "";
			return parent !== "ul" && parent !== "ol";
		});
		expect(strayListItems).toEqual([]);
		expect(elementsNamed(epubDoc, "ul").length).toBeGreaterThan(0);

		const htmlFixture = buildFixtureVault();
		const htmlResult = await runExport(
			htmlFixture, { type: "current-file", path: "tasks.md" }, "html-document", "tasks",
		);
		expect(htmlResult.status).toBe("completed");
		const htmlDoc = new JSDOM(htmlFixture.text("exports/tasks.html")).window.document;
		const items = htmlDoc.querySelectorAll("ul.task-list li");
		expect(items.length).toBe(2);
		expect(items[0].className).toBe("task");
		expect(items[0].querySelector("input[type=checkbox]:not([checked])")).not.toBeNull();
		expect(items[1].className).toBe("task-done");
		expect(items[1].querySelector("input[type=checkbox][checked]")).not.toBeNull();
	});

	describe("folder batch", () => {
		const folderSource: ExportSource = { type: "folder", path: "folder", recursive: true };

		it("preserves nested primaries, relative links and shared attachment bytes in Markdown", async () => {
			const fixture = buildFixtureVault();
			const result = await runExport(
				fixture, folderSource, "markdown-bundle", "index", "folder",
			);

			expect(result.status).toBe("completed");
			expect(result.completedFiles).toBe(3);
			for (const primary of [
				"exports/folder/index.md",
				"exports/folder/nested/part.md",
				"exports/folder/nested/third.md",
			]) {
				expect(fixture.isFile(primary)).toBe(true);
			}

			const index = fixture.text("exports/folder/index.md");
			expect(index).toContain("END-INDEX");
			// The expanded embed carries EMBED-SENTINEL; links stay relative.
			expect(index).toContain("EMBED-SENTINEL");
			expect(index).toContain("(nested/part.md)");
			expect(index).toContain("assets/landscape.png");

			const part = fixture.text("exports/folder/nested/part.md");
			expect(part).toContain("EMBED-SENTINEL");
			expect(part).toContain("../assets/landscape.png");
			expect(part).toContain("(../index.md)");

			const third = fixture.text("exports/folder/nested/third.md");
			expect(third).toContain("THIRD-SENTINEL");
			expect(third).toContain("(part.md)");

			expect(fixture.bytes("exports/folder/assets/landscape.png"))
				.toEqual(fixture.bytes("images/landscape.png"));
			persistCase("folder-markdown", fixture, result, "headless:markdown-bundle");
		});

		it("preserves nested primaries and relative links in fallback HTML", async () => {
			const fixture = buildFixtureVault();
			const result = await runExport(
				fixture, folderSource, "html-document", "index", "folder",
			);

			expect(result.status).toBe("completed");
			const dom = new JSDOM(fixture.text("exports/folder/index.html"));
			const doc = dom.window.document;
			expect(doc.body.textContent).toContain("END-INDEX");
			expect(doc.body.textContent).toContain("EMBED-SENTINEL");
			const link = doc.querySelector('a[href="nested/part.html"]');
			expect(link).not.toBeNull();
			expect(fixture.isFile("exports/folder/nested/part.html")).toBe(true);

			const partDom = new JSDOM(fixture.text("exports/folder/nested/part.html"));
			const image = partDom.window.document.querySelector('img[src="../assets/landscape.png"]');
			expect(image).not.toBeNull();
			expect(fixture.isFile("exports/folder/assets/landscape.png")).toBe(true);
			persistCase("folder-html-fallback", fixture, result, "headless-fallback:html-document");
		});
	});

	it("keeps collision A intact while B exports its blue image to a separate root", async () => {
		const fixture = buildFixtureVault();
		const run = (path: string, name: string) => runExport(
			fixture, { type: "current-file", path }, "markdown-bundle", name,
		);

		const first = await run("collision/a/A.md", "A");
		const originalDocument = fixture.text("exports/A.md");
		const originalHash = sha256Hex(fixture.bytes("exports/assets/img.png"));
		const second = await run("collision/b/B.md", "B");

		expect(first.status).toBe("completed");
		expect(second.status).toBe("completed");
		expect(fixture.text("exports/A.md")).toBe(originalDocument);
		expect(sha256Hex(fixture.bytes("exports/assets/img.png"))).toBe(originalHash);
		expect(second.outputRoot).not.toBe("exports");
		expect(fixture.bytes(`${second.outputRoot}/assets/img.png`))
			.toEqual(fixture.bytes("collision/b/img.png"));
		expect(fixture.text(`${second.outputRoot}/B.md`)).toContain("assets/img.png");
	});

	it("keeps a primary named export-report.md and writes warnings to a distinct report", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "export-report.md" }, "markdown-bundle", "export-report",
		);

		expect(result.status).toBe("completed");
		expect(fixture.text("exports/export-report.md")).toContain("REPORT-DOCUMENT-SENTINEL");
		expect(fixture.isFile("exports/export-report-2.md")).toBe(true);
		expect(fixture.text("exports/export-report-2.md")).toContain("Unresolved link: MissingReportTarget");
		expect(result.reportPath).toBe("exports/export-report-2.md");
	});

	it("reports a missing required attachment as failed, never completed", async () => {
		const fixture = buildFixtureVault();
		const callbacks = {
			onFileStart: () => {},
			onFileComplete: () => {},
			onPhase: (phase: string) => {
				if (phase === "Copying attachments") fixture.remove("images/landscape.png");
			},
		};
		const result = await runExport(
			fixture, { type: "current-file", path: "content.md" }, "markdown-bundle", "content",
			undefined, callbacks,
		);

		expect(result.status).toBe("failed");
		expect(result.success).toBe(false);
		expect(result.incompletePaths).toContain("exports/content.md");
		expect(result.errors).toContain("Failed to copy attachment: images/landscape.png");
	});

	it("reports cancellation with the incomplete primary instead of success", async () => {
		const fixture = buildFixtureVault();
		const runner = new ExportRunner(fixture.app);
		const plan = new ExportPlanBuilder(
			fixture.app, { type: "current-file", path: "content.md" },
			"markdown-bundle", "exports", "content",
		).setInputFiles(["content.md"]).build();
		const result = await runner.run(plan, SETTINGS, {
			onFileStart: () => {},
			onFileComplete: () => {},
			onPhase: (phase) => phase === "Copying attachments" && runner.cancel(),
		});

		expect(result.status).toBe("cancelled");
		expect(result.success).toBe(false);
		expect(result.completedFiles).toBe(0);
		expect(result.incompletePaths).toContain("exports/content.md");
	});
});
