# Docsify

Runtime Markdown renderer (v4.x). No build step: serves Markdown files directly to the browser
from a single `index.html`. No JSX, no components, no compilation.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — `docsify init ./docs`, project structure, `index.html` entry point,
   static-file serving options. → `references/setup.md`
2. **Configure** — `window.$docsify` object in `index.html`: name, loadSidebar, loadNavbar,
   coverpage, subMaxLevel, search plugin, routerMode. → `references/configuration.md`
3. **Author pages and nav** — no frontmatter system; `_sidebar.md` defines navigation,
   `_navbar.md` top nav, `_coverpage.md` cover. Page title = first `#` heading. → `references/frontmatter.md`
4. **Rich content** — standard Markdown, code highlighting via Prism, plugin-based admonitions
   (`> [!NOTE]`), plugin-based tabs (`<!-- tabs:start -->`), HTML embeds. → `references/content-authoring.md`
5. **Plugins and customization** — CDN script plugins (flexible-alerts, tabs, copy-code, pagination,
   mermaid, zoom-image), CSS variable overrides, custom stylesheets. → `references/components.md`

For a single narrow question (e.g. "how do I add mermaid?") read just the one relevant reference.

## Quick facts

- Scaffold: `npm i docsify-cli -g && docsify init ./docs`
- Entry point: `docs/index.html` (the app shell + `window.$docsify` config + CDN script tags)
- Content: any `.md` file in `docs/` is a routable page; `README.md` is the directory index
- Serve locally: `docsify serve docs` or `npx serve docs` or `python3 -m http.server 3000 --directory docs`
- No build output: deploy the `docs/` directory as-is to GitHub Pages, Netlify, Vercel, or any static host
- Sidebar nav: `_sidebar.md` (requires `loadSidebar: true` in `$docsify`)
- Top navbar: `_navbar.md` (requires `loadNavbar: true`)
- Cover page: `_coverpage.md` (requires `coverpage: true`)
- All plugins are `<script>` tags added to `index.html`; no npm/bundler required for the site
- No YAML frontmatter: page title = first `#` heading in the file

## Authoring guidance

- No component import syntax: all enhancements are opt-in CDN plugins. Check `references/components.md`
  for the script tag to add to `index.html` before using any plugin feature.
- Admonitions (`> [!NOTE]`) require `docsify-plugin-flexible-alerts`; tabs require `docsify-tabs`.
  Neither is available without adding the plugin script.
- SEO caveat: Docsify renders at runtime via XHR; search engines may not index content.
  Consider docsify-ssr or a prerender service if SEO matters.
- `_sidebar.md` at the root applies site-wide; subdirectories can each have their own `_sidebar.md`
  for scoped navigation.
- Validate by opening in a browser with `docsify serve`; broken links show 404 in the content area.
