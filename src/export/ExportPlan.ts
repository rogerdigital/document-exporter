import { ExportPlan, ExportProfileId, ExportSource } from "@/types";
import { App } from "obsidian";
import { extensionForProfile, longestCommonDirPrefix } from "@/export/utils";

const INVALID_OUTPUT_NAME_RE = /[<>:"/\\|?*]/;
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateOutputLeafName(
	value: string,
	label: "File name" | "Folder name",
): string | null {
	const trimmed = value.trim();
	const hasControlCharacter = Array.from(trimmed)
		.some((character) => character.charCodeAt(0) <= 0x1F);
	if (!trimmed) return `${label} cannot be empty.`;
	if (
		trimmed !== value
		|| trimmed === "."
		|| trimmed === ".."
		|| trimmed.endsWith(".")
		|| INVALID_OUTPUT_NAME_RE.test(trimmed)
		|| hasControlCharacter
		|| WINDOWS_RESERVED_NAME_RE.test(trimmed)
	) {
		return `${label} contains invalid path characters.`;
	}
	return null;
}

type OutputLayout = Pick<
	ExportPlan,
	"profile" | "source" | "inputFiles" | "outputRoot" | "outputFilename" | "outputFolderName"
>;

export function computeOutputFiles(layout: OutputLayout): string[] {
	const ext = extensionForProfile(layout.profile);

	if (layout.source.type === "current-file") {
		const baseName = layout.outputFilename.replace(/\.(md|html|htm|pdf|docx)$/i, "");
		return [`${layout.outputRoot}/${baseName}.${ext}`];
	}

	const root = layout.outputFolderName
		? `${layout.outputRoot}/${layout.outputFolderName}`
		: layout.outputRoot;

	if (layout.source.type === "folder") {
		const prefix = layout.source.path ? `${layout.source.path}/` : "";
		return layout.inputFiles.map((path) => {
			const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
			return `${root}/${relative.replace(/\.md$/i, `.${ext}`)}`;
		});
	}

	const prefix = longestCommonDirPrefix(layout.inputFiles);
	return layout.inputFiles.map((path) => {
		const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
		return `${root}/${relative.replace(/\.md$/i, `.${ext}`)}`;
	});
}

export function relocatePlan(
	plan: ExportPlan,
	outputRoot: string,
	outputFolderName = plan.outputFolderName,
): ExportPlan {
	const relocated = { ...plan, outputRoot, outputFolderName };
	return { ...relocated, outputFiles: computeOutputFiles(relocated) };
}

export class ExportPlanBuilder {
	private app: App;
	private source: ExportSource;
	private profile: ExportProfileId;
	private outputRoot: string;
	private outputFilename: string;
	private outputFolderName?: string;
	private inputFiles: string[] = [];

	constructor(
		app: App,
		source: ExportSource,
		profile: ExportProfileId,
		outputRoot: string,
		outputFilename: string,
		outputFolderName?: string,
	) {
		this.app = app;
		this.source = source;
		this.profile = profile;
		this.outputRoot = outputRoot;
		this.outputFilename = outputFilename;
		this.outputFolderName = outputFolderName;
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
			outputFolderName: this.outputFolderName,
			outputFiles: computeOutputFiles({
				profile: this.profile,
				source: this.source,
				inputFiles: this.inputFiles,
				outputRoot: this.outputRoot,
				outputFilename: this.outputFilename,
				outputFolderName: this.outputFolderName,
			}),
			attachmentCopies: [],
		};
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
	const filenameError = validateOutputLeafName(plan.outputFilename, "File name");
	if (filenameError) return filenameError;

	if (plan.source.type !== "current-file" && plan.outputFolderName !== undefined) {
		const folderError = validateOutputLeafName(plan.outputFolderName, "Folder name");
		if (folderError) return folderError;
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
