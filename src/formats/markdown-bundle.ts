import { AssembledDocument, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";

export async function renderMarkdownBundle(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	outputFilePath: string,
): Promise<string[]> {
	const warnings: string[] = [];

	// Ensure output folder
	await writer.ensureFolder(plan.outputRoot);

	// Create assets folder only when there are attachments
	if (doc.attachments.length > 0) {
		await writer.ensureFolder(`${plan.outputRoot}/assets`);
	}

	// Combine sections into document.md
	const parts: string[] = [];
	parts.push(`# ${doc.title}\n`);

	const isSingleSection = doc.sections.length === 1;
	for (const section of doc.sections) {
		if (!(isSingleSection && section.title === doc.title)) {
			parts.push(`## ${section.title}\n`);
		}
		parts.push(section.markdown);
		parts.push("");
	}

	const content = parts.join("\n");
	await writer.writeText(outputFilePath, content);

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
