# Issue #76 Pipeline Fix

## Context

Document Exporter 0.7.3 still renders a Markdown heading as ordinary text when an image embed is immediately followed by the heading:

```markdown
![[image.png]]
## Title
```

The 0.7.3 release asset contains the block-boundary logic introduced by PR #77. The remaining failure occurs earlier in the default export pipeline. With `Expand note embeds` enabled, `EmbedExpander` splits every wiki embed into a separate fragment before it knows whether the target is a note or an attachment. A preserved attachment therefore reaches `LinkRewriter` as an isolated fragment, while the following heading is in the next fragment. `LinkRewriter` cannot classify the attachment against content it cannot see, and `joinMarkdownFragments` later restores the original single newline.

Desktop tracing in Obsidian 1.13.7 confirmed that the Markdown entering native PDF rendering is:

```html
<img src="..." alt="image.png" />
## Title
```

The release build is therefore present and running, but the fragment boundary bypasses its local adjacency check.

A second attachment-rendering defect exists when `Copy attachments` is disabled. The collector is not created, so PDF rendering receives no attachment metadata: the heading can render correctly because the original wiki embed is preserved, but the image URL cannot be restored or embedded and appears broken.

## Goals

- Make the exact issue #76 reproduction render both the image and the following heading correctly in PDF output.
- Cover all four combinations of `expandEmbeds` and `copyAttachments`.
- Preserve inline, list-item, and blockquote attachment behavior.
- Keep successful note-transclusion boundaries and source-path-aware rewriting unchanged.
- Prove the fix at the full export-pipeline boundary and in desktop Obsidian, not only in `LinkRewriter` unit tests.

## Non-goals

- Adding new note-transclusion behavior or changing how successful note transclusions are delimited.
- Adding attachment types, sizing syntax, or new renderer features.
- Changing Markdown bundle, DOCX, EPUB, or HTML attachment-copy semantics unless a regression test proves they are affected by this fix.
- Redesigning the export pipeline or replacing its fragment model.

## Design

### Rejoin preserved fragments before link rewriting

`EmbedExpander` will coalesce adjacent fragments when all of the following are true:

- neither side declares a block boundary;
- both fragments have the same `sourcePath`;
- joining them restores the original byte sequence without inserting whitespace.

Preserved attachment embeds, unresolved embeds, and surrounding text from the same note will therefore reach `LinkRewriter` together. Existing attachment-only placeholder logic can then determine whether an embed is standalone using its real line context.

Successful note transclusions remain isolated because `markBlockBoundaries` marks their first and last fragments. Fragments from different source notes are never coalesced, preserving source-relative link resolution.

This is preferred over passing look-behind and look-ahead text into `LinkRewriter`: it restores information that was unnecessarily fragmented instead of expanding the rewriter interface. Marking every attachment fragment as a block is rejected because it would break inline, list-item, and blockquote embeds.

### Separate PDF attachment discovery from attachment copying

PDF export needs attachment metadata even when the user does not request copied asset files. The metadata is required to restore vault source URLs, rewrite Obsidian `app://` URLs, and embed image data in the PDF.

For PDF only:

- run attachment collection regardless of `copyAttachments`;
- pass the collected metadata through rewriting and rendering;
- execute the output `assets/` copy step only when `copyAttachments` is enabled.

This preserves the setting's stated meaning—whether referenced files are copied into the export bundle—while keeping a self-contained PDF visually complete. Other profiles retain their existing collection gate in this change.

### Keep warning behavior accurate

A resolved PDF attachment is no longer reported as `Unresolved embed` merely because asset copying is disabled. Genuine unresolved targets keep the current syntax and warning. Attachment read or render failures keep their existing failure paths.

## Data Flow

The corrected PDF path is:

1. assemble and optionally expand note transclusions;
2. coalesce adjacent unmarked same-source fragments;
3. discover PDF attachment metadata;
4. rewrite the complete same-source Markdown context;
5. render using source-restored attachment URLs;
6. copy asset files only when `copyAttachments` is enabled.

## Testing

### Fragment tests

- A preserved attachment plus following text is returned as one same-source fragment.
- Inline, list-item, and blockquote attachment text is preserved byte-for-byte.
- Marked note-transclusion fragments are not coalesced across either boundary.
- Different-source fragments are never coalesced.

### Export-pipeline tests

- Exercise the exact issue #76 input with `expandEmbeds=true` and assert the Markdown passed to `renderPdf` contains a blank line between generated image HTML and the heading.
- Repeat with `expandEmbeds=false`.
- Repeat with `copyAttachments=true` and `false`, asserting attachment metadata is present for PDF in both cases.
- With copying disabled, assert that no attachment file is written to the output `assets/` directory.
- Assert inline, list-item, and blockquote embeds do not gain top-level blank lines.

### Project verification

- Run the focused red/green tests.
- Run the complete Vitest suite, Obsidian warning lint, production build, and `git diff --check`.

### Desktop verification

Load the production bundle into `/Users/Roger/my-vault` and export the exact reproducer with Obsidian 1.13.7. Verify the four-setting matrix:

| `expandEmbeds` | `copyAttachments` | Expected PDF |
| --- | --- | --- |
| on | on | image visible; following text rendered as H2 |
| on | off | image visible; following text rendered as H2; no copied asset |
| off | on | image visible; following text rendered as H2 |
| off | off | image visible; following text rendered as H2; no copied asset |

The generated PDF pages must be rendered to images and inspected. Automated tests alone are not sufficient because production PDF rendering depends on Obsidian and Electron.

## Expected Implementation Scope

Production changes should normally be limited to:

- `src/export/EmbedExpander.ts` for same-source unmarked-fragment coalescing;
- `src/export/ExportRunner.ts` for PDF attachment discovery versus copying separation.

Tests should be added primarily to:

- `src/export/EmbedExpander.test.ts`;
- `src/export/ExportRunner.test.ts`.

`LinkRewriter`, native rendering, and PDF CSS should not need production changes. Any wider change requires new evidence.

## Acceptance Criteria

- The exact issue #76 reproduction passes the four-setting desktop PDF matrix.
- Images load and following headings retain heading structure in every matrix cell.
- Inline and container embeds retain their existing structure.
- Successful note-transclusion boundaries and source-path resolution remain unchanged.
- `copyAttachments=false` produces no copied asset while retaining the image inside the PDF.
- All automated checks and the production build pass.
- Issue #76 is not answered or closed until the release-equivalent desktop artifact passes these checks.
