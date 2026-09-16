import { describe, expect, it, vi, afterEach } from "vitest";
import { ExportRunner } from "@/export/ExportRunner";
import { ExportPlanBuilder } from "@/export/ExportPlan";
import { OutputWriter } from "@/export/OutputWriter";
import { DEFAULT_SETTINGS, ExportSettings } from "@/types";
import { createMemoryVault } from "@/test-support/memory-vault";

// Real runner, collector, rewriter and writer with a persistent in-memory
// vault: writes survive across runs so cross-run corruption is observable.
// Only timestampSuffix is stubbed (for deterministic relocation paths); no
// write method is ever mocked here.
const TIMESTAMP = "2026-09-16T00-00-00";

function integritySettings(overrides: Partial<ExportSettings> = {}): ExportSettings {
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

afterEach(() => {
	vi.restoreAllMocks();
});

describe("export integrity", () => {
	it("preserves earlier attachments across sequential single-note exports", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "![[a/img.png]]");
		fixture.putText("b/B.md", "![[b/img.png]]");
		fixture.putBinary("a/img.png", new Uint8Array([1]));
		fixture.putBinary("b/img.png", new Uint8Array([2]));
		const settings = integritySettings();
		const run = (path: string, name: string) =>
			new ExportRunner(fixture.app).run(singleFilePlan(fixture, path, name), settings);
		const first = await run("a/A.md", "A");
		const original = fixture.text("exports/A.md");
		const second = await run("b/B.md", "B");
		expect(first.success).toBe(true);
		expect(second.success).toBe(true);
		expect(fixture.text("exports/A.md")).toBe(original);
		expect(Array.from(fixture.bytes("exports/assets/img.png"))).toEqual([1]);
		expect(second.outputRoot).not.toBe(first.outputRoot);
		expect(Array.from(fixture.bytes(`${second.outputRoot}/assets/img.png`))).toEqual([2]);
		expect(fixture.text(`${second.outputRoot}/B.md`)).toContain("assets/img.png");
	});

	it("relocates when the single-file output root is an existing empty directory", async () => {
		vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue(TIMESTAMP);
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "content");
		await fixture.app.vault.createFolder("exports");

		const result = await new ExportRunner(fixture.app)
			.run(singleFilePlan(fixture, "a/A.md", "A"), integritySettings());

		expect(result.success).toBe(true);
		expect(result.outputRoot).toBe(`exports-${TIMESTAMP}`);
		expect(fixture.text(`exports-${TIMESTAMP}/A.md`)).toContain("A");
		expect(fixture.paths()).not.toContain("exports/A.md");
	});

	it("relocates past occupied root and existing timestamp/suffix candidates without modifying them", async () => {
		vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue(TIMESTAMP);
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "content");
		fixture.putText("exports", "occupied file at root");
		fixture.putText(`exports-${TIMESTAMP}`, "taken");
		fixture.putText(`exports-${TIMESTAMP}-2`, "taken");

		const result = await new ExportRunner(fixture.app)
			.run(singleFilePlan(fixture, "a/A.md", "A"), integritySettings());

		expect(result.success).toBe(true);
		expect(result.outputRoot).toBe(`exports-${TIMESTAMP}-3`);
		expect(fixture.text(`exports-${TIMESTAMP}-3/A.md`)).toContain("A");
		expect(fixture.text("exports")).toBe("occupied file at root");
		expect(fixture.text(`exports-${TIMESTAMP}`)).toBe("taken");
		expect(fixture.text(`exports-${TIMESTAMP}-2`)).toBe("taken");
	});

	it("keeps primaries, links, assets and report on the relocated batch leaf", async () => {
		vi.spyOn(OutputWriter.prototype, "timestampSuffix").mockReturnValue(TIMESTAMP);
		const fixture = createMemoryVault();
		fixture.putText("notes/A.md", "![[notes/img.png]] See [[B]] and [[missing]]");
		fixture.putText("notes/B.md", "B content");
		fixture.putBinary("notes/img.png", new Uint8Array([7]));
		await fixture.app.vault.createFolder("exports/notes");

		const plan = new ExportPlanBuilder(
			fixture.app,
			{ type: "folder", path: "notes", recursive: true },
			"markdown-bundle", "exports", "index", "notes",
		).setInputFiles(["notes/A.md", "notes/B.md"]).build();
		const result = await new ExportRunner(fixture.app).run(plan, integritySettings());

		const leaf = `exports/notes-${TIMESTAMP}`;
		expect(result.success).toBe(true);
		expect(fixture.text(`${leaf}/A.md`)).toContain("[B](B.md)");
		expect(fixture.text(`${leaf}/A.md`)).toContain("assets/img.png");
		expect(fixture.text(`${leaf}/B.md`)).toContain("B content");
		expect(Array.from(fixture.bytes(`${leaf}/assets/img.png`))).toEqual([7]);
		expect(fixture.text(`${leaf}/export-report.md`)).toContain("Unresolved link: missing");
		expect(fixture.paths()).not.toContain("exports/notes/A.md");
	});

	it("keeps a primary named export-report.md and moves the report to a fresh name", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "Link to [[missing]]");

		const result = await new ExportRunner(fixture.app)
			.run(singleFilePlan(fixture, "a/A.md", "export-report"), integritySettings());

		expect(result.success).toBe(true);
		const primary = fixture.text("exports/export-report.md");
		expect(primary).toContain("# A");
		expect(primary).not.toContain("Unresolved link");
		expect(fixture.text("exports/export-report-2.md")).toContain("Unresolved link: missing");
	});

	it("skips an existing export-report-2.md when allocating the report", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "Link to [[missing]]");
		fixture.putText("exports/export-report-2.md", "previous report");

		const result = await new ExportRunner(fixture.app)
			.run(
				singleFilePlan(fixture, "a/A.md", "export-report"),
				integritySettings({ overwriteExisting: true }),
			);

		expect(result.success).toBe(true);
		expect(fixture.text("exports/export-report.md")).toContain("# A");
		expect(fixture.text("exports/export-report-2.md")).toBe("previous report");
		expect(fixture.text("exports/export-report-3.md")).toContain("Unresolved link: missing");
	});

	it("never overwrites a prior report even with overwrite enabled", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "Link to [[missing]]");
		fixture.putText("exports/export-report.md", "OLD REPORT");

		const result = await new ExportRunner(fixture.app)
			.run(
				singleFilePlan(fixture, "a/A.md", "A"),
				integritySettings({ overwriteExisting: true }),
			);

		expect(result.success).toBe(true);
		expect(fixture.text("exports/export-report.md")).toBe("OLD REPORT");
		expect(fixture.text("exports/export-report-2.md")).toContain("Unresolved link: missing");
	});

	it("refuses to modify a destination that appears after plan resolution", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "content");

		const result = await new ExportRunner(fixture.app).run(
			singleFilePlan(fixture, "a/A.md", "A"),
			integritySettings(),
			{
				onFileStart: () => {},
				onFileComplete: () => {},
				onPhase: (phase) => {
					if (phase === "Assembling document") {
						void fixture.app.vault.create("exports/A.md", "PRE-EXISTING");
					}
				},
			},
		);

		expect(result.success).toBe(false);
		expect(result.warnings[0]).toContain("Output already exists: exports/A.md");
		expect(fixture.text("exports/A.md")).toBe("PRE-EXISTING");
	});

	it("still overwrites primary and attachment output when overwrite is enabled", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "![[a/img.png]]");
		fixture.putBinary("a/img.png", new Uint8Array([1]));
		const settings = integritySettings({ overwriteExisting: true });
		const runner = new ExportRunner(fixture.app);

		await runner.run(singleFilePlan(fixture, "a/A.md", "A"), settings);
		expect(Array.from(fixture.bytes("exports/assets/img.png"))).toEqual([1]);

		fixture.remove("a/img.png");
		fixture.putBinary("a/img.png", new Uint8Array([9]));
		const second = await runner.run(singleFilePlan(fixture, "a/A.md", "A"), settings);

		expect(second.success).toBe(true);
		expect(second.outputRoot).toBe("exports");
		expect(Array.from(fixture.bytes("exports/assets/img.png"))).toEqual([9]);
	});

	it("surfaces a missing attachment as a failed copy warning", async () => {
		const fixture = createMemoryVault();
		fixture.putText("a/A.md", "![[a/img.png]]");
		fixture.putBinary("a/img.png", new Uint8Array([1]));

		const result = await new ExportRunner(fixture.app).run(
			singleFilePlan(fixture, "a/A.md", "A"),
			integritySettings(),
			{
				onFileStart: () => {},
				onFileComplete: () => {},
				onPhase: (phase) => {
					if (phase === "Copying attachments") {
						fixture.remove("a/img.png");
					}
				},
			},
		);

		expect(result.success).toBe(true);
		expect(result.warnings).toContain("Failed to copy attachment: a/img.png");
		expect(fixture.text("exports/export-report.md")).toContain("Failed to copy attachment");
	});
});
