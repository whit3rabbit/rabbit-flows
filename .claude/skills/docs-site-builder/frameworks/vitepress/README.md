# VitePress

Vue + Vite static-site generator for documentation (v1.x). Markdown content with Vue-in-Markdown;
no React/JSX.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — `npm add -D vitepress`, interactive init wizard, project structure.
   → `references/setup.md`
2. **Configure** — `.vitepress/config.mts`: title, nav, sidebar, socialLinks, footer,
   search, editLink. The sidebar (flat vs. per-path object) is the fiddly part.
   → `references/configuration.md`
3. **Author pages** — per-page frontmatter (title, description, layout, hero, features,
   aside, outline, lastUpdated). → `references/frontmatter.md`
4. **Rich content** — custom containers (`::: tip`), code blocks with focus/diff/code-group,
   snippet imports (`<<< @/src/file.ts`), Vue components in Markdown, math, Mermaid, `[[toc]]`.
   → `references/content-authoring.md`
5. **Components** — built-in global components (Badge), custom Vue components, layout slots,
   `useData` composable, `withBase` helper. → `references/components.md`

For a single narrow question (e.g. "how do I do per-path sidebar?") read just the one
relevant reference.

## Quick facts

- Install + scaffold: `npm add -D vitepress && npx vitepress init`
- Config file: `docs/.vitepress/config.mts` (TypeScript recommended)
- Content: Markdown files in `docs/` (or your configured `srcDir`)
- Dev: `npm run docs:dev` | Build: `npm run docs:build` | Preview: `npm run docs:preview`
- Sidebar: flat array (same everywhere) or object keyed by path prefix for per-section sidebars
- Built-in global component: `<Badge type="tip" text="New" />`
- Containers in Markdown: `::: info`, `::: tip Title`, `::: warning`, `::: danger STOP`, `::: details`
- Code blocks: title via ` ```js title="file.js" `, line highlight `{1,3-5}`, diff `// [!code --/++]`,
  focus `// [!code focus]`, group via `::: code-group`
- Validate: `npm run docs:build` catches broken links and config errors

## Authoring guidance

- VitePress runs Markdown through Vue; Vue template syntax (`{{ }}`, `v-if`) works in `.md` files.
  Use `<span v-pre>` to escape Vue syntax in code examples.
- `.md` for plain prose, `.vue` components placed in `.vitepress/theme/` and registered via
  `enhanceApp`. Global registration makes components available in all Markdown without import.
- Sidebar must list explicit items; there is no autogenerate from directory (unlike Starlight).
  Per-path sidebar (`sidebar: { '/guide/': [...] }`) keeps each section's nav focused.
- After config changes, `npm run docs:build` is the check that matters.
