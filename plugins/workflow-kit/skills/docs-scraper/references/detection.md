# Platform detection

Identify the docs platform from the entry page's HTML before enumerating or extracting. Check signals
in this order; the generator meta tag is the strongest single signal.

## Signals, by strength

1. **Generator meta tag** — `<meta name="generator" content="...">`. Most reliable when present.
2. **Characteristic markup / CSS classes** — framework-specific wrapper classes survive theming.
3. **Asset paths / script names** — bundle names and `_app`/`assets` paths hint at the generator.
4. **URL shape** — trailing-slash style, `/docs/` prefix conventions. Weakest; corroborate only.

## Per-platform signatures

| Platform | generator tag | Markup / class tells | Other |
|---|---|---|---|
| **Starlight** (Astro) | `content="Astro v…"` | `.sl-markdown-content`, `<starlight-…>` custom elements, `data-astro-*` attrs | `/_astro/` asset paths |
| **Docusaurus** | `content="Docusaurus v…"` | `.theme-doc-markdown`, `.markdown`, `#__docusaurus` root, `.navbar__inner` | `/assets/js/` chunked bundles |
| **MkDocs / Material** | `content="mkdocs-…"` / `"Material for MkDocs"` | `.md-content`, `.md-main`, `[data-md-component]`, `.md-nav` | `search/search_index.json` exists |
| **VitePress** | `content="VitePress v…"` | `.VPDoc`, `.vp-doc`, `#VPContent`, `.VPSidebar` | `/assets/chunks/` Vite hashes |
| **GitBook** | (often none) | `.gitbook-root`, `data-testid` attrs | hydration-heavy; treat as generic + JS-render risk |
| **Sphinx / ReadTheDocs** | `content="Docutils …"` / `"Sphinx"` | `.rst-content`, `.document`, `.wy-nav-content` (RTD theme) | `searchindex.js`, `objects.inv` |
| **Docsify** | none | near-empty `<body>` with `<div id="app">`, `window.$docsify` script | **client-rendered: raw HTML has no content** |

## Client-rendered gotcha

Docsify (and some GitBook/SPA setups) ship a shell page whose real content is fetched and rendered by
JavaScript. A plain HTTP fetch of such a page returns navigation scaffolding and an empty content div.
Tell: the fetched HTML is tiny, has a single mount div, and a `$docsify`/SPA bootstrap script.

When detected: the page list usually still lives in a `_sidebar.md` / `summary` markdown file the SPA
loads, OR the underlying `.md` source files are fetchable directly (Docsify maps route `/foo` to
`/foo.md`). Prefer fetching the raw `.md` source over the rendered HTML. If neither works, report the
site as JS-rendered in the gaps section rather than capturing the empty shell.

## Output of this step

`{ platform: 'starlight'|'docusaurus'|'mkdocs'|'vitepress'|'generic', baseUrl, jsRendered: bool, evidence: string }`.
When no signature matches, return `platform: 'generic'` with the evidence you did find.
