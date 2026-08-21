import { afterEach, describe, it, expect, vi } from "vitest";
import { ExportRunner, SINGLE_FILE_PHASES } from "@/export/ExportRunner";
import { AttachmentCollector } from "@/export/AttachmentCollector";
import { OutputWriter } from "@/export/OutputWriter";
import { Platform } from "obsidian";

vi.mock("@/formats/pdf", () => ({
	renderPdf: vi.fn(() => Promise.reject(new Error("PDF generation failed: test failure"))),
}));

function createFile(path: string) {
	return { path, basename: path.split("/").pop()?.replace(/\.md$/, "") ?? path, extension: "md" };
}

function createMockApp(files: string[]) {
	const fileMap = new Map(files.map((p) => [p, createFile(p)]));
	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => fileMap.get(path) ?? null),
			read: vi.fn((_file?: { path: string }) => Promise.resolve("content")),
			getMarkdownFiles: vi.fn(() => []),
			createFolder: vi.fn(),
			create: vi.fn(),
			modify: vi.fn(),
			createBinary: vi.fn(),
			readBinary: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
			adapter: {},
		},
		metadataCache: {
			getFileCache: vi.fn(() => ({ frontmatter: {}, links: [], embeds: [] })),
		},
	};
}

function createPathAwareMockApp(
	files: string[],
	existingFolders: string[] = [],
	existingFiles: string[] = [],
) {
	const pathMap = new Map<string, unknown>();
	for (const path of files) pathMap.set(path, createFile(path));
	for (const path of existingFolders) pathMap.set(path, { path, children: [] });
	for (const path of existingFiles) pathMap.set(path, createFile(path));

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => pathMap.get(path) ?? null),
			read: vi.fn((_file?: { path: string }) => Promise.resolve("content")),
			getMarkdownFiles: vi.fn(() => []),
			createFolder: vi.fn().mockResolvedValue(undefined),
			create: vi.fn().mockResolvedValue(undefined),
			modify: vi.fn().mockResolvedValue(undefined),
			createBinary: vi.fn().mockResolvedValue(undefined),
			modifyBinary: vi.fn().mockResolvedValue(undefined),
			readBinary: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
			adapter: {},
		},
		metadataCache: {
			getFileCache: vi.fn(() => ({ frontmatter: {}, links: [], embeds: [] })),
			getFirstLinkpathDest: vi.fn(
				(_link?: string): ReturnType<typeof createFile> | null => null,
			),
		},
	};
}

function defaultSettings() {
	return {
		defaultProfile: "markdown-bundle" as const,
		defaultOutputFolder: "exports",
		expandEmbeds: false,
		includeSourcePathComments: false,
		copyAttachments: false,
		overwriteExisting: false,
	};
}

function makePlan(files: string[]) {
	const outputFilename = files[0]?.split("/").pop()?.replace(/\.md$/i, "") ?? "output";
	return {
		profile: "markdown-bundle" as const,
		source: { type: "current-file" as const, path: files[0] },
		inputFiles: files,
		outputRoot: "exports",
		outputFilename,
		outputFolderName: undefined,
		outputFiles: files.map((f) => `exports/${f.split("/").pop()}`),
		attachmentCopies: [],
	};
}

function makePdfPlan(files: string[]) {
	return {
		...makePlan(files),
		profile: "pdf" as const,
		outputFiles: files.map((f) => `exports/${f.split("/").pop()?.replace(/\\.md$/, ".pdf")}`),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	Platform.isDesktopApp = true;
	Platform.isDesktop = true;
});

describe("ExportRunner", () => {
	describe("SINGLE_FILE_PHASES", () => {
		it("has 5 phases", () => {
			expect(SINGLE_FILE_PHASES).toHaveLength(5);
		});
	});

	describe("callbacks", () => {
		it("calls onFileStart for each file", async () => {
			const app = createMockApp(["a.md", "b.md"]);
			const plan = makePlan(["a.md", "b.md"]);
			const runner = new ExportRunner(app as never);
			const onFileStart = vi.fn();
			await runner.run(plan, defaultSettings(), { onFileStart, onFileComplete: vi.fn(), onPhase: vi.fn() });
			expect(onFileStart).toHaveBeenCalledTimes(2);
			expect(onFileStart).toHaveBeenCalledWith(0, 2, "a");
			expect(onFileStart).toHaveBeenCalledWith(1, 2, "b");
		});

		it("calls onFileComplete for each file", async () => {
			const app = createMockApp(["a.md", "b.md"]);
			const plan = makePlan(["a.md", "b.md"]);
			const runner = new ExportRunner(app as never);
			const onFileComplete = vi.fn();
			await runner.run(plan, defaultSettings(), { onFileStart: vi.fn(), onFileComplete, onPhase: vi.fn() });
			expect(onFileComplete).toHaveBeenCalledTimes(2);
		});

		it("calls onPhase for each step within a file", async () => {
			const app = createMockApp(["a.md"]);
			const plan = makePlan(["a.md"]);
			const runner = new ExportRunner(app as never);
			const onPhase = vi.fn();
			await runner.run(plan, defaultSettings(), { onFileStart: vi.fn(), onFileComplete: vi.fn(), onPhase });
			expect(onPhase.mock.calls.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("cancel", () => {
		it("stops before the next attachment after cancellation", async () => {
			const app = createMockApp(["a.md"]);
			const plan = {
				...makePlan(["a.md"]),
				attachmentCopies: [
					{ sourcePath: "one.png", outputRelativePath: "assets/one.png" },
					{ sourcePath: "two.png", outputRelativePath: "assets/two.png" },
				],
			};
			const runner = new ExportRunner(app as never);
			const copySpy = vi.spyOn(OutputWriter.prototype, "copyBinaryFile")
				.mockImplementationOnce(async () => {
					runner.cancel();
				})
				.mockResolvedValue(undefined);

			const result = await runner.run(plan, defaultSettings());

			expect(copySpy).toHaveBeenCalledTimes(1);
			expect(result.success).toBe(false);
			expect(result.warnings[0]).toContain("cancelled");
		});

		it("reports partial success when cancellation happens after an earlier file", async () => {
			const app = createMockApp(["a.md", "b.md"]);
			const plan = makePlan(["a.md", "b.md"]);
			const runner = new ExportRunner(app as never);
			vi.spyOn(AttachmentCollector.prototype, "collect")
				.mockResolvedValueOnce({
					attachments: [
						{ sourcePath: "a-one.png", outputRelativePath: "assets/a-one.png" },
						{ sourcePath: "a-two.png", outputRelativePath: "assets/a-two.png" },
					],
					warnings: [],
				})
				.mockResolvedValueOnce({
					attachments: [
						{ sourcePath: "b-one.png", outputRelativePath: "assets/b-one.png" },
						{ sourcePath: "b-two.png", outputRelativePath: "assets/b-two.png" },
					],
					warnings: [],
				});
			let copies = 0;
			const copySpy = vi.spyOn(OutputWriter.prototype, "copyBinaryFile")
				.mockImplementation(async () => {
					copies++;
					if (copies === 3) runner.cancel();
				});

			const result = await runner.run(
				plan,
				{ ...defaultSettings(), copyAttachments: true },
			);

			expect(copySpy).toHaveBeenCalledTimes(3);
			expect(result.success).toBe(true);
			expect(result.warnings[0]).toContain("1 of 2 file(s) exported");
		});

		it("returns partial success when cancelled after some files", async () => {
			const app = createMockApp(["a.md", "b.md", "c.md"]);
			const plan = makePlan(["a.md", "b.md", "c.md"]);
			const runner = new ExportRunner(app as never);

			let cancelAfterFirst = false;
			const callbacks = {
				onFileStart: vi.fn(),
				onFileComplete: vi.fn(() => {
					if (!cancelAfterFirst) {
						cancelAfterFirst = true;
						runner.cancel();
					}
				}),
				onPhase: vi.fn(),
			};

			const result = await runner.run(plan, defaultSettings(), callbacks);
			expect(result.success).toBe(true);
			expect(result.warnings[0]).toContain("cancelled");
			expect(result.warnings[0]).toContain("file(s) exported");
		});

		it("returns failure when cancelled before any file completes", async () => {
			const app = createMockApp(["a.md", "b.md"]);
			const plan = makePlan(["a.md", "b.md"]);
			const runner = new ExportRunner(app as never);

			const callbacks = {
				onFileStart: vi.fn(),
				onFileComplete: vi.fn(),
				onPhase: vi.fn(() => {
					runner.cancel();
				}),
			};

			const result = await runner.run(plan, defaultSettings(), callbacks);
			expect(result.success).toBe(false);
			expect(result.warnings[0]).toContain("cancelled");
		});
	});

	describe("format failures", () => {
		it("marks PDF export as failed when the PDF file was not produced", async () => {
			const app = createMockApp(["a.md"]);
			const plan = makePdfPlan(["a.md"]);
			const runner = new ExportRunner(app as never);

			const result = await runner.run(plan, defaultSettings(), {
				onFileStart: vi.fn(),
				onFileComplete: vi.fn(),
				onPhase: vi.fn(),
			});

			expect(result.success).toBe(false);
			expect(result.warnings[0]).toContain("PDF generation failed");
		});

		it("rejects PDF on mobile before creating output artifacts", async () => {
			Platform.isDesktopApp = false;
			Platform.isDesktop = false;
			const app = createMockApp(["a.md"]);
			const runner = new ExportRunner(app as never);

			const result = await runner.run(makePdfPlan(["a.md"]), defaultSettings());

			expect(result.success).toBe(false);
			expect(result.warnings).toEqual(["PDF export requires the desktop app."]);
			expect(app.vault.createFolder).not.toHaveBeenCalled();
			expect(app.vault.create).not.toHaveBeenCalled();
			expect(app.vault.createBinary).not.toHaveBeenCalled();
		});
	});

	describe("attachment destination", () => {
		it("copies attachments into the target folder's assets (folder source)", async () => {
			const app = createMockApp(["notes/a.md"]);
			// Folder source: outputFolderName set → assetsRoot = outputRoot/folderName
			const plan = {
				profile: "markdown-bundle" as const,
				source: { type: "folder" as const, path: "notes" },
				inputFiles: ["notes/a.md"],
				outputRoot: "exports",
				outputFilename: "index",
				outputFolderName: "notes",
				outputFiles: ["exports/notes/a.md"],
				attachmentCopies: [
					{ sourcePath: "notes/img.png", outputRelativePath: "assets/img.png" },
				],
			};
			const runner = new ExportRunner(app as never);

			const copySpy = vi
				.spyOn(OutputWriter.prototype, "copyBinaryFile")
				.mockResolvedValue(undefined);

			await runner.run(
				plan as never,
				{ ...defaultSettings(), copyAttachments: false },
				{ onFileStart: vi.fn(), onFileComplete: vi.fn(), onPhase: vi.fn() },
			);

			// Attachment must land under the target folder, not the export root.
			const destPaths = copySpy.mock.calls.map((c) => c[1]);
			expect(destPaths).toContain("exports/notes/assets/img.png");
			expect(destPaths).not.toContain("exports/assets/img.png");
			copySpy.mockRestore();
		});
	});

	describe("output collisions", () => {
		it("keeps the original root when the directory exists but the target file does not", async () => {
			const app = createPathAwareMockApp(["note.md"], ["exports"]);
			const runner = new ExportRunner(app as never);
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			const result = await runner.run(makePlan(["note.md"]), defaultSettings());

			expect(result.outputRoot).toBe("exports");
			expect(writeSpy).toHaveBeenCalledWith(
				"exports/note.md",
				expect.any(String),
			);
		});

		it("relocates the output file when the target already exists", async () => {
			const app = createPathAwareMockApp(
				["note.md"],
				["exports"],
				["exports/note.md"],
			);
			const runner = new ExportRunner(app as never);
			vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			const result = await runner.run(makePlan(["note.md"]), defaultSettings());

			expect(result.outputRoot).toBe("exports-2026-07-29");
			expect(writeSpy).toHaveBeenCalledWith(
				"exports-2026-07-29/note.md",
				expect.any(String),
			);
			expect(writeSpy).not.toHaveBeenCalledWith(
				"exports/note.md",
				expect.any(String),
			);
		});

		it("timestamps the batch leaf only when the actual batch target exists", async () => {
			const plan = {
				...makePlan(["notes/a.md"]),
				source: { type: "folder" as const, path: "notes", recursive: true },
				outputFolderName: "notes",
				outputFiles: ["exports/notes/a.md"],
			};
			vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			const noConflictApp = createPathAwareMockApp(["notes/a.md"], ["exports"]);
			const noConflictResult = await new ExportRunner(noConflictApp as never)
				.run(plan, defaultSettings());
			expect(noConflictResult.outputRoot).toBe("exports");
			expect(writeSpy).toHaveBeenCalledWith(
				"exports/notes/a.md",
				expect.any(String),
			);

			writeSpy.mockClear();
			const conflictApp = createPathAwareMockApp(
				["notes/a.md"],
				["exports", "exports/notes"],
			);
			await new ExportRunner(conflictApp as never).run(plan, defaultSettings());
			expect(writeSpy).toHaveBeenCalledWith(
				"exports/notes-2026-07-29/a.md",
				expect.any(String),
			);
		});

		it("treats a file at the batch target as a collision", async () => {
			const app = createPathAwareMockApp(
				["notes/a.md"],
				["exports"],
				["exports/notes"],
			);
			const plan = {
				...makePlan(["notes/a.md"]),
				source: { type: "folder" as const, path: "notes", recursive: true },
				outputFolderName: "notes",
				outputFiles: ["exports/notes/a.md"],
			};
			vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			await new ExportRunner(app as never).run(plan, defaultSettings());

			expect(writeSpy).toHaveBeenCalledWith(
				"exports/notes-2026-07-29/a.md",
				expect.any(String),
			);
		});

		it("increments the timestamped root when that candidate already exists", async () => {
			const app = createPathAwareMockApp(
				["note.md"],
				["exports", "exports-2026-07-29"],
				["exports/note.md"],
			);
			vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			const result = await new ExportRunner(app as never)
				.run(makePlan(["note.md"]), defaultSettings());

			expect(result.outputRoot).toBe("exports-2026-07-29-2");
			expect(writeSpy).toHaveBeenCalledWith(
				"exports-2026-07-29-2/note.md",
				expect.any(String),
			);
		});

		it("applies collision protection to external output paths", async () => {
			const app = createPathAwareMockApp(["note.md"]);
			const plan = {
				...makePlan(["note.md"]),
				outputRoot: "/tmp/exports",
				outputFiles: ["/tmp/exports/note.md"],
			};
			vi.spyOn(OutputWriter.prototype, "pathExists")
				.mockImplementation((path) => path === "/tmp/exports/note.md");
			vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
			vi.spyOn(OutputWriter.prototype, "ensureFolder").mockResolvedValue(undefined);
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			const result = await new ExportRunner(app as never).run(plan, defaultSettings());

			expect(result.outputRoot).toBe("/tmp/exports-2026-07-29");
			expect(writeSpy).toHaveBeenCalledWith(
				"/tmp/exports-2026-07-29/note.md",
				expect.any(String),
			);
		});

		it("relocates attachments and warning reports with the output root", async () => {
			const app = createPathAwareMockApp(
				["note.md"],
				["exports"],
				["exports/note.md"],
			);
			app.vault.read.mockResolvedValue("[[Missing]]");
			const plan = {
				...makePlan(["note.md"]),
				attachmentCopies: [
					{ sourcePath: "images/picture.png", outputRelativePath: "assets/picture.png" },
				],
			};
			vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
			const copySpy = vi.spyOn(OutputWriter.prototype, "copyBinaryFile")
				.mockResolvedValue(undefined);
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			await new ExportRunner(app as never).run(plan, defaultSettings());

			expect(copySpy).toHaveBeenCalledWith(
				"images/picture.png",
				"exports-2026-07-29/assets/picture.png",
			);
			expect(writeSpy).toHaveBeenCalledWith(
				"exports-2026-07-29/export-report.md",
				expect.stringContaining("Unresolved link: Missing"),
			);
			expect(writeSpy).not.toHaveBeenCalledWith(
				"exports/export-report.md",
				expect.any(String),
			);
		});

		it("uses relocated output paths when rewriting links in a batch", async () => {
			const app = createPathAwareMockApp(
				["notes/a.md", "notes/b.md"],
				["exports", "exports/notes"],
			);
			app.vault.read.mockImplementation((file?: { path: string }) =>
				Promise.resolve(file?.path === "notes/a.md" ? "[[b]]" : "content"),
			);
			app.metadataCache.getFirstLinkpathDest.mockImplementation((link?: string) =>
				link === "b" ? createFile("notes/b.md") : null,
			);
			const plan = {
				...makePlan(["notes/a.md", "notes/b.md"]),
				source: { type: "folder" as const, path: "notes", recursive: true },
				outputFolderName: "notes",
				outputFiles: ["exports/notes/a.md", "exports/notes/b.md"],
			};
			vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue("2026-07-29");
			const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText")
				.mockResolvedValue(undefined);

			await new ExportRunner(app as never).run(plan, defaultSettings());

			expect(writeSpy).toHaveBeenCalledWith(
				"exports/notes-2026-07-29/a.md",
				expect.stringContaining("[b](b.md)"),
			);
			expect(writeSpy).not.toHaveBeenCalledWith(
				"exports/notes-2026-07-29/a.md",
				expect.stringContaining("../notes/b.md"),
			);
		});
	});
});

describe("embed expansion", () => {
	function createExpandApp(files: Record<string, string>, linkmap: Record<string, string> = {}) {
		const pathMap = new Map<string, unknown>();
		for (const path of Object.keys(files)) {
			if (path.endsWith(".md")) pathMap.set(path, createFile(path));
			else {
				const name = path.split("/").pop() ?? path;
				pathMap.set(path, {
					path,
					basename: name.replace(/\.[^.]+$/, ""),
					extension: name.split(".").pop() ?? "",
					name,
				});
			}
		}
		return {
			vault: {
				getAbstractFileByPath: vi.fn((p: string) => pathMap.get(p) ?? null),
				read: vi.fn(async (f: { path: string }) => {
					const content = files[f.path];
					if (content === undefined) throw new Error(`missing file: ${f.path}`);
					return content;
				}),
				getMarkdownFiles: vi.fn(() => []),
				createFolder: vi.fn().mockResolvedValue(undefined),
				create: vi.fn().mockResolvedValue(undefined),
				createBinary: vi.fn().mockResolvedValue(undefined),
				readBinary: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
				adapter: {},
			},
			metadataCache: {
				getFileCache: vi.fn(() => ({ frontmatter: {}, links: [], embeds: [] })),
				getFirstLinkpathDest: vi.fn((link: string) => {
					const dest = linkmap[link];
					return dest ? { path: dest } : null;
				}),
			},
		};
	}

	it("resolves relative links inside expanded embeds against the embedded note's folder", async () => {
		// Host sits at the vault root; the embedded note and its image live in
		// notes/. Flat rewriting against the host would resolve ./img.png to the
		// vault root and miss the attachment entirely.
		const app = createExpandApp({
			"main.md": "![[part]]",
			"notes/part.md": "![alt](./img.png)",
			"notes/img.png": "",
		}, { part: "notes/part.md" });

		const plan = makePlan(["main.md"]);
		const runner = new ExportRunner(app as never);
		const writeSpy = vi.spyOn(OutputWriter.prototype, "writeText").mockResolvedValue(undefined);
		const copySpy = vi.spyOn(OutputWriter.prototype, "copyBinaryFile").mockResolvedValue(undefined);

		const result = await runner.run(plan, {
			...defaultSettings(),
			copyAttachments: true,
			expandEmbeds: true,
		});

		expect(result.success).toBe(true);
		const written = writeSpy.mock.calls.map((c) => String(c[1])).join("\n");
		expect(written).toContain("](assets/img.png)");
		expect(copySpy).toHaveBeenCalledWith("notes/img.png", expect.stringContaining("assets/img.png"));

		writeSpy.mockRestore();
		copySpy.mockRestore();
	});

	it("renders fragment-joined markdown into HTML with resolved image paths", async () => {
		const { renderHtmlDocument } = await import("@/formats/html-document");
		const markdown = "Intro\n\n![alt](assets/img.png)";
		const writer = {
			ensureFolder: vi.fn().mockResolvedValue(undefined),
			writeText: vi.fn().mockResolvedValue(undefined),
		};
		const doc = {
			title: "Fixture",
			sections: [{
				sourcePath: "main.md",
				title: "Fixture",
				markdown,
				frontmatter: {},
				fragments: [{ markdown: "Intro\n\n", sourcePath: "main.md" }, { markdown: "![alt](./img.png)", sourcePath: "notes/part.md" }],
			}],
			attachments: [],
		};
		const plan = { outputRoot: "exports", outputFilename: "fixture.md" };

		await renderHtmlDocument(doc as never, plan as never, writer as never, null, "exports/fixture.html");

		const html = String(writer.writeText.mock.calls[0][1]);
		expect(html).toContain('src="assets/img.png"');
	});
});
