# Fumadocs: Frontmatter

Distilled from fuma-nama/fumadocs (v14.x). Used in `.mdx` files in `content/docs/`.

## Standard frontmatter

```yaml
---
title: Page Title             # (required) displayed as page heading and in nav
description: Short description # shown below title, used in <meta>
icon: FileText                # Lucide icon name — shown in sidebar next to the title
full: false                   # if true: full-width page (no TOC aside)
---
```

## Sidebar position and visibility

Sidebar order and structure is controlled by `meta.json` files in each directory, NOT by per-file frontmatter.

`meta.json` in the same directory:
```json
{
  "title": "Guide",
  "pages": ["intro", "setup", "config"],
  "defaultOpen": true
}
```

## TOC configuration

```yaml
---
toc: true    # default; set false to hide TOC on this page
---
```

## Full page width

```yaml
---
full: true   # removes the TOC aside, content spans full width
---
```

## Custom frontmatter fields

Define additional typed fields in `source.config.ts`:

```ts
import { defineDocs, defineConfig, frontmatterSchema } from 'fumadocs-mdx/config'
import { z } from 'zod'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema.extend({
      preview: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  },
})
```

Then access in `page.data.preview`, `page.data.tags`.

## Notes

- Fumadocs frontmatter is minimal. Most structure (nav, order) comes from `meta.json`.
- `icon` accepts any Lucide icon name (see https://lucide.dev/) as a string.
- `title` is the only required field; pages without it won't render a heading.
- All frontmatter fields are TypeScript-typed via the Zod schema in `source.config.ts`.
