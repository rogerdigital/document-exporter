import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { DEFAULT_SETTINGS, ExportSettings } from "@/types";

function makePlugin(settings: ExportSettings = { ...DEFAULT_SETTINGS }) {
	return {
		settings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
	};
}

function makeTab(plugin = makePlugin()) {
	return new DocumentExporterSettingTab({} as never, plugin as never);
}

afterEach(() => {
	Platform.isDesktopApp = true;
});

describe("DocumentExporterSettingTab#getSettingDefinitions", () => {
	it("declares the output folder as a text control", () => {
		const defs = makeTab().getSettingDefinitions();
		const first = defs[0] as {
			name: string;
			control: { type: string; key: string; placeholder?: string };
		};
		expect(first.name).toBe("Output folder");
		expect(first.control.type).toBe("text");
		expect(first.control.key).toBe("defaultOutputFolder");
		expect(first.control.placeholder).toBe("Exports");
	});

	it("declares the default format as a dropdown with all desktop profiles", () => {
		const defs = makeTab().getSettingDefinitions();
		const dropdown = defs[1] as {
			control: { type: string; key: string; options: Record<string, string> };
		};
		expect(dropdown.control.type).toBe("dropdown");
		expect(dropdown.control.key).toBe("defaultProfile");
		expect(Object.keys(dropdown.control.options).sort()).toEqual(
			["docx", "html-document", "markdown-bundle", "pdf"],
		);
	});

	it("omits PDF from the dropdown on mobile", () => {
		Platform.isDesktopApp = false;
		const defs = makeTab().getSettingDefinitions();
		const dropdown = defs[1] as { control: { options: Record<string, string> } };
		expect(Object.keys(dropdown.control.options).sort()).toEqual(
			["docx", "html-document", "markdown-bundle"],
		);
	});

	it("groups the three advanced toggles under one heading", () => {
		const defs = makeTab().getSettingDefinitions();
		const expandEmbeds = defs[2] as { control: { type: string; key: string } };
		expect(expandEmbeds.control.type).toBe("toggle");
		expect(expandEmbeds.control.key).toBe("expandEmbeds");
		const group = defs[3] as {
			type: string;
			heading: string;
			items: { control: { type: string; key: string; defaultValue: boolean } }[];
		};
		expect(group.type).toBe("group");
		expect(group.heading).toBe("Advanced");
		expect(group.items.map((i) => i.control.key)).toEqual([
			"includeSourcePathComments",
			"copyAttachments",
			"overwriteExisting",
		]);
		expect(group.items.every((i) => i.control.type === "toggle")).toBe(true);
	});

	it("adds search aliases to every setting", () => {
		const defs = makeTab().getSettingDefinitions();
		const flat = [
			defs[0],
			defs[1],
			defs[2],
			...(defs[3] as { items: unknown[] }).items,
		] as { aliases?: string[] }[];
		expect(flat.every((d) => Array.isArray(d.aliases) && d.aliases.length > 0)).toBe(true);
	});
});

describe("DocumentExporterSettingTab control value bridge", () => {
	it("reads values from plugin settings", () => {
		const plugin = makePlugin({ ...DEFAULT_SETTINGS, overwriteExisting: true });
		const tab = makeTab(plugin);
		expect(tab.getControlValue("overwriteExisting")).toBe(true);
	});

	it("normalizes an unsupported stored profile for mobile", () => {
		Platform.isDesktopApp = false;
		const plugin = makePlugin(); // defaultProfile is "pdf", not offered on mobile
		const tab = makeTab(plugin);
		expect(tab.getControlValue("defaultProfile")).toBe("markdown-bundle");
	});

	it("writes values and persists through saveSettings", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("copyAttachments", false);
		expect(plugin.settings.copyAttachments).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("rejects unsupported profile values", async () => {
		Platform.isDesktopApp = false;
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("defaultProfile", "pdf");
		expect(plugin.settings.defaultProfile).toBe(DEFAULT_SETTINGS.defaultProfile);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("ignores unknown keys", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("nope", 1);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
