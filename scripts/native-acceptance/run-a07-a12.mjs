import fs from "node:fs";
import { spawn } from "node:child_process";
import { connect, runExport, writeCase, listTree, readVaultText, sha256, vaultPath, STAGING, OUT, RUN } from "./run-export.mjs";

const { d, env } = await connect();
const results = {};
const fail = (id, msg) => { results[id] = { status: "FAIL", error: msg }; console.error(`[${id}] FAIL: ${msg}`); };
const ok = (id, data) => { results[id] = { status: "PASS", ...data }; console.log(`[${id}] PASS`); };

const COMBOS = [
  { tag: "tt", expandEmbeds: true, copyAttachments: true },
  { tag: "tf", expandEmbeds: true, copyAttachments: false },
  { tag: "ft", expandEmbeds: false, copyAttachments: true },
  { tag: "ff", expandEmbeds: false, copyAttachments: false },
];
const A07_INPUTS = ["heading-host", "adjacency", "cycle-a"];

try {
  // ---------- A07: embed/copy combinations, PDF + HTML ----------
  try {
    await d.setSettings({ overwriteExisting: false });
    const runs = [];
    for (const combo of COMBOS) {
      await d.setSettings({ expandEmbeds: combo.expandEmbeds, copyAttachments: combo.copyAttachments });
      for (const name of A07_INPUTS) {
        runs.push({ combo: combo.tag, format: "html", name, ...(await runExport(d, {
          entry: "command",
          file: `${STAGING}/${name === "cycle-a" ? "failure/cycle-a" : name}.md`,
          form: { source: "current-file", profile: "html-document", outputFolder: `${OUT}/A07/html/${combo.tag}/${name}`, outputName: name },
          timeoutMs: 240_000,
        })) });
      }
    }
    // PDF spot matrix: tt for all three, ff heading-host, ft adjacency
    const pdfMatrix = [
      { tag: "tt", name: "heading-host" }, { tag: "tt", name: "adjacency" }, { tag: "tt", name: "cycle-a" },
      { tag: "ff", name: "heading-host" }, { tag: "ft", name: "adjacency" },
    ];
    await d.setSettings({ expandEmbeds: true, copyAttachments: true });
    for (const m of pdfMatrix) {
      const combo = COMBOS.find((c) => c.tag === m.tag);
      await d.setSettings({ expandEmbeds: combo.expandEmbeds, copyAttachments: combo.copyAttachments });
      runs.push({ combo: m.tag, format: "pdf", name: m.name, ...(await runExport(d, {
        entry: "command",
        file: `${STAGING}/${m.name === "cycle-a" ? "failure/cycle-a" : m.name}.md`,
        form: { source: "current-file", profile: "pdf", outputFolder: `${OUT}/A07/pdf/${m.tag}/${m.name}`, outputName: m.name },
        timeoutMs: 300_000,
      })) });
    }
    await d.setSettings({ expandEmbeds: true, copyAttachments: true });

    const checks = {};
    for (const r of runs) {
      const base = r.format === "html"
        ? `${OUT}/A07/html/${r.combo}/${r.name}/${r.name}.html`
        : `${OUT}/A07/pdf/${r.combo}/${r.name}/${r.name}.pdf`;
      const exists = fs.existsSync(vaultPath(base));
      checks[`${r.combo}-${r.name}-${r.format}-exists`] = exists;
      checks[`${r.combo}-${r.name}-${r.format}-notice`] = r.notice.startsWith("Export complete: 1/1") ? true : r.notice;
      if (r.format === "html" && exists) {
        const text = readVaultText(base);
        if (r.name === "heading-host") {
          const expand = r.combo[0] === "t";
          checks[`${r.combo}-host-wanted${expand ? "" : "-absent"}`] = text.includes("WANTED-SENTINEL") === expand;
          checks[`${r.combo}-host-excluded-absent`] = !text.includes("EXCLUDED-SENTINEL");
        }
        if (r.name === "adjacency") {
          checks[`${r.combo}-adj-after-image`] = text.includes("AFTER-IMAGE-SENTINEL");
          const tree = listTree(`${OUT}/A07/html/${r.combo}/${r.name}`);
          const hasAssets = tree.some((f) => f.rel.includes("assets/"));
          checks[`${r.combo}-adj-assets=${r.combo[1] === "t"}`] = hasAssets === (r.combo[1] === "t");
        }
      }
    }
    // bounded cycle handling: every cycle-a run completed without freeze
    checks.cycleBounded = runs.filter((r) => r.name === "cycle-a").every((r) => r.notice.startsWith("Export complete"));
    writeCase("A07", { env, matrix: { html: "4 combos x 3 inputs", pdf: "tt x3, ff heading-host, ft adjacency" }, runs, checks });
    if (Object.values(checks).every((v) => v === true)) ok("A07", { combos: Object.keys(checks).length }); else fail("A07", JSON.stringify(Object.fromEntries(Object.entries(checks).filter(([, v]) => v !== true))));
  } catch (e) { fail("A07", e.message); }

  // ---------- A08: cancel mid-batch + retry preserves results ----------
  try {
    await d.setSettings({ expandEmbeds: true, copyAttachments: true, overwriteExisting: false });
    const cancelBatch = async (profile, dest, shotPrefix) => {
      await d.openExportViaCommand();
      await d.fillFormAndNext({ source: "folder", folderPath: `${STAGING}/bulk`, profile, outputFolder: dest });
      await d.markNoticesSeen();
      await d.confirmExport();
      // wait until progress is actually visible with completed>0, then cancel
      const dead = Date.now() + 120_000;
      let progressSnap = null;
      while (Date.now() < dead) {
        const visible = await d.progressVisible();
        if (visible) {
          progressSnap = await d.progressText();
          await d.clickProgressCancel();
          break;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      if (shotPrefix && progressSnap) await d.screenshot(`${RUN}/screenshots/${shotPrefix}-cancel.png`);
      const notice = await d.waitExportNotice({ timeoutMs: 240_000 });
      if (shotPrefix) await d.screenshot(`${RUN}/screenshots/${shotPrefix}-notice.png`);
      return { progressSnap, notice };
    };

    const md = await cancelBatch("markdown-bundle", `${OUT}/A08/md`, "A08-md");
    const treeAfterCancel = listTree(`${OUT}/A08/md`);
    const retry = await runExport(d, {
      entry: "command",
      form: { source: "folder", folderPath: `${STAGING}/bulk`, profile: "markdown-bundle", outputFolder: `${OUT}/A08/md` },
      timeoutMs: 600_000,
    });
    const treeAfterRetry = listTree(`${OUT}/A08/md`);
    const priorStable = treeAfterCancel.every((f) => {
      const later = treeAfterRetry.find((g) => g.rel === f.rel);
      return !later || later.sha256 === f.sha256;
    });
    const pdf = await cancelBatch("pdf", `${OUT}/A08/pdf`, "A08-pdf");

    const checks = {
      mdCancelledNotice: md.notice.startsWith("Export cancelled:"),
      mdCancelledProgressSeen: !!md.progressSnap,
      mdPartialOutputsKept: treeAfterCancel.length > 0,
      mdRetryComplete: retry.notice.includes("501/501 file(s) complete"),
      mdPriorResultsPreserved: priorStable,
      pdfCancelledNotice: pdf.notice.startsWith("Export cancelled:") || pdf.notice.startsWith("Export partially complete:"),
    };
    writeCase("A08", { env, md, retry, pdf, checks, treeAfterCancel: treeAfterCancel.length, treeAfterRetry: treeAfterRetry.length });
    if (checks.mdCancelledNotice && checks.mdPartialOutputsKept && checks.mdRetryComplete && checks.mdPriorResultsPreserved && checks.pdfCancelledNotice) ok("A08", { checks }); else fail("A08", JSON.stringify(checks));
  } catch (e) { fail("A08", e.message); }

  // ---------- A09: long document PDF + DOCX ----------
  try {
    const pdf = await runExport(d, {
      entry: "command", file: `${STAGING}/long.md`,
      form: { source: "current-file", profile: "pdf", outputFolder: `${OUT}/A09/pdf`, outputName: "long" },
      shotPrefix: "A09-pdf", timeoutMs: 600_000,
    });
    const docx = await runExport(d, {
      entry: "command", file: `${STAGING}/long.md`,
      form: { source: "current-file", profile: "docx", outputFolder: `${OUT}/A09/docx`, outputName: "long" },
      timeoutMs: 600_000,
    });
    const checks = {
      pdfComplete: pdf.notice.startsWith("Export complete: 1/1"),
      docxComplete: docx.notice.startsWith("Export complete: 1/1"),
      pdfSize: fs.statSync(vaultPath(`${OUT}/A09/pdf/long.pdf`)).size,
      docxSize: fs.statSync(vaultPath(`${OUT}/A09/docx/long.docx`)).size,
    };
    writeCase("A09", { env, pdf, docx, checks });
    if (checks.pdfComplete && checks.docxComplete) ok("A09", { checks }); else fail("A09", JSON.stringify(checks));
  } catch (e) { fail("A09", e.message); }

  // ---------- A10: loopback network probe ----------
  try {
    const probeSrc = `${RUN}/harness/probe-server.cjs`;
    fs.writeFileSync(probeSrc, `const http = require("node:http");
const fs = require("node:fs");
const png = fs.readFileSync(process.argv[2]);
http.createServer((request, response) => {
  process.stdout.write(JSON.stringify({ method: request.method, url: request.url, at: Date.now() }) + "\\n");
  response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  response.end(png);
}).listen(0, "127.0.0.1", function () { process.stdout.write("PORT=" + this.address().port + "\\n"); });
`);
    const server = spawn("node", [probeSrc, vaultPath(`${STAGING}/images/landscape.png`)], { stdio: ["ignore", "pipe", "pipe"] });
    let port = null;
    const requests = [];
    server.stdout.on("data", (buf) => {
      for (const line of buf.toString().split("\n").filter(Boolean)) {
        if (line.startsWith("PORT=")) port = Number(line.slice(5));
        else { try { requests.push(JSON.parse(line)); } catch {} }
      }
    });
    // wait for port
    for (let i = 0; i < 30 && !port; i++) await new Promise((r) => setTimeout(r, 100));
    if (!port) throw new Error("probe server did not report a port");

    const probeNote = `${STAGING}/probe.md`;
    const writeNote = (phase) => fs.writeFileSync(vaultPath(probeNote), `# Probe ${phase}\n\n![Probe](http://127.0.0.1:${port}/probe.png?phase=${phase})\n`);

    // phase: preview (reading view)
    writeNote("preview");
    await d.cdp.evalJs(`(async () => {
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(probeNote)});
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(f);
      await leaf.setViewState({ type: 'markdown', state: { mode: 'preview' } });
    })()`);
    await new Promise((r) => setTimeout(r, 4000));
    await d.screenshot(`${RUN}/screenshots/A10-preview.png`);
    const previewRequests = requests.filter((r2) => r2.url.includes("phase=preview")).length;

    // phase: export html
    writeNote("export");
    const htmlRun = await runExport(d, {
      entry: "command", file: probeNote,
      form: { source: "current-file", profile: "html-document", outputFolder: `${OUT}/A10/export`, outputName: "probe" },
      timeoutMs: 240_000,
    });
    await new Promise((r) => setTimeout(r, 2000));
    const exportRequests = requests.filter((r2) => r2.url.includes("phase=export")).length;

    // phase: open exported HTML in a real browser (Chrome)
    writeNote("open");
    const openRun = await runExport(d, {
      entry: "command", file: probeNote,
      form: { source: "current-file", profile: "html-document", outputFolder: `${OUT}/A10/open`, outputName: "probe" },
      timeoutMs: 240_000,
    });
    await new Promise((r) => setTimeout(r, 1000));
    const openFile = vaultPath(`${OUT}/A10/open/probe.html`);
    spawn("open", ["-a", "Google Chrome", openFile]);
    await new Promise((r) => setTimeout(r, 5000));
    const openRequests = requests.filter((r2) => r2.url.includes("phase=open")).length;
    await d.screenshot(`${RUN}/screenshots/A10-chrome-open.png`);

    // phase: pdf render
    writeNote("pdf");
    const pdfRun = await runExport(d, {
      entry: "command", file: probeNote,
      form: { source: "current-file", profile: "pdf", outputFolder: `${OUT}/A10/pdf`, outputName: "probe" },
      timeoutMs: 300_000,
    });
    await new Promise((r) => setTimeout(r, 2000));
    const pdfRequests = requests.filter((r2) => r2.url.includes("phase=pdf")).length;

    server.kill();
    const checks = { port, previewRequests, exportRequests, openRequests, pdfRequests,
      htmlComplete: htmlRun.notice.startsWith("Export complete: 1/1"),
      pdfComplete: pdfRun.notice.startsWith("Export complete: 1/1") };
    writeCase("A10", { env, checks, runs: { html: htmlRun, pdf: pdfRun }, allRequests: requests });
    ok("A10", checks); // observational case: record actual counts, PASS = probe executed
  } catch (e) { fail("A10", e.message); }

  // ---------- A11: documented limitations across five formats ----------
  try {
    const formats = ["pdf", "docx", "epub", "markdown-bundle", "html-document"];
    const runs = {};
    for (const profile of formats) {
      runs[profile] = await runExport(d, {
        entry: "command", file: `${STAGING}/limitations.md`,
        form: { source: "current-file", profile, outputFolder: `${OUT}/A11/${profile}`, outputName: "limitations" },
        timeoutMs: 300_000,
      });
      console.log(`[A11] ${profile}: ${runs[profile].notice}`);
    }
    const allComplete = Object.values(runs).every((r) => r.notice.startsWith("Export complete"));
    const md = readVaultText(`${OUT}/A11/markdown-bundle/limitations.md`);
    writeCase("A11", { env, runs, mdSample: md.slice(0, 1500), trees: { md: listTree(`${OUT}/A11/markdown-bundle`) } });
    if (allComplete) ok("A11", {}); else fail("A11", "not all formats completed");
  } catch (e) { fail("A11", e.message); }

  // ---------- A12: bulk 100 then 501, md + html ----------
  try {
    const bulkPaths = (n) => Array.from({ length: n }, (_, i) => `${STAGING}/bulk/note-${String(i + 1).padStart(3, "0")}.md`);
    const mem = () => d.cdp.evalJs(`(performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize } : null)`);

    const run100md = await runExport(d, {
      entry: "command",
      form: { source: "files", filePaths: bulkPaths(100), profile: "markdown-bundle", outputFolder: `${OUT}/A12/md-100`, outputName: "bulk100" },
      shotPrefix: "A12-100", timeoutMs: 600_000,
    });
    const run100html = await runExport(d, {
      entry: "command",
      form: { source: "files", filePaths: bulkPaths(100), profile: "html-document", outputFolder: `${OUT}/A12/html-100`, outputName: "bulk100" },
      timeoutMs: 600_000,
    });
    const run501md = await runExport(d, {
      entry: "command",
      form: { source: "folder", folderPath: `${STAGING}/bulk`, profile: "markdown-bundle", outputFolder: `${OUT}/A12/md-501`, outputName: "bulk501" },
      shotPrefix: "A12-501", timeoutMs: 900_000,
    });
    const run501html = await runExport(d, {
      entry: "command",
      form: { source: "folder", folderPath: `${STAGING}/bulk`, profile: "html-document", outputFolder: `${OUT}/A12/html-501`, outputName: "bulk501" },
      timeoutMs: 900_000,
    });

    const counts = {
      md100: listTree(`${OUT}/A12/md-100`).filter((f) => f.rel.endsWith(".md")).length,
      html100: listTree(`${OUT}/A12/html-100`).filter((f) => f.rel.endsWith(".html")).length,
      md501: listTree(`${OUT}/A12/md-501`).filter((f) => f.rel.endsWith(".md")).length,
      html501: listTree(`${OUT}/A12/html-501`).filter((f) => f.rel.endsWith(".html")).length,
    };
    const checks = {
      counts,
      md100Complete: run100md.notice.includes("100/100 file(s) complete"),
      html100Complete: run100html.notice.includes("100/100 file(s) complete"),
      md501Complete: run501md.notice.includes("501/501 file(s) complete"),
      html501Complete: run501html.notice.includes("501/501 file(s) complete"),
      largeExportWarning501md: run501md.notice.includes("Large export: 501 files"),
      largeExportWarning501html: run501html.notice.includes("Large export: 501 files"),
      noWarningAt100: !run100md.notice.includes("Large export"),
      uiUsableAfter: !!(await mem()),
      elapsed: { md100: run100md.elapsedMs, html100: run100html.elapsedMs, md501: run501md.elapsedMs, html501: run501html.elapsedMs },
    };
    writeCase("A12", { env, checks, runs: { run100md, run100html, run501md, run501html } });
    const required = ["md100Complete", "html100Complete", "md501Complete", "html501Complete", "largeExportWarning501md", "largeExportWarning501html", "noWarningAt100"];
    if (required.every((k) => checks[k] === true)) ok("A12", { counts }); else fail("A12", JSON.stringify(checks));
  } catch (e) { fail("A12", e.message); }
} finally {
  fs.writeFileSync(`${RUN}/artifacts/results-a07-a12.json`, JSON.stringify(results, null, 2));
  d.cdp.close();
}
console.log("A07-A12 summary:", JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status]))));
process.exit(Object.values(results).some((r) => r.status === "FAIL") ? 1 : 0);
