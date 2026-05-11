# CLAUDE.md

## Project Overview

Obsidian plugin for exporting notes, folders, and query results into Markdown bundles, HTML documents, and print-ready exports.

- Plugin ID: `document-exporter`
- Current version: `0.1.0`
- Min Obsidian version: `1.0.0`

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
    DocumentAssembler.ts     Read and combine markdown notes
    AttachmentCollector.ts   Discover and deduplicate attachments
    LinkRewriter.ts          Rewrite wiki links, embeds, and image paths
    OutputWriter.ts          Write files and copy binaries via Vault API
    ExportRunner.ts          Orchestrate the full pipeline
  formats/             Output renderers
    markdown-bundle.ts       Combined document.md + assets/
    html-document.ts         Standalone index.html with TOC and CSS
    print-html.ts            HTML with print stylesheet
  ui/                  Modal and progress UI
```

## Conventions

- Use duck-typing (`"extension" in f`) instead of `instanceof TFile`/`TFolder` — enables Vitest without mocking obsidian module
- Tests live alongside source: `*.test.ts` in the same directory
- Export profiles: `markdown-bundle`, `html-document`, `print-html`
- All module imports use `@/` path alias

## Git

- Branch: `main` is protected (PR required, CI must pass, no force push)
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- No co-author or AI attribution in commits

## Key References

- Development plan: `docs/plans/2026-05-10-document-exporter-development-plan.md`
- Obsidian plugin docs: https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
