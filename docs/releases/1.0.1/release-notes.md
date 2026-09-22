# Document Exporter 1.0.1

## Markdown backslash escapes now export correctly

Fixed a bug where escaped punctuation (`\*`, `\|`, `\[`, …) was not recognized during export (#91).

- **EPUB books with escaped asterisks open again.** In tables, two `\*` in the same row used to pair into an `<em>` crossing cell boundaries, producing invalid XHTML that Apple Books refuses to open (`Opening and ending tag mismatch`). Escaped asterisks now render as the literal `*` character everywhere — no spurious italics, no leaked backslash.
- **Escaped pipes stay inside the table cell.** `a \| b` was previously split into two cells (`a \` and `b`); it now stays one cell containing `a | b`.
- **Escaped brackets don't become links.** `\[not a link\](url)` now exports as literal text instead of a rendered link.
- **All escapes render as the literal character.** `\_`, `\\`, `\#` and friends no longer keep their backslash in the exported document.
- **Word exports fixed too.** The DOCX converter had the same emphasis-pairing and pipe-splitting behavior and is fixed in this release. PDF and HTML use Obsidian's own renderer and were only affected in rare fallback cases.
- **Bare multiplication stays plain.** `3 * 4 * 5` no longer renders `4` in italics — emphasis now follows CommonMark whitespace rules.

Escapes inside code blocks and inline code are untouched.
