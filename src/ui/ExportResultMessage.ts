import type { ExportResult } from "@/export/ExportOutcome";

export function exportResultMessage(result: ExportResult): string {
	const labels = {
		completed: "Export complete",
		partial: "Export partially complete",
		cancelled: "Export cancelled",
		failed: "Export failed",
	} as const;
	const pieces = [
		`${labels[result.status]}: ${result.completedFiles}/${result.totalFiles} file(s) complete`,
		result.outputRoot,
	];
	if (result.incompletePaths.length) {
		pieces.push(`${result.incompletePaths.length} output(s) may be incomplete`);
	}
	const firstDiagnostic = result.errors[0] ?? result.warnings[0];
	if (firstDiagnostic) pieces.push(firstDiagnostic);
	if (result.reportPath) pieces.push(`Details: ${result.reportPath}`);
	if (result.status !== "completed") {
		pieces.push("Existing output was kept. Retry with overwrite off to create a separate export.");
	}
	return pieces.join(" — ");
}
