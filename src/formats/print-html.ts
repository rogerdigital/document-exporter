import { App } from "obsidian";
import { AssembledDocument, ExportPlan } from "@/types";
import { OutputWriter } from "@/export/OutputWriter";
import { renderHtmlDocument } from "./html-document";

export async function renderPrintHtml(
	doc: AssembledDocument,
	plan: ExportPlan,
	writer: OutputWriter,
	app: App | null = null,
): Promise<string[]> {
	return renderHtmlDocument(doc, plan, writer, true, app);
}
