export type ExportProfileId = "markdown-bundle" | "html-document" | "print-html";

export type ExportSort = {
	mode: "path" | "name" | "frontmatter";
	frontmatterKey?: string;
	direction: "asc" | "desc";
};

export type ExportSettings = {
	defaultProfile: ExportProfileId;
	defaultOutputFolder: string;
	includeSourcePathComments: boolean;
	copyAttachments: boolean;
	overwriteExisting: boolean;
	defaultSort: ExportSort;
};

export type ExportSource =
	| { type: "current-file"; path: string }
	| { type: "files"; paths: string[] }
	| { type: "folder"; path: string; recursive: boolean }
	| { type: "filter"; queryText: string; tag?: string };

export type AttachmentCopy = {
	sourcePath: string;
	outputRelativePath: string;
};

export type ExportPlan = {
	profile: ExportProfileId;
	source: ExportSource;
	inputFiles: string[];
	outputRoot: string;
	outputFilename: string;
	outputFiles: string[];
	attachmentCopies: AttachmentCopy[];
	sort: ExportSort;
};

export type DocumentSection = {
	sourcePath: string;
	title: string;
	markdown: string;
	frontmatter: Record<string, unknown>;
};

export type AssembledDocument = {
	title: string;
	sections: DocumentSection[];
	attachments: AttachmentCopy[];
};

export const DEFAULT_SETTINGS: ExportSettings = {
	defaultProfile: "markdown-bundle",
	defaultOutputFolder: "exports",
	includeSourcePathComments: false,
	copyAttachments: true,
	overwriteExisting: false,
	defaultSort: {
		mode: "path",
		direction: "asc",
	},
};
