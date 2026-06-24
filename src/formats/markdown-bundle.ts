import { AssembledDocument, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";

export async function renderMarkdownBundle(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	outputFilePath: string,
): Promise<string[]> {
	const warnings: string[] = [];

	// Ensure output folder exists (attachments are copied centrally by
	// ExportRunner Step 6 into <assetsRoot>/assets, where assetsRoot is the
	// target folder, consistent across all formats).
	await writer.ensureFolder(plan.outputRoot);

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

	return warnings;
}
