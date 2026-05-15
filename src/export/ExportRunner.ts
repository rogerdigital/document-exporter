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

		// Resolve TFile objects from plan input paths
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

		// Handle existing output folder
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

		// Build output path map: sourcePath -> outputPath
		const outputPathMap = new Map<string, string>();
		for (let i = 0; i < plan.inputFiles.length; i++) {
			outputPathMap.set(plan.inputFiles[i], plan.outputFiles[i]);
		}

		const assembler = new DocumentAssembler(this.app, settings.includeSourcePathComments);
		const copiedAttachments = new Set<string>();

		// Export each file individually
		for (let i = 0; i < files.length; i++) {
			if (this.cancelled) return this.cancelledResult(outputRoot);

			const file = files[i];
			const outputFilePath = plan.outputFiles[i];

			// Step 1: Assemble single-file document
			const doc = await assembler.assemble([file]);

			// Step 2: Collect attachments for this file
			let attachments = plan.attachmentCopies;
			if (settings.copyAttachments) {
				const collector = new AttachmentCollector(this.app, exportedPaths);
				const collectResult = await collector.collect([file]);
				attachments = collectResult.attachments;
				allWarnings.push(...collectResult.warnings);
			}
			doc.attachments = attachments;

			// Step 3: Rewrite links
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

			// Step 4: Ensure output folder exists
			const outputDir = outputFilePath.substring(0, outputFilePath.lastIndexOf("/"));
			await writer.ensureFolder(outputDir);

			// Step 5: Render format
			let formatWarnings: string[] = [];
			switch (effectivePlan.profile) {
				case "markdown-bundle":
					formatWarnings = await renderMarkdownBundle(doc, effectivePlan, writer, outputFilePath);
					break;
				case "html-document":
					formatWarnings = await renderHtmlDocument(doc, effectivePlan, writer, false, this.app, outputFilePath);
					break;
				case "pdf":
					formatWarnings = await renderPdf(doc, effectivePlan, writer, this.app, outputFilePath);
					break;
				case "docx":
					formatWarnings = await renderDocx(doc, effectivePlan, writer, this.app, outputFilePath);
					break;
			}
			allWarnings.push(...formatWarnings);

			// Copy attachments (deduplicate across files)
			if (doc.attachments.length > 0) {
				await writer.ensureFolder(`${assetsRoot}/assets`);
			}
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

	private cancelledResult(outputRoot: string): ExportResult {
		return {
			success: false,
			outputRoot,
			warnings: ["Export was cancelled."],
		};
	}
}
