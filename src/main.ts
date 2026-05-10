import { Plugin, Notice } from "obsidian";
import { ExportSettings } from "@/types";
import { loadSettings, saveSettings } from "@/settings/settings";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { ExportModal, ExportModalResult } from "@/ui/ExportModal";

export default class DocumentExporterPlugin extends Plugin {
	settings!: ExportSettings;

	async onload() {
		this.settings = await loadSettings(this);

		this.addCommand({
			id: "export-documents",
			name: "Export documents",
			callback: () => this.openExportModal(),
		});

		this.addSettingTab(new DocumentExporterSettingTab(this.app, this));
	}

	onunload() {}

	async saveSettings() {
		await saveSettings(this, this.settings);
	}

	private async openExportModal() {
		const modal = new ExportModal(this.app, this.settings);
		const result = await modal.openForResult();
		if (!result) return;

		new Notice(
			`Export starting: ${result.profile} from ${result.source.type}`,
		);
	}
}
