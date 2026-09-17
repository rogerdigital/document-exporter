# Native acceptance harness (T6)

Drives the **real Obsidian app** through its export dialog to execute the
A01–A12 native acceptance cases from the 1.0.0 acceptance protocol, plus the
T6.3 artifact inspections with independent tools.

## How it works

Obsidian (Electron) is launched with `--remote-debugging-port`; a minimal CDP
client (`cdp.mjs`) talks to the renderer of the target vault window. All
interactions use **trusted renderer input** (`Input.dispatchMouseEvent`) and
real DOM events — the same code paths a user's clicks invoke. No mocks, no
spies; every export runs the actual plugin pipeline inside Obsidian.

## Two required environment accommodations

1. **DOM context menus.** macOS Obsidian defaults to *native* (Electron) menus
   when the `nativeMenus` vault config is unset (`updateUseNativeMenu`:
   `isMacOS && null => true`). Native menus are invisible to CDP, which is why
   earlier OS-level automation attempts failed. `driver.useDomMenus()` sets
   `nativeMenus: false` for the session; restore the prior value afterwards
   (`restoreMenusConfig`).
2. **Background timer throttling.** Chromium throttles timers in background
   windows to ~1/min. Native-renderer batches (HTML/PDF) crawl or appear hung
   when the Obsidian window is in the background — a real user exporting with
   the window visible does not hit this. Launch Obsidian with:

   ```
   --remote-debugging-port=9223 \
     --disable-background-timer-throttling \
     --disable-backgrounding-occluded-windows \
     --disable-renderer-backgrounding \
     --disable-features=<app's own list>,IntensiveWakeUpThrottling
   ```

## Usage

```bash
# 1. Stage fixtures into the vault (scripts/create-release-fixtures.mjs)
# 2. Install the candidate plugin build per T6.1
# 3. Relaunch Obsidian with the flags above
# 4. Run cases (env vars override the default run workspace):
NATIVE_RUN_DIR=... NATIVE_VAULT_DIR=... NATIVE_STAGING_DIR=... \
  node scripts/native-acceptance/run-a01-a06.mjs
  node scripts/native-acceptance/run-a07-a12.mjs   # A08/A12 reruns: run-a08-md.mjs, run-a12-retry.mjs
  node scripts/native-acceptance/verify-a03-a04.mjs
# 5. Artifact inspections (EPUBCheck, LibreOffice, unzip, Chrome headless, PDFKit)
  node scripts/native-acceptance/inspect-t63.mjs   # swift pdf-inspect.swift used for PDFs
```

Case evidence is written as JSON under `$RUN/artifacts/`, screenshots under
`$RUN/screenshots/`, EPUBCheck reports under `$RUN/logs/`.

## Files

- `cdp.mjs` — minimal CDP client (targets, eval, trusted mouse input, screenshots)
- `driver.mjs` — Obsidian-specific driving (menus, export modal, notices, settings)
- `run-export.mjs` — shared case-runner utilities
- `run-a01-a06.mjs` / `run-a07-a12.mjs` — case execution
- `run-a08-md.mjs`, `run-a12-retry.mjs` — focused reruns
- `verify-a03-a04.mjs` — disk-state re-verification for A03/A04
- `inspect-t63.mjs`, `pdf-inspect.swift` — T6.3 independent tool checks
