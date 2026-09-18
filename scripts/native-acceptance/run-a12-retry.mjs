import fs from "node:fs";
import { connect, runExport, writeCase, listTree, STAGING, OUT, RUN } from "./run-export.mjs";

const { d, env } = await connect();

// keep the window foreground-ish during long batches (real-user condition)
const keepAlive = setInterval(() => { d.cdp.send("Page.bringToFront").catch(() => {}); }, 30_000);

try {
  await d.setSettings({ expandEmbeds: true, copyAttachments: true, overwriteExisting: false });
  const bulkPaths = (n) => Array.from({ length: n }, (_, i) => `${STAGING}/bulk/note-${String(i + 1).padStart(3, "0")}.md`);

  const html100 = await runExport(d, {
    entry: "command",
    form: { source: "files", filePaths: bulkPaths(100), profile: "html-document", outputFolder: `${OUT}/A12/html-100`, outputName: "bulk100" },
    shotPrefix: "A12-html100-retry", timeoutMs: 900_000,
  });
  console.log(`[A12] html-100: ${html100.notice}`);

  const md501 = await runExport(d, {
    entry: "command",
    form: { source: "folder", folderPath: `${STAGING}/bulk`, profile: "markdown-bundle", outputFolder: `${OUT}/A12/md-501`, outputName: "bulk501" },
    timeoutMs: 900_000,
  });
  console.log(`[A12] md-501: ${md501.notice}`);

  const html501 = await runExport(d, {
    entry: "command",
    form: { source: "folder", folderPath: `${STAGING}/bulk`, profile: "html-document", outputFolder: `${OUT}/A12/html-501`, outputName: "bulk501" },
    shotPrefix: "A12-html501", timeoutMs: 1_800_000,
  });
  console.log(`[A12] html-501: ${html501.notice}`);

  const counts = {
    html100: listTree(`${OUT}/A12/html-100`).filter((f) => f.rel.endsWith(".html")).length,
    md501: listTree(`${OUT}/A12/md-501`).filter((f) => f.rel.endsWith(".md")).length,
    html501: listTree(`${OUT}/A12/html-501`).filter((f) => f.rel.endsWith(".html")).length,
  };
  const checks = {
    counts,
    html100Complete: html100.notice.includes("100/100 file(s) complete"),
    md501Complete: md501.notice.includes("501/501 file(s) complete"),
    html501Complete: html501.notice.includes("501/501 file(s) complete"),
    largeWarning501md: md501.notice.includes("Large export: 501 files"),
    largeWarning501html: html501.notice.includes("Large export: 501 files"),
    elapsedMs: { html100: html100.elapsedMs, md501: md501.elapsedMs, html501: html501.elapsedMs },
    uiUsableAfter: !!(await d.cdp.evalJs(`performance.memory ? performance.memory.usedJSHeapSize : null`)),
  };
  writeCase("A12", { env, retry: { html100, md501, html501 }, checks });
  console.log("A12:", JSON.stringify(checks));
} finally {
  clearInterval(keepAlive);
  d.cdp.close();
}
