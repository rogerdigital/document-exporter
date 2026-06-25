# CLAUDE.md

## Project Overview

Obsidian plugin for exporting notes, folders, and query results into Markdown bundles, HTML documents, and print-ready exports.

- Plugin ID: `document-exporter`
- Current version: `0.4.8`
- Min Obsidian version: `1.4.0`

## Tech Stack

- TypeScript + esbuild (bundled CJS output)
- Vitest for testing
- Obsidian API (`obsidian` module)

## Commands

```bash
npm run dev      # watch mode with esbuild
npm run build    # type check + production build
npm test         # vitest run
npm run test:watch  # vitest watch
```

## Architecture

```
src/
  main.ts              Plugin entry, command registration, export pipeline orchestration
  types.ts             Shared types and default settings
  settings/            Settings load/save and settings tab UI
  export/              Core pipeline modules
    ExportSourceResolver.ts  Resolve files from source (current-file, folder, files, filter)
    ExportPlan.ts            Build and validate export plans
    DocumentAssembler.ts     Read and combine markdown notes, strip frontmatter, derive title
    AttachmentCollector.ts   Discover and deduplicate attachments (cross-file)
    LinkRewriter.ts          Rewrite wiki links, embeds, and image paths
    OutputWriter.ts          Write files and copy binaries via Vault API
    utils.ts                 Shared helpers (extension lookup, path stripping)
    ExportRunner.ts          Orchestrate the full pipeline
  formats/             Output renderers
    native-renderer.ts       Wrap Obsidian MarkdownRenderer (shared by HTML and PDF)
    markdown-bundle.ts       Combined document.md + assets/
    html-document.ts         Standalone index.html with TOC and CSS (also handles print-ready HTML)
    pdf.ts                   PDF export via browser window
    docx.ts                  Word document export
  ui/                  Modal and progress UI
    ExportModal.ts           Two-step export configuration modal
    ProgressNotice.ts        Visual progress bar with cancel button
```

## Conventions

- Use duck-typing (`"extension" in f`) instead of `instanceof TFile`/`TFolder` — enables Vitest without mocking obsidian module
- Tests live alongside source: `*.test.ts` in the same directory
- All module imports use `@/` path alias
- DOM-dependent tests (e.g. ProgressNotice) need `// @ts-nocheck` and `/** @vitest-environment jsdom */` at top; Obsidian HTMLElement methods (`empty`, `createDiv`, `createEl`, `createSpan`) must be polyfilled in the test mock

## Git

- Branch: `main` is protected (PR required, CI must pass, no force push)
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- No co-author or AI attribution in commits
- Plugin directory in vault (`~/.obsidian/plugins/document-exporter/`) is a symlink to repo root — build artifacts are live after `npm run build`
- **Never place a backup copy of the plugin inside `~/.obsidian/plugins/`**: Obsidian loads plugins by `manifest.json` `id`, so a second dir with the same id (e.g. `document-exporter.backup-...`) collides and one silently shadows the other. Keep backups outside `plugins/`, or remove their `manifest.json`.

## Release

- CI has an automatic release workflow triggered by tags — do NOT manually run `gh release create` after pushing a tag, it will conflict
- Release steps: bump version in `manifest.json` + `versions.json` → PR → merge → `git tag -a X.Y.Z` → `git push origin X.Y.Z` → CI creates the release with `main.js`, `manifest.json`, `styles.css`

## Key References

- Development plan: `docs/plans/2026-05-10-document-exporter-development-plan.md`
- Obsidian plugin docs: https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
