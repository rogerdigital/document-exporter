import { App } from "obsidian";
import { ExportPlan, ExportSettings } from "@/types";
import { DocumentAssembler } from "@/export/DocumentAssembler";
import { AttachmentCollector } from "@/export/AttachmentCollector";
import { LinkRewriter } from "@/export/LinkRewriter";
import { OutputWriter } from "@/export/OutputWriter";
import { renderMarkdownBundle } from "@/formats/markdown-bundle";
import { renderHtmlDocument } from "@/formats/html-document";
import { renderPrintHtml } from "@/formats/print-html";

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

		// Handle existing output folder
		let outputRoot = plan.outputRoot;
		if (!settings.overwriteExisting && !writer.isExternal(outputRoot)) {
			if (writer.folderExists(outputRoot)) {
				outputRoot = writer.timestampedFolder(outputRoot);
			}
		}

		const effectivePlan = { ...plan, outputRoot };

		// Step 1: Assemble document
		if (this.cancelled) return this.cancelledResult(outputRoot);
		const assembler = new DocumentAssembler(this.app, settings.includeSourcePathComments);
		const doc = await assembler.assemble(files);

		// Step 2: Collect attachments
		if (this.cancelled) return this.cancelledResult(outputRoot);
		const exportedPaths = new Set(plan.inputFiles);
		let attachments = plan.attachmentCopies;

		if (settings.copyAttachments) {
			const collector = new AttachmentCollector(this.app, exportedPaths);
			const collectResult = await collector.collect(files);
			attachments = collectResult.attachments;
			allWarnings.push(...collectResult.warnings);
		}

		doc.attachments = attachments;

		// Step 3: Rewrite links in each section
		if (this.cancelled) return this.cancelledResult(outputRoot);
		const rewriter = new LinkRewriter(
			this.app,
			exportedPaths,
			attachments,
			effectivePlan.profile,
		);

		for (const section of doc.sections) {
			const result = rewriter.rewrite(section.markdown, section.sourcePath);
			section.markdown = result.markdown;
			allWarnings.push(...result.warnings);
		}

		// Step 4: Render format
		if (this.cancelled) return this.cancelledResult(outputRoot);
		let formatWarnings: string[] = [];
		switch (effectivePlan.profile) {
			case "markdown-bundle":
				formatWarnings = await renderMarkdownBundle(doc, effectivePlan, writer);
				break;
			case "html-document":
				formatWarnings = await renderHtmlDocument(doc, effectivePlan, writer);
				break;
			case "print-html":
				formatWarnings = await renderPrintHtml(doc, effectivePlan, writer);
				break;
		}
		allWarnings.push(...formatWarnings);

		// Write export report
		if (allWarnings.length > 0) {
			let report = allWarnings
				.map((w, i) => `${i + 1}. ${w}`)
				.join("\n");

			if (effectivePlan.profile === "print-html") {
				report += "\n\n## Print Instructions\n\nOpen `index.html` in a browser and use File > Print (or Cmd/Ctrl+P) to save as PDF.\n";
			}

			await writer.writeText(
				`${effectivePlan.outputRoot}/export-report.md`,
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
