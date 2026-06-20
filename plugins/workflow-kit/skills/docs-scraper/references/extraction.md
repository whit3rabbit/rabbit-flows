# Content extraction

For each page: isolate the main content container, strip the chrome, convert to clean markdown.
The goal is the article body as the author wrote it — no nav, no sidebar, no footer.

## Per-platform content container

| Platform | Main content selector | Notes |
|---|---|---|
| **Starlight** | `.sl-markdown-content`, fallback `main article` | content sits inside the markdown wrapper, not the page `<main>` |
| **Docusaurus** | `.theme-doc-markdown.markdown`, fallback `article` | `.markdown` is the rendered body |
| **MkDocs/Material** | `.md-content__inner.md-typeset`, fallback `.md-content article` | `.md-typeset` carries the prose styles |
| **VitePress** | `.vp-doc`, fallback `.VPDoc .content` | `.vp-doc` wraps the rendered markdown |
| **generic** | readability heuristic: largest `<article>` / `<main>` / highest text-density block | last resort; verify it is the body not a card grid |

## Always strip (chrome)

Navbar / top nav, left sidebar, right table-of-contents aside, footer, breadcrumbs, "Edit this page" /
"Edit on GitHub" link, the prev/next pager, the search box, version/locale switchers, "last updated"
banners, cookie notices, skip-to-content links.

## Convert to markdown — preserve

- **Heading hierarchy** (`#`/`##`/…), in document order. Drop the auto-injected anchor-link icons.
- **Fenced code blocks** with their language, e.g. ` ```js `. Platforms wrap code in syntax-highlight
  spans — collapse those back to the raw code text inside one fence. Keep line content; drop per-token
  `<span>` markup. Strip "copy" buttons and line-number gutters.
- **Tables** as GitHub-flavored markdown.
- **Admonitions/callouts** (`:::note`, Material `!!! note`, etc.) → a markdown blockquote with a bold
  label, e.g. `> **Note:** …`. Don't lose the content; normalizing the syntax is fine.
- **Links** — keep as-is during extraction (absolute or as-written). Rewriting to local corpus paths
  happens only at assemble time, once the full URL→path map is known.
- **Images** — keep the markdown image with its resolved absolute `src`. (Downloading binaries is out
  of scope for v1; note image-heavy pages in gaps if it matters.)

## Gotchas

- **Client-rendered pages** (Docsify, some GitBook/SPA): a plain fetch returns an empty shell. Prefer
  the raw `.md` source URL if the platform exposes one; otherwise mark the page JS-rendered and skip it
  (record in gaps) rather than saving the empty shell.
- **Nav captured as content:** if the "content" is mostly a flat list of links, the wrong container was
  selected — fall back to the next selector or the generic heuristic.
- **Duplicated content:** print/AMP variants and trailing-slash twins resolve to the same page — the
  workflow `normURL` dedup handles this; don't fight it here.

## Output of this step (the canonical compact note)

`{ url, title, section, status: 'ok'|'empty'|'error', markdown, wordCount }`. On failure set `status`
and leave `markdown` empty; the admission gate drops empties, 404s, login walls, dupes, and nav-junk,
and flags (does not drop) thin pages.
