# Nextra

Next.js-based documentation framework (v3.x). MDX content with a file-system router;
sidebar order controlled by `_meta.ts` files per directory.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — `npx create-nextra-app`, project structure, dev commands. → `references/setup.md`
2. **Configure** — `next.config.mjs` (nextra wrapper) + `theme.config.tsx` (docs theme: logo, nav,
   footer, TOC settings). → `references/configuration.md`
3. **Author pages** — MDX frontmatter (`title`, `description`, `sidebarTitle`); `_meta.ts` for
   ordering/grouping. → `references/frontmatter.md`
4. **Rich content** — Nextra built-in components (Callout, Steps, Tabs, Code, FileTree),
   custom MDX components, syntax highlighting (Shiki), math (KaTeX). → `references/content-authoring.md`
5. **Components** — Callout, Steps, Tabs/Tab, FileTree, Cards/Card, Table, Code.
   → `references/components.md`

For a single narrow question (e.g. "how do I set sidebar order?") read just the one relevant
reference.

## Quick facts

- Scaffold: `npx create-nextra-app`  (or `pnpm create nextra-app`)
- Config files: `next.config.mjs` + `theme.config.tsx` at project root
- Content: MDX files under `content/` (v3) or `pages/` (v2)
- Dev: `npm run dev` | Build: `npm run build`
- Sidebar order: `_meta.ts` per directory — exports a default object mapping filename (no ext) to display title;
  `"*": { type: "page" }` to show all pages; `{ type: "separator", title: "..." }` for dividers
- Built-in components: `<Callout type="info|warning|error">`, `<Steps>`, `<Tabs>`, `<FileTree>`
- Validate: `npm run build` catches MDX errors and broken imports

## Authoring guidance

- Use `.mdx` for all Nextra content; the framework expects MDX throughout.
- `_meta.ts` files drive the sidebar. A missing `_meta.ts` in a directory means entries appear
  in filesystem order with raw filenames as labels.
- `theme.config.tsx` is where navigation links, the logo component, and the footer live;
  it's a React component file, not plain JSON.
- Callout replaces admonitions: `<Callout type="info">` maps to note/tip; `type="warning"` and
  `type="error"` for caution/danger. Wrap multi-line content in `<Callout>` blocks.
- After config changes, `npm run build` is the check that matters.
