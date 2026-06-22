# MkDocs + Material

Python-based static-site generator (v1.x) with MkDocs-Material theme (v9.x), the canonical
real-world setup. Pure Markdown content; no JSX or components.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — install, `mkdocs new`, project structure, dev commands. → `references/setup.md`
2. **Configure** — `mkdocs.yml`: site_name, theme, nav, plugins, markdown_extensions.
   The `nav` and `theme.features` list are the fiddly parts. → `references/configuration.md`
3. **Author pages** — per-page frontmatter (title, description, status, tags). → `references/frontmatter.md`
4. **Rich content** — admonitions (`!!! note`), code blocks with annotations, content tabs (`===`),
   Mermaid, math, grids, buttons, snippet includes, emoji. → `references/content-authoring.md`
5. **Components** — MkDocs-Material extension patterns: cards grid, annotations, tooltips, details,
   content tabs, blog plugin, social cards. → `references/components.md`

For a single narrow question (e.g. "how do I do collapsible admonitions?") read just the one
relevant reference.

## Quick facts

- Install: `pip install mkdocs-material` (brings in mkdocs as a dependency)
- New project: `mkdocs new my-project` — creates `mkdocs.yml` + `docs/index.md`
- Config file: `mkdocs.yml` at project root
- Content: Markdown files under `docs/`
- Dev: `mkdocs serve` | Build: `mkdocs build` | Deploy to GitHub Pages: `mkdocs gh-deploy`
- Nav: omit `nav:` to auto-generate from file tree; add explicit `nav:` only for custom ordering
- Admonitions: `!!! note`, `!!! tip "Custom title"`, `??? note "Collapsible"`, `???+ tip "Open by default"`
- Content tabs: `=== "Tab name"` blocks (requires `pymdownx.tabbed` with `alternate_style: true`)
- Code blocks: `pymdownx.highlight` + `pymdownx.superfences`; title via ` ```python title="file.py" `,
  line numbers via `linenums="1"`, copy button via `content.code.copy` theme feature
- Validate: `mkdocs build` catches broken nav references and missing files

## Authoring guidance

- MkDocs-Material uses Markdown extensions, not importable components. "Components" are extension
  patterns (see `references/components.md`).
- Enable extensions you need in `mkdocs.yml`; most patterns require a specific `markdown_extensions`
  entry. Check `references/content-authoring.md` for required extensions per feature.
- No YAML frontmatter support by default in bare MkDocs; Material adds `title`, `description`,
  `status`, `tags` — check `references/frontmatter.md`.
- After config changes, `mkdocs build` is the check that matters.
