# Issue #94 Word for iPad validation candidate

`word-for-ipad-image-candidate-v2.docx` was produced by the DOCX renderer at
`d18ece3` (the merge of PR #95). It contains a short editable sentence and a
visible 640 × 240 red PNG image. It is an export sample, not a released plugin
version.

SHA-256: `88f4a103b9428a24960b8a263c23168930f2047e8f93883c5051a3360ca88347`

The ZIP passed an integrity check. Its XML parses, and it includes
`word/settings.xml`, the settings relationship, and the settings content type.
The embedded PNG passes checksum validation. LibreOffice rendered it visibly
in a converted PDF. Native Word for iPad image rendering still needs confirmation.

The original `word-for-ipad-editability-candidate.docx` remains here to preserve
the file linked in the first validation request. Its embedded 1 × 1 PNG had an
invalid IDAT checksum and was not a valid image-rendering test. The reporter
confirmed that the original file was editable and could be saved and reopened.

To validate, download the DOCX, open it in Word for iPad, edit the sentence,
save, close, and reopen it. Please test both iCloud Files and OneDrive if
possible, and report whether editing and saving work in each path, along with
the iPadOS and Word versions.
