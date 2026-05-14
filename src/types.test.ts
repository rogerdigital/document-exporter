import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/types";

describe("DEFAULT_SETTINGS", () => {
	it("has PDF as default profile", () => {
		expect(DEFAULT_SETTINGS.defaultProfile).toBe("pdf");
	});

	it("has copyAttachments enabled by default", () => {
		expect(DEFAULT_SETTINGS.copyAttachments).toBe(true);
	});
});
