import { AssembledDocument, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { renderHtmlDocument } from "./html-document";

export async function renderPrintHtml(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
): Promise<string[]> {
	return renderHtmlDocument(doc, plan, writer, true);
}
