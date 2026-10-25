# Document Exporter 1.1.0

## Merge batch exports into a single file

- Folder and selected-files exports now offer **Merge into a single file** in the export dialog (#97). Every source note is rendered into one output document, in any of the five formats: PDF, Word, EPUB, Markdown, or HTML.
- Each note keeps its title as a section heading; the merged file name becomes the document title. PDF and HTML exports gain a table of contents, and EPUB exports gain one chapter per note.
- The merged file lands directly in the chosen output folder as `<file name>.<ext>`, with referenced images and attachments collected across all notes into `assets/` (deduplicated).
- Links between merged notes resolve to in-document anchors — the same anchors the table of contents and document sections use — so they keep working after export. EPUB keeps omitting cross-note links, as before.
- With "Overwrite existing exports" off, an existing destination folder relocates the whole merged export to a timestamped folder, matching single-note export behavior.

## Fixed

- Exported PDF files now carry the document title as their metadata title instead of a generic "Export".
