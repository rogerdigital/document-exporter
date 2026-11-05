import type { ExportPlan, ExportSettings } from "@/types";
import { relocatePlan } from "@/export/ExportPlan";
import { OutputWriter } from "@/export/OutputWriter";

function nextAvailablePath(candidate: string, writer: OutputWriter): string {
	let path = candidate;
	let sequence = 2;
	while (writer.pathExists(path)) path = `${candidate}-${sequence++}`;
	return path;
}

/** Shared by confirmation and execution; execution rechecks for intervening writes. */
export function resolveOutputPlan(plan: ExportPlan, settings: ExportSettings, writer: OutputWriter): ExportPlan {
	if (writer.pathExists(plan.outputRoot) && !writer.folderExists(plan.outputRoot)) {
		throw new Error("Output destination is not a folder. Choose another output folder.");
	}
	if (settings.overwriteExisting) return plan;
	const root = plan.outputFolderName ? `${plan.outputRoot}/${plan.outputFolderName}` : plan.outputRoot;
	// Reserve the shared assets namespace as a unit: different notes may use
	// the same relative attachment name for different source bytes.
	const conflict = plan.outputFiles.some(path => writer.pathExists(path))
		|| writer.pathExists(`${root}/assets`)
		|| (writer.pathExists(root) && !writer.folderExists(root));
	if (!conflict) return plan;
	if (plan.source.type === "current-file" || plan.mergeIntoSingleFile || !plan.outputFolderName) {
		const name = plan.outputFilename.replace(/\.(md|html|htm|pdf|docx|epub)$/i, "");
		return relocatePlan(plan, nextAvailablePath(`${plan.outputRoot}/${name}-${writer.timestampSuffix()}`, writer));
	}
	const path = nextAvailablePath(`${root}-${writer.timestampSuffix()}`, writer);
	return relocatePlan(plan, plan.outputRoot, path.slice(plan.outputRoot.length + 1));
}
