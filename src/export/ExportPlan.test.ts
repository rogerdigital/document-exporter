import { describe, it, expect, vi } from "vitest";
import {
	validatePlan,
	summarizePlan,
	ExportPlanBuilder,
} from "@/export/ExportPlan";
import { ExportPlan, ExportSort, ExportSource } from "@/types";

function makePlan(overrides: Partial<ExportPlan> = {}): ExportPlan {
	return {
		profile: "markdown-bundle",
		source: { type: "current-file", path: "note.md" },
		inputFiles: ["note.md"],
		outputRoot: "exports",
		outputFilename: "document",
		outputFiles: ["exports/document.md"],
		attachmentCopies: [],
		sort: { mode: "path", direction: "asc" },
		...overrides,
	};
}

describe("validatePlan", () => {
	it("returns error for empty inputFiles", () => {
		const plan = makePlan({ inputFiles: [] });
		const result = validatePlan(plan);
		expect(result).toBe("No files to export. Check your source selection.");
	});

	it("returns error for empty outputRoot", () => {
		const plan = makePlan({ outputRoot: "" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot be empty.");
	});

	it("returns error for whitespace-only outputRoot", () => {
		const plan = makePlan({ outputRoot: "   " });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot be empty.");
	});

	it("allows absolute outputRoot paths (external)", () => {
		const plan = makePlan({ outputRoot: "/absolute/path" });
		const result = validatePlan(plan);
		expect(result).toBeNull();
	});

	it("returns error for outputRoot starting with ..", () => {
		const plan = makePlan({ outputRoot: "../escape" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot use parent directory traversal.");
	});

	it("returns error for .. embedded in middle of path", () => {
		const plan = makePlan({ outputRoot: "foo/../../../etc" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot use parent directory traversal.");
	});

	it("returns error for single dot segment in path", () => {
		const plan = makePlan({ outputRoot: "foo/./bar" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot use parent directory traversal.");
	});

	it("allows dots within folder names", () => {
		const plan = makePlan({ outputRoot: "my.exports/v1.0" });
		const result = validatePlan(plan);
		expect(result).toBeNull();
	});

	it("returns null for valid plan", () => {
		const plan = makePlan();
		const result = validatePlan(plan);
		expect(result).toBeNull();
	});
});

describe("summarizePlan", () => {
	it("includes file count, profile, and output root", () => {
		const plan = makePlan({
			inputFiles: ["a.md", "b.md", "c.md"],
			profile: "html-document",
			outputRoot: "my-exports",
		});
		const summary = summarizePlan(plan);

		expect(summary).toContain("Files: 3");
		expect(summary).toContain("Format: html-document");
		expect(summary).toContain("Output: my-exports");
	});
});

describe("ExportPlanBuilder", () => {
	const mockApp = {
		metadataCache: {
			getFirstLinkpathDest: vi.fn(),
		},
	} as never;

	const defaultSource: ExportSource = { type: "current-file", path: "note.md" };
	const defaultSort: ExportSort = { mode: "path", direction: "asc" };

	it("produces correct outputFiles for markdown-bundle profile", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"markdown-bundle",
			"exports",
			defaultSort,
			"document",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.profile).toBe("markdown-bundle");
		expect(plan.outputFiles).toEqual(["exports/document.md"]);
	});

	it("produces correct outputFiles for html-document profile", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"html-document",
			"output",
			defaultSort,
			"index",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.profile).toBe("html-document");
		expect(plan.outputFiles).toEqual(["output/index.html"]);
	});

	it("produces correct outputFiles for print-html profile", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"print-html",
			"output",
			defaultSort,
			"index",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.profile).toBe("print-html");
		expect(plan.outputFiles).toEqual(["output/index.html"]);
	});

	it("passes through all builder fields", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"markdown-bundle",
			"exports",
			defaultSort,
			"document",
		)
			.setInputFiles(["a.md", "b.md"])
			.build();

		expect(plan.source).toBe(defaultSource);
		expect(plan.inputFiles).toEqual(["a.md", "b.md"]);
		expect(plan.outputRoot).toBe("exports");
		expect(plan.outputFilename).toBe("document");
		expect(plan.sort).toBe(defaultSort);
		expect(plan.attachmentCopies).toEqual([]);
	});

	it("strips extension from custom filename", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"markdown-bundle",
			"exports",
			defaultSort,
			"my-note.md",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.outputFiles).toEqual(["exports/my-note.md"]);
	});
});
