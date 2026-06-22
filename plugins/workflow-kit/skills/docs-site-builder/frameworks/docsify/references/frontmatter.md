# Docsify: Frontmatter

Distilled from docsifyjs/docsify (v4.x).

## Key point

**Docsify does not process YAML frontmatter by default.** Frontmatter blocks are displayed as raw Markdown (typically a table or code block) unless a plugin handles them.

## Page identity

- URL = the file path relative to the docs root. No slug customization in frontmatter.
- Page title in browser tab = the first `# H1` heading found in the page.
- Sidebar label = the link text in `_sidebar.md`, not derived from the file.

## Custom cover page (not frontmatter)

The `_coverpage.md` file is the cover page; it uses regular Markdown content.

## Plugin-based frontmatter

Some community plugins add frontmatter support. Example with `docsify-front-matter`:

```md
---
title: Custom Page Title
keywords: docs, search
---
```

Without such a plugin, strip frontmatter manually or the block will render visibly.

## Recommended convention

Since there is no native frontmatter, use H1 headings for page titles:

```md
# Getting Started

Content begins here.
```

The `_sidebar.md` entry controls what the page is called in navigation:
```md
- [Getting Started](getting-started.md)
```

## Per-directory sidebars

To scope a sidebar to a subdirectory:
1. Create `guide/_sidebar.md` with links relative to that directory.
2. Set `window.$docsify.alias` if needed to prevent the root sidebar from overriding.

Example:
```md
<!-- guide/_sidebar.md -->
- [Back to Home](/)
- [Guide Overview](guide/)
- [Installation](guide/installation.md)
```
