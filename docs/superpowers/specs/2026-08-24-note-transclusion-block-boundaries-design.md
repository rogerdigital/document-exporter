# Note Transclusion Block Boundaries

## Context

`EmbedExpander` preserves source-aware Markdown fragments so links inside an
embedded note can later be rewritten relative to that note. Both
`DocumentAssembler` and `ExportRunner` currently reconstruct the section with
`join("")`.

That exact concatenation is correct for ordinary source slices, but a
successfully expanded note transclusion is a block-level insertion. When the
host does not already provide blank lines, the embedded note is joined directly
to adjacent host content:

```markdown
Before ![[note]] after

![[note#One]] ![[note#Two]]
```

The resulting Markdown can merge headings, lists, blockquotes, tables, code
fences, or ordinary paragraphs across the transclusion seam. Nested note
transclusions have the same problem inside the embedded note.

## Goals

- Treat every successfully expanded Markdown note transclusion as an
  independent Markdown block.
- Cover full-note, heading-scoped, self, repeated, inline, and nested note
  transclusions.
- Preserve each fragment's source path through link rewriting.
- Insert only the missing line breaks at a transclusion boundary.
- Preserve existing blank-line spacing and line-ending style.
- Apply the same final Markdown structure to every export profile.

## Non-goals

- Changing attachment embed rewriting or the attachment fix from issue #76.
- Expanding block-reference embeds.
- Changing cycle, depth-limit, unresolved, missing-heading, or non-Markdown
  fallback behavior.
- Changing heading extraction, heading normalization, frontmatter handling, or
  link-resolution rules.
- Replacing the current fragment architecture or introducing a Markdown parser.

## Chosen Behavior

A successfully expanded note transclusion always becomes an independent block,
including when the source embed appears inline.

For example, given an embedded note whose body is `## Embedded`:

```markdown
Before ![[note]] after
```

the assembled Markdown is structurally equivalent to:

```markdown
Before

## Embedded

after
```

Horizontal whitespace used only to separate the inline embed from adjacent
host text is removed at the host side of the seam. Whitespace and indentation
inside the embedded note are not trimmed, because they may be meaningful for
indented code or nested Markdown.

## Design

### Carry explicit transclusion boundary metadata

Extend the source-aware fragment type with optional block-boundary flags:

```ts
type DocumentFragment = {
	markdown: string;
	sourcePath: string;
	blockBoundaryBefore?: boolean;
	blockBoundaryAfter?: boolean;
};
```

`EmbedExpander` adds the flags only after a Markdown note has been resolved,
read, and successfully expanded:

- the first returned fragment receives `blockBoundaryBefore`;
- the last returned fragment receives `blockBoundaryAfter`;
- a one-fragment expansion receives both flags.

Nested expansion keeps its own inner flags while the outer expansion marks the
outermost first and last fragments. Boolean flags are sufficient because the
required separator is idempotent: multiple nested boundaries at the same seam
still require only one blank line.

The following paths return the original embed without boundary flags:

- attachments and other non-Markdown embeds;
- unresolved targets;
- unsupported block references;
- missing headings;
- circular embeds;
- depth-limit fallbacks.

This distinction prevents failed expansion from changing the author's original
Markdown structure.

### Join fragments through one boundary-aware helper

Add a focused `joinMarkdownFragments` helper used by both
`DocumentAssembler` and `ExportRunner`.

For each seam, the helper checks whether the fragment on the left ends a
transclusion or the fragment on the right begins one. At a marked seam it:

1. removes horizontal separator whitespace only from the adjacent host side;
2. preserves existing blank lines;
3. upgrades a single line break to a blank-line boundary;
4. inserts a blank-line boundary when no line break exists;
5. adds no leading or trailing blank lines at document edges.

The helper selects CRLF when the adjoining content uses CRLF and otherwise uses
LF. It never normalizes unrelated line endings or collapses author-provided
blank lines.

Fragments without boundary metadata are concatenated exactly as before. This
keeps disabled expansion and ordinary source slices byte-for-byte stable.

### Preserve source-aware link rewriting

`DocumentAssembler` normalizes headings per fragment, preserves all fragment
metadata, and calls `joinMarkdownFragments` for its assembled preview.

`ExportRunner` continues to pass every fragment separately to `LinkRewriter`
using that fragment's `sourcePath`. Instead of collecting only rewritten
strings, it copies each rewritten string back onto the corresponding fragment
and calls the same join helper. Boundary metadata therefore survives the stage
that currently performs the final concatenation.

This ordering preserves relative link and attachment resolution inside embedded
notes while ensuring the renderer receives the same block-safe structure that
`DocumentAssembler` produced.

### Empty and nested expansions

An empty successfully expanded note carries boundary metadata but contributes
no visible content. The joiner treats its boundary as a separator between
surrounding nonempty host fragments and does not emit multiple blank blocks.

For nested transclusions, each successful level marks its own edges. The joiner
applies the same non-duplicating rule at every seam, so inner note content is
separated from its parent note and the outer note is separated from the host.

## Behavior Matrix

| Source case | Expected result |
| --- | --- |
| `Before ![[note]] after` | Host text, note, and trailing host text are separate blocks |
| `![[note#One]] ![[note#Two]]` | The two heading sections are separate blocks |
| Host already has blank lines around the embed | Existing spacing is preserved |
| Host has one newline around the embed | The seam is upgraded to a blank line |
| Nested note embed | Both inner and outer transclusion seams are block-safe |
| Document contains only one note embed | No outer leading or trailing blank line |
| Note content starts with indentation | Embedded indentation is preserved |
| Attachment embed | No note-boundary metadata; attachment pipeline remains authoritative |
| Unresolved, cycle, depth, or missing-heading fallback | Original embed syntax and spacing remain unchanged |
| Expansion setting is disabled | Original Markdown remains unchanged |

## Testing

### Fragment joiner unit tests

- Exact concatenation when no boundary flags exist.
- Inline host text split around a successful note transclusion.
- A single newline upgraded to a blank line.
- Existing LF and CRLF blank lines preserved without duplication.
- No unnecessary document-edge whitespace.
- Host-side separator spaces removed without trimming embedded indentation.
- Repeated and nested boundary flags remain idempotent.
- Empty expanded content does not produce duplicate blank blocks.

### Embed expansion tests

- Successful full-note and heading-scoped expansions mark their outer edges.
- Nested expansions preserve inner and outer boundary metadata.
- Attachments and every fallback path remain unmarked.
- Repeated heading transclusions no longer concatenate through a host space.

### Assembly and runner integration tests

- `DocumentAssembler` emits block-safe Markdown while retaining source-aware
  fragments.
- `ExportRunner` preserves boundaries after per-fragment `LinkRewriter`
  processing.
- Relative images and links inside embedded notes still resolve against the
  embedded note's folder.
- Expansion-disabled output remains unchanged.

### Full and runtime verification

- Run the focused Vitest files, full test suite, Obsidian warning lint, and
  production build.
- Use `/Users/Roger/my-vault` for a fixture covering inline, heading-scoped,
  repeated, nested, list, quote, table, and fenced-code adjacency.
- Export representative Markdown bundle, HTML, DOCX, EPUB, and PDF artifacts.
- Inspect generated text/HTML structure and verify PDF rendering in desktop
  Obsidian, because the production PDF path depends on Obsidian and Electron.

## Expected Files

- `src/types.ts`
- `src/export/FragmentJoiner.ts`
- `src/export/FragmentJoiner.test.ts`
- `src/export/EmbedExpander.ts`
- `src/export/EmbedExpander.test.ts`
- `src/export/DocumentAssembler.ts`
- `src/export/DocumentAssembler.test.ts`
- `src/export/ExportRunner.ts`
- `src/export/ExportRunner.test.ts`

Changes outside this list require evidence that the shared fragment boundary
cannot be fixed within the existing export pipeline.

## Acceptance Criteria

- Every successful Markdown note transclusion has independent block boundaries,
  including inline and nested cases.
- Headings, lists, blockquotes, tables, fences, and paragraphs do not merge
  across a transclusion seam.
- Existing blank lines and meaningful embedded indentation are preserved.
- Failed or disabled note expansion, attachments, warnings, and relative-link
  behavior remain unchanged.
- Every export profile receives the same block-safe assembled Markdown.
- Automated verification passes and desktop Obsidian artifacts pass runtime
  inspection.
