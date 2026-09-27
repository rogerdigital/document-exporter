# Issue #94 Word for iPad validation candidate

`word-for-ipad-editability-candidate.docx` was produced by the DOCX renderer at
`d18ece3` (the merge of PR #95). It contains a short editable sentence and an
embedded PNG image. It is an export sample, not a released plugin version.

SHA-256: `5ae4025de23b6024798298f5710ba803cf92e6153af966f5a5711bbf81ad7b0c`

The ZIP passed an integrity check. Its XML parses, and it includes
`word/settings.xml`, the settings relationship, and the settings content type.
Native Word for iPad editability still needs confirmation.

To validate, download the DOCX, open it in Word for iPad, edit the sentence,
save, close, and reopen it. Please test both iCloud Files and OneDrive if
possible, and report whether editing and saving work in each path, along with
the iPadOS and Word versions.
