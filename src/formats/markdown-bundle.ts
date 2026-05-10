import { AssembledDocument, AttachmentCopy, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";

export async function renderMarkdownBundle(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
): Promise<string[]> {
	const warnings: string[] = [];

	// Ensure output folder
	await writer.ensureFolder(plan.outputRoot);
	await writer.ensureFolder(`${plan.outputRoot}/assets`);

	// Combine sections into document.md
	const parts: string[] = [];
	parts.push(`# ${doc.title}\n`);

	for (const section of doc.sections) {
		parts.push(`## ${section.title}\n`);
		parts.push(section.markdown);
		parts.push("");
	}

	const content = parts.join("\n");
	await writer.writeText(`${plan.outputRoot}/document.md`, content);

	// Copy attachments
	for (const att of doc.attachments) {
		try {
			await writer.copyBinaryFile(
				att.sourcePath,
				`${plan.outputRoot}/${att.outputRelativePath}`,
			);
		} catch {
			warnings.push(`Failed to copy attachment: ${att.sourcePath}`);
		}
	}

	return warnings;
}
