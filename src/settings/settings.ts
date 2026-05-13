import { ExportSettings, DEFAULT_SETTINGS } from "@/types";
import { Plugin } from "obsidian";

export async function loadSettings(
	plugin: Plugin,
): Promise<ExportSettings> {
	return Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData() as Partial<ExportSettings>);
}

export async function saveSettings(
	plugin: Plugin,
	settings: ExportSettings,
): Promise<void> {
	await plugin.saveData(settings);
}
