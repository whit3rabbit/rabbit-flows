# Page enumeration

Get the full, canonical page list once, up front. Never crawl blindly link-by-link: it is slow,
re-fetches the same pages, and wanders off-site. Use the curated source the site already publishes.

## Priority order

1. **`llms.txt`** (try `<baseUrl>/llms.txt`). When present this is a curated, machine-readable list
   of the doc pages, often the single best source. `llms-full.txt` may contain the full text already —
   if so, enumeration and extraction collapse into one fetch. Use it.
2. **`sitemap.xml`** (try `<baseUrl>/sitemap.xml`, then `/sitemap_index.xml`). Parse `<loc>` entries;
   filter to the docs path (e.g. keep only URLs under `/docs/` or the entry's path prefix). Sitemaps
   are complete by design — the preferred fallback when there is no `llms.txt`.
3. **Sidebar nav DOM** — when there is no sitemap, extract the page list from the rendered navigation:
   the platform's sidebar container holds every doc link. Selectors per platform below. De-dup the
   hrefs, resolve them against `baseUrl`, drop external/anchor-only links.

## Sidebar selectors (for step 3)

| Platform | Sidebar nav container | Link selector |
|---|---|---|
| Starlight | `nav.sidebar`, `<starlight-menu>` | `a[href]` within it |
| Docusaurus | `.theme-doc-sidebar-menu`, `.menu__list` | `a.menu__link[href]` |
| MkDocs/Material | `.md-nav--primary`, `.md-sidebar--primary` | `a.md-nav__link[href]` |
| VitePress | `.VPSidebar`, `.VPSidebarNav` | `a.VPLink[href]`, `.link[href]` |
| Fumadocs | `#nd-sidebar`, `aside` | `a[href]` (try `llms.txt`/`sitemap.xml` first — see below) |
| GitBook | `aside`, `[data-testid="table-of-contents"]`; legacy `.book-summary` | `a[href]` |
| Sphinx/RTD | `.wy-menu-vertical` (RTD), `.sphinxsidebar` (classic) | `a.reference.internal[href]` |
| Docsify | rendered `.sidebar-nav`, OR fetch `<baseUrl>/_sidebar.md` directly | `a[href]` / markdown links in `_sidebar.md` |
| generic | `nav`, `[role=navigation]`, `aside` | `a[href]` then filter to same-origin docs paths |

**Platform-specific shortcuts that beat the sidebar:**
- **Fumadocs** MAY serve `/llms.txt` (opt-in feature, not default — verified absent on fumadocs.dev at
  test time). Probe `<baseUrl>/llms.txt`; if present (and `llms-full.txt` with full text even better),
  use it — it collapses enumeration + extraction. If absent, fall back to `sitemap.xml` then nav.
- **Docsify** has no sitemap. Fetch `<baseUrl>/_sidebar.md` and parse its markdown links — that *is* the
  page list. Each link's `/foo` route maps to source `/foo.md` for extraction.

## Filtering

- Resolve relative hrefs against `baseUrl`; keep only **same-origin** links under the docs path prefix.
- Drop pure anchors (`#section`), `mailto:`, external domains, and asset links (`.png`, `.js`, `.css`).
- Apply caller `include`/`exclude` URL globs here.
- De-dup with a normalized key (lowercase host, strip `www.`, strip trailing slash) — see `normURL`
  in the workflow. The workflow also enforces the `maxPages` / budget cap.

## Output of this step

`{ baseUrl, pages: [{ url, title?, section? }], source: 'llms.txt'|'sitemap'|'nav', constraints }`.
`section` is the sidebar group the page sits under (used to mirror the hierarchy at assemble time).
`constraints` carries the platform content-container selector + chrome-to-strip so fetch workers do
not re-derive it.
