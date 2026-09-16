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
import { ExportResult, resolveExportStatus } from "@/export/ExportOutcome";

export type { ExportResult } from "@/export/ExportOutcome";

const WIKI_EMBED_RE = /!\[\[([^\]]+)]]/g;

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
		const writer = new OutputWriter(this.app, settings.overwriteExisting);
		const allWarnings: string[] = [];
		const errors: string[] = [];
		const completedPaths: string[] = [];
		const incompletePaths = new Set<string>();
		let hasFailure = false;
		let reportPath: string | undefined;
		let enteredOutputStage = false;
		this.cancelled = false;

		// Preflight failures produce no outputs and never create report folders.
		if (!isProfileSupported(plan.profile, Platform.isDesktopApp)) {
			return this.failedPreflight(plan, ["PDF export requires the desktop app."]);
		}

		if (!OutputWriter.supportsExternalPaths() && writer.isExternal(plan.outputRoot)) {
			return this.failedPreflight(
				plan,
				["External paths are not supported on mobile. Use a vault-relative path."],
			);
		}

		// Missing requested inputs stay counted in the total and are named as
		// errors; the remaining valid files still export.
		const requestedPaths = plan.inputFiles;
		const files = requestedPaths
			.map((p) => this.app.vault.getAbstractFileByPath(p))
			.filter(
				(f): f is import("obsidian").TFile =>
					f !== null && "extension" in f && (f as import("obsidian").TFile).extension === "md",
			);
		const validPaths = files.map((f) => f.path);
		for (const missing of requestedPaths.filter((p) => !validPaths.includes(p))) {
			errors.push(`Input file not found or not a Markdown note: ${missing}`);
			hasFailure = true;
		}

		if (files.length === 0) {
			errors.push("No valid files found for export.");
			return this.failedPreflight(plan, errors);
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

		runLoop:
		for (let i = 0; i < files.length; i++) {
			if (this.cancelled) break;

			const file = files[i];
			const outputFilePath = outputPathMap.get(file.path) ?? effectivePlan.outputFiles[i];
			let attachmentFailed = false;

			callbacks?.onFileStart(i, files.length, file.basename);

			try {
				// Step 1: Assemble single-file document
				callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[0] : `Assembling ${file.basename}`);
				const doc = await assembler.assemble([file]);
				allWarnings.push(...(doc.warnings ?? []));
				if (this.cancelled) break;

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
				if (this.cancelled) break;

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
						if (
							!settings.expandEmbeds
							&& this.containsUnexpandedNoteEmbed(
								fragment.markdown,
								fragment.sourcePath,
							)
						) {
							sawUnexpandedEmbed = true;
						}
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
				if (this.cancelled) break;

				// Step 4: Ensure output folder exists — from here on the run has
				// entered its output-writing stage.
				const outputDir = outputFilePath.substring(0, outputFilePath.lastIndexOf("/"));
				await writer.ensureFolder(outputDir);
				enteredOutputStage = true;

				// Step 5: Render format. The renderer can fail after partially
				// writing, so the primary counts as incomplete until all of its
				// required writes have succeeded.
				callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[3] : `Rendering ${file.basename}`);
				incompletePaths.add(outputFilePath);
				let formatWarnings: string[] = [];
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
				allWarnings.push(...formatWarnings);
				if (this.cancelled) break;

				// Step 6: Copy attachments (deduplicate across files) — not for EPUB,
				// whose images are packaged inside the .epub itself.
				if (
					settings.copyAttachments
					&& effectivePlan.profile !== "epub"
					&& doc.attachments.length > 0
				) {
					callbacks?.onPhase(isSingleFile ? SINGLE_FILE_PHASES[4] : `Copying attachments for ${file.basename}`);
					await writer.ensureFolder(`${assetsRoot}/assets`);
					if (this.cancelled) break;

					for (const att of doc.attachments) {
						if (this.cancelled) break runLoop;
						// A path joins copiedAttachments only after a successful copy,
						// so a shared attachment that failed for one source is retried
						// for a later source that needs it.
						if (copiedAttachments.has(att.outputRelativePath)) continue;
						try {
							await writer.copyBinaryFile(
								att.sourcePath,
								`${assetsRoot}/${att.outputRelativePath}`,
							);
							copiedAttachments.add(att.outputRelativePath);
						} catch {
							errors.push(`Failed to copy attachment: ${att.sourcePath}`);
							hasFailure = true;
							// This primary is not complete even though it exists.
							attachmentFailed = true;
						}
					}
					if (this.cancelled) break;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`Export failed for ${file.path}: ${msg}`);
				hasFailure = true;
				break;
			}

			if (attachmentFailed) continue;

			// All required writes for this file succeeded and cancellation did not
			// interrupt it.
			incompletePaths.delete(outputFilePath);
			completedPaths.push(outputFilePath);
			callbacks?.onFileComplete(completedPaths.length - 1, files.length);
		}

		if (this.cancelled) {
			const completed = completedPaths.length;
			const total = requestedPaths.length;
			allWarnings.push(
				total === 1
					? "Export was cancelled."
					: `Export was cancelled. ${completed} of ${total} file(s) exported.`,
			);
		}

		const status = resolveExportStatus(
			this.cancelled, completedPaths.length, requestedPaths.length, hasFailure,
		);

		// Write a report only when the run reached its output-writing stage and
		// that directory actually exists; preflight failures create nothing.
		if (
			(allWarnings.length > 0 || errors.length > 0)
			&& enteredOutputStage
			&& writer.folderExists(assetsRoot)
		) {
			const reportWriter = new OutputWriter(this.app, false);
			try {
				const path = this.reportPath(assetsRoot, effectivePlan, reportWriter);
				await reportWriter.writeText(path, this.reportContent(status, plan, {
					completedPaths,
					incompletePaths: [...incompletePaths],
					warnings: allWarnings,
					errors,
				}));
				reportPath = path;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				allWarnings.push(`Could not write export report: ${msg}`);
			}
		}

		return {
			status, success: status === "completed", outputRoot: assetsRoot,
			totalFiles: requestedPaths.length,
			completedFiles: completedPaths.length,
			completedPaths, incompletePaths: [...incompletePaths],
			warnings: allWarnings, errors,
			...(reportPath ? { reportPath } : {}),
		};
	}

	private failedPreflight(plan: ExportPlan, errors: string[]): ExportResult {
		return {
			status: "failed",
			success: false,
			outputRoot: plan.outputRoot,
			totalFiles: plan.inputFiles.length,
			completedFiles: 0,
			completedPaths: [],
			incompletePaths: [],
			warnings: [],
			errors,
		};
	}

	private reportContent(
		status: string,
		plan: ExportPlan,
		outcome: {
			completedPaths: string[];
			incompletePaths: string[];
			warnings: string[];
			errors: string[];
		},
	): string {
		const lines = [
			"# Export Report",
			"",
			`Status: ${status}`,
			`Files: ${outcome.completedPaths.length} of ${plan.inputFiles.length} complete`,
		];
		if (outcome.completedPaths.length > 0) {
			lines.push("", "## Completed", ...outcome.completedPaths.map((p) => `- ${p}`));
		}
		if (outcome.incompletePaths.length > 0) {
			lines.push(
				"", "## Possibly incomplete",
				...outcome.incompletePaths.map((p) => `- ${p}`),
				"",
				"These outputs may exist but are not complete.",
			);
		}
		if (outcome.warnings.length > 0) {
			lines.push("", "## Warnings", ...numbered(outcome.warnings));
		}
		if (outcome.errors.length > 0) {
			lines.push("", "## Errors", ...numbered(outcome.errors));
		}
		return `${lines.join("\n")}\n`;
	}

	private containsUnexpandedNoteEmbed(
		markdown: string,
		sourcePath: string,
	): boolean {
		for (const match of markdown.matchAll(WIKI_EMBED_RE)) {
			const [rawTarget] = match[1].split("|");
			const [target] = rawTarget.split("#");
			if (target === "") return true;

			const dest = this.app.metadataCache.getFirstLinkpathDest(
				target,
				sourcePath,
			);
			if (!dest || dest.path.toLowerCase().endsWith(".md")) return true;
		}

		return false;
	}

	private resolveEffectivePlan(
		plan: ExportPlan,
		settings: ExportSettings,
		writer: OutputWriter,
	): ExportPlan {
		if (settings.overwriteExisting) return plan;

		if (plan.source.type === "current-file") {
			// Reuse the single-file output root only if nothing occupies it;
			// an existing file or directory — even an empty one — relocates the
			// whole export so previous outputs keep their attachments.
			if (!writer.pathExists(plan.outputRoot)) return plan;
			const candidateRoot = this.nextAvailablePath(
				writer.timestampedFolder(plan.outputRoot), writer,
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

	// Pick a report path that cannot collide with any planned primary output
	// or an existing file/directory. Case-insensitive reservation is
	// deliberately conservative for case-insensitive filesystems.
	private reportPath(root: string, plan: ExportPlan, writer: OutputWriter): string {
		const reserved = new Set(plan.outputFiles.map((path) => path.toLowerCase()));
		let sequence = 1;
		let candidate = `${root}/export-report.md`;
		const conflicts = (path: string) => {
			const key = path.toLowerCase();
			return writer.pathExists(path) || [...reserved].some(
				(other) => other === key || other.startsWith(`${key}/`)
					|| key.startsWith(`${other}/`),
			);
		};
		while (conflicts(candidate)) {
			sequence++;
			candidate = `${root}/export-report-${sequence}.md`;
		}
		return candidate;
	}
}

function numbered(items: string[]): string[] {
	return items.map((item, i) => `${i + 1}. ${item}`);
}
