import { describe, expect, it } from "vitest";
import {
	getAvailableProfiles,
	resolveSupportedProfile,
} from "@/export/ProfileCapabilities";

describe("profile capabilities", () => {
	it("removes PDF on mobile", () => {
		expect(getAvailableProfiles(false)).toEqual([
			"docx",
			"epub",
			"markdown-bundle",
			"html-document",
		]);
	});

	it("keeps PDF on desktop", () => {
		expect(getAvailableProfiles(true)).toContain("pdf");
	});

	it("falls back from a stored PDF default on mobile", () => {
		expect(resolveSupportedProfile("pdf", false)).toBe("markdown-bundle");
	});
});
