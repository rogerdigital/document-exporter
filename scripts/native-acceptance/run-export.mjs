// Shared runner utilities for the A01-A12 native cases.
// Paths are configurable through env vars so reruns do not depend on the
// original 2026-09-18 workspace.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ObsidianDriver } from "./driver.mjs";

export const RUN = process.env.NATIVE_RUN_DIR ?? "/var/folders/cg/8_2x8c9s5xx3dl1trdcs3ndh0000gn/T/document-exporter-1.0-qa.UgHjVD/native/run3-20260918";
export const VAULT = process.env.NATIVE_VAULT_DIR ?? "/Users/Roger/my-vault";
export const STAGING = process.env.NATIVE_STAGING_DIR ?? "release-acceptance-1.0-run3";
export const OUT = `${STAGING}/out`;

export const vaultPath = (p) => path.join(VAULT, p);

export function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function listTree(relDir) {
  const abs = vaultPath(relDir);
  if (!fs.existsSync(abs)) return null;
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ rel: path.relative(abs, p), bytes: fs.statSync(p).size, sha256: sha256(p) });
    }
  };
  walk(abs);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function readVaultText(relPath) {
  return fs.readFileSync(vaultPath(relPath), "utf8");
}

/** One full native export: entry -> modal -> confirm -> completion notice. */
export async function runExport(d, {
  entry = "command",               // 'command' | 'editor-menu' | 'folder-menu' | 'ribbon'
  file = null,                     // vault path to open in editor (command / editor-menu)
  folderPath = null,               // vault folder path (folder-menu entry, or source=folder via command)
  form,                            // { source, folderPath, filePaths, profile, outputFolder, outputName }
  timeoutMs = 240_000,
  shotPrefix = null,               // screenshot basename (without extension) for confirm+notice
}) {
  const t0 = Date.now();
  if (entry === "editor-menu") {
    await d.openFileInEditor(file);
    await d.openExportViaEditorContextMenu();
  } else if (entry === "folder-menu") {
    await d.openExportViaFolderContextMenu(folderPath);
  } else {
    if (file) await d.openFileInEditor(file);
    await d.openExportViaCommand();
  }
  if (shotPrefix) await d.screenshot(`${RUN}/screenshots/${shotPrefix}-1-modal.png`);

  const summary = await d.fillFormAndNext(form);
  if (shotPrefix) await d.screenshot(`${RUN}/screenshots/${shotPrefix}-2-confirm.png`);

  await d.markNoticesSeen();
  await d.confirmExport();
  const notice = await d.waitExportNotice({ timeoutMs });
  if (shotPrefix) await d.screenshot(`${RUN}/screenshots/${shotPrefix}-3-notice.png`);
  return { summary, notice, elapsedMs: Date.now() - t0 };
}

export function writeCase(caseId, data) {
  const file = `${RUN}/artifacts/case-${caseId}.json`;
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...data, caseId, updated: new Date().toISOString() }, null, 2));
  console.log(`[${caseId}] written ${file}`);
}

export async function connect() {
  const d = await ObsidianDriver.connect("my-vault");
  const env = await d.cdp.evalJs(`(() => ({
    vault: app.vault.getName(),
    plugin: app.plugins.plugins['document-exporter'].manifest.version,
  }))()`);
  if (env.vault !== "my-vault") throw new Error(`wrong vault: ${env.vault}`);
  return { d, env };
}
