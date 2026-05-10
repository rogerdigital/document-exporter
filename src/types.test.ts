import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/types";

describe("DEFAULT_SETTINGS", () => {
	it("has markdown-bundle as default profile", () => {
		expect(DEFAULT_SETTINGS.defaultProfile).toBe("markdown-bundle");
	});

	it("has path sort as default", () => {
		expect(DEFAULT_SETTINGS.defaultSort.mode).toBe("path");
		expect(DEFAULT_SETTINGS.defaultSort.direction).toBe("asc");
	});

	it("has copyAttachments enabled by default", () => {
		expect(DEFAULT_SETTINGS.copyAttachments).toBe(true);
	});
});
