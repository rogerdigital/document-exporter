# Document Exporter

An Obsidian plugin for exporting notes, folders, and query results into Markdown bundles, HTML documents, and print-ready exports.

## Features

- **Markdown Bundle**: combines selected notes into a single `document.md` with copied attachments and rewritten links
- **HTML Document**: generates a standalone `index.html` with table of contents and linked assets
- **Print-ready HTML**: produces HTML with print stylesheet for PDF output via browser print dialog

## Export Sources

- Current file
- Selected files (via fuzzy search picker)
- Folder export (recursive)
- Notes matching a tag

## Usage

1. Open command palette and run **Document Exporter: Export documents**
2. Choose source, format, output folder, and sort order
3. Review the confirmation summary
4. Click **Export**

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Default export profile | Format used when opening the modal | Markdown Bundle |
| Default output folder | Folder name for exports (relative to vault root) | `exports` |
| Default sort mode | How notes are ordered in the output | File path |
| Include source path comments | Add HTML comments showing each section's origin | Off |
| Copy attachments | Copy referenced images and files into the export bundle | On |
| Overwrite existing exports | Overwrite if the output folder already exists | Off |

## Limitations

- Direct PDF generation is not supported — use Print-ready HTML and browser print instead
- Inline note embeds (`![[Note]]`) are not expanded in v0.1; they are preserved as links
- Dataview queries are not executed during export
- Canvas files are not supported
- The built-in Markdown-to-HTML converter handles common syntax but does not support all Obsidian-specific rendering (callouts, mermaid, math)

## Privacy

Document Exporter does not make any network requests. All processing happens locally within Obsidian. No data is sent to external services.

## Installation

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/document-exporter/` directory.

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
```

## License

MIT
