# Docusaurus: Frontmatter

Distilled from facebook/docusaurus (v3.x).

## Doc pages (`docs/`)

```yaml
---
id: my-doc-id                   # overrides the file-path slug (optional)
title: My Doc Title             # (required) page title and sidebar label
description: A short summary.   # used in <meta name="description"> and cards
sidebar_label: Short label      # label shown in sidebar (overrides title)
sidebar_position: 2             # numeric order within its category
slug: /custom-url               # overrides the default URL path
tags:
  - docs
  - feature
keywords:
  - docs
  - docusaurus
image: /img/og.png              # og:image for social sharing
hide_title: false               # suppress the H1 title at top of page
hide_table_of_contents: false   # suppress right-side TOC
toc_min_heading_level: 2
toc_max_heading_level: 3
pagination_prev: null           # disable/set the "Previous" pagination link (null or doc id)
pagination_next: null
draft: false                    # exclude from production build
last_update:
  date: 2024-01-01
  author: Someone
custom_edit_url: null           # override the "Edit this page" link (null to disable)
---
```

## Blog posts (`blog/`)

```yaml
---
title: Blog Post Title
description: Blog post description
slug: my-blog-post              # URL (default: derived from filename)
authors:
  - name: Sébastien Lorber
    title: Docusaurus maintainer
    url: https://sebastienlorber.com
    image_url: https://github.com/slorber.png
  - slorber                     # reference to authors.yml entry
tags: [hello, docusaurus]
image: /img/blog-og.png
hide_table_of_contents: false
draft: false
date: 2024-01-01T10:00
---
```

## Standalone pages (`src/pages/`)

Standalone pages (`.md` or `.tsx`) don't use doc frontmatter; they're rendered as React pages.
MDX pages may have:
```yaml
---
title: My Page
description: A standalone page
---
```

## Notes

- `id` defaults to the file path relative to `docs/`, minus the extension.
- `slug` can start with `/` (absolute site path) or be relative.
- Boolean defaults: `hide_title: false`, `hide_table_of_contents: false`, `draft: false`.
