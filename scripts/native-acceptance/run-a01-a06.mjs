import fs from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { connect, runExport, writeCase, listTree, readVaultText, sha256, vaultPath, STAGING, OUT, RUN } from "./run-export.mjs";

const createHashSha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const fixtureManifest = JSON.parse(readVaultText(`${STAGING}/fixture-manifest.json`));
const originalImgHash = fixtureManifest.find((e) => e.path === "collision/a/img.png").sha256;

const { d, env } = await connect();
const results = {};
const fail = (id, msg) => { results[id] = { status: "FAIL", error: msg }; console.error(`[${id}] FAIL: ${msg}`); };
const ok = (id, data) => { results[id] = { status: "PASS", ...data }; console.log(`[${id}] PASS`); };

try {
  // ---------- A01: content.md, editor context menu, five formats ----------
  try {
    await d.setSettings({ expandEmbeds: true, copyAttachments: true, overwriteExisting: false });
    const formats = ["pdf", "docx", "epub", "markdown-bundle", "html-document"];
    const runs = {};
    for (const [i, profile] of formats.entries()) {
      runs[profile] = await runExport(d, {
        entry: "editor-menu",
        file: `${STAGING}/content.md`,
        form: { source: "current-file", profile, outputFolder: `${OUT}/A01/${profile}`, outputName: "content" },
        shotPrefix: i === 0 ? "A01" : null,
        timeoutMs: 300_000,
      });
      console.log(`[A01] ${profile}: ${runs[profile].notice}`);
    }
    const md = readVaultText(`${OUT}/A01/markdown-bundle/content.md`);
    const html = readVaultText(`${OUT}/A01/html-document/content.html`);
    const checks = {
      mdMarkers: ["BEGIN-CONTENT", "END-CONTENT", "中文导出", "😀", "café", "Alpha", "123", "中文", "456", "CODE-CONTENT"].every((m) => md.includes(m)),
      mdImages: md.includes("assets/landscape.png") && md.includes("assets/portrait.png"),
      htmlMarkers: ["BEGIN-CONTENT", "END-CONTENT", "中文导出", "CODE-CONTENT"].every((m) => html.includes(m)),
      landscapeBytesEqual: sha256(vaultPath(`${OUT}/A01/markdown-bundle/assets/landscape.png`)) === sha256(vaultPath(`${STAGING}/images/landscape.png`)),
      portraitBytesEqual: sha256(vaultPath(`${OUT}/A01/markdown-bundle/assets/portrait.png`)) === sha256(vaultPath(`${STAGING}/images/portrait.png`)),
      pdfExists: fs.statSync(vaultPath(`${OUT}/A01/pdf/content.pdf`)).size > 1000,
      docxExists: fs.statSync(vaultPath(`${OUT}/A01/docx/content.docx`)).size > 1000,
      epubExists: fs.statSync(vaultPath(`${OUT}/A01/epub/content.epub`)).size > 1000,
      noticesAllComplete: Object.values(runs).every((r) => r.notice.startsWith("Export complete: 1/1")),
    };
    writeCase("A01", { env, runs, checks, trees: { md: listTree(`${OUT}/A01/markdown-bundle`), html: listTree(`${OUT}/A01/html-document`) } });
    if (Object.values(checks).every(Boolean)) ok("A01", { checks }); else fail("A01", JSON.stringify(checks));
  } catch (e) { fail("A01", e.message); }

  // ---------- A02: folder right-click, five-format batch ----------
  try {
    const formats = ["pdf", "docx", "epub", "markdown-bundle", "html-document"];
    const runs = {};
    for (const [i, profile] of formats.entries()) {
      runs[profile] = await runExport(d, {
        entry: "folder-menu",
        folderPath: `${STAGING}/folder`,
        form: { source: "folder", folderPath: `${STAGING}/folder`, profile, outputFolder: `${OUT}/A02/${profile}` },
        shotPrefix: i === 0 ? "A02" : null,
        timeoutMs: 300_000,
      });
      console.log(`[A02] ${profile}: ${runs[profile].notice}`);
    }
    const mdTree = listTree(`${OUT}/A02/markdown-bundle`);
    const mdPrimaries = mdTree.map((f) => f.rel).filter((p) => p.endsWith(".md"));
    const htmlTree = listTree(`${OUT}/A02/html-document`);
    const checks = {
      threeMdPrimaries: mdPrimaries.filter((p) => ["folder/index.md", "folder/nested/part.md", "folder/nested/third.md"].includes(p)).length === 3,
      nestedPathsPreserved: mdPrimaries.some((p) => p === "folder/nested/part.md"),
      htmlPrimaries: htmlTree.map((f) => f.rel).filter((p) => p.endsWith(".html")).length >= 3,
      noticesBatchComplete: Object.values(runs).every((r) => r.notice.includes("3/3 file(s) complete")),
    };
    writeCase("A02", { env, runs, checks, trees: { md: mdTree, html: htmlTree } });
    if (Object.values(checks).every(Boolean)) ok("A02", { checks }); else fail("A02", JSON.stringify(checks));
  } catch (e) { fail("A02", e.message); }

  // ---------- A03: command palette -> Selected files (index + third) ----------
  try {
    const formats = ["markdown-bundle", "html-document", "docx"];
    const runs = {};
    for (const profile of formats) {
      runs[profile] = await runExport(d, {
        entry: "command",
        form: {
          source: "files",
          filePaths: [`${STAGING}/folder/index.md`, `${STAGING}/folder/nested/third.md`],
          profile,
          outputFolder: `${OUT}/A03/${profile}`,
          outputName: "selected",
        },
        shotPrefix: profile === "markdown-bundle" ? "A03" : null,
        timeoutMs: 300_000,
      });
      console.log(`[A03] ${profile}: ${runs[profile].notice}`);
    }
    const mdTree = listTree(`${OUT}/A03/markdown-bundle`).map((f) => f.rel);
    const checks = {
      exactlyTwoPrimaries: mdTree.filter((p) => p.endsWith(".md")).length === 2,
      excludedPartAbsent: !mdTree.some((p) => p.includes("part.")),
      indexAndThirdPresent: mdTree.some((p) => p.endsWith("index.md")) && mdTree.some((p) => p.endsWith("third.md")),
      noticeCountsCorrect: Object.values(runs).every((r) => r.notice.includes("2/2 file(s) complete")),
    };
    writeCase("A03", { env, runs, checks, trees: { md: listTree(`${OUT}/A03/markdown-bundle`) } });
    if (Object.values(checks).every(Boolean)) ok("A03", { checks }); else fail("A03", JSON.stringify(checks));
  } catch (e) { fail("A03", e.message); }

  // ---------- A04: A -> B -> A to identical destination (md + html) ----------
  try {
    const runs = { md: [], html: [] };
    const trees = { md: [], html: [] };
    for (const fmt of ["md", "html"]) {
      const profile = fmt === "md" ? "markdown-bundle" : "html-document";
      const dest = `${OUT}/A04/${fmt}`;
      for (const which of ["a", "b", "a2"]) {
        const src = which === "b" ? `${STAGING}/collision/b/B.md` : `${STAGING}/collision/a/A.md`;
        runs[fmt].push(await runExport(d, {
          entry: "command",
          file: src,
          form: { source: "current-file", profile, outputFolder: dest, outputName: which === "b" ? "B" : "A" },
          timeoutMs: 240_000,
        }));
        console.log(`[A04.${fmt}.${which}] ${runs[fmt].at(-1).notice}`);
        trees[fmt].push(listTree(dest));
      }
    }
    // first-run files must be unchanged after later runs
    const firstRunStable = (fmt) => trees[fmt][0].every((f) => {
      const later = trees[fmt].find((t, idx) => idx > 0 && t.some((g) => g.rel === f.rel));
      const all = trees[fmt].slice(1).flat().filter((g) => g.rel === f.rel);
      return all.every((g) => g.sha256 === f.sha256);
    });
    const redHash = sha256(vaultPath(`${STAGING}/collision/a/img.png`));
    const blueHash = sha256(vaultPath(`${STAGING}/collision/b/img.png`));
    const bOutput = trees.md[1].find((f) => f.rel.endsWith("img.png"));
    const checks = {
      mdFirstRunStable: firstRunStable("md"),
      htmlFirstRunStable: firstRunStable("html"),
      bReferencesBlue: bOutput ? bOutput.sha256 === blueHash : false,
      aReferencesRed: trees.md[0].find((f) => f.rel.endsWith("img.png"))?.sha256 === redHash,
      noticesIdentifyDestinations: runs.md.every((r) => r.notice.includes(`${OUT}/A04/md`)),
      rerunsRedirected: runs.md.slice(1).every((r) => r.notice.includes(`${OUT}/A04/md/2`)),
    };
    writeCase("A04", { env, runs, checks, trees });
    if (checks.mdFirstRunStable && checks.htmlFirstRunStable && checks.bReferencesBlue && checks.aReferencesRed && checks.rerunsRedirected) ok("A04", { checks }); else fail("A04", JSON.stringify(checks));
  } catch (e) { fail("A04", e.message); }

  // ---------- A05: export A, change its image, re-export with overwrite ----------
  try {
    // tiny PNG encoder (same scheme as the fixture generator)
    const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const t = Buffer.from(type, "ascii"); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); };
    const png = (w, h, rgb) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const px = Buffer.alloc(h * (1 + w * 3)); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (1 + w * 3) + 1 + x * 3; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(px)), chunk("IEND", Buffer.alloc(0))]); };

    const run1 = await runExport(d, {
      entry: "command",
      file: `${STAGING}/collision/a/A.md`,
      form: { source: "current-file", profile: "markdown-bundle", outputFolder: `${OUT}/A05`, outputName: "A" },
      timeoutMs: 240_000,
    });
    const tree1 = listTree(`${OUT}/A05`);
    const img1 = tree1.find((f) => f.rel.endsWith("img.png"));

    // change the synthetic source image (green now); hash before writing
    const vaultImg = `${STAGING}/collision/a/img.png`;
    const beforeChange = sha256(vaultPath(vaultImg));
    const greenPngHash = createHashSha256(png(160, 100, [30, 210, 30]));
    fs.writeFileSync(vaultPath(vaultImg), png(160, 100, [30, 210, 30]));

    await d.setSettings({ overwriteExisting: true });
    const run2 = await runExport(d, {
      entry: "command",
      file: `${STAGING}/collision/a/A.md`,
      form: { source: "current-file", profile: "markdown-bundle", outputFolder: `${OUT}/A05`, outputName: "A" },
      timeoutMs: 240_000,
    });
    await d.setSettings({ overwriteExisting: false });
    const tree2 = listTree(`${OUT}/A05`);
    const img2 = tree2.find((f) => f.rel.endsWith("img.png"));

    const checks = {
      run1Complete: run1.notice.startsWith("Export complete: 1/1"),
      run2Complete: run2.notice.startsWith("Export complete: 1/1"),
      oldImageWasFixtureRed: beforeChange === originalImgHash,
      overwriteReplacedImage: img1 && img2 && img1.sha256 !== img2.sha256 && img2.sha256 === greenPngHash,
      sourceUntouchedByExport: sha256(vaultPath(vaultImg)) === greenPngHash,
      unrelatedOutputsIntact: fs.existsSync(vaultPath(`${OUT}/A03/markdown-bundle`)) && fs.existsSync(vaultPath(`${OUT}/smoke/content.md`)),
      noExtraTimestampedDir: tree2.filter((f) => /\/\d{4}-\d{2}-\d{2}/.test(f.rel)).length === 0,
    };
    writeCase("A05", { env, runs: { run1, run2 }, checks, trees: { run1: tree1, run2: tree2 } });
    if (checks.run1Complete && checks.run2Complete && checks.overwriteReplacedImage && checks.unrelatedOutputsIntact && checks.sourceUntouchedByExport) ok("A05", { checks }); else fail("A05", JSON.stringify(checks));
  } catch (e) { fail("A05", e.message); }

  // ---------- A06: export-report preserved + missing-reference diagnostics ----------
  try {
    const run1 = await runExport(d, {
      entry: "command",
      file: `${STAGING}/export-report.md`,
      form: { source: "current-file", profile: "markdown-bundle", outputFolder: `${OUT}/A06/report`, outputName: "export-report" },
      timeoutMs: 240_000,
    });
    const run2 = await runExport(d, {
      entry: "command",
      file: `${STAGING}/failure/missing.md`,
      form: { source: "current-file", profile: "markdown-bundle", outputFolder: `${OUT}/A06/missing`, outputName: "missing" },
      timeoutMs: 240_000,
    });
    const reportPrimary = readVaultText(`${OUT}/A06/report/export-report.md`);
    const reportFiles = listTree(`${OUT}/A06/report`).map((f) => f.rel);
    const checks = {
      primarySentinelPreserved: reportPrimary.includes("REPORT-DOCUMENT-SENTINEL"),
      distinctReportFile: reportFiles.some((p) => /export-report.*\.md$/.test(p) && !p.endsWith("export-report.md")) || reportFiles.filter((p) => p.endsWith(".md")).length >= 2,
      missingRunDiagnosticsInNotice: /NoSuch(Image|Note)|missing|not found/i.test(run2.notice),
      missingPrimaryExists: fs.existsSync(vaultPath(`${OUT}/A06/missing/missing.md`)),
    };
    writeCase("A06", { env, runs: { report: run1, missing: run2 }, checks, trees: { report: listTree(`${OUT}/A06/report`), missing: listTree(`${OUT}/A06/missing`) } });
    if (checks.primarySentinelPreserved && checks.distinctReportFile && checks.missingRunDiagnosticsInNotice) ok("A06", { checks }); else fail("A06", JSON.stringify(checks));
  } catch (e) { fail("A06", e.message); }
} finally {
  fs.writeFileSync(`${RUN}/artifacts/results-a01-a06.json`, JSON.stringify(results, null, 2));
  d.cdp.close();
}
console.log("A01-A06 summary:", JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status]))));
process.exit(Object.values(results).some((r) => r.status === "FAIL") ? 1 : 0);
