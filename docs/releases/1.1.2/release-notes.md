# Document Exporter 1.1.2

## Fixed

- Word exports now convert supported inline and display LaTeX into editable equations. An inline equation and an embedded image can share the same line (#103).
- EPUB and the fallback renderer for HTML and PDF now export supported formulas as MathML.
- Wiki-link rewriting and note-embed expansion preserve square brackets inside formulas. Unsupported formulas are kept as source text and reported as export warnings.

## Validation

- 468 automated tests, production build, lint, version consistency checks, and 8 version-validation tests passed.
- Verified equation markup in DOCX and EPUB exports and visually checked the fallback HTML in Chrome.
