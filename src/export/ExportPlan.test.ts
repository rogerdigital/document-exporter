import { describe, it, expect, vi } from "vitest";
import {
	validatePlan,
	summarizePlan,
	ExportPlanBuilder,
	relocatePlan,
} from "@/export/ExportPlan";
import { ExportPlan, ExportSource } from "@/types";

function makePlan(overrides: Partial<ExportPlan> = {}): ExportPlan {
	return {
		profile: "markdown-bundle",
		source: { type: "current-file", path: "note.md" },
		inputFiles: ["note.md"],
		outputRoot: "exports",
		outputFilename: "document",
		outputFiles: ["exports/document.md"],
		attachmentCopies: [],
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

	it.each([
		"../outside",
		"nested/name",
		"nested\\name",
		".",
		"..",
		"bad:name",
		"bad\u0000name",
		"trailing.",
		"trailing ",
		"CON",
		"con.txt",
		"NUL",
		"COM1",
		"LPT9.log",
	])("rejects unsafe output filename %j", (outputFilename) => {
		const result = validatePlan(makePlan({ outputFilename }));
		expect(result).toMatch(/file name/i);
	});

	it.each(["../outside", "nested/name", "nested\\name", ".", ".."])(
		"rejects unsafe batch folder name %j",
		(outputFolderName) => {
			const result = validatePlan(makePlan({
				source: { type: "folder", path: "notes", recursive: true },
				outputFolderName,
			}));
			expect(result).toMatch(/folder name/i);
		},
	);
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

	it("produces correct outputFiles for markdown-bundle profile", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"markdown-bundle",
			"exports",
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
			"index",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.profile).toBe("html-document");
		expect(plan.outputFiles).toEqual(["output/index.html"]);
	});

	it("produces correct outputFiles for pdf profile", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"pdf",
			"output",
			"index",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.profile).toBe("pdf");
		expect(plan.outputFiles).toEqual(["output/index.pdf"]);
	});

	it("produces correct outputFiles for docx profile", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"docx",
			"output",
			"index",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.profile).toBe("docx");
		expect(plan.outputFiles).toEqual(["output/index.docx"]);
	});

	it("passes through all builder fields", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"markdown-bundle",
			"exports",
			"document",
		)
			.setInputFiles(["a.md", "b.md"])
			.build();

		expect(plan.source).toBe(defaultSource);
		expect(plan.inputFiles).toEqual(["a.md", "b.md"]);
		expect(plan.outputRoot).toBe("exports");
		expect(plan.outputFilename).toBe("document");
		expect(plan.attachmentCopies).toEqual([]);
	});

	it("strips extension from custom filename", () => {
		const plan = new ExportPlanBuilder(
			mockApp,
			defaultSource,
			"markdown-bundle",
			"exports",
			"my-note.md",
		)
			.setInputFiles(["note.md"])
			.build();

		expect(plan.outputFiles).toEqual(["exports/my-note.md"]);
	});
});

describe("relocatePlan", () => {
	it("recomputes a single output file from the new root", () => {
		const relocated = relocatePlan(makePlan(), "exports-2026-07-29");

		expect(relocated.outputRoot).toBe("exports-2026-07-29");
		expect(relocated.outputFiles).toEqual(["exports-2026-07-29/document.md"]);
	});

	it("recomputes batch output files from the new leaf folder", () => {
		const plan = makePlan({
			source: { type: "folder", path: "notes", recursive: true },
			inputFiles: ["notes/a.md", "notes/nested/b.md"],
			outputFolderName: "notes",
			outputFiles: ["exports/notes/a.md", "exports/notes/nested/b.md"],
		});

		const relocated = relocatePlan(plan, "exports", "notes-2026-07-29");

		expect(relocated.outputFiles).toEqual([
			"exports/notes-2026-07-29/a.md",
			"exports/notes-2026-07-29/nested/b.md",
		]);
	});
});
