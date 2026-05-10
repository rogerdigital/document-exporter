import { ExportSettings, DEFAULT_SETTINGS } from "@/types";
import { Plugin } from "obsidian";

export async function loadSettings(
	plugin: Plugin,
): Promise<ExportSettings> {
	const loaded = await plugin.loadData();
	return Object.assign({}, DEFAULT_SETTINGS, loaded);
}

export async function saveSettings(
	plugin: Plugin,
	settings: ExportSettings,
): Promise<void> {
	await plugin.saveData(settings);
}
