import { ExportPlan, ExportProfileId, ExportSource } from "@/types";
import { App } from "obsidian";
import { extensionForProfile, longestCommonDirPrefix } from "@/export/utils";

export class ExportPlanBuilder {
	private app: App;
	private source: ExportSource;
	private profile: ExportProfileId;
	private outputRoot: string;
	private outputFilename: string;
	private inputFiles: string[] = [];

	constructor(
		app: App,
		source: ExportSource,
		profile: ExportProfileId,
		outputRoot: string,
		outputFilename: string,
	) {
		this.app = app;
		this.source = source;
		this.profile = profile;
		this.outputRoot = outputRoot;
		this.outputFilename = outputFilename;
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
			outputFilename: this.outputFilename,
			outputFiles: this.computeOutputFiles(),
			attachmentCopies: [],
		};
	}

	private computeOutputFiles(): string[] {
		const ext = extensionForProfile(this.profile);

		if (this.source.type === "current-file") {
			const baseName = this.stripExtension(this.outputFilename);
			return [`${this.outputRoot}/${baseName}.${ext}`];
		}

		if (this.source.type === "folder") {
			const prefix = this.source.path ? this.source.path + "/" : "";
			return this.inputFiles.map(p => {
				const rel = prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
				return `${this.outputRoot}/${rel.replace(/\.md$/i, `.${ext}`)}`;
			});
		}

		// files: strip longest common directory prefix
		const prefix = longestCommonDirPrefix(this.inputFiles);
		return this.inputFiles.map(p => {
			const rel = prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
			return `${this.outputRoot}/${rel.replace(/\.md$/i, `.${ext}`)}`;
		});
	}

	private stripExtension(name: string): string {
		return name.replace(/\.(md|html|htm|pdf|docx)$/i, "");
	}
}

export function validatePlan(plan: ExportPlan): string | null {
	if (plan.inputFiles.length === 0) {
		return "No files to export. Check your source selection.";
	}
	if (!plan.outputRoot || plan.outputRoot.trim() === "") {
		return "Output folder cannot be empty.";
	}
	const segments = plan.outputRoot.split("/");
	if (segments.some(s => s === ".." || s === ".")) {
		return "Output folder cannot use parent directory traversal.";
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
