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

## Acquisition ladder — cheapest first (prioritize token usage)

Fetching every page through a model (load HTML into context, have the model emit markdown) is the
expensive way and the last resort. Prefer deterministic code so the model never sees raw HTML:

1. **git clone** — when the docs SOURCE is markdown in a repo (mkdocs `repo_url`, docusaurus/starlight
   `editUrl`, an "Edit on GitHub" link, a `*.github.io` host). Shallow-clone, copy the `.md`/`.mdx`.
   Zero conversion — the corpus is already markdown. Confident-only: skip if you can't name the repo.
2. **python scraper** (`scripts/scrape.py`) — for any static/SSR site reachable over HTTP. Enumerates
   via `trafilatura.sitemaps` / `llms.txt` / (MkDocs) `search_index.json`, extracts with **trafilatura**
   (readability → markdown; bs4+markdownify fallback), writes the `.md` tree + `manifest.json`. All in
   code; the model sees only the manifest. No per-platform CSS selectors needed for the primary path.
3. **playwright render** (`scrape.py --render`) — same scraper, headless Chromium, for client-rendered /
   SPA docs (Docsify, hydration-only sites). Opt-in heavy dep; reached only when python comes up empty.
4. **WebFetch fan-out** — one model fetch per page. Last resort, when nothing above can acquire.
   → `references/extraction.md`.

→ `references/acquisition.md` (strategy selection, the `scrape.py` CLI, the manifest schema).

## Workflow

Work in this order; each step has a reference to read when you reach it:

1. **Recon (cheap, facts only)** — platform (generator tag, markup, URL shape); probe
   `llms.txt`/`sitemap.xml`/`search_index.json`; `gh`-verify a backing repo + source format; enumerate
   fallback pages. → `references/detection.md` (+ shared `references/platform-signatures.md`)
2. **Decide the strategy (in code, not an agent)** — a deterministic rule over recon facts:
   verified md/mdx repo → git; client-rendered → playwright; else python; webfetch only via fallback.
   → `references/acquisition.md`
3. **Enumerate the pages** (python/webfetch only) — prefer `llms.txt` → `sitemap.xml` → sidebar-nav DOM.
   → `references/enumeration.md`
4. **Fetch + extract** — git copies markdown directly (`--clean-mdx` for `.mdx`); python extracts with
   trafilatura (bs4 fallback); webfetch isolates the content container. → `references/extraction.md`
5. **Gate (conditional)** — trusted git-`.md` uses a cheap code filter; everything else passes a
   strong-model admission gate that drops empty/404/dupe/nav-junk and flags thin pages.
6. **Assemble** — write a `.md` tree (or one concatenated corpus) plus `INDEX.md` mapping source
   URLs to local paths, with a gaps section for anything that failed or was dropped.

## Scripts (the python lane)

`scripts/` holds the deterministic scraper invoked by the workflow's python/playwright acquire agent via Bash:

- `scrape.py` — enumerate (trafilatura.sitemaps / llms.txt / MkDocs search_index) → extract (trafilatura
  primary, bs4+markdownify fallback) → write `<out>/*.md` + `<out>/manifest.json`. Exit 3 = "enumeration
  found nothing" (caller falls back). `--render` uses Playwright for client-rendered docs;
  `--clean-mdx DIR` strips import/export + JSX-only lines (git lane, `.mdx` sources).
  `scrape.py --selftest` runs stdlib-only checks of the pure helpers (CI-safe).
- `requirements.txt` — `trafilatura`, `beautifulsoup4`, `markdownify`, `httpx` (isolated venv, NOT project deps).
  `requirements-playwright.txt` — `playwright` (only installed with `setup_venv.sh --with-playwright`).
- `setup_venv.sh [--with-playwright]` — idempotent: create `scripts/.venv`, install deps, print the venv
  python path; with the flag, also install Playwright + Chromium for `--render`.

`ultimate-sitemap-parser` is intentionally avoided (GPL-3.0); `trafilatura.sitemaps` (Apache-2.0) covers discovery.

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
