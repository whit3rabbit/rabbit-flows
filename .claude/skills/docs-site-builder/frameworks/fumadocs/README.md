# Fumadocs

Next.js App Router documentation framework (v14.x). MDX content, `fumadocs-mdx` source,
`fumadocs-ui` component library. Requires Next.js 14+ (not a static-site generator).

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — `npm create fumadocs-app@latest`, project structure, key generated files
   (`source.config.ts`, `app/docs/[[...slug]]/page.tsx`, `lib/source.ts`). → `references/setup.md`
2. **Configure** — `source.config.ts` (MDX options, plugins), `next.config.mjs` (MDX pipeline),
   `DocsLayout` props, `RootProvider`, search API route, `meta.json` nav ordering.
   → `references/configuration.md`
3. **Author pages** — per-page frontmatter (`title`, `description`, `full`, `toc`). The `meta.json`
   file controls sidebar ordering for a directory. → `references/frontmatter.md`
4. **Rich content** — Callout, Tabs, Steps, Files, Cards, Accordion, code blocks with rehypeCode,
   MDX defaults via `defaultMdxComponents`. → `references/content-authoring.md`
5. **Components** — full `fumadocs-ui/components/*` API: Callout, Tabs/Tab, Steps/Step,
   Cards/Card, Files/Folder/File, Accordions/Accordion, CodeBlock, ImageZoom, DocsPage layout
   components. → `references/components.md`

For a single narrow question (e.g. "how do I persist tab selection?") read just the one
relevant reference.

## Quick facts

- New project: `npm create fumadocs-app@latest` (interactive wizard)
- Content: `.mdx` files under `content/docs/`; `meta.json` in each directory controls order
- Config: `source.config.ts` (source + MDX options), `next.config.mjs` (Next.js plugin)
- Dev: `npm run dev` | Build: `npm run build`
- Nav ordering: `meta.json` with `{ "title": "...", "pages": ["index", "guide", ...] }`
- Components: all from `fumadocs-ui/components/*`; wire defaults via `defaultMdxComponents` in
  `app/docs/[[...slug]]/page.tsx` (`<MDX components={defaultMdxComponents} />`)
- Search: built-in Orama (no config) or Algolia; expose via `app/api/search/route.ts`
- Validate: `npm run build` is the check that matters (catches missing pages, bad imports)

## Authoring guidance

- Fumadocs is Next.js, not a static-site generator. Deploy to Vercel/Netlify or any Node host.
- All content is `.mdx`; standard Markdown prose works inside MDX without imports.
- Import components from `fumadocs-ui/components/<name>`, not from `fumadocs-ui` directly.
  `defaultMdxComponents` pre-wires them all; individual overrides: `{ ...defaultMdxComponents, MyComp }`.
- Sidebar order is driven by `meta.json` in each content directory, not frontmatter position.
- `DocsPage`, `DocsBody`, `DocsTitle`, `DocsDescription` live in `fumadocs-ui/page` (not `fumadocs-ui/components`).
- After config changes, `npm run build` is the check that matters.
