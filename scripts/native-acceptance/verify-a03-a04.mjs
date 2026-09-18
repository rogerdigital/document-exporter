// Re-verify A03/A04 against the actual on-disk state and recorded notices.
import fs from "node:fs";
import { writeCase, listTree, sha256, vaultPath, STAGING, OUT, RUN } from "./run-export.mjs";

// ---- A03: primaries exclude the export report ----
const a03 = JSON.parse(fs.readFileSync(`${RUN}/artifacts/case-A03.json`, "utf8"));
const mdTree = listTree(`${OUT}/A03/markdown-bundle`);
const primaries = mdTree.map((f) => f.rel).filter((p) => p.endsWith(".md") && !p.endsWith("export-report.md"));
const reportPresent = mdTree.some((f) => f.rel.endsWith("export-report.md"));
const a03Checks = {
  exactlyTwoPrimaries: primaries.length === 2,
  excludedPartAbsent: !mdTree.some((p) => p.rel.includes("part.")),
  indexAndThirdPresent: primaries.some((p) => p.endsWith("index.md")) && primaries.some((p) => p.endsWith("third.md")),
  noticeCountsCorrect: Object.values(a03.runs).every((r) => r.notice.includes("2/2 file(s) complete")),
  excludedLinkDocumentedWarning: Object.values(a03.runs).every((r) => r.notice.includes("Unresolved link: nested/part")),
  reportAlsoWritten: reportPresent,
};
const a03Status = Object.values(a03Checks).every(Boolean) ? "PASS" : "FAIL";
writeCase("A03", { recheck: a03Checks, status: a03Status, primaries });

// ---- A04: read actual output roots from notices ----
const a04 = JSON.parse(fs.readFileSync(`${RUN}/artifacts/case-A04.json`, "utf8"));
const rootFromNotice = (notice) => notice.split(" — ")[1];
// A05 later replaced collision/a/img.png in the vault, so compare against the
// original fixture manifest hashes for red/blue.
const manifest = JSON.parse(fs.readFileSync(vaultPath(`${STAGING}/fixture-manifest.json`), "utf8"));
const red = manifest.find((e) => e.path === "collision/a/img.png").sha256;
const blue = manifest.find((e) => e.path === "collision/b/img.png").sha256;

const a04Checks = {};
for (const fmt of ["md", "html"]) {
  const runs = a04.runs[fmt];
  const roots = runs.map((r) => rootFromNotice(r.notice));
  const primaryExt = fmt === "md" ? ".md" : ".html";
  a04Checks[`${fmt}-distinctRoots`] = new Set(roots).size === 3;
  a04Checks[`${fmt}-firstRootIsPlainDest`] = roots[0] === `${OUT}/A04/${fmt}`;
  a04Checks[`${fmt}-rerunsTimestamped`] = roots.slice(1).every((r) => /-2026-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(r));
  a04Checks[`${fmt}-allOutputsExist`] = roots.every((r) => fs.existsSync(vaultPath(r)));
  // first-run files unchanged NOW vs the snapshot taken right after run 1
  const snap1 = a04.trees[fmt][0];
  const nowTree = listTree(roots[0]) ?? [];
  a04Checks[`${fmt}-firstRunIntact`] = snap1.length > 0 && nowTree.length === snap1.length
    && snap1.every((f) => nowTree.find((g) => g.rel === f.rel)?.sha256 === f.sha256);
  // A references red, B references blue (attachment dir)
  const imgOf = (root) => {
    const tree = listTree(root) ?? [];
    const img = tree.find((f) => f.rel.endsWith("img.png"));
    return img ? img.sha256 : null;
  };
  a04Checks[`${fmt}-aReferencesRed`] = imgOf(roots[0]) === red;
  a04Checks[`${fmt}-bReferencesBlue`] = imgOf(roots[1]) === blue;
  a04Checks[`${fmt}-a2ReferencesRed`] = imgOf(roots[2]) === red;
}
const a04Status = Object.values(a04Checks).every(Boolean) ? "PASS" : "FAIL";
writeCase("A04", { recheck: a04Checks, status: a04Status });

console.log("A03:", a03Status, JSON.stringify(a03Checks));
console.log("A04:", a04Status, JSON.stringify(a04Checks));
