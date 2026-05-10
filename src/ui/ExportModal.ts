import { App, Modal, TFile, FuzzySuggestModal } from "obsidian";
import { ExportProfileId, ExportSettings, ExportSource, ExportSort } from "@/types";

const PROFILE_OPTIONS: Record<ExportProfileId, string> = {
	"markdown-bundle": "Markdown Bundle",
	"html-document": "HTML Document",
	"print-html": "Print-ready HTML",
};

const SOURCE_OPTIONS = {
	"current-file": "Current file",
	folder: "Folder",
	files: "Selected files",
	filter: "Filter by tag",
} as const;

export type ExportModalResult = {
	source: ExportSource;
	profile: ExportProfileId;
	outputFolder: string;
	sort: ExportSort;
};

export class ExportModal extends Modal {
	private settings: ExportSettings;
	private resolve: ((result: ExportModalResult | null) => void) | null = null;
	private sourceType: string = "current-file";
	private folderPath = "";
	private selectedFilePaths: string[] = [];
	private filterTag = "";
	private profile: ExportProfileId;
	private outputFolder: string;
	private sort: ExportSort;

	constructor(app: App, settings: ExportSettings) {
		super(app);
		this.settings = settings;
		this.profile = settings.defaultProfile;
		this.outputFolder = settings.defaultOutputFolder;
		this.sort = { ...settings.defaultSort };
	}

	onOpen(): void {
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	openForResult(): Promise<ExportModalResult | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	private renderForm(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Export Documents" });

		// Source type
		const sourceRow = contentEl.createDiv({ cls: "export-modal-row" });
		sourceRow.createEl("label", { text: "Source" });
		const sourceSelect = sourceRow.createEl("select");
		for (const [value, label] of Object.entries(SOURCE_OPTIONS)) {
			const opt = sourceSelect.createEl("option", { text: label });
			opt.value = value;
		}
		sourceSelect.value = this.sourceType;

		const sourceFields = contentEl.createDiv({ cls: "export-modal-source-fields" });

		const renderSourceFields = () => {
			sourceFields.empty();
			if (this.sourceType === "folder") {
				const row = sourceFields.createDiv({ cls: "export-modal-row" });
				row.createEl("label", { text: "Folder path" });
				const input = row.createEl("input", { type: "text", attr: { placeholder: "notes/project" } });
				input.value = this.folderPath;
				input.addEventListener("input", (e) => {
					this.folderPath = (e.target as HTMLInputElement).value;
				});
			} else if (this.sourceType === "files") {
				const row = sourceFields.createDiv({ cls: "export-modal-row" });
				row.createEl("label", { text: "Selected files" });
				const count = this.selectedFilePaths.length;
				const btn = row.createEl("button", {
					text: count > 0 ? `${count} file(s) selected` : "Choose files",
				});
				btn.addEventListener("click", () => {
					const picker = new FilePickerModal(this.app, this.selectedFilePaths, (paths) => {
						this.selectedFilePaths = paths;
						btn.textContent = paths.length > 0 ? `${paths.length} file(s) selected` : "Choose files";
					});
					picker.open();
				});
			} else if (this.sourceType === "filter") {
				const row = sourceFields.createDiv({ cls: "export-modal-row" });
				row.createEl("label", { text: "Tag" });
				const input = row.createEl("input", { type: "text", attr: { placeholder: "project" } });
				input.value = this.filterTag;
				input.addEventListener("input", (e) => {
					this.filterTag = (e.target as HTMLInputElement).value;
				});
			}
		};

		sourceSelect.addEventListener("change", () => {
			this.sourceType = sourceSelect.value;
			renderSourceFields();
		});
		renderSourceFields();

		// Profile
		const profileRow = contentEl.createDiv({ cls: "export-modal-row" });
		profileRow.createEl("label", { text: "Format" });
		const profileSelect = profileRow.createEl("select");
		for (const [value, label] of Object.entries(PROFILE_OPTIONS)) {
			const opt = profileSelect.createEl("option", { text: label });
			opt.value = value;
		}
		profileSelect.value = this.profile;
		profileSelect.addEventListener("change", () => {
			this.profile = profileSelect.value as ExportProfileId;
		});

		// Output folder
		const folderRow = contentEl.createDiv({ cls: "export-modal-row" });
		folderRow.createEl("label", { text: "Output folder" });
		const folderInput = folderRow.createEl("input", { type: "text" });
		folderInput.value = this.outputFolder;
		folderInput.addEventListener("input", (e) => {
			this.outputFolder = (e.target as HTMLInputElement).value;
		});

		// Sort mode
		const sortRow = contentEl.createDiv({ cls: "export-modal-row" });
		sortRow.createEl("label", { text: "Sort by" });
		const sortSelect = sortRow.createEl("select");
		const sortOptions: Record<string, string> = { path: "File path", name: "File name", frontmatter: "Frontmatter field" };
		for (const [value, label] of Object.entries(sortOptions)) {
			const opt = sortSelect.createEl("option", { text: label });
			opt.value = value;
		}
		sortSelect.value = this.sort.mode;
		sortSelect.addEventListener("change", () => {
			this.sort.mode = sortSelect.value as ExportSort["mode"];
			renderSortFields();
		});

		const sortFields = contentEl.createDiv({ cls: "export-modal-source-fields" });
		const renderSortFields = () => {
			sortFields.empty();
			if (this.sort.mode === "frontmatter") {
				const row = sortFields.createDiv({ cls: "export-modal-row" });
				row.createEl("label", { text: "Frontmatter key" });
				const input = row.createEl("input", {
					type: "text",
					attr: { placeholder: "title" },
				});
				input.value = this.sort.frontmatterKey ?? "";
				input.addEventListener("input", (e) => {
					this.sort.frontmatterKey = (e.target as HTMLInputElement).value || undefined;
				});
			}
		};
		renderSortFields();

		// Buttons
		const buttonRow = contentEl.createDiv({ cls: "export-modal-buttons" });
		const cancelButton = buttonRow.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => {
			this.close();
			this.resolve?.(null);
		});
		const exportButton = buttonRow.createEl("button", { text: "Next", cls: "mod-cta" });
		exportButton.addEventListener("click", () => {
			const result = this.buildResult();
			this.renderConfirmation(result);
		});
	}

	private renderConfirmation(result: ExportModalResult): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Confirm Export" });

		const summary = contentEl.createDiv({ cls: "export-confirm-summary" });
		summary.createEl("p", { text: `Format: ${PROFILE_OPTIONS[result.profile]}` });
		summary.createEl("p", { text: `Output: ${result.outputFolder}` });
		summary.createEl("p", { text: `Source: ${SOURCE_OPTIONS[result.source.type]}` });
		summary.createEl("p", { text: `Sort: ${result.sort.mode} (${result.sort.direction})` });

		if (result.source.type === "folder") {
			summary.createEl("p", { text: `Folder: ${result.source.path} (recursive: ${result.source.recursive})` });
		} else if (result.source.type === "filter" && result.source.tag) {
			summary.createEl("p", { text: `Tag: ${result.source.tag}` });
		}

		const buttonRow = contentEl.createDiv({ cls: "export-modal-buttons" });
		const backButton = buttonRow.createEl("button", { text: "Back" });
		backButton.addEventListener("click", () => {
			this.renderForm();
		});
		const confirmButton = buttonRow.createEl("button", { text: "Export", cls: "mod-cta" });
		confirmButton.addEventListener("click", () => {
			this.close();
			this.resolve?.(result);
		});
	}

	private buildSource(): ExportSource {
		switch (this.sourceType) {
			case "current-file": {
				const file = this.app.workspace.getActiveFile();
				return { type: "current-file", path: file?.path ?? "" };
			}
			case "folder":
				return { type: "folder", path: this.folderPath, recursive: true };
			case "files":
				return { type: "files", paths: [...this.selectedFilePaths] };
			case "filter":
				return { type: "filter", queryText: "", tag: this.filterTag };
		}
		return { type: "current-file", path: "" };
	}

	private buildResult(): ExportModalResult {
		return {
			source: this.buildSource(),
			profile: this.profile,
			outputFolder: this.outputFolder,
			sort: this.sort,
		};
	}
}

class FilePickerModal extends FuzzySuggestModal<TFile> {
	private selectedPaths: string[];
	private onDone: (paths: string[]) => void;
	private chosen: Set<string>;

	constructor(app: App, currentPaths: string[], onDone: (paths: string[]) => void) {
		super(app);
		this.selectedPaths = currentPaths;
		this.chosen = new Set(currentPaths);
		this.onDone = onDone;
		this.setPlaceholder("Search files to add...");
		this.setInstructions([{ command: "Enter", purpose: "Toggle selection" }]);
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(item: TFile): string {
		const selected = this.chosen.has(item.path) ? "✓ " : "  ";
		return `${selected}${item.path}`;
	}

	onChooseItem(item: TFile): void {
		if (this.chosen.has(item.path)) {
			this.chosen.delete(item.path);
		} else {
			this.chosen.add(item.path);
		}
		this.selectedPaths = Array.from(this.chosen);
		this.onDone(this.selectedPaths);
		this.close();
	}

	onClose(): void {
		this.onDone(Array.from(this.chosen));
	}
}
