# Document Exporter 1.1.1

## Fixed

- Desktop output paths starting with `~/` now resolve to the home directory. Pasted leading and trailing whitespace is removed, and unsupported system-path syntax produces an actionable error instead of being treated as a vault folder (#100).
- Existing empty output folders are reused. With **Overwrite existing exports** off, conflicting documents and shared assets are protected in a timestamped child folder inside the selected output folder, rather than moving single-note or merged exports to a sibling folder.
- The export confirmation now shows the resolved destination, including conflict handling. The destination is checked again when export starts to preserve files created in the meantime.
- External folder checks now distinguish directories from ordinary files and report when a file occupies the selected output location.

## Validation

- 461 automated tests, production build, lint, version consistency checks and 8 version-validation regression tests passed.
- Desktop acceptance in Obsidian 1.14.5 on macOS verified the native folder picker, home paths, empty vault folders, repeated PDF exports, unchanged original files and attachment bytes, and invalid-path feedback.
