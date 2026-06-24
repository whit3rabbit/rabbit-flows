# MkDocs: Frontmatter

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material (v9.x).

Frontmatter is YAML between `---` delimiters at the top of a Markdown file.

## Core MkDocs frontmatter

```yaml
---
title: Page Title               # overrides H1/filename as page title
description: Short description  # used in <meta name="description">
hide:
  - navigation                  # hide the left sidebar on this page
  - toc                         # hide the right table of contents
  - footer                      # hide prev/next footer
---
```

## Material-specific frontmatter

```yaml
---
status: new          # badge in sidebar: 'new' | 'deprecated'
icon: material/star  # icon next to title in sidebar
tags:
  - HTML
  - JavaScript
search:
  boost: 2           # boost this page in search results (default 1)
  exclude: false     # exclude from search index
---
```

## Template frontmatter

```yaml
---
template: home.html  # use a custom Jinja2 template for this page
---
```

## Notes

- MkDocs frontmatter is minimal; most configuration lives in `mkdocs.yml`.
- `title` from frontmatter overrides the first `# H1` heading and the nav label if no explicit nav entry.
- `tags` require the `tags` plugin enabled in `mkdocs.yml`.
- `hide: [navigation, toc]` is useful for landing pages that should show full-width content.
- `description` is not displayed on the page itself; it populates `<meta name="description">` and social sharing cards.
