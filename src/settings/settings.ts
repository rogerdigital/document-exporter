import { ExportSettings, ExportProfileId, DEFAULT_SETTINGS } from "@/types";
import { Plugin } from "obsidian";

const VALID_PROFILES: Set<string> = new Set<ExportProfileId>(["markdown-bundle", "html-document", "pdf", "docx"]);

export async function loadSettings(
	plugin: Plugin,
): Promise<ExportSettings> {
	const data = Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData() as Partial<ExportSettings>);
	if (!VALID_PROFILES.has(data.defaultProfile)) {
		data.defaultProfile = DEFAULT_SETTINGS.defaultProfile;
	}
	return data;
}

export async function saveSettings(
	plugin: Plugin,
	settings: ExportSettings,
): Promise<void> {
	await plugin.saveData(settings);
}
