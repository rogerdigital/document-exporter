# Document Exporter 1.0.0

## Protecting your previous exports

This release makes exports non-destructive by default.

- **No more silent overwrites.** With "Overwrite existing exports" off (the default), an export never modifies an existing file. When the destination already exists — including an empty folder — the whole export (documents, attachments, and report) moves to a new timestamped folder instead. Nothing you exported before is moved, changed, or deleted.
- **Attachments are protected too.** The protection covers every output file, not just the main document. A second export of a different note can no longer replace the first export's images, even when both use the same image filename.
- **Reports never overwrite anything.** Export reports always get a fresh, conflict-free name — even with overwrite enabled — and a note named `export-report.md` keeps its own file.

## Clearer export results

- Exports now finish with an explicit status: **complete**, **partially complete**, **cancelled**, or **failed**, with completed and possibly-incomplete file counts.
- Cancelling preserves everything already exported and says exactly what may be incomplete — no more "success" messages for half-finished runs.
- The export report lists status, completed paths, possibly-incomplete paths, warnings, and errors.

## Destination layout change

When overwrite is off and the destination exists, the new export lands in a sibling timestamped folder (for example `exports/2026-09-17T10-30-00/`). This applies to single-note exports (destination = the selected output root) and batch exports (destination = the batch leaf folder).

## Fixes for task lists and nested batch exports

- Notes containing task lists (`- [ ]` / `- [x]`) now export as valid EPUB and HTML: task items are grouped into a proper list. Previously such notes produced an EPUB that failed strict readers.
- Batch HTML exports now reference copied images relative to each document's own folder, so images load correctly from documents in nested folders, not just from the batch root.

## Formats and platforms

PDF, Word (.docx), EPUB, Markdown bundles, and HTML on desktop and mobile Obsidian. PDF requires the desktop app. See the README's format capability table for rendering paths, attachment handling, and per-format limitations.

## Limitations

Unchanged from 0.7.4: block-reference embeds are not expanded; EPUB packages images only (other attachments and cross-note links are omitted); Dataview queries are not executed; Canvas files are not supported.
