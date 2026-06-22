# Fumadocs: Setup

Distilled from fuma-nama/fumadocs (v14.x). Next.js-based documentation framework.

## New project (recommended)

```sh
npm create fumadocs-app@latest
# interactive wizard: project name, content source (fumadocs-mdx or Content Collections)
cd my-app
npm run dev   # dev server at http://localhost:3000
```

The wizard scaffolds a complete Next.js App Router project.

## Manual installation (into existing Next.js app)

```sh
npm install fumadocs-ui fumadocs-core
npm install fumadocs-mdx   # for MDX content source (most common)
# or: npm install fumadocs-content-collections  # for content-collections source
```

### Required peer dependencies

- Next.js 14+ (App Router)
- React 18+

## Project structure (from scaffold)

```
my-app/
  app/
    (home)/
      page.tsx              # home page
    docs/
      [[...slug]]/
        page.tsx            # catch-all docs route
        layout.tsx          # docs layout (sidebar, breadcrumbs)
    layout.tsx              # root layout (providers)
  content/
    docs/                   # MDX content files
      index.mdx             # home doc
      getting-started.mdx
      meta.json             # folder metadata (nav order, title)
  source.config.ts          # fumadocs-mdx source configuration
  next.config.mjs           # Next.js config with Fumadocs MDX plugin
  package.json
```

## `next.config.mjs`

```js
import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
}

export default withMDX(config)
```

## `source.config.ts`

```ts
import { defineDocs, defineConfig } from 'fumadocs-mdx/config'

export const docs = defineDocs({
  dir: 'content/docs',
})

export default defineConfig({
  mdxOptions: {
    // remark/rehype plugins
  },
})
```

## `app/layout.tsx` (root provider)

```tsx
import { RootProvider } from 'fumadocs-ui/provider'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
```

## Commands

```sh
npm run dev       # development server
npm run build     # production build
npm run start     # serve production build
```

## Notes

- Fumadocs is a React/Next.js framework; it does NOT generate a static site without Next.js.
- Deploy to Vercel, Netlify, or any Node-compatible host.
- Content source options: `fumadocs-mdx` (recommended, uses Next.js MDX pipeline) or `fumadocs-content-collections` (schema-validated).
