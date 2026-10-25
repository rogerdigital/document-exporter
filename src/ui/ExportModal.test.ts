import { describe, expect, it, vi } from "vitest";
import { defaultMergeFilename, deriveDefaultFilename } from "@/ui/ExportModal";

describe("deriveDefaultFilename", () => {
	it("prefers the context-menu file over the active editor file", () => {
		const activeFile = { path: "active.md", basename: "active", extension: "md" };
		const selectedFile = { path: "selected.md", basename: "selected", extension: "md" };
		const app = {
			workspace: { getActiveFile: vi.fn(() => activeFile) },
		};

		expect(deriveDefaultFilename(app as never, selectedFile as never)).toBe("selected");
	});
});

describe("defaultMergeFilename", () => {
	it("uses the folder leaf for folder sources", () => {
		expect(defaultMergeFilename("folder", "book/part-one")).toBe("part-one");
	});

	it("falls back to merged for the vault root", () => {
		expect(defaultMergeFilename("folder", "")).toBe("merged");
	});

	it("uses merged for selected-files sources", () => {
		expect(defaultMergeFilename("files", "")).toBe("merged");
	});
});
