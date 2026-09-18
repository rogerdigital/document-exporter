// Obsidian-specific driving helpers on top of the raw CDP client.
// All interactions go through the real DOM/trusted renderer input of the
// running Obsidian app — the same code paths a user's clicks invoke.
import { CDP } from "./cdp.mjs";

// The last .modal-container in DOM order is the topmost open modal.
const MODAL = `document.querySelectorAll('.modal-container').length ? document.querySelectorAll('.modal-container')[document.querySelectorAll('.modal-container').length-1] : null`;
const NOTICE_RE = /^Export (complete|cancelled|failed|partially)/;

export class ObsidianDriver {
  constructor(cdp) {
    this.cdp = cdp;
  }

  static async connect(vaultName = "my-vault") {
    const { findVaultTarget } = await import("./cdp.mjs");
    const target = await findVaultTarget(vaultName);
    const cdp = await CDP.connect(target.webSocketDebuggerUrl, target.title);
    return new ObsidianDriver(cdp);
  }

  async info() {
    return this.cdp.evalJs(`(() => ({
      vault: app.vault.getName(),
      obsidianVersion: app.appId ? 'obsidian' : 'obsidian',
      pluginVersion: app.plugins?.plugins?.['document-exporter']?.manifest?.version ?? null,
      pluginEnabled: !!app.plugins?.plugins?.['document-exporter'],
      command: !!app.commands?.commands?.['document-exporter:export-documents'],
      ua: navigator.userAgent,
    }))()`);
  }

  async setSettings(partial) {
    return this.cdp.evalJs(`(async () => {
      const p = app.plugins.plugins['document-exporter'];
      Object.assign(p.settings, ${JSON.stringify(partial)});
      await p.saveSettings();
      return { ...p.settings };
    })()`);
  }

  async openFileInEditor(vaultPath) {
    return this.cdp.evalJs(`(async () => {
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(vaultPath)});
      if (!f) throw new Error('file not found: ${vaultPath}');
      await app.workspace.getLeaf(false).openFile(f);
      return app.workspace.getActiveFile()?.path ?? null;
    })()`);
  }

  /** Tag existing notices so we can detect only NEW completion notices. */
  async markNoticesSeen() {
    return this.cdp.evalJs(`(() => {
      let n = 0;
      for (const el of document.querySelectorAll('.notice')) {
        if (!el.dataset.harnessSeen) { el.dataset.harnessSeen = '1'; n++; }
      }
      return n;
    })()`);
  }

  /** Wait for a NEW completion/failure notice and return its full text. */
  async waitExportNotice({ timeoutMs = 180_000 } = {}) {
    const text = await this.cdp.waitFor(`(() => {
      for (const el of document.querySelectorAll('.notice')) {
        if (el.dataset.harnessSeen) continue;
        const t = (el.textContent ?? '').trim();
        if (${NOTICE_RE.toString()}.test(t)) return t;
      }
      return null;
    })()`, { timeoutMs, pollMs: 200, label: "export completion notice" });
    return text;
  }

  async currentNotices() {
    return this.cdp.evalJs(`[...document.querySelectorAll('.notice')].map(n => (n.textContent ?? '').trim())`);
  }

  async progressVisible() {
    return this.cdp.evalJs(`!!document.querySelector('.de-progress-notice')`);
  }

  async progressText() {
    return this.cdp.evalJs(`(() => {
      const el = document.querySelector('.de-progress-notice');
      return el ? (el.textContent ?? '').trim() : null;
    })()`);
  }

  async clickProgressCancel() {
    return this.cdp.clickEl(`document.querySelector('.de-progress-cancel')`, { label: "progress Cancel button", timeoutMs: 15_000 });
  }

  // ---- Environment setup / teardown ----

  // macOS Obsidian defaults to NATIVE (Electron) context menus when the
  // `nativeMenus` vault config is unset (app.js updateUseNativeMenu:
  // isMacOS && null => true). Native menus are invisible to CDP. Switch the
  // test vault to DOM menus so context-menu entries can be driven; the
  // original config value is returned for restoration.
  async useDomMenus() {
    const before = await this.cdp.evalJs(`app.vault.getConfig('nativeMenus')`);
    await this.cdp.evalJs(`(async () => {
      await app.vault.setConfig('nativeMenus', false);
      app.updateUseNativeMenu();
    })()`);
    return before;
  }

  async restoreMenusConfig(priorValue) {
    return this.cdp.evalJs(`(async () => {
      await app.vault.setConfig('nativeMenus', ${JSON.stringify(priorValue)});
      app.updateUseNativeMenu();
      return app.vault.getConfig('nativeMenus');
    })()`);
  }

  async ensureFileExplorerVisible() {
    await this.cdp.evalJs(`(async () => {
      app.workspace.leftSplit.expand();
      const headers = [...document.querySelectorAll('.workspace-sidedock-vault-tab, .workspace-tab-header, .sidebar-tab-header')];
      const hit = headers.find((h) => ((h.getAttribute('aria-label') || h.textContent || '').toLowerCase().includes('files')) || h.dataset?.type === 'file-explorer');
      hit?.click();
    })()`);
  }

  async pressEscape() {
    for (const type of ["keyDown", "keyUp"]) {
      await this.cdp.send("Input.dispatchKeyEvent", {
        type, key: "Escape", code: "Escape",
        windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
    }
  }

  async dismissMenu() {
    await this.pressEscape();
    await this.cdp.waitFor(`!document.querySelector('.menu')`, { timeoutMs: 3_000, label: "menu dismissed" }).catch(() => {});
  }

  findMenuItem(title) {
    return `[...document.querySelectorAll('.menu .menu-item')].find(el => (el.textContent ?? '').includes(${JSON.stringify(title)}))`;
  }

  async clickMenuItem(title) {
    await this.cdp.waitFor(`!!${this.findMenuItem(title)}`, { timeoutMs: 5_000, label: `menu item ${title}` });
    await this.cdp.clickEl(this.findMenuItem(title), { label: `menu item ${title}` });
  }

  // ---- Entry points ----

  async openExportViaCommand() {
    await this.cdp.evalJs(`app.commands.executeCommandById('document-exporter:export-documents')`);
    await this.waitForModalForm();
  }

  /** Real editor right-click -> context menu -> "Export current file". */
  async openExportViaEditorContextMenu() {
    const target = `document.querySelector('.workspace-leaf.mod-active .view-content')`;
    await this.cdp.waitFor(`!!(${target})`, { timeoutMs: 10_000, label: "active editor view" });
    await this.cdp.rightClickEl(target, { label: "active editor content", timeoutMs: 15_000 });
    await this.clickMenuItem("Export current file");
    await this.waitForModalForm();
  }

  /** Real file-explorer folder right-click -> "Export this folder". */
  async openExportViaFolderContextMenu(folderPath) {
    await this.ensureFileExplorerVisible();
    const nav = `document.querySelector('.nav-folder-title[data-path="${folderPath}"]')`;
    await this.cdp.waitFor(`!!(${nav})`, { timeoutMs: 15_000, label: `file-explorer node ${folderPath}` });
    await this.cdp.evalJs(`${nav}.scrollIntoView({ block: 'center' })`);
    await new Promise((r) => setTimeout(r, 250));
    await this.cdp.rightClickEl(nav, { label: `folder nav ${folderPath}` });
    await this.clickMenuItem("Export this folder");
    await this.waitForModalForm();
  }

  // ---- Modal form driving ----

  async waitForModalForm({ timeoutMs = 10_000 } = {}) {
    await this.cdp.waitFor(`(() => { const m = ${MODAL}; return !!m && (m.querySelector('h2')?.textContent ?? '') === 'Export documents'; })()`,
      { timeoutMs, label: "export modal form" });
  }

  async waitForConfirmStep({ timeoutMs = 10_000 } = {}) {
    await this.cdp.waitFor(`(() => { const m = ${MODAL}; return !!m && (m.querySelector('h2')?.textContent ?? '') === 'Confirm export'; })()`,
      { timeoutMs, label: "confirm step" });
  }

  async setSelectByLabel(selectIndex, value) {
    return this.cdp.evalJs(`(() => {
      const m = ${MODAL};
      const s = m.querySelectorAll('select')[${selectIndex}];
      if (!s) throw new Error('select ${selectIndex} not found');
      s.value = ${JSON.stringify(value)};
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return s.value;
    })()`);
  }

  async setInputByLabel(labelText, value) {
    return this.cdp.evalJs(`(() => {
      const m = ${MODAL};
      const rows = [...m.querySelectorAll('.export-modal-row')];
      const row = rows.find(r => (r.querySelector('label')?.textContent ?? '') === ${JSON.stringify(labelText)});
      if (!row) throw new Error('row with label ${labelText} not found');
      const input = row.querySelector('input');
      if (!input) throw new Error('input in row ${labelText} not found');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
  }

  async outputFolderInput() {
    return this.cdp.evalJs(`(() => { const m = ${MODAL}; return [...m.querySelectorAll('.export-modal-input-group input')][0]?.value ?? null; })()`);
  }

  /** In "Selected files" source mode: open the picker, check the given paths, Done. */
  async pickFiles(paths) {
    await this.cdp.clickEl(`(() => { const m = ${MODAL}; return [...m.querySelectorAll('button')].find(b => /Choose files|file\\(s\\) selected/.test(b.textContent)); })()`,
      { label: "Choose files button" });
    await this.cdp.waitFor(`!!document.querySelector('.file-picker-modal')`, { timeoutMs: 5_000, label: "file picker modal" });
    const picked = await this.cdp.evalJs(`(() => {
      const wanted = ${JSON.stringify(paths)};
      const items = [...document.querySelectorAll('.file-picker-item')];
      const checked = [];
      for (const item of items) {
        const path = (item.textContent ?? '').trim();
        const box = item.querySelector('input[type=checkbox]');
        const should = wanted.includes(path);
        if (box.checked !== should) box.click();
        if (should) checked.push(path);
      }
      return { checked, missing: wanted.filter(w => !checked.includes(w)) };
    })()`);
    if (picked.missing.length) throw new Error(`file picker: not found in list: ${picked.missing.join(", ")}`);
    await this.cdp.clickEl(`document.querySelector('.file-picker-done-btn')`, { label: "file picker Done" });
    await this.cdp.waitFor(`!document.querySelector('.file-picker-modal')`, { timeoutMs: 5_000, label: "file picker closed" });
    return picked.checked;
  }

  /**
   * Drive the modal form: choose source/profile/paths, fill output folder+name,
   * click Next (trusted click), verify the confirm summary.
   */
  async fillFormAndNext({ source = "current-file", folderPath = null, filePaths = null, profile, outputFolder, outputName = null }) {
    await this.waitForModalForm();
    await this.setSelectByLabel(0, source);
    if (source === "folder") {
      await this.setInputByLabel("Folder path", folderPath);
    } else if (source === "files") {
      await this.pickFiles(filePaths);
    }
    await this.setSelectByLabel(1, profile);
    await this.setInputByLabel("Output folder", outputFolder);
    if (outputName != null) {
      await this.setInputByLabel(source === "current-file" ? "File name" : "Folder name", outputName);
    }
    await this.cdp.clickEl(`(() => { const m = ${MODAL}; return [...m.querySelectorAll('button')].find(b => b.textContent.trim() === 'Next'); })()`,
      { label: "Next button" });
    await this.waitForConfirmStep();
    return this.confirmSummary();
  }

  async confirmSummary() {
    return this.cdp.evalJs(`(() => { const m = ${MODAL}; return [...m.querySelectorAll('.export-confirm-summary p')].map(p => p.textContent); })()`);
  }

  async confirmExport() {
    await this.cdp.clickEl(`(() => { const m = ${MODAL}; return [...m.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export'); })()`,
      { label: "Export button" });
    await this.cdp.waitFor(`!(${MODAL})`, { timeoutMs: 5_000, label: "modal closed after confirm" });
  }

  async cancelModal() {
    await this.cdp.clickEl(`(() => { const m = ${MODAL}; return [...m.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel'); })()`,
      { label: "Cancel button" });
    await this.cdp.waitFor(`!(${MODAL})`, { timeoutMs: 5_000, label: "modal closed after cancel" });
  }

  async screenshot(path) {
    return this.cdp.screenshot(path);
  }
}
