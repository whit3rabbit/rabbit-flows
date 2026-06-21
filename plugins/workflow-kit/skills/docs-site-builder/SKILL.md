---
name: docs-site-builder
description: >-
  Build and author documentation sites with Astro Starlight (fully supported) and other
  documentation frameworks. Use whenever the user wants to create, scaffold, configure, or
  write content for a docs site with Starlight, mentions astro.config Starlight integration,
  the starlight() integration, Starlight sidebar/frontmatter/components (Aside, Card, CardGrid,
  Tabs, Steps, FileTree), a `src/content/docs/` content collection, or asks to "set up a docs
  site", "make a documentation website", or "add a docs section" using Astro. Reach for this
  even when the user just says "docs site" without naming the framework, since Starlight is the
  default here. Also covers (as skeletons, not yet filled in) MkDocs, Docusaurus, Fumadocs,
  VitePress, Docsify, and mdBook.
---

# Docs Site Builder

Authoring reference for documentation sites. **Astro Starlight is the implemented framework.**
Other frameworks have skeleton folders under `frameworks/` and are not filled in yet.

The point of this skill: get the framework's real config/frontmatter/component contract in front
of you so you author against the actual API instead of guessing. The reference files are distilled
from the official source (Starlight v0.40.0), so prefer them over memory for exact option names
and prop types.

## Pick the framework

| User wants | Go to |
|---|---|
| Astro Starlight, or just "a docs site" with no framework named | this file + `references/` (below) |
| MkDocs / Docusaurus / Fumadocs / VitePress / Docsify / mdBook | `frameworks/<name>/README.md` |

For **platform identity** — which config/nav file defines each framework, and how to recognise a
site built on it — see the shared `docs-scraper/references/platform-signatures.md` (one table, both
skills; present when the `workflow-kit` plugin is installed whole). Each `frameworks/<name>/README.md`
also carries the per-framework config/nav facts you need to author standalone.

If the user names a framework whose `frameworks/<name>/` folder is still a skeleton: say so plainly,
then either (a) build it with Starlight instead if they're flexible, or (b) work from current official
docs (use the `find-docs` / context7 path) since this skill has no distilled reference for it yet.
Do not pretend a skeleton folder contains guidance it doesn't.

## Starlight workflow

Work in this order; each step has a reference file to read **when you reach that step** (don't
preload them all):

1. **Scaffold or add** — new project vs. adding Starlight to an existing Astro app, and the
   resulting file tree. → `references/setup.md`
2. **Configure** — the `starlight()` integration in `astro.config.mjs`: title, social, sidebar,
   locales, components overrides, plugins. Sidebar is the fiddly part. → `references/configuration.md`
3. **Frame the IA** — read this BEFORE planning the page list or authoring page shapes: which Diátaxis
   quadrant each page is (tutorial/how-to/reference/explanation), the reader journey, and the section
   template each page kind must follow. Documentation is an IA problem before a syntax problem.
   → `references/information-architecture.md`
4. **Author pages** — per-page frontmatter (title, description, template, hero, sidebar order/badge).
   → `references/frontmatter.md`
5. **Rich content** — Markdown/MDX features Starlight adds: asides, Expressive Code blocks, plus
   brief i18n and theming. → `references/content-authoring.md`
6. **Components** — built-in `.mdx` components and their exact props. → `references/components.md`

For a single narrow question (e.g. "what are the Aside variants?") skip the workflow and read just
the one relevant reference.

## Quick facts (so you don't have to open a reference for these)

- New project: `npm create astro@latest -- --template starlight`
- Add to existing Astro project: `npx astro add starlight`
- Content lives in `src/content/docs/**` (`.md` or `.mdx`). Routes map to file paths.
- Collection schema in `src/content.config.ts` uses `docsLoader()` + `docsSchema()`. Extend frontmatter
  via `docsSchema({ extend: z.object({ ... }) })`.
- Components import (MDX only):
  `import { Aside, Badge, Card, CardGrid, FileTree, Icon, LinkButton, LinkCard, Steps, Tabs, TabItem } from '@astrojs/starlight/components';`
- Asides in plain Markdown: `:::note`, `:::tip`, `:::caution`, `:::danger` (custom title: `:::tip[My title]`).
- Code blocks use Expressive Code: title via ```` ```js title="file.js" ````, line highlight `{1,3-5}`.
- Sidebar: `autogenerate: { directory: 'guides' }` for a folder, or explicit `{ label, items: [...] }` groups.
- Splash/landing page: frontmatter `template: splash` + a `hero:` block.

## Authoring guidance

- **Match the existing site.** If editing an established docs site, read a couple of existing pages
  first and copy their frontmatter conventions, sidebar grouping, and component usage. Consistency
  beats introducing a "better" pattern mid-site.
- **`.md` vs `.mdx`.** Components and JSX need `.mdx`. Plain prose can stay `.md` (lighter). Don't
  convert a file to `.mdx` unless it actually uses components.
- **Verify props against the reference**, not memory. Prop names and enums (e.g. `Aside` types,
  `Badge` variants) are exact in `references/components.md` because they came from the component source.
- **Don't hand-build navigation** that `autogenerate` can produce. Reach for an explicit sidebar only
  when you need custom ordering/labels/badges.
- After config changes, the check that matters is `npm run build` (or `astro build`) — it catches
  bad integration options and broken content schema. Run it if the environment allows.

## Adding a new framework (filling a skeleton)

Each `frameworks/<name>/` mirrors the Starlight shape: a `README.md` with the same workflow
(scaffold → configure → author → content → components) pointing at that framework's distilled
references. To fill one in, clone the framework's docs repo, distill its setup/config/content-model
into compact reference files under `frameworks/<name>/references/`, and rewrite its README to point
at them. Keep references compact and authoring-focused, same as the Starlight set.
