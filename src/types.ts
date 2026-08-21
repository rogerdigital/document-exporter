export type ExportProfileId = "markdown-bundle" | "html-document" | "pdf" | "docx";

export type ExportSettings = {
	defaultProfile: ExportProfileId;
	defaultOutputFolder: string;
	expandEmbeds: boolean;
	includeSourcePathComments: boolean;
	copyAttachments: boolean;
	overwriteExisting: boolean;
};

export type ExportSource =
	| { type: "current-file"; path: string }
	| { type: "files"; paths: string[] }
	| { type: "folder"; path: string; recursive: boolean };

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
	outputFolderName?: string;
	outputFiles: string[];
	attachmentCopies: AttachmentCopy[];
};

export type DocumentSection = {
	sourcePath: string;
	title: string;
	markdown: string;
	frontmatter: Record<string, unknown>;
	/** Source-aware pieces from embed expansion; each is rewritten against its own sourcePath. */
	fragments?: { markdown: string; sourcePath: string }[];
};

export type AssembledDocument = {
	title: string;
	sections: DocumentSection[];
	attachments: AttachmentCopy[];
	/** Warnings raised while assembling (e.g. embed resolution). */
	warnings?: string[];
	/** Vault paths of notes inlined via embed expansion. */
	embeddedPaths?: string[];
};

export const DEFAULT_SETTINGS: ExportSettings = {
	defaultProfile: "pdf",
	defaultOutputFolder: "exports",
	expandEmbeds: true,
	includeSourcePathComments: false,
	copyAttachments: true,
	overwriteExisting: false,
};
