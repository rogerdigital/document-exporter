# Document Exporter Development Plan

## 1. Positioning

**Plugin name:** Document Exporter

**One-line goal:** Export selected Obsidian notes, folders, or query results into coherent document packages such as Markdown bundles, HTML, PDF-ready HTML, and later Pandoc or Quarto projects.

**Target users:**

- Writers who maintain drafts in Obsidian and need shareable output.
- Researchers who want to collect notes into manuscripts or reports.
- Students and teams who need folder-level exports.
- General users who want better multi-note export than copying files manually.

**Core product principle:** Start with deterministic document assembly and asset handling. Add external toolchain integrations only after the internal export pipeline is reliable.

## 2. Relationship To `obsidian-releases`

Document Exporter should be developed in its own plugin repository. This `obsidian-releases` repository becomes relevant only when listing the plugin:

- Add one entry to `community-plugins.json`.
- Use `id`: `document-exporter`.
- Ensure release assets include `main.js`, `manifest.json`, and `styles.css` if styles are used.

## 3. MVP Scope

### Included In v0.1

Input sources:

- Current file.
- Selected files from a modal.
- Folder export.
- Notes matching a simple path/name/tag filter.

Output formats:

- Markdown bundle:
  - one combined `document.md`
  - copied attachments
  - rewritten relative links to copied attachments
- HTML:
  - one `index.html`
  - copied attachments
  - generated table of contents
  - basic CSS
- PDF-ready HTML:
  - same HTML output with print stylesheet
  - user can print to PDF through system/browser

Document assembly:

- Sort by file path by default.
- Optional sort by frontmatter field.
- Preserve heading hierarchy where practical.
- Rewrite embeds and internal links conservatively.
- Include source path comments only if enabled.

Export profiles:

- `Markdown Bundle`
- `HTML Document`
- `Print-ready HTML`

### Explicitly Out Of v0.1

- Direct PDF generation inside plugin.
- Pandoc execution.
- Quarto project generation.
- Zotero citation resolution.
- Full Dataview query execution.
- Exporting Canvas as visual diagrams.
- Publishing to remote services.

## 4. Why Not Direct PDF First

Direct PDF generation in an Obsidian plugin introduces avoidable complexity:

- Rendering Markdown, callouts, math, syntax highlighting, embeds, and CSS consistently is hard.
- Native PDF generation may require external tools or browser APIs with platform differences.
- A print-ready HTML output gives users a practical path to PDF without making the first version depend on a heavy rendering pipeline.

The first release should focus on a correct export graph: note ordering, content assembly, asset copying, and link rewriting.

## 5. Architecture

### Obsidian APIs To Use

- `Plugin` for lifecycle.
- `Modal` for export source/profile selection.
- `Vault` for reading notes and writing export files.
- `TFile` and `TFolder` for selected sources.
- `MetadataCache` for links, embeds, frontmatter, headings, and tags.
- `PluginSettingTab` for default export profile and output folder.
- `Notice` for export completion/errors.

Reference docs:

- Obsidian plugin development: https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
- Obsidian plugin publishing: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Obsidian developer policies: https://docs.obsidian.md/Developer+policies

### Proposed File Structure

```text
document-exporter/
  manifest.json
  package.json
  tsconfig.json
  esbuild.config.mjs
  src/
    main.ts
    settings/
      settings.ts
      settings-tab.ts
    export/
      ExportCommand.ts
      ExportPlan.ts
      ExportRunner.ts
      ExportSourceResolver.ts
      DocumentAssembler.ts
      AttachmentCollector.ts
      LinkRewriter.ts
      OutputWriter.ts
    formats/
      markdown-bundle.ts
      html-document.ts
      print-html.ts
    ui/
      ExportModal.ts
      ProfileSelector.ts
      ProgressNotice.ts
    utils/
      frontmatter.ts
      markdown.ts
      paths.ts
      slug.ts
    tests/
      source-resolver.test.ts
      document-assembler.test.ts
      attachment-collector.test.ts
      link-rewriter.test.ts
      markdown-bundle.test.ts
      html-document.test.ts
  styles.css
  README.md
  LICENSE
```

### Module Responsibilities

- `ExportCommand.ts`: registers commands and context actions.
- `ExportModal.ts`: collects source, format, output folder, and sorting choices.
- `ExportSourceResolver.ts`: resolves current file, selected files, folder, or filter into ordered `TFile` objects.
- `ExportPlan.ts`: immutable plan describing input files, assets, output paths, and profile.
- `DocumentAssembler.ts`: reads note contents and combines them into a normalized intermediate document.
- `AttachmentCollector.ts`: discovers embedded and linked assets that need copying.
- `LinkRewriter.ts`: rewrites internal links and attachment paths for exported output.
- `OutputWriter.ts`: writes files and avoids overwrites.
- Format modules: transform intermediate document into final output.

## 6. Data Model

```ts
type ExportProfileId = "markdown-bundle" | "html-document" | "print-html";

type ExportSettings = {
  defaultProfile: ExportProfileId;
  defaultOutputFolder: string;
  includeSourcePathComments: boolean;
  copyAttachments: boolean;
  overwriteExisting: boolean;
  defaultSort: ExportSort;
};

type ExportSort = {
  mode: "path" | "name" | "frontmatter";
  frontmatterKey?: string;
  direction: "asc" | "desc";
};

type ExportSource =
  | { type: "current-file"; path: string }
  | { type: "files"; paths: string[] }
  | { type: "folder"; path: string; recursive: boolean }
  | { type: "filter"; queryText: string; tag?: string };

type ExportPlan = {
  profile: ExportProfileId;
  source: ExportSource;
  inputFiles: string[];
  outputRoot: string;
  outputFiles: string[];
  attachmentCopies: AttachmentCopy[];
  sort: ExportSort;
};

type AssembledDocument = {
  title: string;
  sections: DocumentSection[];
  attachments: AttachmentCopy[];
};

type DocumentSection = {
  sourcePath: string;
  title: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
};

type AttachmentCopy = {
  sourcePath: string;
  outputRelativePath: string;
};
```

## 7. Export Pipeline

1. User starts export command.
2. Modal gathers source and profile.
3. `ExportSourceResolver` resolves files.
4. `ExportPlan` is created and displayed for confirmation:
   - number of notes
   - output folder
   - profile
   - attachment count estimate
5. `DocumentAssembler` reads Markdown files.
6. `AttachmentCollector` finds assets through metadata and Markdown parsing.
7. `LinkRewriter` rewrites links for the chosen format.
8. Format renderer generates output content.
9. `OutputWriter` writes files.
10. Completion notice offers to open output file.

## 8. Link And Asset Rules

### Wiki Links

- `[[Note]]`: convert to anchor link if target is included in export.
- `[[Note|Alias]]`: use alias text with anchor link if target included.
- `[[Note#Heading]]`: convert to heading anchor when target included.
- If target is not included, leave readable text and optionally add unresolved marker in debug mode.

### Embeds

- `![[image.png]]`: copy attachment and rewrite to relative path.
- `![[Note]]`: inline note content only if setting is enabled in a future release; v0.1 should link to included section instead.
- `![[file.pdf]]`: copy and link to PDF.

### Markdown Links

- Relative links to attachments are copied and rewritten.
- External `http` and `https` links remain unchanged.

### Frontmatter

- Do not include raw frontmatter in body by default.
- Use frontmatter for sorting and title extraction.
- Optional future setting can include frontmatter as a metadata table.

## 9. Development Milestones

### Milestone 0: Repository Bootstrap

Goal: create a minimal, buildable plugin.

Tasks:

- Scaffold official Obsidian plugin structure.
- Add test runner for pure export modules.
- Add `manifest.json`:
  - `id`: `document-exporter`
  - `name`: `Document Exporter`
  - `version`: `0.1.0`
- Add README and license.

Commit:

```bash
git commit -m "chore: scaffold document exporter plugin"
```

Verification:

- `npm install`
- `npm run build`
- Plugin loads in a test vault.

### Milestone 1: Export Settings And Command Shell

Goal: provide a command path before implementing export internals.

Tasks:

- Add settings schema and defaults.
- Add command `Document Exporter: Export documents`.
- Add modal with source/profile/output folder fields.
- Add settings tab for default profile and output folder.

Commit:

```bash
git commit -m "feat: add document export command shell"
```

Verification:

- Command opens modal.
- Settings persist after reload.
- Canceling modal performs no writes.

### Milestone 2: Source Resolver

Goal: convert user export choices into ordered Markdown files.

Tasks:

- Implement current-file source.
- Implement selected-file source.
- Implement folder source with recursive option.
- Implement simple filter source by path/name/tag.
- Add sorting by path and name.
- Add tests for every source type.

Commit:

```bash
git commit -m "feat: resolve document export sources"
```

Verification:

- Folder export includes only Markdown files.
- Recursive toggle works.
- Tag filter uses metadata cache.

### Milestone 3: Export Plan Preview

Goal: show users what will be written before writing.

Tasks:

- Add `ExportPlan` builder.
- Estimate note count and attachment candidates.
- Show confirmation summary in modal.
- Prevent export when no files match.
- Prevent output inside unsafe or blank path.

Commit:

```bash
git commit -m "feat: preview document export plans"
```

Verification:

- Empty source shows actionable error.
- Non-empty source shows note count and output root.
- Confirm button is disabled for invalid output folder.

### Milestone 4: Document Assembler

Goal: combine Markdown notes deterministically.

Tasks:

- Read input Markdown files.
- Strip frontmatter from body.
- Derive section title from first heading, frontmatter title, or basename.
- Normalize heading levels so combined document has coherent hierarchy.
- Add optional source path comments.
- Add tests for heading normalization and title extraction.

Commit:

```bash
git commit -m "feat: assemble markdown documents for export"
```

Verification:

- Multiple notes combine in selected order.
- Frontmatter is not duplicated in body.
- Heading hierarchy is predictable.

### Milestone 5: Attachment Collection

Goal: gather assets needed by exported documents.

Tasks:

- Collect embeds from metadata cache where available.
- Parse Markdown image links as fallback.
- Deduplicate attachment copies.
- Skip missing attachments with warnings.
- Add tests for wiki embeds and Markdown image links.

Commit:

```bash
git commit -m "feat: collect export attachments"
```

Verification:

- Referenced image is copied once.
- Missing attachment appears in warning list.
- External URLs are ignored.

### Milestone 6: Link Rewriter

Goal: make exported documents usable outside Obsidian.

Tasks:

- Rewrite embedded attachments to copied relative paths.
- Convert included wiki links to anchors.
- Preserve external links.
- Add unresolved link warning collection.
- Add tests for wiki links, aliases, heading links, embeds, and external links.

Commit:

```bash
git commit -m "feat: rewrite links for exported documents"
```

Verification:

- Exported Markdown opens with working local image links.
- Included note links point to anchors.
- External links remain unchanged.

### Milestone 7: Markdown Bundle Export

Goal: ship the simplest useful export format.

Tasks:

- Implement `markdown-bundle` renderer.
- Write `document.md`.
- Copy attachments under `assets/`.
- Write `export-report.md` with warnings.
- Avoid overwrite unless setting allows it.

Commit:

```bash
git commit -m "feat: export markdown document bundles"
```

Verification:

- Export creates one folder with `document.md` and `assets/`.
- Re-running export creates a timestamped folder unless overwrite is enabled.
- Missing links are reported, not fatal.

### Milestone 8: HTML Export

Goal: produce shareable single-document HTML.

Tasks:

- Convert assembled Markdown to HTML using a local Markdown renderer bundled with the plugin.
- Generate table of contents from headings.
- Link copied assets.
- Add basic accessible HTML template.
- Add tests for generated TOC and asset URLs.

Commit:

```bash
git commit -m "feat: export documents as html"
```

Verification:

- `index.html` opens in browser.
- Images render.
- Table of contents anchors work.
- No remote resources are required.

### Milestone 9: Print-Ready HTML

Goal: support practical PDF output via browser/system print.

Tasks:

- Add print stylesheet.
- Add page-break hints before top-level sections.
- Add optional title page.
- Add print instructions in output report.
- Add tests for profile selection.

Commit:

```bash
git commit -m "feat: add print-ready html export"
```

Verification:

- Browser print preview shows readable layout.
- Page breaks are reasonable for multi-note export.
- Output still works without network access.

### Milestone 10: Error Handling And Progress

Goal: make export failures recoverable.

Tasks:

- Add progress status for large exports.
- Collect warnings instead of failing for missing optional assets.
- Fail clearly for write permission/path problems.
- Add cancellation point between major pipeline steps.
- Show completion notice with output path.

Commit:

```bash
git commit -m "feat: add document export progress and warnings"
```

Verification:

- Missing attachment does not abort export.
- Invalid output path produces clear error.
- Large export shows progress.

### Milestone 11: Release Readiness

Goal: prepare for public submission.

Tasks:

- README with screenshots, supported formats, limitations, and privacy note.
- Add examples:
  - current note to Markdown bundle
  - folder to HTML
  - folder to print-ready HTML
- Confirm no remote services are used.
- Build release assets.

Commit:

```bash
git commit -m "docs: prepare document exporter release"
```

Verification:

- Install release assets into clean test vault.
- Export sample folder to all v0.1 formats.
- Confirm release version matches `manifest.json`.

## 10. Testing Strategy

### Unit Tests

- Source resolving:
  - current file
  - selected files
  - recursive folder
  - non-recursive folder
  - tag filter
- Assembly:
  - heading normalization
  - frontmatter stripping
  - title derivation
- Attachments:
  - wiki embeds
  - Markdown images
  - duplicate assets
  - missing assets
- Link rewriting:
  - wiki links
  - alias links
  - heading links
  - external links
  - attachment links
- Output:
  - Markdown bundle file list
  - HTML TOC
  - print profile CSS selection

### Manual Tests

- Single current note.
- Folder with nested notes.
- Folder with images.
- Folder with PDFs.
- Notes with callouts.
- Notes with math blocks.
- Notes with code blocks.
- Notes with non-ASCII filenames.
- Export folder already exists.

### Compatibility Checks

- Obsidian desktop on macOS.
- Paths with spaces.
- Vaults stored in iCloud/Dropbox-like folders.
- Files with repeated basenames in different folders.

## 11. Recommended Commit Sequence

1. `chore: scaffold document exporter plugin`
2. `feat: add document export command shell`
3. `feat: resolve document export sources`
4. `feat: preview document export plans`
5. `feat: assemble markdown documents for export`
6. `feat: collect export attachments`
7. `feat: rewrite links for exported documents`
8. `feat: export markdown document bundles`
9. `feat: export documents as html`
10. `feat: add print-ready html export`
11. `feat: add document export progress and warnings`
12. `docs: prepare document exporter release`

Keep the Markdown bundle working before starting HTML. Do not start Pandoc, Quarto, or Zotero before v0.1 export correctness is proven.

## 12. Future Roadmap

### v0.2: Better Document Controls

- Saved export profiles.
- Frontmatter-driven ordering.
- Include/exclude by property.
- Export selection from file explorer context menu.
- Optional frontmatter metadata table.

### v0.3: Pandoc Project Export

- Generate Pandoc-ready folder:
  - `document.md`
  - `assets/`
  - `metadata.yaml`
  - optional `references.bib`
- Do not execute Pandoc yet; just generate project files.

### v0.4: Quarto Project Export

- Generate Quarto project:
  - `_quarto.yml`
  - `index.qmd`
  - assets
- Support frontmatter mapping to Quarto metadata.

### v0.5: Zotero Citation Support

- Detect citation keys in Markdown.
- Copy or generate bibliography file if user provides source.
- Validate unresolved citation keys.

### v0.6: Direct PDF Export

- Only after HTML/Pandoc/Quarto pipelines are stable.
- Prefer user-configured external toolchain with clear diagnostics.
- Never require remote rendering services.

## 13. Risks And Mitigations

- **Risk:** Export format scope becomes too broad.
  - **Mitigation:** v0.1 supports Markdown bundle and HTML only.
- **Risk:** Link rewriting corrupts meaning.
  - **Mitigation:** Export copies output; source notes are never modified.
- **Risk:** Direct PDF becomes platform-specific.
  - **Mitigation:** Start with print-ready HTML and defer direct PDF.
- **Risk:** External toolchain support creates support burden.
  - **Mitigation:** Generate Pandoc/Quarto projects before executing tools.
