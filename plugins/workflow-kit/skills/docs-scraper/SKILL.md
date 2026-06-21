---
name: docs-scraper
description: Ingest an existing documentation website into a local markdown corpus. Detect the docs platform (Starlight, Docusaurus, MkDocs/Material, VitePress, Fumadocs, GitBook, Sphinx/ReadTheDocs, Docsify, or generic), enumerate its pages, fetch + extract clean markdown, and assemble a navigable corpus. Use when the user wants to scrape, mirror, ingest, archive, or pull down docs from a website, or asks "save these docs locally" / "turn this docs site into markdown".
---

# Docs scraper

The mirror image of `docs-site-builder`: that skill knows how to *build* docs sites on these
platforms; this one knows how to *read* sites built on them. The point is the same — get the
platform's real markup contract in front of you so you extract the actual content instead of
guessing, and strip the chrome instead of capturing nav junk.

The runtime copy of this guidance lives inline in `.claude/workflows/docs-scrape.js` (the
`DETECTION` and `EXTRACTION` consts). If you change a reference here, refresh those consts —
`agent()` has no `skills` option, so the workflow cannot load this skill at runtime.

## Workflow

Work in this order; each step has a reference to read when you reach it:

1. **Detect the platform** — generator meta tag, characteristic markup/CSS, URL shape.
   → `references/detection.md`
2. **Enumerate the pages** — prefer `llms.txt` → `sitemap.xml` → sidebar-nav DOM extraction.
   → `references/enumeration.md`
3. **Fetch + extract** — isolate the main content container, strip chrome, convert to clean
   markdown preserving headings/code-fences/tables. → `references/extraction.md`
4. **Assemble** — write a `.md` tree (or one concatenated corpus) plus `INDEX.md` mapping source
   URLs to local paths, with a gaps section for anything that failed or was dropped.

## Platform coverage

First-class detection signatures and extraction selectors exist for: **Starlight, Docusaurus,
MkDocs/Material, VitePress, Fumadocs, GitBook, Sphinx/ReadTheDocs, Docsify**, plus a generic
readability-style fallback for everything else. Two carry caveats:

- **Docsify** is client-rendered (the HTML is a near-empty shell hydrated by JS). Don't extract the
  rendered HTML — fetch `_sidebar.md` for the page list and each route's raw `/foo.md` source.
- **GitBook** modern hosted sites are hydration-heavy and the markup shifts; confirm the chosen
  container holds prose before trusting it, and fall back to the generic heuristic if not.
- **Fumadocs** server-renders content (HTML has the body — extract it directly). `/llms.txt` and
  per-page raw `.md` are opt-in, not guaranteed — probe for them and use if present, else extract HTML.

## Quick facts

- **Enumeration priority:** `llms.txt` (if present, it is the curated page list — use it) →
  `/sitemap.xml` → extract links from the sidebar nav DOM. Never crawl blindly link-by-link.
- **Content container** is platform-specific (see `extraction.md`): e.g. `<article>`/`.sl-markdown-content`
  for Starlight, `article` / `.theme-doc-markdown` for Docusaurus, `.md-content` for MkDocs,
  `.VPDoc`/`.vp-doc` for VitePress.
- **Always strip:** nav, sidebar, footer, breadcrumbs, "edit on GitHub", "next/prev" pager, table-of-contents
  aside, search box.
- **Preserve:** heading hierarchy, fenced code blocks (with language), tables, links (rewrite to local
  paths only at assemble time, not during extraction).
