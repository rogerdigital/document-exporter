import { describe, expect, it } from "vitest";
import { exportResultMessage } from "@/ui/ExportResultMessage";
import type { ExportResult } from "@/export/ExportOutcome";

function result(overrides: Partial<ExportResult>): ExportResult {
	return {
		status: "completed",
		success: true,
		outputRoot: "exports/notes",
		totalFiles: 3,
		completedFiles: 3,
		completedPaths: [],
		incompletePaths: [],
		warnings: [],
		errors: [],
		...overrides,
	};
}

describe("exportResultMessage", () => {
	it("labels a completed run with counts and output root", () => {
		expect(exportResultMessage(result({})))
			.toBe("Export complete: 3/3 file(s) complete — exports/notes");
	});

	it("shows a warning for a completed run without a retry hint", () => {
		const message = exportResultMessage(result({
			warnings: ["Unresolved link: missing"],
			reportPath: "exports/notes/export-report.md",
		}));
		expect(message).toContain("Export complete: 3/3 file(s) complete");
		expect(message).toContain("Unresolved link: missing");
		expect(message).toContain("Details: exports/notes/export-report.md");
		expect(message).not.toContain("Existing output was kept");
	});

	it("describes a partial run with incomplete outputs, report and retry hint", () => {
		const message = exportResultMessage(result({
			status: "partial",
			success: false,
			completedFiles: 1,
			incompletePaths: ["exports/notes/B.md"],
			errors: ["Failed to copy attachment: notes/img.png"],
			reportPath: "exports/notes/export-report-2.md",
		}));
		expect(message).toContain("Export partially complete: 1/3 file(s) complete");
		expect(message).toContain("1 output(s) may be incomplete");
		expect(message).toContain("Failed to copy attachment: notes/img.png");
		expect(message).toContain("Details: exports/notes/export-report-2.md");
		expect(message).toContain("Existing output was kept");
	});

	it("prefers the first error over warnings", () => {
		const message = exportResultMessage(result({
			status: "failed",
			success: false,
			completedFiles: 0,
			errors: ["Export failed for a.md: boom"],
			warnings: ["earlier warning"],
		}));
		expect(message).toContain("Export failed: 0/3 file(s) complete");
		expect(message).toContain("Export failed for a.md: boom");
		expect(message).not.toContain("earlier warning");
	});

	it("reports the all-zero cancelled case without claiming failure", () => {
		const message = exportResultMessage(result({
			status: "cancelled",
			success: false,
			completedFiles: 0,
		}));
		expect(message).toContain("Export cancelled: 0/3 file(s) complete");
		expect(message.startsWith("Export complete")).toBe(false);
		expect(message.startsWith("Export failed")).toBe(false);
	});

	it("keeps cancelled runs distinguishable from complete and failed runs", () => {
		const cancelled = exportResultMessage(result({
			status: "cancelled",
			success: false,
			completedFiles: 1,
			completedPaths: ["exports/notes/a.md"],
			warnings: ["Export was cancelled. 1 of 3 file(s) exported."],
		}));
		expect(cancelled).toContain("Export cancelled: 1/3 file(s) complete");
		expect(cancelled.startsWith("Export complete")).toBe(false);
		expect(cancelled.startsWith("Export failed")).toBe(false);
		expect(cancelled).toContain("Existing output was kept");
	});
});
