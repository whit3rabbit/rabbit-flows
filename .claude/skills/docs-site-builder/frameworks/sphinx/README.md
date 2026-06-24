# Sphinx

Python documentation generator (v8.x) with MyST-Parser for Markdown support. reStructuredText
(.rst) or Markdown (.md) content; toctree directives define the page tree.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — install, `sphinx-quickstart`, project structure, dev commands. → `references/setup.md`
2. **Configure** — `docs/conf.py`: project, extensions, html_theme, source_suffix, intersphinx.
   The extensions list and MyST-Parser options are the fiddly parts. → `references/configuration.md`
3. **Author pages** — reStructuredText directives or MyST-flavored Markdown. Frontmatter via MyST.
   → `references/frontmatter.md`
4. **Rich content** — admonitions (`.. note::`, `.. warning::`), code blocks with syntax highlighting
   (Pygments), cross-references (`:doc:`, `:ref:`), images, includes, toctree. → `references/content-authoring.md`
5. **Components** — Sphinx built-in directives (autodoc, viewcode, intersphinx), Furo / RTD theme
   features, MyST-Parser admonitions in Markdown syntax. → `references/components.md`

For a single narrow question (e.g. "how do I cross-reference another page?") read just the one
relevant reference.

## Quick facts

- Install: `pip install sphinx furo myst-parser`
- Scaffold: `sphinx-quickstart docs` (creates `docs/conf.py` + `docs/index.rst`)
- Config file: `docs/conf.py` at project root
- Content: `.rst` files under `docs/` (or `.md` with `source_suffix` + MyST-Parser)
- Dev: `sphinx-autobuild docs docs/_build/html` | Build: `sphinx-build -b html docs docs/_build/html`
- Navigation: toctree directives in `index.rst` and chapter index files; no auto-generation
- Admonitions (rst): `.. note::`, `.. warning::`, `.. tip::`, `.. important::`, `.. code-block:: python`
- Admonitions (MyST Markdown): `:::{note}`, `:::`, or `!!! note` with `myst_admonition_enable`
- Cross-references: `:doc:`path/to/page`` (page), `:ref:`label`` (anchor), `:func:`module.fn`` (API)
- Validate: `sphinx-build -W -b html docs docs/_build/html` (-W turns warnings into errors)

## Authoring guidance

- `.rst` is the native format; use it for complex directives (autodoc, toctree with options).
  `.md` with MyST-Parser works for prose-heavy pages; MyST supports most Sphinx directives via
  the `{directive}` fence syntax.
- Every section needs a toctree entry (directly or via a parent index). Pages not in any toctree
  produce a WARNING and won't appear in navigation.
- Prefer `:maxdepth: 2` for the root toctree; section-level toctrees use `:maxdepth: 1`.
- Furo theme is recommended for modern projects; sphinx_rtd_theme for legacy/corporate contexts.
- After config changes, `sphinx-build -W` is the check that matters.
