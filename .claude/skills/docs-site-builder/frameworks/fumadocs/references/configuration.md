# Fumadocs: Configuration

Distilled from fuma-nama/fumadocs (v14.x).

Configuration is spread across several files, not a single config file.

## Source: `source.config.ts`

```ts
import { defineDocs, defineConfig } from 'fumadocs-mdx/config'
import { rehypeCode } from 'fumadocs-core/mdx-plugins'
import { remarkInstall } from 'fumadocs-docgen'

export const docs = defineDocs({
  dir: 'content/docs',
})

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkInstall],
    rehypePlugins: (v) => [rehypeCode, ...v],
  },
})
```

## Docs route: `app/docs/[[...slug]]/page.tsx`

```tsx
import { source } from '@/lib/source'
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'
import defaultMdxComponents from 'fumadocs-ui/mdx'

export default async function Page({ params }: { params: { slug?: string[] } }) {
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{ style: 'clerk', single: false }}
      tableOfContentPopover={{ enabled: true }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata({ params }: { params: { slug?: string[] } }) {
  const page = source.getPage(params.slug)
  if (!page) notFound()
  return { title: page.data.title, description: page.data.description }
}
```

## Docs layout: `app/docs/[[...slug]]/layout.tsx`

```tsx
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { source } from '@/lib/source'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ title: 'My Docs' }}
      sidebar={{ collapsible: true }}
    >
      {children}
    </DocsLayout>
  )
}
```

## Source binding: `lib/source.ts`

```ts
import { docs } from '@/.source'
import { loader } from 'fumadocs-core/source'
import { createMDXSource } from 'fumadocs-mdx'

export const source = loader({
  baseUrl: '/docs',
  source: createMDXSource(docs),
})
```

## Navigation: `meta.json`

Each content directory can have a `meta.json` to control sidebar order and labels:

```json
{
  "title": "Getting Started",
  "pages": ["index", "installation", "configuration"],
  "defaultOpen": true
}
```

`pages` is an ordered list of filenames (without extension). Folders are referenced by their dir name.

## `fumadocs-ui` theming

The `RootProvider` accepts a `theme` prop:
```tsx
<RootProvider theme={{ defaultMode: 'dark' }}>
```

Custom CSS variables in `global.css`:
```css
:root {
  --fd-nav-height: 4rem;
  --fd-sidebar-width: 260px;
}
```

## Search

Fumadocs ships with built-in Orama search (no config needed) or Algolia:

```ts
// app/api/search/route.ts
import { source } from '@/lib/source'
import { createSearchAPI } from 'fumadocs-core/search/server'

export const { GET } = createSearchAPI('advanced', {
  indexes: source.getPages().map((page) => ({
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    id: page.url,
    structuredData: page.data.structuredData,
  })),
})
```
