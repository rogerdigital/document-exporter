# Document Exporter 1.0.2

## Word document compatibility fixes

- DOCX exports now include document settings required by Microsoft Word for iPad to enable editing (#94). The reporter verified that the corrected candidate opens, displays its embedded image, allows editing, and preserves edits after saving and reopening through both iCloud Files and OneDrive in Word for iPad.
- Links to headings inside a DOCX now point to matching bookmarks, including duplicate headings and headings containing punctuation or non-Latin text. Unresolved heading links remain plain text.
- Embedded SVG images now use the correct SVG content type.

Existing DOCX files are not modified. Export your notes again after updating to create documents with these fixes.
