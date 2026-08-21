import { PluginSettingTab, App, Platform, Setting, debounce } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { ExportProfileId, DEFAULT_SETTINGS } from "@/types";
import {
	getAvailableProfiles,
	resolveSupportedProfile,
} from "@/export/ProfileCapabilities";
import type DocumentExporterPlugin from "@/main";

const PROFILE_LABELS: Record<ExportProfileId, string> = {
	pdf: "PDF",
	docx: "Word document",
	"markdown-bundle": "Markdown bundle",
	"html-document": "HTML document",
};

// Single source of truth for setting text. display() renders it for
// Obsidian < 1.13; getSettingDefinitions() exposes it to settings search.
const SETTING_META = {
	defaultOutputFolder: {
		name: "Output folder",
		desc: "Exported files will be saved here (relative to vault root). You can change this path to any folder in your vault.",
		aliases: ["directory", "destination", "save location", "export path"],
	},
	defaultProfile: {
		name: "Default export format",
		desc: "Choose the default format when opening the export dialog.",
		aliases: ["pdf", "word", "docx", "html", "markdown", "file type"],
	},
	expandEmbeds: {
		name: "Expand note embeds",
		desc: "Inline ![[Note]] embeds into the exported document instead of keeping them as links.",
		aliases: ["transclusion", "include notes", "inline"],
	},
	includeSourcePathComments: {
		name: "Include source path comments",
		desc: "Add HTML comments showing the source path of each section.",
		aliases: ["origin", "provenance"],
	},
	copyAttachments: {
		name: "Copy attachments",
		desc: "Copy referenced images and files into the export bundle.",
		aliases: ["images", "assets", "media"],
	},
	overwriteExisting: {
		name: "Overwrite existing exports",
		desc: "Overwrite if the output folder already exists. Otherwise a timestamped folder is created.",
		aliases: ["replace", "timestamped folder"],
	},
} as const;

export class DocumentExporterSettingTab extends PluginSettingTab {
	plugin: DocumentExporterPlugin;

	constructor(app: App, plugin: DocumentExporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const formatOptions: Record<string, string> = {};
		for (const profile of getAvailableProfiles(Platform.isDesktopApp)) {
			formatOptions[profile] = PROFILE_LABELS[profile];
		}

		return [
			{
				name: SETTING_META.defaultOutputFolder.name,
				desc: SETTING_META.defaultOutputFolder.desc,
				aliases: [...SETTING_META.defaultOutputFolder.aliases],
				control: {
					type: "text",
					key: "defaultOutputFolder",
					defaultValue: DEFAULT_SETTINGS.defaultOutputFolder,
					placeholder: "Exports",
				},
			},
			{
				name: SETTING_META.defaultProfile.name,
				desc: SETTING_META.defaultProfile.desc,
				aliases: [...SETTING_META.defaultProfile.aliases],
				control: {
					type: "dropdown",
					key: "defaultProfile",
					defaultValue: DEFAULT_SETTINGS.defaultProfile,
					options: formatOptions,
				},
			},
			{
				name: SETTING_META.expandEmbeds.name,
				desc: SETTING_META.expandEmbeds.desc,
				aliases: [...SETTING_META.expandEmbeds.aliases],
				control: {
					type: "toggle",
					key: "expandEmbeds",
					defaultValue: DEFAULT_SETTINGS.expandEmbeds,
				},
			},
			{
				type: "group",
				heading: "Advanced",
				items: [
					{
						name: SETTING_META.includeSourcePathComments.name,
						desc: SETTING_META.includeSourcePathComments.desc,
						aliases: [...SETTING_META.includeSourcePathComments.aliases],
						control: {
							type: "toggle",
							key: "includeSourcePathComments",
							defaultValue: DEFAULT_SETTINGS.includeSourcePathComments,
						},
					},
					{
						name: SETTING_META.copyAttachments.name,
						desc: SETTING_META.copyAttachments.desc,
						aliases: [...SETTING_META.copyAttachments.aliases],
						control: {
							type: "toggle",
							key: "copyAttachments",
							defaultValue: DEFAULT_SETTINGS.copyAttachments,
						},
					},
					{
						name: SETTING_META.overwriteExisting.name,
						desc: SETTING_META.overwriteExisting.desc,
						aliases: [...SETTING_META.overwriteExisting.aliases],
						control: {
							type: "toggle",
							key: "overwriteExisting",
							defaultValue: DEFAULT_SETTINGS.overwriteExisting,
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === "defaultProfile") {
			// The stored value may be "pdf" while the mobile dropdown omits it;
			// surface the same fallback the legacy display() shows.
			return resolveSupportedProfile(
				this.plugin.settings.defaultProfile,
				Platform.isDesktopApp,
			);
		}
		return (this.plugin.settings as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!(key in SETTING_META)) return;
		if (key === "defaultProfile") {
			const allowed = getAvailableProfiles(Platform.isDesktopApp);
			if (typeof value !== "string" || !allowed.includes(value as ExportProfileId)) {
				return;
			}
		}
		(this.plugin.settings as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const debouncedSaveOutputFolder = debounce(async (v: string) => {
			this.plugin.settings.defaultOutputFolder = v;
			await this.plugin.saveSettings();
		}, 500, true);

		// Output folder — most important setting, shown first
		new Setting(containerEl)
			.setName(SETTING_META.defaultOutputFolder.name)
			.setDesc(SETTING_META.defaultOutputFolder.desc)
			.addText((text) => {
				text.setPlaceholder("Exports");
				text.setValue(this.plugin.settings.defaultOutputFolder);
				text.onChange((v) => {
					debouncedSaveOutputFolder(v);
				});
			});

		new Setting(containerEl)
			.setName(SETTING_META.defaultProfile.name)
			.setDesc(SETTING_META.defaultProfile.desc)
			.addDropdown((dd) => {
				for (const profile of getAvailableProfiles(Platform.isDesktopApp)) {
					dd.addOption(profile, PROFILE_LABELS[profile]);
				}
				dd.setValue(resolveSupportedProfile(
					this.plugin.settings.defaultProfile,
					Platform.isDesktopApp,
				));
				dd.onChange(async (v) => {
					this.plugin.settings.defaultProfile = v as ExportProfileId;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(SETTING_META.expandEmbeds.name)
			.setDesc(SETTING_META.expandEmbeds.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.expandEmbeds);
				toggle.onChange(async (v) => {
					this.plugin.settings.expandEmbeds = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName(SETTING_META.includeSourcePathComments.name)
			.setDesc(SETTING_META.includeSourcePathComments.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.includeSourcePathComments);
				toggle.onChange(async (v) => {
					this.plugin.settings.includeSourcePathComments = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(SETTING_META.copyAttachments.name)
			.setDesc(SETTING_META.copyAttachments.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.copyAttachments);
				toggle.onChange(async (v) => {
					this.plugin.settings.copyAttachments = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(SETTING_META.overwriteExisting.name)
			.setDesc(SETTING_META.overwriteExisting.desc)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.overwriteExisting);
				toggle.onChange(async (v) => {
					this.plugin.settings.overwriteExisting = v;
					await this.plugin.saveSettings();
				});
			});
	}
}
