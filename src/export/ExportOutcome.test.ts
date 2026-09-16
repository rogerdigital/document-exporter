import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveExportStatus } from "@/export/ExportOutcome";
import { ExportRunner } from "@/export/ExportRunner";
import { ExportPlanBuilder } from "@/export/ExportPlan";
import { DEFAULT_SETTINGS, ExportSettings } from "@/types";
import { createMemoryVault } from "@/test-support/memory-vault";
import type { AssembledDocument } from "@/types";

const { renderPdfMock } = vi.hoisted(() => ({
	renderPdfMock: vi.fn<[AssembledDocument, ...unknown[]], Promise<string[]>>(),
}));

vi.mock("@/formats/pdf", () => ({
	renderPdf: renderPdfMock,
}));

function outcomeSettings(overrides: Partial<ExportSettings> = {}): ExportSettings {
	return {
		...DEFAULT_SETTINGS,
		expandEmbeds: false,
		copyAttachments: true,
		overwriteExisting: false,
		...overrides,
	};
}

function singleFilePlan(
	fixture: ReturnType<typeof createMemoryVault>,
	path: string,
	name: string,
) {
	return new ExportPlanBuilder(
		fixture.app, { type: "current-file", path },
		"markdown-bundle", "exports", name,
	).setInputFiles([path]).build();
}

function filesPlan(
	fixture: ReturnType<typeof createMemoryVault>,
	paths: string[],
) {
	return new ExportPlanBuilder(
		fixture.app, { type: "files", paths },
		"markdown-bundle", "exports", "output", "files",
	).setInputFiles(paths).build();
}

const noCallbacks = {
	onFileStart: () => {},
	onFileComplete: () => {},
	onPhase: () => {},
};

afterEach(() => {
	vi.restoreAllMocks();
	renderPdfMock.mockReset();
});

describe("resolveExportStatus", () => {
	it.each([
		[false, 2, 2, false, "completed"],
		[false, 1, 2, true, "partial"],
		[false, 0, 2, true, "failed"],
		[true, 0, 2, false, "cancelled"],
		[true, 1, 2, false, "cancelled"],
		[true, 2, 2, false, "cancelled"],
		[false, 0, 0, false, "failed"],
		[false, 2, 2, true, "partial"],
	] as const)("resolves outcome %s/%i/%i/%s", (cancelled, done, total, failure, expected) => {
		expect(resolveExportStatus(cancelled, done, total, failure)).toBe(expected);
	});
});

describe("export outcomes", () => {
	it("cancel during the assembling phase leaves no primary output", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "content");
		const runner = new ExportRunner(fixture.app);

		const result = await runner.run(
			singleFilePlan(fixture, "a/A.md", "A"),
			outcomeSettings(),
			{ ...noCallbacks, onPhase: (phase) => phase === "Assembling document" && runner.cancel() },
		);

		expect(result).toMatchObject({ status: "cancelled", success: false, completedFiles: 0 });
		expect(fixture.paths()).not.toContain("exports/A.md");
	});

	it("cancel in the first onFileComplete of a three-file batch preserves the first output and diagnostics", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "Link to [[missing]]");
		fixture.putText("b/B.md", "content");
		fixture.putText("c/C.md", "content");
		const runner = new ExportRunner(fixture.app);

		const result = await runner.run(
			filesPlan(fixture, ["a/A.md", "b/B.md", "c/C.md"]),
			outcomeSettings(),
			{
				...noCallbacks,
				onFileComplete: () => runner.cancel(),
			},
		);

		expect(result.status).toBe("cancelled");
		expect(result.success).toBe(false);
		expect(result.completedFiles).toBe(1);
		expect(result.completedPaths).toEqual(["exports/files/a/A.md"]);
		expect(result.warnings).toContain("Unresolved link: missing");
		expect(result.warnings.some((w) => w.includes("1 of 3 file(s) exported"))).toBe(true);
		expect(fixture.text("exports/files/a/A.md")).toContain("missing");
	});

	it("cancel in the copy phase after rendering lists the primary as incomplete", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "![[a/img.png]]");
		fixture.putBinary("a/img.png", new Uint8Array([1]));
		const runner = new ExportRunner(fixture.app);

		const result = await runner.run(
			singleFilePlan(fixture, "a/A.md", "A"),
			outcomeSettings(),
			{ ...noCallbacks, onPhase: (phase) => phase === "Copying attachments" && runner.cancel() },
		);

		expect(result).toMatchObject({ status: "cancelled", success: false, completedFiles: 0 });
		expect(result.incompletePaths).toContain("exports/A.md");
		expect(fixture.text("exports/A.md")).toContain("assets/");
	});

	it("a read failure on the second source stays partial with prior warnings and the new error", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "Link to [[missing]]");
		// A binary file with an .md extension passes input filtering but fails
		// assembly with a read error, without being a "missing input".
		fixture.putBinary("b/B.md", new Uint8Array([0]));

		const result = await new ExportRunner(fixture.app)
			.run(filesPlan(fixture, ["a/A.md", "b/B.md"]), outcomeSettings());

		expect(result.status).toBe("partial");
		expect(result.success).toBe(false);
		expect(result.completedPaths).toEqual(["exports/files/a/A.md"]);
		expect(result.warnings).toContain("Unresolved link: missing");
		expect(result.errors[0]).toContain("Export failed for b/B.md");
		expect(fixture.text("exports/files/a/A.md")).toContain("missing");
	});

	it("a rejected renderer fails the run and lists the potential primary", async () => {
		renderPdfMock.mockRejectedValue(new Error("PDF generation failed: no window"));
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "content");

		const plan = new ExportPlanBuilder(
			fixture.app, { type: "current-file", path: "a/A.md" },
			"pdf", "exports", "A",
		).setInputFiles(["a/A.md"]).build();
		const result = await new ExportRunner(fixture.app).run(plan, outcomeSettings());

		expect(result.status).toBe("failed");
		expect(result.success).toBe(false);
		expect(result.completedFiles).toBe(0);
		expect(result.incompletePaths).toContain("exports/A.pdf");
		expect(result.errors[0]).toContain("PDF generation failed");
	});

	it("a shared attachment that fails once is retried for the later source", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "![[shared/img.png]]");
		fixture.putText("b/B.md", "![[shared/img.png]]");
		fixture.putBinary("shared/img.png", new Uint8Array([5]));

		const result = await new ExportRunner(fixture.app).run(
			filesPlan(fixture, ["a/A.md", "b/B.md"]),
			outcomeSettings(),
			{
				...noCallbacks,
				onPhase: (phase) => {
					// The source exists for A's collection, disappears before
					// A's copy, and returns before B collects and copies it.
					if (phase === "Copying attachments for A") fixture.remove("shared/img.png");
					if (phase === "Collecting attachments for B") {
						fixture.putBinary("shared/img.png", new Uint8Array([5]));
					}
				},
			},
		);

		expect(result.status).toBe("partial");
		expect(result.completedPaths).toEqual(["exports/files/b/B.md"]);
		expect(result.incompletePaths).toContain("exports/files/a/A.md");
		expect(result.errors).toContain("Failed to copy attachment: shared/img.png");
		expect(Array.from(fixture.bytes("exports/files/assets/img.png"))).toEqual([5]);
	});

	it("a missing requested input keeps the original total and is named in errors", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "content");

		const result = await new ExportRunner(fixture.app)
			.run(filesPlan(fixture, ["a/A.md", "b/B.md"]), outcomeSettings());

		expect(result.status).toBe("partial");
		expect(result.totalFiles).toBe(2);
		expect(result.completedFiles).toBe(1);
		expect(result.errors).toContain("Input file not found or not a Markdown note: b/B.md");
		expect(fixture.text("exports/files/a/A.md")).toContain("A");
	});

	it("a report write failure stays visible as a warning without losing documents", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "Link to [[missing]]");
		const vault = fixture.app.vault;
		const create = vault.create.bind(vault) as unknown as
			(path: string, content: string) => Promise<unknown>;
		vault.create = async (path: string, content: string) => {
			if (path.endsWith("export-report.md")) {
				throw new Error("simulated report failure");
			}
			return create(path, content);
		};

		const result = await new ExportRunner(fixture.app)
			.run(singleFilePlan(fixture, "a/A.md", "A"), outcomeSettings());

		expect(result.status).toBe("completed");
		expect(result.success).toBe(true);
		expect(result.reportPath).toBeUndefined();
		expect(result.warnings).toContain("Could not write export report: simulated report failure");
		expect(fixture.text("exports/A.md")).toContain("# A");
	});

	it("an unresolved-link warning alone stays completed with a warning, not failed", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "Link to [[missing]]");

		const result = await new ExportRunner(fixture.app)
			.run(singleFilePlan(fixture, "a/A.md", "A"), outcomeSettings());

		expect(result.status).toBe("completed");
		expect(result.success).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.warnings).toContain("Unresolved link: missing");
		expect(result.reportPath).toBe("exports/export-report.md");
	});
});
