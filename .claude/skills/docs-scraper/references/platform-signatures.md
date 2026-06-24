# Platform signatures (shared)

Single source of truth for **which docs platform a site is** and **how you recognise it from
either side**: the rendered markup a scraper reads, and the source config a builder authors. One
table, two consumers — `docs-scraper` (detect a live site) and `docs-site-builder` (author one).

Columns:
- **Detect tell** — what identifies the platform in the *served HTML*: generator meta tag, then
  characteristic markup/CSS, then asset/URL shape. Generator tag is the strongest single signal.
- **Content container** — the wrapper holding the real prose (what a scraper isolates, strips
  chrome around, and converts to markdown).
- **Render** — `static`/`SSR` (a plain fetch returns content) vs `CSR` (JS hydrates an empty shell;
  fetch the raw source instead — see the gotcha below).
- **Source config / nav** — the files that define the site at author time (what a builder writes).
- **Docs home** — upstream docs to confirm against (use `find-docs`/context7, not memory).

| Platform | Detect tell (served HTML) | Content container | Render | Source config / nav | Docs home |
|---|---|---|---|---|---|
| **Starlight** (Astro) | `<meta generator "Astro">`; `.sl-markdown-content`, custom `<starlight-*>`; `/_astro/` assets | `.sl-markdown-content` (fallback `main article`) | static | `astro.config.mjs` (`starlight()` integration); sidebar in that config | https://starlight.astro.build/ |
| **Docusaurus** | `<meta generator "Docusaurus">`; `#__docusaurus`, `.theme-doc-markdown`, `.markdown`, `.navbar__inner`; `/assets/js/` chunks | `.theme-doc-markdown.markdown` (fallback `article`) | static (React-hydrated) | `docusaurus.config.js`; `sidebars.js`; `docs/` + `blog/` | https://docusaurus.io/ |
| **MkDocs / Material** | `<meta generator "mkdocs"/"Material for MkDocs">`; `.md-content`, `.md-main`, `.md-nav`; `search/search_index.json` | `.md-content__inner.md-typeset` (fallback `.md-content article`) | static | `mkdocs.yml` (`nav:`, `theme:`); `docs/` | https://squidfunk.github.io/mkdocs-material/ |
| **VitePress** | `<meta generator "VitePress">`; `.VPDoc`, `.vp-doc`, `#VPContent`, `.VPSidebar`; `/assets/chunks/` | `.vp-doc` (fallback `.VPDoc .content`) | static (Vue-hydrated) | `.vitepress/config.ts` (`themeConfig.nav`, `.sidebar`) | https://vitepress.dev/ |
| **Fumadocs** (Next.js) | no generator; ids `#nd-docs-layout`, `#nd-sidebar`, `#nd-page`, `#nd-toc`; `DocsBody`→`<article>` | `#nd-page article` (fallback `article .prose`); prefer per-page raw `.md` if exposed | SSR | `source.config.ts` + app router; `fumadocs-mdx`; page/meta frontmatter | https://fumadocs.dev/ |
| **GitBook** | often no generator; `.gitbook-root`, `[data-testid]`, `data-view`/`data-card-*`; legacy self-hosted `.markdown-section`, `.page-inner` | modern: `main` / `[data-testid="page.content"]` (confirm it is prose); legacy: `.markdown-section .page-inner` | SSR (modern hosted); markup shifts — confirm container | hosted editor / `SUMMARY.md` (legacy self-hosted) | https://gitbook.com/docs |
| **Sphinx / ReadTheDocs** | `<meta generator "Docutils"/"Sphinx">`; `.rst-content`, `div.body[role=main]`, `.wy-nav-content` (RTD theme); `searchindex.js`, `objects.inv`, `/_static/` | `.rst-content [role=main]` (fallback `div.body[role=main]`); strip `.headerlink` anchors | static | `conf.py`; `index.rst`/`index.md` + toctree | https://www.sphinx-doc.org/ |
| **Docsify** | no generator; near-empty `<body>` with `<div id="app">` + `window.$docsify` script | fetch raw `.md` source at `/<route>.md`, NOT rendered HTML (fallback `.markdown-section`) | **CSR** | `index.html` (`window.$docsify`); nav `_sidebar.md` / `_navbar.md` | https://docsify.js.org/ |
| **mdBook** | no generator; `<div id="content" class="content">`, theme `book.js`, `nav.nav-chapters` (signatures unverified — generic fallback for scraping) | `#content main` (unverified; treat as generic) | static | `book.toml`; `src/SUMMARY.md` (TOC drives the book) | https://rust-lang.github.io/mdBook/ |
| **generic** | no signature matched | largest `<article>`/`<main>`/highest text-density block (verify it is body, not a card grid) | unknown — probe | n/a | n/a |

## Client-rendered gotcha (scrape side)

Docsify (and some modern GitBook/SPA setups) ship a shell page whose real content is rendered by
JavaScript: a plain fetch returns a tiny HTML with a single mount div and a `$docsify`/SPA bootstrap
script, and an empty content container. When you see that tell, fetch the raw `.md` source instead
(Docsify maps route `/foo` → `/foo.md`; its page list lives in `_sidebar.md`). If no raw source is
exposed, set `jsRendered:true` and report the site in the gaps section rather than capturing the shell.

**Fumadocs is the inverse:** also a JS framework, but Next.js server-renders the article into the HTML,
so a plain fetch *does* return content. Still prefer its `/llms.txt` (curated list) and per-page raw
`.md` source when exposed — but both are opt-in, so probe; don't assume.

## Verification note

The detect tells and containers for the eight first-class scrape platforms were live-validated via
WebFetch probes (2026-06-20). mdBook is **not** a first-class scrape target — its row carries the
well-known build identity (`book.toml` / `SUMMARY.md`) but its markup signatures are unverified, so
scrape it via the generic fallback. Confirm any row against the platform's current docs before relying
on exact selectors; themes and framework versions move.
