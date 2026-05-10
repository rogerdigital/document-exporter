import { PluginSettingTab, App, Setting } from "obsidian";
import { ExportSettings, ExportProfileId, ExportSort } from "@/types";
import type DocumentExporterPlugin from "@/main";

const PROFILE_LABELS: Record<ExportProfileId, string> = {
	"markdown-bundle": "Markdown Bundle",
	"html-document": "HTML Document",
	"print-html": "Print-ready HTML",
};

const SORT_MODES: Record<ExportSort["mode"], string> = {
	path: "File path",
	name: "File name",
	frontmatter: "Frontmatter field",
};

export class DocumentExporterSettingTab extends PluginSettingTab {
	plugin: DocumentExporterPlugin;

	constructor(app: App, plugin: DocumentExporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default export profile")
			.setDesc("Choose the default format for exports.")
			.addDropdown((dd) => {
				dd.addOptions(PROFILE_LABELS);
				dd.setValue(this.plugin.settings.defaultProfile);
				dd.onChange(async (v) => {
					this.plugin.settings.defaultProfile = v as ExportProfileId;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Default output folder")
			.setDesc("Folder name for exported documents (relative to vault root).")
			.addText((text) => {
				text.setPlaceholder("exports");
				text.setValue(this.plugin.settings.defaultOutputFolder);
				text.onChange(async (v) => {
					this.plugin.settings.defaultOutputFolder = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Default sort mode")
			.setDesc("How notes are ordered in the exported document.")
			.addDropdown((dd) => {
				dd.addOptions(SORT_MODES);
				dd.setValue(this.plugin.settings.defaultSort.mode);
				dd.onChange(async (v) => {
					this.plugin.settings.defaultSort.mode = v as ExportSort["mode"];
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Include source path comments")
			.setDesc("Add HTML comments showing the source path of each section.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.includeSourcePathComments);
				toggle.onChange(async (v) => {
					this.plugin.settings.includeSourcePathComments = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Copy attachments")
			.setDesc("Copy referenced images and files into the export bundle.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.copyAttachments);
				toggle.onChange(async (v) => {
					this.plugin.settings.copyAttachments = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Overwrite existing exports")
			.setDesc("Overwrite if the output folder already exists. Otherwise a timestamped folder is created.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.overwriteExisting);
				toggle.onChange(async (v) => {
					this.plugin.settings.overwriteExisting = v;
					await this.plugin.saveSettings();
				});
			});
	}
}
