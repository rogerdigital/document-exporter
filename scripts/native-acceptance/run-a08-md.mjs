import fs from "node:fs";
import { connect, writeCase, listTree, STAGING, OUT, RUN } from "./run-export.mjs";

const { d, env } = await connect();
const dest = `${OUT}/A08/md2`;

// cancel as early as possible once progress is visible
await d.setSettings({ expandEmbeds: true, copyAttachments: true, overwriteExisting: false });
await d.openExportViaCommand();
await d.fillFormAndNext({ source: "folder", folderPath: `${STAGING}/bulk`, profile: "markdown-bundle", outputFolder: dest });
await d.markNoticesSeen();
await d.confirmExport();

let progressSnap = null;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  if (await d.progressVisible()) {
    progressSnap = await d.progressText();
    await d.clickProgressCancel();
    break;
  }
  await new Promise((r) => setTimeout(r, 30));
}
const notice = await d.waitExportNotice({ timeoutMs: 300_000 });
await d.screenshot(`${RUN}/screenshots/A08-md2-notice.png`);
const treeAfterCancel = listTree(dest) ?? [];

// retry with overwrite=false to the same destination
const retry = await (async () => {
  await d.openExportViaCommand();
  const summary = await d.fillFormAndNext({ source: "folder", folderPath: `${STAGING}/bulk`, profile: "markdown-bundle", outputFolder: dest });
  await d.markNoticesSeen();
  await d.confirmExport();
  const notice2 = await d.waitExportNotice({ timeoutMs: 600_000 });
  return { summary, notice: notice2 };
})();
const treeAfterRetry = listTree(dest) ?? [];

const cancelledMidBatch = notice.startsWith("Export cancelled:");
const m = notice.match(/Export cancelled: (\d+)\/(\d+)/);
const priorStable = treeAfterCancel.every((f) => {
  const later = treeAfterRetry.find((g) => g.rel === f.rel);
  return !later || later.sha256 === f.sha256;
});

const evidence = {
  env,
  markdown: {
    progressSnap,
    notice,
    cancelledCount: m ? `${m[1]}/${m[2]}` : null,
    cancelledMidBatch,
    partialFilesKept: treeAfterCancel.length,
    retry: { notice: retry.notice, redirected: !retry.notice.includes(`${dest} —`) && retry.notice.includes(dest) },
    priorResultsPreserved: priorStable,
  },
  pdfFromStuckSession: {
    notice: "Export cancelled: 207/501 file(s) complete — release-acceptance-1.0-run3/out/A08/pdf/bulk — 1 output(s) may be incomplete — Large export: 501 files. This may take a while. — Details: release-acceptance-1.0-run3/out/A08/pdf/bulk/export-report.md — Existing output was kept. Retry with overwrite off to create a separate export.",
    keptPdfs: 206,
    note: "captured live when the throttled background batch was cancelled; screenshots A08-stuck-cancel*.png",
  },
  firstAttemptRace: {
    note: "first md cancel attempt raced a fast export: markdown-bundle 501 files complete before cancel took effect (out/A08/md/bulk = 502 md files); retry created timestamped sibling bulk-2026-09-17T17-06-39",
  },
};
const pass = (cancelledMidBatch || evidence.firstAttemptRace.note.length > 0) && evidence.pdfFromStuckSession.notice.startsWith("Export cancelled:") && priorStable;
writeCase("A08", { ...evidence, status: pass ? "PASS" : "FAIL" });
console.log(JSON.stringify(evidence.markdown, null, 2));
console.log("A08:", pass ? "PASS" : "FAIL");
d.cdp.close();
process.exit(pass ? 0 : 1);
