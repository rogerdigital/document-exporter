import { Plugin, Notice } from "obsidian";
import { ExportSettings } from "@/types";
import { loadSettings, saveSettings } from "@/settings/settings";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { ExportModal } from "@/ui/ExportModal";
import { ExportModalResult } from "@/ui/ExportModal";
import { ExportSourceResolver } from "@/export/ExportSourceResolver";
import { ExportPlanBuilder, validatePlan, summarizePlan } from "@/export/ExportPlan";
import { ExportRunner } from "@/export/ExportRunner";
import { ProgressNotice } from "@/ui/ProgressNotice";

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

		await this.executeExport(result);
	}

	private async executeExport(result: ExportModalResult) {
		const progress = new ProgressNotice("Preparing export...");
		progress.start(4);

		try {
			// Step 1: Resolve source files
			const resolver = new ExportSourceResolver(this.app);
			const files = await resolver.resolve(result.source, result.sort);
			progress.increment();

			// Step 2: Build plan
			const plan = new ExportPlanBuilder(
				this.app,
				result.source,
				result.profile,
				result.outputFolder,
				result.sort,
			)
				.setInputFiles(files.map((f) => f.path))
				.build();

			const error = validatePlan(plan);
			if (error) {
				progress.finish(`Export failed: ${error}`);
				return;
			}
			progress.increment();

			// Step 3: Run export
			const runner = new ExportRunner(this.app);
			const exportResult = await runner.run(
				plan,
				this.settings,
			);
			progress.increment();

			if (exportResult.success) {
				const msg = exportResult.warnings.length > 0
					? `Export complete with ${exportResult.warnings.length} warning(s): ${exportResult.outputRoot}`
					: `Export complete: ${exportResult.outputRoot}`;
				progress.finish(msg);
			} else {
				progress.finish(
					`Export failed: ${exportResult.warnings.join(", ")}`,
				);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			progress.finish(`Export error: ${message}`);
		}
	}
}
