import { describe, it, expect, vi } from "vitest";
import { ExportRunner, SINGLE_FILE_PHASES } from "@/export/ExportRunner";
import { OutputWriter } from "@/export/OutputWriter";

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
			read: vi.fn(() => Promise.resolve("content")),
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

function defaultSettings() {
	return {
		defaultProfile: "markdown-bundle" as const,
		defaultOutputFolder: "exports",
		includeSourcePathComments: false,
		copyAttachments: false,
		overwriteExisting: false,
	};
}

function makePlan(files: string[]) {
	return {
		profile: "markdown-bundle" as const,
		source: { type: "current-file" as const, path: files[0] },
		inputFiles: files,
		outputRoot: "exports",
		outputFilename: "output",
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
});
