# Docsy

Hugo-based documentation theme (v0.11.x) by Google. Markdown or HTML content under `content/en/`;
Hugo sections map to the left-nav hierarchy. Config: `hugo.toml` at project root.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — Hugo module setup, `hugo.toml`, Go module init (`go mod init`). → `references/setup.md`
2. **Configure** — `hugo.toml`: `[module]` imports (docsy), `[params]` (UI options, feedback,
   GitHub links), `[languages.en]`, `[[menus.main]]` entries. → `references/configuration.md`
3. **Author pages** — per-page frontmatter (`title`, `weight`, `description`, `date`,
   `linkTitle`). `_index.md` defines a section landing page. → `references/frontmatter.md`
4. **Rich content** — Hugo shortcodes (Docsy adds: `alert`, `pageinfo`, `swaggerui`, `tabpane/tab`,
   `img`), Markdown with Hugo extensions, Mermaid via the `mermaid` shortcode. → `references/content-authoring.md`
5. **Components** — Docsy shortcodes: `alert`, `pageinfo`, `tabpane`/`tab`, `swaggerui`,
   `iframe`, `figure`. Hugo built-in shortcodes: `figure`, `ref`, `relref`. → `references/components.md`

For a single narrow question (e.g. "how do I order sections?") read just the one relevant reference.

## Quick facts

- Prerequisites: Hugo extended (v0.126+), Go (for Hugo modules), Node.js (for PostCSS/SASS)
- Install theme: add `github.com/google/docsy` to `go.mod` and import in `hugo.toml`
- Config file: `hugo.toml` (or `config.toml`) at project root
- Content: Markdown under `content/en/` — `_index.md` for section landing, `<page>.md` for leaves
- Dev: `hugo server --disableFastRender` | Build: `hugo --minify`
- Section ordering: `weight:` in frontmatter (lower = earlier); default is alphabetical
- Left-nav depth: `[params] ui.sidebar_menu_compact = true` for collapsed; `sidebar_menu_foldable = true` for fold
- Alerts: `{{< alert color="warning" title="Warning" >}}...{{< /alert >}}`
- Validate: `hugo --minify` (errors on broken refs and template issues with the extended build)

## Authoring guidance

- Docsy uses Hugo Modules; `go.mod` is required. Initialize with `go mod init github.com/<org>/<repo>`,
  then `go get github.com/google/docsy@v0.11.0`.
- Every content directory needs an `_index.md` to appear as a section in the left nav.
  Leaf pages (no `_index.md`) appear as direct nav entries under their parent section.
- `weight:` frontmatter controls ordering; omit to fall back to alphabetical title order.
- The `extended` Hugo variant is required for SCSS compilation; the standard binary will error.
- After config changes, `hugo --minify` is the check that matters (also validates shortcode syntax).
