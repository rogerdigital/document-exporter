import { App, Modal, Platform, TFile, TFolder, FuzzySuggestModal } from "obsidian";
import { ExportProfileId, ExportSettings, ExportSource, ExportSort } from "@/types";

const PROFILE_OPTIONS: Record<ExportProfileId, string> = {
	pdf: "PDF",
	docx: "Word document",
	"markdown-bundle": "Markdown bundle",
	"html-document": "HTML document",
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
	outputFilename: string;
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
	private outputFilename: string;
	private sort: ExportSort;
	private preselectedFile?: TFile;
	private preselectedFolder?: TFolder;

	constructor(app: App, settings: ExportSettings, preselectedFile?: TFile, preselectedFolder?: TFolder) {
		super(app);
		this.settings = settings;
		this.profile = settings.defaultProfile;
		this.outputFolder = settings.defaultOutputFolder;
		this.outputFilename = this.deriveDefaultFilename();
		this.sort = { ...settings.defaultSort };
		this.preselectedFile = preselectedFile;
		this.preselectedFolder = preselectedFolder;
	}

	onOpen(): void {
		if (this.preselectedFile) {
			this.sourceType = "current-file";
		} else if (this.preselectedFolder) {
			this.sourceType = "folder";
			this.folderPath = this.preselectedFolder.path;
		}
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve?.(null);
		this.resolve = null;
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
		contentEl.createEl("h2", { text: "Export documents" });

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
				this.renderFolderPicker(sourceFields, "Folder path", this.folderPath, (v) => { this.folderPath = v; });
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
				const input = row.createEl("input", { type: "text", attr: { placeholder: "Project" } });
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

		// Output folder with browser — supports both vault and system paths
		this.renderOutputFolderPicker(contentEl);

		// Output filename
		const filenameRow = contentEl.createDiv({ cls: "export-modal-row" });
		filenameRow.createEl("label", { text: "File name" });
		const filenameInput = filenameRow.createEl("input", {
			type: "text",
			attr: { placeholder: "Document" },
		});
		filenameInput.value = this.outputFilename;
		filenameInput.addEventListener("input", (e) => {
			this.outputFilename = (e.target as HTMLInputElement).value;
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
					attr: { placeholder: "Title" },
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
			this.resolve = null;
			this.close();
		});
		const exportButton = buttonRow.createEl("button", { text: "Next", cls: "mod-cta" });
		exportButton.addEventListener("click", () => {
			const result = this.buildResult();
			this.renderConfirmation(result);
		});
	}

	private renderFolderPicker(
		container: HTMLElement,
		label: string,
		currentValue: string,
		onChange: (value: string) => void,
	): void {
		const row = container.createDiv({ cls: "export-modal-row" });
		row.createEl("label", { text: label });
		const group = row.createDiv({ cls: "export-modal-input-group" });
		const input = group.createEl("input", { type: "text" });
		input.value = currentValue;
		input.addEventListener("input", (e) => {
			onChange((e.target as HTMLInputElement).value);
		});
		const browseBtn = group.createEl("button", { text: "Browse", cls: "export-modal-browse-btn" });
		browseBtn.addEventListener("click", () => {
			const picker = new FolderPickerModal(this.app, input.value, (selected) => {
				input.value = selected;
				onChange(selected);
			});
			picker.open();
		});
	}

	private renderOutputFolderPicker(container: HTMLElement): void {
		const onChange = (v: string) => { this.outputFolder = v; };

		const row = container.createDiv({ cls: "export-modal-row" });
		row.createEl("label", { text: "Output folder" });
		const group = row.createDiv({ cls: "export-modal-input-group" });
		const input = group.createEl("input", {
			type: "text",
			attr: { placeholder: Platform.isDesktopApp
				? "Exports or /users/you/desktop/exports"
				: "Exports (vault-relative only)" },
		});
		input.value = this.outputFolder;
		input.addEventListener("input", (e) => {
			onChange((e.target as HTMLInputElement).value);
		});

		// Vault folder picker
		const vaultBtn = group.createEl("button", { text: "Vault", cls: "export-modal-browse-btn" });
		vaultBtn.addEventListener("click", () => {
			const picker = new FolderPickerModal(this.app, input.value, (selected) => {
				input.value = selected;
				onChange(selected);
			});
			picker.open();
		});

		// System folder picker (desktop only)
		if (Platform.isDesktopApp) {
			const sysBtn = group.createEl("button", { text: "Choose folder", cls: "export-modal-browse-btn" });
			sysBtn.addEventListener("click", () => {
				void (async () => {
					try {
						const g = typeof window !== "undefined" ? window : undefined;
						const electron = g && "require" in g
							? (g as unknown as Record<string, (id: string) => unknown>)["require"]("electron") as { remote?: { dialog?: { showOpenDialog: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } }; dialog?: { showOpenDialog: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } } | undefined
							: undefined;
						const dialog = electron?.remote?.dialog ?? electron?.dialog;
						if (!dialog) return;
						const result = await dialog.showOpenDialog({
							properties: ["openDirectory", "createDirectory"],
							title: "Select output folder",
						});
						if (!result.canceled && result.filePaths[0]) {
							input.value = result.filePaths[0];
							onChange(result.filePaths[0]);
						}
					} catch (err) {
						console.error("Document Exporter: failed to open folder dialog", err);
					}
				})();
			});
		}
	}

	private renderConfirmation(result: ExportModalResult): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Confirm export" });

		const summary = contentEl.createDiv({ cls: "export-confirm-summary" });
		summary.createEl("p", { text: `Format: ${PROFILE_OPTIONS[result.profile]}` });
		summary.createEl("p", { text: `Output: ${result.outputFolder}/${result.outputFilename}` });
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
			const resolveRef = this.resolve;
			this.resolve = null;
			this.close();
			resolveRef?.(result);
		});
	}

	private deriveDefaultFilename(): string {
		if (this.preselectedFile) {
			return this.preselectedFile.basename;
		}
		if (this.preselectedFolder) {
			return this.preselectedFolder.name;
		}
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			return activeFile.basename;
		}
		return "export";
	}

	private buildSource(): ExportSource {
		switch (this.sourceType) {
			case "current-file": {
				const file = this.preselectedFile ?? this.app.workspace.getActiveFile();
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
			outputFilename: this.outputFilename || "export",
			sort: this.sort,
		};
	}
}

class FilePickerModal extends Modal {
	private chosen: Set<string>;
	private onDone: (paths: string[]) => void;
	private filterText = "";
	private listEl: HTMLElement | null = null;

	constructor(app: App, currentPaths: string[], onDone: (paths: string[]) => void) {
		super(app);
		this.chosen = new Set(currentPaths);
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("file-picker-modal");
		contentEl.createEl("h3", { text: "Select files" });

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "file-picker-filter",
			attr: { placeholder: "Filter files..." },
		});
		input.addEventListener("input", () => {
			this.filterText = input.value.toLowerCase();
			this.renderList();
		});

		this.listEl = contentEl.createDiv({ cls: "file-picker-list" });
		this.renderList();

		const doneBtn = contentEl.createEl("button", { text: "Done", cls: "mod-cta file-picker-done-btn" });
		doneBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		this.onDone(Array.from(this.chosen));
	}

	private renderList(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		const allFiles = this.app.vault.getMarkdownFiles();
		const filtered = this.filterText
			? allFiles.filter((f) => f.path.toLowerCase().includes(this.filterText))
			: allFiles;

		for (const file of filtered) {
			const row = this.listEl.createDiv({ cls: "file-picker-item" });
			const label = row.createEl("label");
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.chosen.has(file.path);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.chosen.add(file.path);
				} else {
					this.chosen.delete(file.path);
				}
			});
			label.appendText(" " + file.path);
		}
	}
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	private onSelect: (path: string) => void;

	constructor(app: App, currentPath: string, onSelect: (path: string) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder("Search folders...");
		this.setInstructions([{ command: "Enter", purpose: "Select folder" }]);
	}

	getItems(): TFolder[] {
		return getAllFolders(this.app.vault.getRoot());
	}

	getItemText(item: TFolder): string {
		return item.path === "/" ? "/ (vault root)" : item.path;
	}

	onChooseItem(item: TFolder): void {
		this.onSelect(item.path === "/" ? "" : item.path);
	}
}

function getAllFolders(root: TFolder): TFolder[] {
	const result: TFolder[] = [root];
	for (const child of root.children) {
		if (child instanceof TFolder) {
			result.push(...getAllFolders(child));
		}
	}
	return result;
}
