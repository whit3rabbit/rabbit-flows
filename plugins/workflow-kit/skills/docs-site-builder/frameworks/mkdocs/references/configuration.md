# MkDocs: Configuration (mkdocs.yml)

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material (v9.x).

## Minimal config

```yaml
site_name: My Docs
```

## Full config example

```yaml
site_name: My Project
site_url: https://myproject.example.com/
site_description: Documentation for My Project
site_author: My Name
repo_url: https://github.com/org/repo
repo_name: org/repo

theme:
  name: material
  language: en
  palette:
    - scheme: default
      primary: indigo
      accent: indigo
      toggle:
        icon: material/brightness-7
        name: Switch to dark mode
    - scheme: slate
      primary: indigo
      accent: indigo
      toggle:
        icon: material/brightness-4
        name: Switch to light mode
  font:
    text: Roboto
    code: Roboto Mono
  features:
    - navigation.instant
    - navigation.tabs
    - navigation.sections
    - navigation.expand
    - navigation.top
    - search.highlight
    - search.share
    - content.code.copy
    - content.code.annotate

nav:
  - Home: index.md
  - Getting Started:
    - Installation: getting-started/installation.md
    - Configuration: getting-started/configuration.md
  - API Reference:
    - api/overview.md
    - api/auth.md

plugins:
  - search
  - tags

markdown_extensions:
  - admonition
  - pymdownx.details
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
  - pymdownx.highlight:
      anchor_linenums: true
      line_spans: __span
      pygments_lang_class: true
  - pymdownx.inlinehilite
  - pymdownx.snippets
  - pymdownx.tabbed:
      alternate_style: true
  - pymdownx.emoji:
      emoji_index: !!python/name:material.extensions.emoji.twemoji
      emoji_generator: !!python/name:material.extensions.emoji.to_svg
  - attr_list
  - md_in_html
  - tables
  - toc:
      permalink: true
      title: On this page

extra:
  social:
    - icon: fontawesome/brands/github
      link: https://github.com/org/repo
  version:
    provider: mike

copyright: Copyright &copy; 2024 My Company
```

## `theme.features` (Material — key ones)

| Feature | Effect |
|---|---|
| `navigation.instant` | SPA-style instant loading |
| `navigation.tabs` | Top-level nav as tabs |
| `navigation.sections` | Render sections in sidebar |
| `navigation.expand` | Auto-expand sidebar |
| `navigation.top` | Back-to-top button |
| `navigation.indexes` | Section index pages (folder with `index.md`) |
| `navigation.footer` | Prev/next page links in footer |
| `search.highlight` | Highlight search terms on page |
| `search.suggest` | Inline search suggestions |
| `content.code.copy` | Copy button on code blocks |
| `content.code.annotate` | Code annotations |
| `content.tabs.link` | Linked content tabs |
| `toc.follow` | TOC auto-scrolls |

## `nav` rules

- If `nav` is omitted: MkDocs auto-generates from the file tree.
- Sections: a list under a key. Mix of bare files and sub-sections.
- Index page for a section: a file matching the section name or `index.md` in the folder.
- Absolute paths in nav are relative to `docs/`.

## Plugins (common)

```yaml
plugins:
  - search:                     # built-in full-text search
      lang: en
  - tags:                       # page tagging (Material)
      tags_file: tags.md
  - mike:                       # versioning
  - git-revision-date-localized # show last commit date
  - minify:                     # minify HTML/CSS/JS
      minify_html: true
```

## Hooks (`hooks/`)

Python scripts in `hooks/` that modify build output:
```yaml
hooks:
  - hooks/on_page_markdown.py
```
