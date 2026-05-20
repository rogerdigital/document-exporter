import { App } from "obsidian";
import { ExportPlan, ExportSettings } from "@/types";
import { DocumentAssembler } from "@/export/DocumentAssembler";
import { AttachmentCollector } from "@/export/AttachmentCollector";
import { LinkRewriter } from "@/export/LinkRewriter";
import { OutputWriter } from "@/export/OutputWriter";
import { renderMarkdownBundle } from "@/formats/markdown-bundle";
import { renderHtmlDocument } from "@/formats/html-document";
import { renderPdf } from "@/formats/pdf";
import { renderDocx } from "@/formats/docx";

export interface ExportResult {
	success: boolean;
	outputRoot: string;
	warnings: string[];
}

export interface ExportProgressCallbacks {
	onFileStart: (fileIndex: number, totalFiles: number, fileName: string) => void;
	onFileComplete: (fileIndex: number, totalFiles: number) => void;
	onPhase: (phase: string) => void;
}

export const SINGLE_FILE_PHASES = [
	"Assembling document",
	"Collecting attachments",
	"Rewriting links",
	"Rendering output",
	"Copying attachments",
] as const;

export class ExportRunner {
	private app: App;
	private cancelled = false;

	constructor(app: App) {
		this.app = app;
	}

	cancel(): void {
		this.cancelled = true;
	}

	async run(
		plan: ExportPlan,
		settings: ExportSettings,
		callbacks?: ExportProgressCallbacks,
	): Promise<ExportResult> {
		const writer = new OutputWriter(this.app);
		const allWarnings: string[] = [];
		this.cancelled = false;

		if (!OutputWriter.supportsExternalPaths() && writer.isExternal(plan.outputRoot)) {
			return {
				success: false,
				outputRoot: plan.outputRoot,
				warnings: ["External paths are not supported on mobile. Use a vault-relative path."],
			};
		}

		const files = plan.inputFiles
			.map((p) => this.app.vault.getAbstractFileByPath(p))
			.filter(
				(f): f is import("obsidian").TFile =>
					f !== null && "extension" in f && (f as import("obsidian").TFile).extension === "md",
			);

		if (files.length === 0) {
			return {
				success: false,
				outputRoot: plan.outputRoot,
				warnings: ["No valid files found for export."],
			};
		}

		if (files.length > 500) {
			allWarnings.push(`Large export: ${files.length} files. This may take a while.`);
		}

		let outputRoot = plan.outputRoot;
		if (!settings.overwriteExisting && !writer.isExternal(outputRoot)) {
			if (writer.folderExists(outputRoot)) {
				outputRoot = writer.timestampedFolder(outputRoot);
			}
		}

		const effectivePlan = { ...plan, outputRoot };
		const exportedPaths = new Set(plan.inputFiles);

		const assetsRoot = effectivePlan.outputFolderName
			? `${outputRoot}/${effectivePlan.outputFolderName}`
			: outputRoot;

		const outputPathMap = new Map<string, string>();
		for (let i = 0; i < plan.inputFiles.length; i++) {
			outputPathMap.set(plan.inputFiles[i], plan.outputFiles[i]);
		}

		const assembler = new DocumentAssembler(this.app, settings.includeSourcePathComments);
		const copiedAttachments = new Set<string>();

		const isSingleFile = files.length === 1;
		let completedFiles = 0;

		for (let i = 0; i < files.length; i++) {
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			const file = files[i];
			const outputFilePath = outputPathMap.get(file.path) ?? plan.outputFiles[i];

			callbacks?.onFileStart(i, files.length, file.basename);

			// Step 1: Assemble single-file document
			callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[0] : `Assembling ${file.basename}`);
			const doc = await assembler.assemble([file]);
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			// Step 2: Collect attachments for this file
			let attachments = plan.attachmentCopies;
			if (settings.copyAttachments) {
				callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[1] : `Collecting attachments for ${file.basename}`);
				const collector = new AttachmentCollector(this.app, exportedPaths);
				const collectResult = await collector.collect([file]);
				attachments = collectResult.attachments;
				allWarnings.push(...collectResult.warnings);
			}
			doc.attachments = attachments;
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			// Step 3: Rewrite links
			callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[2] : `Rewriting links in ${file.basename}`);
			const rewriter = new LinkRewriter(
				this.app,
				exportedPaths,
				attachments,
				effectivePlan.profile,
				outputPathMap,
				outputFilePath,
				assetsRoot,
			);
			for (const section of doc.sections) {
				const result = rewriter.rewrite(section.markdown, section.sourcePath);
				section.markdown = result.markdown;
				allWarnings.push(...result.warnings);
			}
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			// Step 4: Ensure output folder exists
			const outputDir = outputFilePath.substring(0, outputFilePath.lastIndexOf("/"));
			await writer.ensureFolder(outputDir);

			// Step 5: Render format
			callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[3] : `Rendering ${file.basename}`);
			let formatWarnings: string[] = [];
			try {
				switch (effectivePlan.profile) {
					case "markdown-bundle":
						formatWarnings = await renderMarkdownBundle(doc, effectivePlan, writer, outputFilePath);
						break;
					case "html-document":
						formatWarnings = await renderHtmlDocument(doc, effectivePlan, writer, this.app, outputFilePath);
						break;
					case "pdf":
						formatWarnings = await renderPdf(doc, effectivePlan, writer, this.app, outputFilePath);
						break;
					case "docx":
						formatWarnings = await renderDocx(doc, effectivePlan, writer, this.app, outputFilePath);
						break;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					success: false,
					outputRoot,
					warnings: [msg],
				};
			}
			allWarnings.push(...formatWarnings);
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			// Step 6: Copy attachments (deduplicate across files)
			if (doc.attachments.length > 0) {
				callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[4] : `Copying attachments for ${file.basename}`);
				await writer.ensureFolder(`${assetsRoot}/assets`);
				for (const att of doc.attachments) {
					if (copiedAttachments.has(att.outputRelativePath)) continue;
					copiedAttachments.add(att.outputRelativePath);
					try {
						await writer.copyBinaryFile(
							att.sourcePath,
							`${assetsRoot}/${att.outputRelativePath}`,
						);
					} catch {
						allWarnings.push(`Failed to copy attachment: ${att.sourcePath}`);
					}
				}
			}

			completedFiles++;
			callbacks?.onFileComplete(i, files.length);
		}

		// Write export report
		if (allWarnings.length > 0) {
			const report = allWarnings
				.map((w, i) => `${i + 1}. ${w}`)
				.join("\n");

			await writer.writeText(
				`${assetsRoot}/export-report.md`,
				`# Export Warnings\n\n${report}\n`,
			);
		}

		return {
			success: true,
			outputRoot: effectivePlan.outputRoot,
			warnings: allWarnings,
		};
	}

	private cancelledResult(outputRoot: string, completed: number, total: number): ExportResult {
		const msg = total === 1
			? "Export was cancelled."
			: `Export was cancelled. ${completed} of ${total} file(s) exported.`;
		return {
			success: completed > 0,
			outputRoot,
			warnings: [msg],
		};
	}
}
