import { ExportPlan, ExportProfileId, ExportSource, ExportSort, AttachmentCopy } from "@/types";
import { App } from "obsidian";

export class ExportPlanBuilder {
	private app: App;
	private source: ExportSource;
	private profile: ExportProfileId;
	private outputRoot: string;
	private sort: ExportSort;
	private inputFiles: string[] = [];

	constructor(
		app: App,
		source: ExportSource,
		profile: ExportProfileId,
		outputRoot: string,
		sort: ExportSort,
	) {
		this.app = app;
		this.source = source;
		this.profile = profile;
		this.outputRoot = outputRoot;
		this.sort = sort;
	}

	setInputFiles(paths: string[]): this {
		this.inputFiles = paths;
		return this;
	}

	build(): ExportPlan {
		return {
			profile: this.profile,
			source: this.source,
			inputFiles: this.inputFiles,
			outputRoot: this.outputRoot,
			outputFiles: this.computeOutputFiles(),
			attachmentCopies: [],
			sort: this.sort,
		};
	}

	private computeOutputFiles(): string[] {
		switch (this.profile) {
			case "markdown-bundle":
				return [
					`${this.outputRoot}/document.md`,
				];
			case "html-document":
			case "print-html":
				return [
					`${this.outputRoot}/index.html`,
				];
		}
	}
}

export function validatePlan(plan: ExportPlan): string | null {
	if (plan.inputFiles.length === 0) {
		return "No files to export. Check your source selection.";
	}
	if (!plan.outputRoot || plan.outputRoot.trim() === "") {
		return "Output folder cannot be empty.";
	}
	if (plan.outputRoot.startsWith("/") || plan.outputRoot.startsWith("..")) {
		return "Output folder must be a relative path within the vault.";
	}
	return null;
}

export function summarizePlan(plan: ExportPlan): string {
	const lines = [
		`Files: ${plan.inputFiles.length}`,
		`Format: ${plan.profile}`,
		`Output: ${plan.outputRoot}`,
	];
	return lines.join("\n");
}
