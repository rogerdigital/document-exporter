import { describe, expect, it, vi } from "vitest";
import { deriveDefaultFilename } from "@/ui/ExportModal";

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
