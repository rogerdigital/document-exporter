# Attachment Embed Block Boundaries

## Context

GitHub issue #76 reports that a Markdown heading immediately after an image embed is rendered as plain text in PDF output:

```markdown
![[image.png]]
## Title
```

The export pipeline collects the attachment, rewrites the wiki embed, and then sends the rewritten Markdown to either Obsidian's native Markdown renderer or the basic HTML fallback. For PDF and HTML exports, `LinkRewriter` currently rewrites supported attachment embeds to raw HTML such as `<img>`, `<video>`, `<audio>`, and `<object>` without preserving whether the original embed occupied a complete Markdown block. Raw HTML adjacent to later Markdown can keep that content in the same paragraph or HTML block, so headings and other block constructs lose their intended structure.

The fallback converter has the same class of problem. It protects generated media tags with inline placeholders before paragraph construction, but does not distinguish a standalone media block from media embedded in a paragraph.

## Goals

- Fix issue #76 in both PDF and HTML exports.
- Preserve Markdown block boundaries after standalone attachment embeds.
- Cover images, video, audio, embedded PDFs, and other attachment types handled by `LinkRewriter`.
- Keep inline attachment embeds inline.
- Make native and fallback rendering agree on the resulting document structure.
- Preserve the current output behavior of Markdown bundle, DOCX, and EPUB exports.

## Non-goals

- Changing note transclusion expansion or fragment joining.
- Changing unsupported or unresolved embed behavior and warnings.
- Redesigning the Markdown parser or native renderer integration.
- Adding new attachment types, image sizing syntax, or media controls.
- Refactoring unrelated export code or CSS.

Note transclusion boundary handling will be addressed in a separate pull request.

## Design

### Prefer Markdown semantics where an equivalent exists

For PDF and HTML profiles:

- Image attachments use standard Markdown image syntax: `![label](path)`.
- Attachments without an embedded-media representation use standard Markdown link syntax: `[label](path)`.
- Video, audio, and PDF embeds continue to use generated safe HTML because Markdown has no equivalent embedded-media syntax:
  - `<video controls ...>`
  - `<audio controls ...>`
  - `<object data=...>`

Markdown images and links are already supported by link restoration, Obsidian native rendering, and the fallback converter. Reusing them removes unnecessary raw HTML from the rendering boundary.

The existing profile-specific behavior for Markdown bundle, DOCX, and EPUB remains unchanged.

### Distinguish standalone and inline attachment embeds

An attachment embed is standalone when the source line contains only optional horizontal whitespace, the embed, and optional horizontal whitespace. An embed with any other content on the same line is inline.

Examples:

```markdown
![[clip.mp4]]

Text ![[clip.mp4]]

- ![[clip.mp4]]

> ![[clip.mp4]]
```

The four examples are, respectively: standalone, inline, contained in a list item, and contained in a blockquote.

For generated video, audio, and PDF HTML:

- A standalone replacement must have a Markdown blank-line boundary before and after it when adjacent nonblank content exists.
- Existing blank lines are preserved and are not multiplied.
- No unnecessary leading boundary is added at the start of a document.
- No unnecessary trailing boundary is added at the end of a document.
- Inline, list-item, and blockquote replacements do not receive injected blank lines.

The boundary decision belongs in `LinkRewriter`, where the original source context and replacement type are both available. The renderer should not infer whether arbitrary user-authored HTML was originally an attachment embed.

### Preserve native rendering behavior

PDF and HTML continue to use `renderMarkdownNative` when the Obsidian DOM is available.

- Markdown images are restored from copied output paths to source-relative vault paths before native rendering.
- Native `app://` URLs are rewritten back to copied attachment paths after rendering.
- Standalone generated HTML reaches the renderer with explicit Markdown block boundaries.

No changes are planned for `renderMarkdownNative`, attachment collection, or URL disambiguation unless runtime verification exposes a regression.

### Make fallback placeholders block-aware

`markdownToBasicHtml` must keep generated attachment HTML safe while preserving its structural context.

- A protected media placeholder that occupies an entire blank-line-delimited block is restored directly as a block-level sibling.
- A protected media placeholder mixed with text remains inside the paragraph containing that text.
- Headings, lists, blockquotes, tables, code fences, and horizontal rules following standalone media must not be wrapped into the media paragraph.
- Generic attachments use normal Markdown links, so they follow the existing safe link conversion instead of passing raw `<a>` HTML through the escape stage.

This keeps the fallback output valid without broadening the allowlist for arbitrary user-authored HTML.

### Preserve warnings and disabled attachment copying

- When attachment copying is disabled, the existing path that leaves attachment embeds available to Obsidian's native renderer remains unchanged.
- Unresolved attachments keep their current syntax and warnings.
- A native-renderer failure continues to produce the existing fallback warning.
- Boundary normalization does not add new user-facing warnings and does not suppress attachment-copy failures.
- No new runtime dependency is introduced.

## Behavior Matrix

| Source context | Attachment representation | Expected structure |
| --- | --- | --- |
| Standalone image followed by H1-H6 | Markdown image | Image and heading are separate blocks |
| Standalone video/audio/PDF followed by H1-H6 | Safe HTML with explicit block boundary | Media and heading are separate blocks |
| Standalone attachment followed by list, quote, table, fence, or rule | Type-appropriate representation | Following construct remains a Markdown block |
| Consecutive standalone attachments | Type-appropriate representations | Original order is preserved; attachments do not consume later blocks |
| Inline image or media in prose | Markdown image or safe inline HTML | Surrounding prose remains one paragraph |
| Attachment inside list item or blockquote | Existing container-relative replacement | No top-level blank line breaks the container |
| Source already contains blank lines | Type-appropriate representation | No extra blank paragraphs are introduced |
| Attachment copying is disabled | Existing original embed path | Current native-renderer behavior is preserved |
| Unresolved attachment | Existing unresolved behavior | Original syntax and warning are preserved |

## Testing

### `LinkRewriter` unit tests

- Image embeds use Markdown image syntax for PDF and HTML.
- Generic attachment embeds use Markdown link syntax for PDF and HTML.
- Standalone video, audio, and PDF embeds receive block boundaries only when required.
- Existing blank lines are not duplicated.
- Beginning-of-document and end-of-document embeds do not gain unnecessary outer whitespace.
- Inline, list-item, and blockquote embeds do not receive top-level block boundaries.
- Markdown bundle, DOCX, and EPUB expectations remain unchanged.

### Fallback HTML tests

For each generated attachment representation, verify that adjacent constructs are emitted as sibling blocks rather than nested in a paragraph:

- H1-H6 headings
- unordered and ordered lists
- blockquotes
- tables
- fenced code blocks
- horizontal rules
- ordinary following paragraphs

Also verify consecutive media, mixed inline media and text, and generic attachment links.

### Pipeline and regression tests

- Confirm PDF and HTML profiles receive the corrected rewritten Markdown.
- Confirm other profiles retain their existing output.
- Run the full test suite, lint, type-check, and production build.

### Obsidian runtime verification

Use `/Users/Roger/my-vault` for a fixture note containing the adjacency matrix above.

- Build the plugin so the vault-visible symlink receives the updated bundle.
- Export the fixture to PDF and HTML in desktop Obsidian.
- Inspect the HTML structure and rendered appearance.
- Inspect the PDF for heading styles, media order, lists, blockquotes, and unintended whitespace.

PDF completion must not be claimed from headless tests alone because the production path depends on Obsidian's renderer and Electron printing.

## Expected Files

The implementation should normally be limited to:

- `src/export/LinkRewriter.ts`
- `src/export/LinkRewriter.test.ts`
- `src/formats/html-document.ts`
- `src/formats/html-document.test.ts`

Small targeted additions to PDF or `ExportRunner` tests are allowed when needed to prove profile integration. Production changes to PDF rendering, native rendering, CSS, attachment collection, or document assembly require new evidence that the narrower design is insufficient.

## Acceptance Criteria

- The exact issue #76 reproduction renders `Title` as a heading in PDF and HTML without requiring a source blank line.
- Equivalent adjacency cases work for every supported attachment embed representation.
- Inline, list-item, and blockquote attachment embeds retain their container structure.
- Native and fallback rendering produce structurally valid output.
- Markdown bundle, DOCX, EPUB, unresolved embeds, and note transclusion behavior are unchanged.
- Automated verification passes, and desktop Obsidian artifacts pass manual inspection.
