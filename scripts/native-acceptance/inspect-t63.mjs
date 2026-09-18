// T6.3 — inspect actual documents with independent real tools.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUN = process.env.NATIVE_RUN_DIR ?? "/var/folders/cg/8_2x8c9s5xx3dl1trdcs3ndh0000gn/T/document-exporter-1.0-qa.UgHjVD/native/run3-20260918";
const QA = process.env.NATIVE_QA_DIR ?? "/var/folders/cg/8_2x8c9s5xx3dl1trdcs3ndh0000gn/T/document-exporter-1.0-qa.UgHjVD";
const VAULT = process.env.NATIVE_VAULT_DIR ?? "/Users/Roger/my-vault";
const STAGING = "release-acceptance-1.0-run3";
const OUT = `${STAGING}/out`;
const harness = path.dirname(fileURLToPath(import.meta.url));
const report = {};
const sh = (cmd, args, opts = {}) => {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", timeout: 300_000, ...opts });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), status: e.status };
  }
};

const pdfInspect = (rel, sentinels = []) => {
  const abs = path.join(VAULT, rel);
  const r = sh("swift", [`${harness}/pdf-inspect.swift`, abs, ...sentinels]);
  const lines = r.stdout.split("\n").filter(Boolean);
  return { ok: r.ok, result: Object.fromEntries(lines.map((l) => l.split("=")).map(([k, ...v]) => [k, v.join("=")])) };
};

const epubCheck = (rel) => {
  const abs = path.join(VAULT, rel);
  const jsonReport = `${RUN}/logs/epubcheck-${rel.replaceAll("/", "_")}.json`;
  const r = sh("/opt/homebrew/opt/openjdk/bin/java", [
    "-jar", `${QA}/tools/epubcheck-5.2.1/epubcheck.jar`,
    "--failonwarnings", "--json", jsonReport, abs,
  ]);
  let summary = null;
  try { summary = JSON.parse(fs.readFileSync(jsonReport, "utf8")).messages ? null : null; } catch {}
  let counts = null;
  try {
    const j = JSON.parse(fs.readFileSync(jsonReport, "utf8"));
    counts = { fatal: j.messages?.filter((m) => m.severity === "FATAL").length ?? null,
               error: j.messages?.filter((m) => m.severity === "ERROR").length ?? null,
               warn: j.messages?.filter((m) => m.severity === "WARNING").length ?? null };
  } catch {}
  return { ok: r.ok, status: r.status, counts, report: jsonReport };
};

const unzipT = (rel) => {
  const r = sh("unzip", ["-t", path.join(VAULT, rel)]);
  return { ok: r.ok, tail: r.stdout.trim().split("\n").slice(-2).join(" | ") };
};

const loConvert = (rel, outSub) => {
  const abs = path.join(VAULT, rel);
  const outdir = `${RUN}/artifacts/lo-${outSub}`;
  fs.mkdirSync(outdir, { recursive: true });
  const r = sh(`${process.env.HOME}/Applications/LibreOffice.app/Contents/MacOS/soffice`,
    ["--headless", "--convert-to", "pdf", "--outdir", outdir, abs]);
  const produced = fs.existsSync(`${outdir}/${path.basename(rel).replace(/\.(docx|epub)$/i, "")}.pdf`);
  return { ok: r.ok && produced, outdir };
};

const chromeShot = (rel, name, width = 1400) => {
  const abs = path.join(VAULT, rel);
  const out = `${RUN}/screenshots/t63-${name}.png`;
  const r = sh("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless", "--disable-gpu", `--screenshot=${out}`, `--window-size=${width},2200`,
    "--virtual-time-budget=4000", `file://${abs}`,
  ]);
  return { ok: r.ok && fs.existsSync(out), shot: out };
};

const zipText = (rel, inner) => {
  const r = sh("unzip", ["-p", path.join(VAULT, rel), inner]);
  return r.ok ? r.stdout : null;
};

// ---------- PDF ----------
report.pdf = {};
report.pdf["A01-content"] = pdfInspect(`${OUT}/A01/pdf/content.pdf`, ["BEGIN-CONTENT", "END-CONTENT", "中文导出", "CODE-CONTENT", "Alpha", "456"]);
report.pdf["A09-long"] = pdfInspect(`${OUT}/A09/pdf/long.pdf`, ["PAGE-SENTINEL-1", "PAGE-SENTINEL-60", "PAGE-SENTINEL-120", "Section 60", "Left", "Right"]);
report.pdf["A07-tt-host"] = pdfInspect(`${OUT}/A07/pdf/tt/heading-host/heading-host.pdf`, ["WANTED-SENTINEL"]);
report.pdf["A07-ff-host"] = pdfInspect(`${OUT}/A07/pdf/ff/heading-host/heading-host.pdf`, ["WANTED-SENTINEL", "EXCLUDED-SENTINEL"]);
report.pdf["A07-tt-cycle"] = pdfInspect(`${OUT}/A07/pdf/tt/cycle-a/cycle-a.pdf`, ["Cycle A", "Cycle B"]);
report.pdf["A07-ft-adjacency"] = pdfInspect(`${OUT}/A07/pdf/ft/adjacency/adjacency.pdf`, ["AFTER-IMAGE-SENTINEL"]);
report.pdf["A11-limitations"] = pdfInspect(`${OUT}/A11/pdf/limitations.pdf`, ["CALLOUT-SENTINEL"]);

// ---------- DOCX ----------
report.docx = {};
for (const [key, rel] of Object.entries({
  "A01-content": `${OUT}/A01/docx/content.docx`,
  "A02-folder-index": `${OUT}/A02/docx/folder/index.docx`,
  "A03-selected": `${OUT}/A03/docx/selected/nested/third.docx`,
  "A09-long": `${OUT}/A09/docx/long.docx`,
  "A11-limitations": `${OUT}/A11/docx/limitations.docx`,
})) {
  const xml = zipText(rel, "word/document.xml");
  report.docx[key] = {
    unzip: unzipT(rel),
    markers: xml ? ["BEGIN-CONTENT", "CODE-CONTENT", "Alpha", "456"].filter((m) => xml.includes(m)) : null,
    hyperLink: xml ? xml.includes("https://example.com/") : null,
    libreOffice: loConvert(rel, key),
  };
}

// ---------- EPUB ----------
report.epub = {};
for (const [key, rel] of Object.entries({
  "A01-content": `${OUT}/A01/epub/content.epub`,
  "A02-folder-index": `${OUT}/A02/epub/folder/index.epub`,
  "A11-limitations": `${OUT}/A11/epub/limitations.epub`,
})) {
  report.epub[key] = { epubCheck: epubCheck(rel), unzip: unzipT(rel) };
}

// ---------- HTML / Markdown (real-browser render + tree checks) ----------
report.html = {};
report.html["A01-chrome"] = chromeShot(`${OUT}/A01/html-document/content.html`, "A01-chrome");
report.html["A02-index-chrome"] = chromeShot(`${OUT}/A02/html-document/folder/index.html`, "A02-index-chrome");
report.html["A03-chrome"] = chromeShot(`${OUT}/A03/html-document/selected/index.html`, "A03-chrome");
report.html["A11-chrome"] = chromeShot(`${OUT}/A11/html-document/limitations.html`, "A11-chrome");

// link/asset integrity inside exported HTML trees (no references back into the vault)
const htmlIntegrity = (rootRel) => {
  const rootAbs = path.join(VAULT, rootRel);
  const issues = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".html")) {
        const html = fs.readFileSync(p, "utf8");
        if (html.includes("app://")) issues.push(`${path.relative(rootAbs, p)}: app:// reference`);
        for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
          const ref = m[1];
          if (/^(https?:|mailto:|#|data:)/.test(ref)) continue;
          const target = path.resolve(path.dirname(p), decodeURIComponent(ref.split("#")[0]));
          if (!fs.existsSync(target)) issues.push(`${path.relative(rootAbs, p)} -> ${ref} MISSING`);
        }
      }
    }
  };
  walk(rootAbs);
  return { issues };
};
report.htmlIntegrity = {
  "A02-folder": htmlIntegrity(`${OUT}/A02/html-document/folder`),
  "A03-selected": htmlIntegrity(`${OUT}/A03/html-document/selected`),
  "A01": htmlIntegrity(`${OUT}/A01/html-document`),
};

// ---------- A11 degradation matrix (from actual outputs) ----------
{
  const md = fs.readFileSync(path.join(VAULT, `${OUT}/A11/markdown-bundle/limitations.md`), "utf8");
  const html = fs.readFileSync(path.join(VAULT, `${OUT}/A11/html-document/limitations.html`), "utf8");
  const docxXml = zipText(`${OUT}/A11/docx/limitations.docx`, "word/document.xml") ?? "";
  report.a11 = {
    markersByFormat: {
      markdown: ["CALLOUT-SENTINEL", "Task item", "dataview", "mermaid", "x^2", "absent-block"].map((s) => [s, md.includes(s)]),
      html: ["CALLOUT-SENTINEL", "Task item", "dataview", "mermaid", "x^2", "absent-block"].map((s) => [s, html.includes(s)]),
      docx: ["CALLOUT-SENTINEL", "Task item", "x^2"].map((s) => [s, docxXml.includes(s)]),
    },
  };
}

// ---------- tool versions ----------
const javaVersion = sh("/opt/homebrew/opt/openjdk/bin/java", ["-version"]);
report.tools = {
  epubcheck: sh("/opt/homebrew/opt/openjdk/bin/java", ["-jar", `${QA}/tools/epubcheck-5.2.1/epubcheck.jar`, "--version"]).stdout.split("\n")[1] ?? "",
  java: (javaVersion.stderr || javaVersion.stdout || "").split("\n")[0],
  libreOffice: sh(`${process.env.HOME}/Applications/LibreOffice.app/Contents/MacOS/soffice`, ["--version"]).stdout.trim(),
  chrome: sh("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--version"]).stdout.trim(),
  swift: sh("swift", ["--version"]).stdout.split("\n")[0],
};

fs.writeFileSync(`${RUN}/artifacts/t63-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
