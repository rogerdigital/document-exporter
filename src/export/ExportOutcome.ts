export type ExportStatus = "completed" | "partial" | "cancelled" | "failed";

export interface ExportResult {
	status: ExportStatus;
	success: boolean; // true only for completed; UI switches on status
	outputRoot: string; // actual batch leaf or relocated single-file root
	totalFiles: number; // original requested input count
	completedFiles: number; // fully processed primary files
	completedPaths: string[];
	incompletePaths: string[]; // outputs that may exist but are not complete
	warnings: string[];
	errors: string[];
	reportPath?: string;
}

export function resolveExportStatus(
	cancelled: boolean,
	completed: number,
	total: number,
	hasFailure: boolean,
): ExportStatus {
	if (cancelled) return "cancelled";
	if (completed === total && total > 0 && !hasFailure) return "completed";
	return completed > 0 ? "partial" : "failed";
}
