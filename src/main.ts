import { Plugin, TFile, TFolder, Menu } from "obsidian";
import { ExportSettings } from "@/types";
import { loadSettings, saveSettings } from "@/settings/settings";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { ExportModal, ExportModalResult } from "@/ui/ExportModal";
import { ExportSourceResolver } from "@/export/ExportSourceResolver";
import { ExportPlanBuilder, validatePlan } from "@/export/ExportPlan";
import { ExportRunner } from "@/export/ExportRunner";
import { ProgressNotice } from "@/ui/ProgressNotice";

export default class DocumentExporterPlugin extends Plugin {
	settings!: ExportSettings;

	async onload() {
		this.settings = await loadSettings(this);

		// Ribbon icon
		this.addRibbonIcon("file-output", "Export documents", () => {
			this.openExportModal();
		});

		// Command palette
		this.addCommand({
			id: "export-documents",
			name: "Export documents",
			callback: () => this.openExportModal(),
		});

		// File explorer context menu — right-click on file
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item) => {
						item.setTitle("Export this file")
							.setIcon("file-output")
							.onClick(() => this.openExportModal(file, undefined));
					});
				}
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle("Export this folder")
							.setIcon("file-output")
							.onClick(() => this.openExportModal(undefined, file));
					});
				}
			}),
		);

		// Editor context menu — right-click in editor
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu) => {
				menu.addItem((item) => {
					item.setTitle("Export current file")
						.setIcon("file-output")
						.onClick(() => this.openExportModal());
				});
			}),
		);

		this.addSettingTab(new DocumentExporterSettingTab(this.app, this));
	}

	onunload() {}

	async saveSettings() {
		await saveSettings(this, this.settings);
	}

	private openExportModal(preselectedFile?: TFile, preselectedFolder?: TFolder) {
		const modal = new ExportModal(this.app, this.settings, preselectedFile, preselectedFolder);
		void modal.openForResult().then((result) => {
			if (result) void this.executeExport(result);
		});
	}

	private async executeExport(result: ExportModalResult) {
		const progress = new ProgressNotice("Preparing export...");

		try {
			const resolver = new ExportSourceResolver(this.app);
			const files = resolver.resolve(result.source, result.sort);
			progress.start(files.length);

			const plan = new ExportPlanBuilder(
				this.app,
				result.source,
				result.profile,
				result.outputFolder,
				result.sort,
				result.outputFilename,
			)
				.setInputFiles(files.map((f) => f.path))
				.build();

			const error = validatePlan(plan);
			if (error) {
				progress.finish(`Export failed: ${error}`);
				return;
			}

			const runner = new ExportRunner(this.app);
			const exportResult = await runner.run(plan, this.settings);

			if (exportResult.success) {
				const msg = exportResult.warnings.length > 0
					? `Export complete with ${exportResult.warnings.length} warning(s): ${exportResult.outputRoot}`
					: `Export complete: ${exportResult.outputRoot}`;
				progress.finish(msg);
			} else {
				progress.finish(`Export failed: ${exportResult.warnings.join(", ")}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			progress.finish(`Export error: ${message}`);
		}
	}
}
