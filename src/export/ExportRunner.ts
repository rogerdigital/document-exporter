import { App, Platform } from "obsidian";
import { DocumentFragment, ExportPlan, ExportSettings } from "@/types";
import { DocumentAssembler } from "@/export/DocumentAssembler";
import { AttachmentCollector } from "@/export/AttachmentCollector";
import { LinkRewriter } from "@/export/LinkRewriter";
import { OutputWriter } from "@/export/OutputWriter";
import { renderMarkdownBundle } from "@/formats/markdown-bundle";
import { renderHtmlDocument } from "@/formats/html-document";
import { renderPdf } from "@/formats/pdf";
import { renderDocx } from "@/formats/docx";
import { renderEpub } from "@/formats/epub";
import { relocatePlan } from "@/export/ExportPlan";
import { isProfileSupported } from "@/export/ProfileCapabilities";
import { joinMarkdownFragments } from "@/export/FragmentJoiner";

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

		if (!isProfileSupported(plan.profile, Platform.isDesktopApp)) {
			return {
				success: false,
				outputRoot: plan.outputRoot,
				warnings: ["PDF export requires the desktop app."],
			};
		}

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

		const effectivePlan = this.resolveEffectivePlan(plan, settings, writer);
		const outputRoot = effectivePlan.outputRoot;
		const exportedPaths = new Set(effectivePlan.inputFiles);

		const assetsRoot = effectivePlan.outputFolderName
			? `${outputRoot}/${effectivePlan.outputFolderName}`
			: outputRoot;

		const outputPathMap = new Map<string, string>();
		for (let i = 0; i < effectivePlan.inputFiles.length; i++) {
			outputPathMap.set(effectivePlan.inputFiles[i], effectivePlan.outputFiles[i]);
		}

		const assembler = new DocumentAssembler(
			this.app,
			settings.includeSourcePathComments,
			settings.expandEmbeds,
		);
		const copiedAttachments = new Set<string>();
		const needsAttachmentMetadata = settings.copyAttachments
			|| effectivePlan.profile === "pdf";
		const collector = needsAttachmentMetadata
			? new AttachmentCollector(this.app, exportedPaths)
			: null;

		const isSingleFile = files.length === 1;
		let completedFiles = 0;

		for (let i = 0; i < files.length; i++) {
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			const file = files[i];
			const outputFilePath = outputPathMap.get(file.path) ?? effectivePlan.outputFiles[i];

			callbacks?.onFileStart(i, files.length, file.basename);

			// Step 1: Assemble single-file document
			callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[0] : `Assembling ${file.basename}`);
			const doc = await assembler.assemble([file]);
			allWarnings.push(...(doc.warnings ?? []));
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			// Step 2: Collect attachments for this file (embedded notes contribute
			// their own references; AttachmentCollector only adds non-markdown files)
			let attachments = effectivePlan.attachmentCopies;
			if (collector) {
				callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[1] : `Collecting attachments for ${file.basename}`);
				const embeddedFiles = (doc.embeddedPaths ?? [])
					.map((p) => this.app.vault.getAbstractFileByPath(p))
					.filter(
						(f): f is import("obsidian").TFile =>
							f !== null && "extension" in f && (f as import("obsidian").TFile).extension === "md",
					);
				const collectResult = await collector.collect([file, ...embeddedFiles]);
				attachments = collectResult.attachments;
				allWarnings.push(...collectResult.warnings);
			}
			doc.attachments = attachments;
			if (this.cancelled) return this.cancelledResult(outputRoot, completedFiles, files.length);

			// Step 3: Rewrite links — per fragment, so content from embedded notes
			// resolves against its own source path rather than the host's.
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
			let sawUnexpandedEmbed = false;
			for (const section of doc.sections) {
				const fragments = section.fragments
					?? [{ markdown: section.markdown, sourcePath: section.sourcePath }];
				const rewritten: DocumentFragment[] = [];
				for (const fragment of fragments) {
					if (fragment.markdown.includes("![[")) sawUnexpandedEmbed = true;
					const result = rewriter.rewrite(fragment.markdown, fragment.sourcePath);
					rewritten.push({ ...fragment, markdown: result.markdown });
					allWarnings.push(...result.warnings);
				}
				section.markdown = joinMarkdownFragments(rewritten);
			}
			// Without this hint, embeds silently degrading to plain text looks
			// like a broken feature instead of a disabled one.
			if (!settings.expandEmbeds && sawUnexpandedEmbed) {
				allWarnings.push("Note embeds were not expanded (Expand note embeds setting is off)");
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
					case "epub":
						formatWarnings = await renderEpub(doc, effectivePlan, writer, this.app, outputFilePath);
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

			// Step 6: Copy attachments (deduplicate across files) — not for EPUB,
			// whose images are packaged inside the .epub itself.
			if (
				settings.copyAttachments
				&& effectivePlan.profile !== "epub"
				&& doc.attachments.length > 0
			) {
				callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[4] : `Copying attachments for ${file.basename}`);
				await writer.ensureFolder(`${assetsRoot}/assets`);
				if (this.cancelled) {
					return this.cancelledResult(outputRoot, completedFiles, files.length);
				}
				for (const att of doc.attachments) {
					if (this.cancelled) {
						return this.cancelledResult(outputRoot, completedFiles, files.length);
					}
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

	private resolveEffectivePlan(
		plan: ExportPlan,
		settings: ExportSettings,
		writer: OutputWriter,
	): ExportPlan {
		if (settings.overwriteExisting) return plan;

		if (plan.source.type === "current-file") {
			const targetPath = plan.outputFiles[0];
			if (!targetPath || !writer.pathExists(targetPath)) return plan;
			const candidateRoot = this.nextAvailablePath(
				writer.timestampedFolder(plan.outputRoot),
				writer,
			);
			return relocatePlan(plan, candidateRoot);
		}

		const batchRoot = plan.outputFolderName
			? `${plan.outputRoot}/${plan.outputFolderName}`
			: plan.outputRoot;
		if (!writer.pathExists(batchRoot)) return plan;

		const baseFolderName = `${plan.outputFolderName ?? "files"}-${writer.timestampSuffix()}`;
		const availablePath = this.nextAvailablePath(
			`${plan.outputRoot}/${baseFolderName}`,
			writer,
		);
		const folderName = availablePath.slice(plan.outputRoot.length + 1);
		return relocatePlan(plan, plan.outputRoot, folderName);
	}

	private nextAvailablePath(candidate: string, writer: OutputWriter): string {
		if (!writer.pathExists(candidate)) return candidate;

		let sequence = 2;
		let available = `${candidate}-${sequence}`;
		while (writer.pathExists(available)) {
			sequence++;
			available = `${candidate}-${sequence}`;
		}
		return available;
	}
}
