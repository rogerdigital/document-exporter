import { Plugin, TFile, TFolder, Menu, MenuItem } from "obsidian";
import { ExportSettings } from "@/types";
import { loadSettings, saveSettings } from "@/settings/settings";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { ExportModal, ExportModalResult } from "@/ui/ExportModal";
import { ExportSourceResolver } from "@/export/ExportSourceResolver";
import { ExportPlanBuilder, validatePlan } from "@/export/ExportPlan";
import { ExportRunner, ExportProgressCallbacks, SINGLE_FILE_PHASES } from "@/export/ExportRunner";
import { ProgressNotice } from "@/ui/ProgressNotice";

type NotebookNavigatorMenus = {
	registerFileMenu?: (callback: (context: NotebookNavigatorFileContext) => void) => () => void;
	registerFolderMenu?: (callback: (context: NotebookNavigatorFolderContext) => void) => () => void;
};

type NotebookNavigatorFileContext = {
	selection?: { mode?: string };
	file?: unknown;
	addItem: (callback: (item: MenuItem) => void) => void;
};

type NotebookNavigatorFolderContext = {
	folder?: unknown;
	addItem: (callback: (item: MenuItem) => void) => void;
};

type AppWithPluginRegistry = typeof Plugin.prototype.app & {
	plugins?: {
		plugins?: Record<string, unknown>;
	};
};

function isNotebookNavigatorMenus(value: unknown): value is NotebookNavigatorMenus {
	if (!value || typeof value !== "object") return false;
	const menus = value as NotebookNavigatorMenus;
	return (
		(typeof menus.registerFileMenu === "function" || typeof menus.registerFileMenu === "undefined")
		&& (typeof menus.registerFolderMenu === "function" || typeof menus.registerFolderMenu === "undefined")
	);
}

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

		// Notebook Navigator context menu integration
		this.registerNotebookNavigatorMenus();

		this.addSettingTab(new DocumentExporterSettingTab(this.app, this));
	}

	onunload() {}

	private registerNotebookNavigatorMenus() {
		const nnMenus = this.getNotebookNavigatorMenus();
		if (!nnMenus) return;

		if (typeof nnMenus.registerFileMenu === "function") {
			const dispose = nnMenus.registerFileMenu((context) => {
				if (context.selection?.mode !== "single") return;
				const file = context.file;
				if (!(file instanceof TFile) || file.extension !== "md") return;
				context.addItem((item) => {
					item.setTitle("Export this file")
						.setIcon("file-output")
						.onClick(() => this.openExportModal(file, undefined));
				});
			});
			this.register(() => dispose());
		}

		if (typeof nnMenus.registerFolderMenu === "function") {
			const dispose = nnMenus.registerFolderMenu((context) => {
				const folder = context.folder;
				if (!(folder instanceof TFolder)) return;
				context.addItem((item) => {
					item.setTitle("Export this folder")
						.setIcon("file-output")
						.onClick(() => this.openExportModal(undefined, folder));
				});
			});
			this.register(() => dispose());
		}
	}

	private getNotebookNavigatorMenus(): NotebookNavigatorMenus | null {
		const app = this.app as AppWithPluginRegistry;
		const registry = app.plugins?.plugins;
		if (!registry) return null;

		const notebookNavigator = registry["notebook-navigator"];
		if (!notebookNavigator || typeof notebookNavigator !== "object") return null;

		const api = (notebookNavigator as { api?: unknown }).api;
		if (!api || typeof api !== "object") return null;

		const menus = (api as { menus?: unknown }).menus;
		if (!isNotebookNavigatorMenus(menus)) return null;

		return menus;
	}

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
		const title = this.buildProgressTitle(result);
		const progress = new ProgressNotice(title);

		try {
			const resolver = new ExportSourceResolver(this.app);
			const files = resolver.resolve(result.source);

			const plan = new ExportPlanBuilder(
				this.app,
				result.source,
				result.profile,
				result.outputFolder,
				result.outputFilename,
				result.outputFolderName,
			)
				.setInputFiles(files.map((f) => f.path))
				.build();

			const error = validatePlan(plan);
			if (error) {
				progress.finish(`Export failed: ${error}`);
				return;
			}

			const runner = new ExportRunner(this.app);
			const isSingleFile = files.length === 1;
			let singleFileStep = 0;

			const callbacks: ExportProgressCallbacks = {
				onFileStart: () => {
					if (isSingleFile) {
						singleFileStep = 0;
					}
				},
				onFileComplete: (i, total) => {
					if (isSingleFile) return;
					progress.setProgress(i + 1, total);
				},
				onPhase: (phase) => {
					progress.setPhase(phase);
					if (isSingleFile) {
						singleFileStep++;
						progress.setProgress(singleFileStep, SINGLE_FILE_PHASES.length);
					}
				},
			};

			progress.onCancel = () => {
				runner.cancel();
			};

			if (isSingleFile) {
				progress.start(SINGLE_FILE_PHASES.length);
			} else {
				progress.start(files.length);
			}

			const exportResult = await runner.run(plan, this.settings, callbacks);

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

	private buildProgressTitle(result: ExportModalResult): string {
		switch (result.source.type) {
			case "current-file": {
				const name = result.source.path.split("/").pop()?.replace(/\.md$/, "") ?? "file";
				return `Exporting: ${name}`;
			}
			case "folder": {
				const name = result.source.path.split("/").pop() ?? "folder";
				return `Exporting folder: ${name}`;
			}
			case "files":
				return `Exporting ${result.source.paths.length} files`;
		}
	}
}
