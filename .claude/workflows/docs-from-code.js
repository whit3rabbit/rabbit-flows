// docs-from-code — document a whole CODEBASE into an Astro Starlight site, using an Eatahorse board as a
//   DURABLE, RESUMABLE ledger:
//     enumerate source -> frame-IA + plan (one card per PAGE) -> seed cards -> [author rounds: parallel
//     page authors + one sync + grounding gate, loop-until-dry] -> gather admitted -> assemble config ->
//     write-back.
//
// FUSION, not "eatahorse-research with a docs prompt" (a doc page is NOT a source file):
//   - Board substrate from eatahorse-research.js: durable resumable ledger, single-writer discipline,
//     loop-until-dry with load caps, a grounding gate that re-reads source.
//   - IA framing + Starlight authoring contract + assemble from docs-create.js: group BY READER TASK,
//     tag Diátaxis, emit content + config.
//   - The UNIT is one card per planned doc page (≈ a module), each carrying a file SCOPE (the source it
//     covers). Cards seed from the PAGE PLAN, never one-per-file — per-file done-ness would coarsen the
//     reader-facing page set. Some source files contribute to no page; that is correct.
//
// DECIDED SHAPE (this build):
//   1. Output = content + config, NOT a full buildable project (mirror docs-create). TWO gates:
//      a. GROUNDING gate (in the author loop): re-reads page's scope SOURCE and reopens any page whose
//         claims the code doesn't back — catches hallucinated APIs, the code->docs failure mode.
//      b. QUALITY gate (before config assembly): checks Diataxis adherence, link/asset resolution, and
//         crosswalk no-leak (Starlight syntax in non-Starlight output) per docs-create.js pattern.
//         Emits per-page {path, pass, issues[]}; drops failures before config assembly.
//      `astro check` runs only if outDir is already buildable, else "skipped: not a buildable project".
//   2. Default page set = reference + module overviews (groundable from source). Tutorials/getting-started
//      need intent the source rarely states, so Plan DEFERS them (needsHumanBrief) instead of authoring
//      confidently-wrong pages the gate would keep reopening. args.includeTutorials=true opts in.
//
// NOTED DEVIATIONS (CLAUDE.md "Bending") — same as eatahorse-research.js:
//   1. Shared MUTABLE store (the board), made race-free by WRITE DISCIPLINE: within a round every page
//      author writes ONLY its own page file (under outDir) + its own card markdown (under the board) — both
//      distinct paths — and runs NO eatahorse CLI. The ONLY writer of state.json/board.md is the single
//      sync agent that runs alone after the round. EATAHORSE_NO_AUTOSYNC=1 silences the Stop/SessionEnd sync.
//   2. Board DOUBLES as durable resume state; we still run the CLAUDE.md write-back for the cross-cutting
//      summary + deferred/skipped constraints.
//   3. Script has NO filesystem access (VM sandbox): enumeration, all board I/O, page writes, and config
//      assembly happen INSIDE agents. The loop terminates on the sync agent's returned active count.
//
// PERMISSIONS: READS source files; WRITES under outDir (the site), the board dir, and CLAUDE.md. Does not
//   modify the documented source. Runs under the session allowlist.
//
// Knobs (args): root (or bare string), outDir (required), framework (default starlight), board, brief,
//   workerModel (default sonnet), maxRounds (default 3), includeTutorials (default false), filesPerPage,
//   pages (skip Plan), include/exclude globs, scriptPath (eatahorse.py),
//   scaffoldMode ('content-only' default | 'add-to-existing' | 'full-project'),
//   basePath (string, optional) — subpath the site is served from, e.g. '/docs'; injected into framework
//     config where supported (Astro base, Docusaurus baseUrl, etc.); skipped with a log note elsewhere,
//   i18n ({defaultLocale, locales[]}, optional) — multi-locale config; mapped to each framework's i18n block,
//   versioning ({current, versions?[]}, optional) — version label; mapped where supported (Docusaurus, Sphinx,
//     MkDocs/mike); noted and skipped for frameworks without built-in versioning,
//   site (string, optional) — full production URL, e.g. 'https://docs.example.com'; set as Astro `site:` in
//     defineConfig (Starlight auto-adds @astrojs/sitemap, which needs it; also fixes canonical URLs),
//   verify (bool, default false) — opt-in end-to-end build gate: ensure package.json, npm install, npm run
//     build; surfaces failure as ok:false. Off by default since it pulls deps and builds generated config.
//
// requires-skills: eatahorse, docs-site-builder, document-codebase, document
//   (Bundling only. The eatahorse CLI surface is distilled INLINE as CMD/cli() and sliced per-agent; the
//    Starlight CONTRACT + IA_CONTRACT are distilled inline from docs-site-builder. Those consts are the
//    runtime source of truth; the bundled skills are the portable copies. Workflow stages do NOT auto-load
//    skills. See .claude/rules/workflow-design.md.)
// Run with /workflows or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` flags the trailing top-level return as "illegal return" — expected; the runtime wraps the
//  script in an async function. Same as eatahorse-research.js / docs-create.js.)
export const meta = {
  name: 'docs-from-code',
  description:
    'Document a whole codebase into a Starlight site using an Eatahorse board as a durable resumable ledger: enumerate source, detect generator lanes, frame IA and plan one card per module page, fan out grounded authors gated and synced until dry, then assemble config and write back.',
  phases: [
    { title: 'Enumerate' },
    { title: 'Detect', detail: 'classify the gitignore-respecting tracked file set against language rules: 12 languages plus OpenAPI and CLI --help cross-cutting lanes' },
    { title: 'Generate', detail: 'fan out one worker per active lane: run generator or extract public API from source, write reference pages, report undocumented public symbols' },
    { title: 'Plan' },
    { title: 'Seed' },
    { title: 'Author' },
    { title: 'Gate' },
    { title: 'Assemble' },
    { title: 'Resolve links/assets', detail: 'one Haiku batch call: copy referenced local assets to assetDir, rewrite src/href to framework-correct routes' },
    { title: 'Quality gate', detail: 'one Opus call: per-page Diataxis adherence, link/asset resolution, crosswalk no-leak; drops failures before config assembly' },
    { title: 'Verify', detail: 'opt-in verify=true: ensure package.json, npm install, npm run build; surfaces failure as ok:false' },
    { title: 'Write-back' },
  ],
}

// --- Starlight authoring contract (distilled from docs-site-builder, v0.40.0) -------------------
// Runtime source of truth for page authors. Refresh from plugins/workflow-kit/skills/docs-site-builder/
// references/*.md if the skill changes. Kept identical to docs-create.js CONTRACT on purpose.
// @generated-start docs-contracts/starlight-contract
const CONTRACT = `STARLIGHT AUTHORING CONTRACT (distilled from docs-site-builder/references; do not re-derive syntax from memory).

---

# Starlight: Setup

Distilled from withastro/starlight docs (cloned github.com/withastro/starlight, English docs). \`@astrojs/starlight\` v0.40.0.

Starlight is an Astro integration (a documentation theme built on Astro). Set up either from the starter template or by adding it to an existing Astro project.

## New project (template)

Run in your terminal, then start the dev server:

\`\`\`sh
# npm
npm create astro@latest -- --template starlight
# pnpm
pnpm create astro --template starlight
# yarn
yarn create astro --template starlight
\`\`\`

\`\`\`sh
npm run dev   # pnpm dev / yarn dev
\`\`\`

Dev server prints a local URL. Add pages by creating Markdown in \`src/content/docs/\`.

Update Starlight (and other Astro packages):

\`\`\`sh
npx @astrojs/upgrade   # pnpm dlx / yarn dlx
\`\`\`

## Add to an existing Astro project (manual)

Requires an existing Astro project. Three steps: add the integration, configure it, set up the content collection.

### 1. Add the integration

\`\`\`sh
npx astro add starlight   # pnpm astro add starlight / yarn astro add starlight
\`\`\`

This installs required deps and adds Starlight to the \`integrations\` array in the Astro config.

### 2. Configure in \`astro.config.mjs\`

\`\`\`js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'My delightful docs site',
    }),
  ],
});
\`\`\`

\`title\` is the minimum. See the configuration reference for all options.

### 3. Configure the content collection

Starlight is built on Astro content collections, configured in \`src/content.config.ts\`
(current docs use \`src/content.config.ts\`, NOT the legacy \`src/content/config.ts\`).
Add a \`docs\` collection using Starlight's \`docsLoader()\` and \`docsSchema()\`:

\`\`\`ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
\`\`\`

\`docsLoader()\` uses the Content Layer API. \`@astrojs/starlight\` v0.40.0 peers \`astro@^6.4.5\`
(NOT astro v5 — installing against astro ^5 fails with an ERESOLVE peer conflict). For an older
project that can't migrate collections yet, the \`legacy.collectionsBackwardsCompat\` flag preserves
v4 behavior.

### Pinned dependencies (a buildable \`package.json\`)

When scaffolding a standalone, buildable site, write a \`package.json\` with these pinned deps and
scripts. \`sharp\` is required by Astro's default image service at build time.

\`\`\`json
{
  "name": "docs",
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.40.0",
    "astro": "^6.4.5",
    "sharp": "^0.33.0"
  }
}
\`\`\`

### 4. Add content

Create \`src/content/docs/\` and an \`index.md\` (the homepage):

\`\`\`md
---
# src/content/docs/index.md
title: My docs
description: Learn more about my project.
---

Welcome to my project!
\`\`\`

File-based routing: every \`.md\`, \`.mdx\`, or \`.mdoc\` file in \`src/content/docs/\` becomes a
page. Frontmatter (\`title\`, \`description\`, etc.) controls how each page renders.

## Project structure

Key files and directories:

- \`astro.config.mjs\` — Astro config; holds the Starlight integration and its options.
- \`src/content.config.ts\` — content collections config; adds Starlight's frontmatter schemas.
- \`src/content/docs/\` — content. Each \`.md\` / \`.mdx\` / \`.mdoc\` here becomes a page.
- \`src/content/i18n/\` (optional) — translation data for internationalization.
- \`src/\` — other source (components, styles, images).
- \`public/\` — static assets served as-is (favicon, fonts, PDFs), not processed by Astro.

Example tree:

\`\`\`
public/
  favicon.svg
src/
  assets/
    logo.svg
  components/
    CustomButton.astro
  content/
    docs/
      guides/
        01-getting-started.md
        02-advanced.md
      index.mdx
  content.config.ts
astro.config.mjs
package.json
tsconfig.json
\`\`\`

## Notes

- Mount docs at a subpath by nesting content under a subdirectory of \`src/content/docs/\`
  (e.g. \`src/content/docs/guides/\` serves pages under \`/guides/\`).
- Starlight pages are pre-rendered by default regardless of output mode. For SSR, add an
  Astro server adapter; opt a page out of pre-rendering with the \`prerender: false\` config option.

---

# Starlight: Configuration (astro.config)

Distilled from withastro/starlight docs.

Configure the \`starlight()\` integration in \`astro.config.mjs\`. Only \`title\` is required.

\`\`\`js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [starlight({ title: 'My docs site' })],
});
\`\`\`

## Common options

### \`title\` (required)
\`string | Record<string, string>\` — site title (browser tab + metadata). Object form for multilingual sites, keyed by BCP-47 tag.
\`\`\`ts
title: { en: 'My docs site', de: 'Meine Doku' }
\`\`\`

### \`description\`
\`string\` — default \`<meta name="description">\` when a page has none in frontmatter.

### \`logo\`
\`{ alt?, replacesTitle? } & ({ src } | { light; dark })\` — image in the nav bar. Use \`src\` for one image, or \`light\`/\`dark\` for theme-specific.
\`\`\`js
logo: { src: './src/assets/my-logo.svg' }
\`\`\`

### \`social\`
\`Array<{ label: string; icon: StarlightIcon; href: string }>\` — icon links in the header.
\`\`\`js
social: [
  { icon: 'github', label: 'GitHub', href: 'https://github.com/withastro' },
  { icon: 'discord', label: 'Discord', href: 'https://astro.build/chat' },
]
\`\`\`

### \`sidebar\`
\`SidebarItem[]\` — navigation items. See the Sidebar section below.

### \`locales\` / \`defaultLocale\`
\`locales: { [dir: string]: { label: string; lang?: string; dir?: 'ltr'|'rtl' } }\` — keyed by the content subdirectory. \`defaultLocale\` names the fallback (match a \`locales\` key). Use a \`root\` locale to serve the default language without a \`/lang/\` prefix.
\`\`\`js
defaultLocale: 'en',
locales: {
  en: { label: 'English' },
  'zh-cn': { label: '简体中文', lang: 'zh-CN' },
  ar: { label: 'العربية', dir: 'rtl' },
}
\`\`\`

### \`customCss\`
\`string[]\` — CSS files (local paths or npm modules) to customize styling.
\`\`\`js
customCss: ['./src/custom.css', '@fontsource/roboto']
\`\`\`

### \`head\`
\`Array<{ tag: string; attrs?: Record<string,string|boolean|undefined>; content?: string }>\` — extra \`<head>\` tags (analytics, scripts). Converted to raw HTML; no Astro script/style processing.
\`\`\`js
head: [{ tag: 'script', attrs: { src: 'https://cdn.usefathom.com/script.js', 'data-site': 'ID', defer: true } }]
\`\`\`

### \`editLink\`
\`{ baseUrl: string }\` — enables "Edit this page". Final link = \`baseUrl\` + page path.
\`\`\`js
editLink: { baseUrl: 'https://github.com/withastro/starlight/edit/main/' }
\`\`\`

### \`lastUpdated\`
\`boolean\` (default \`false\`) — show last-updated date in footer. Uses Git history; may be inaccurate on shallow-clone deploys. Overridable per page via frontmatter.

### \`pagination\`
\`boolean\` (default \`true\`) — previous/next page links in the footer. Overridable via \`prev\`/\`next\` frontmatter.

### \`tableOfContents\`
\`false | { minHeadingLevel?: number; maxHeadingLevel?: number }\` (default \`{ min: 2, max: 3 }\`) — right-side TOC. Set \`false\` to disable.

### \`expressiveCode\`
\`StarlightExpressiveCodeOptions | boolean\` (default \`true\`) — code-block rendering (highlighting, filenames). Accepts all Expressive Code options plus Starlight-specific \`themes\`, \`useStarlightDarkModeSwitch\`, \`useStarlightUiThemeColors\`. Set \`false\` to disable.
\`\`\`js
expressiveCode: { styleOverrides: { borderRadius: '0.5rem' } }
\`\`\`

### \`components\`
\`Record<string, string>\` — override Starlight's built-in components with your own paths. See the Overrides Reference for overridable names.
\`\`\`js
components: { SocialLinks: './src/components/MySocialLinks.astro' }
\`\`\`

### \`plugins\`
\`StarlightPlugin[]\` — extend Starlight with plugins.
\`\`\`js
plugins: [starlightThemePlugin()]
\`\`\`

### \`favicon\`
\`string\` (default \`'/favicon.svg'\`) — path in \`public/\` to an \`.ico\`/\`.gif\`/\`.jpg\`/\`.png\`/\`.svg\` icon. Add fallback variants via \`head\`.
\`\`\`js
favicon: '/images/favicon.svg'
\`\`\`

### \`credits\`
\`boolean\` (default \`false\`) — show a "Built with Starlight" footer link.

## The long tail (no example)

- \`markdown\` — \`{ headingLinks?: boolean; processedDirs?: string[] }\`. Toggle clickable heading anchors; add dirs to the Markdown pipeline.
- \`pagefind\` — \`boolean | PagefindOptions\` (default \`true\`). Built-in search; set \`false\` to disable. Cannot be used with \`prerender: false\`.
- \`prerender\` — \`boolean\` (default \`true\`). Set \`false\` to render pages on demand via an SSR adapter.
- \`titleDelimiter\` — \`string\` (default \`'|'\`). Separator in \`<title>\` between page and site title.
- \`disable404Route\` — \`boolean\` (default \`false\`). Set \`true\` to use a custom \`src/pages/404.astro\`.
- \`routeMiddleware\` — \`string | string[]\`. Paths to route middleware that modify Starlight's route data.

## Sidebar

A sidebar is an array of \`SidebarItem\`. Item shapes:

- **Internal link** — \`{ slug: string; label?; badge?; attrs?; translations? }\`. Page title is the default label. Shorthand: a bare string \`'guides/intro'\`.
- **External / non-docs link** — \`{ link: string; label: string; badge?; attrs?; translations? }\`. \`link\` may be a site path (\`'/shop/'\`) or a URL.
- **Group** — \`{ label: string; items: SidebarItem[]; collapsed?: boolean; badge?; translations? }\`. Groups nest; \`items\` may hold links, sub-groups, and autogenerate entries.
- **Autogenerate** — \`{ autogenerate: { directory: string; collapsed?: boolean; attrs? } }\`. Generates links/sub-groups from a docs directory, sorted alphabetically by file id. Customize per page via \`sidebar\` frontmatter (\`label\`, \`order\`, \`badge\`, \`hidden\`, \`attrs\`).

\`\`\`ts
type SidebarItem =
  | string
  | ({ translations?: Record<string, string>; badge?: string | BadgeConfig } & (
      | { link: string; label: string; attrs?: Record<string, string|number|boolean|undefined> }
      | { slug: string; label?: string; attrs?: Record<string, string|number|boolean|undefined> }
      | { label: string; items: SidebarItem[]; collapsed?: boolean }
    ))
  | { autogenerate: { directory: string; collapsed?: boolean; attrs?: Record<string, string|number|boolean|undefined> } };

interface BadgeConfig { text: string; variant?: 'note'|'tip'|'caution'|'danger'|'success'|'default'; class?: string }
\`\`\`

**Badges:** \`badge\` on a link or group. String shorthand uses the accent color; object form sets \`variant\` (built-in style) and optional \`class\` (custom CSS).

**Collapsing:** groups expand by default. \`collapsed: true\` on a group, or \`autogenerate.collapsed: true\` for autogenerated sub-groups.

**Translations:** \`translations: { 'pt-BR': 'Label' }\` on any item; \`label\` is the default locale. \`slug\` links auto-use translated page titles. Multilingual \`badge.text\` may be an object keyed by BCP-47 tag.

### Realistic full example

\`\`\`js
starlight({
  sidebar: [
    // Single link.
    { label: 'Home', link: '/' },
    // Group with internal links (slug + shorthand) and a translation.
    {
      label: 'Start Here',
      translations: { 'pt-BR': 'Comece Aqui' },
      items: [
        { slug: 'intro' },
        'installation',
        // Internal link with a badge.
        { slug: 'tutorial', badge: { text: 'New', variant: 'tip' } },
      ],
    },
    // Nested group, collapsed by default.
    {
      label: 'Constellations',
      collapsed: true,
      items: [
        'constellations/carina',
        {
          label: 'Seasonal',
          items: ['constellations/andromeda', 'constellations/orion'],
        },
      ],
    },
    // Autogenerated group with a badge and collapsed subgroups.
    {
      label: 'Reference',
      badge: 'Outdated',
      items: [{ autogenerate: { directory: 'reference', collapsed: true } }],
    },
    // External link opening in a new tab.
    {
      label: 'Resources',
      items: [
        { label: 'NASA', link: 'https://www.nasa.gov/', attrs: { target: '_blank' } },
      ],
    },
  ],
});
\`\`\`

---

# Starlight: Page Frontmatter

Distilled from withastro/starlight docs (\`reference/frontmatter.md\`).

Set YAML frontmatter at the top of any Markdown/MDX page in \`src/content/docs/\` to control its rendering and metadata.

## Fields

| Field | Type | Meaning |
|---|---|---|
| \`title\` | \`string\` **(required)** | Page title; shown at top of page, in browser tabs, and in metadata. |
| \`description\` | \`string\` | Used for page metadata, search engines, and social previews. |
| \`slug\` | \`string\` | Override the page's URL slug. |
| \`editUrl\` | \`string \| boolean\` | Override global \`editLink\`. \`false\` hides the "Edit page" link; a URL points elsewhere. |
| \`head\` | \`HeadConfig[]\` | Add tags to this page's \`<head>\` (custom styles, meta, etc.). |
| \`tableOfContents\` | \`false \| { minHeadingLevel?: number; maxHeadingLevel?: number }\` | Override global TOC config; \`false\` hides the TOC on this page. |
| \`template\` | \`'doc' \| 'splash'\` (default \`'doc'\`) | Layout. \`'splash'\` is a wide, sidebar-less layout for landing pages. |
| \`hero\` | \`HeroConfig\` | Hero block at the top of the page; pairs with \`template: splash\`. |
| \`banner\` | \`{ content: string }\` | Announcement banner at top of page; \`content\` may include HTML. |
| \`lastUpdated\` | \`Date \| boolean\` | Override global \`lastUpdated\`. A date must be a valid YAML timestamp and overrides Git history. |
| \`prev\` | \`boolean \| string \| { link?: string; label?: string }\` | Override prev-page pagination. \`false\` hides; string sets label; object sets both. |
| \`next\` | \`boolean \| string \| { link?: string; label?: string }\` | Same as \`prev\`, for the next-page link. |
| \`pagefind\` | \`boolean\` (default \`true\`) | Include this page in the Pagefind search index. \`false\` excludes it. |
| \`draft\` | \`boolean\` (default \`false\`) | \`true\` marks a draft: dev-only, excluded from production builds. |
| \`sidebar\` | \`SidebarConfig\` | Control display in an autogenerated sidebar link group (see below). |

## \`HeroConfig\`

\`\`\`ts
interface HeroConfig {
  title?: string;
  tagline?: string;
  image?:
    | { file: string; alt?: string }                 // single image (relative repo path)
    | { dark: string; light: string; alt?: string }  // separate light/dark images
    | { html: string };                              // raw HTML (custom <img> or inline <svg>)
  actions?: Array<{
    text: string;
    link: string;
    variant?: 'primary' | 'secondary' | 'minimal';
    icon?: string;                                    // built-in icon name
    attrs?: Record<string, string | number | boolean>;
  }>;
}
\`\`\`

## \`SidebarConfig\`

\`\`\`ts
interface SidebarConfig {
  label?: string;   // sidebar label; defaults to page title
  order?: number;   // sort order in autogenerated group; lower = higher up
  hidden?: boolean; // default false; true omits page from autogenerated group
  badge?: string | BadgeConfig;  // string = accent badge; object = { text, variant, class }
  attrs?: Record<string, string | number | boolean | undefined>; // HTML attrs on the sidebar link
}
\`\`\`

Notes:
- Draft pages cannot be referenced by slug in manual sidebar config; in autogenerated directories they are auto-excluded from production.
- \`badge\` variants and \`attrs\` (e.g. \`target: _blank\`) only apply within autogenerated link groups.

## Example: normal doc page

\`\`\`md
---
title: About this project
description: Learn more about the project I'm working on.
sidebar:
  label: About
  order: 2
  badge:
    text: Experimental
    variant: caution
---

Welcome to the about page!
\`\`\`

## Example: splash / landing page

\`\`\`md
---
title: My Home Page
template: splash
hero:
  title: 'My Project: Stellar Stuff Sooner'
  tagline: Take your stuff to the moon and back in the blink of an eye.
  image:
    alt: A glittering, brightly colored logo
    file: ~/assets/logo.png
  actions:
    - text: Tell me more
      link: /getting-started/
      icon: right-arrow
    - text: View on GitHub
      link: https://github.com/astronaut/my-project
      icon: external
      variant: minimal
      attrs:
        rel: me
---
\`\`\`

## Extending the schema

Add or tighten fields via \`docsSchema({ extend })\` in \`src/content.config.ts\`. Pass a Zod schema, or a function \`({ image }) => z.object({ cover: image() })\` to use Astro's image helper for local-image fields.

---

# Starlight: Content Authoring

Distilled from withastro/starlight docs (guides: authoring-content, i18n, css-and-tailwind).

Write content as \`.md\`/\`.mdx\` (or Markdoc) under \`src/content/docs/\`. Standard Markdown works; the features below are Starlight/Astro additions. MDX and Markdoc differ in syntax, so confirm per format.

## Frontmatter

Set per-page metadata between \`---\` fences at the top of the file. Every page MUST include \`title\`.

\`\`\`md
---
title: My page title
description: How to use Markdown in Starlight
---

Page content follows the second \`---\`.
\`\`\`

## Headings

- The page \`title\` becomes the top-level \`<h1>\` automatically; start body content with paragraph text, then use \`##\` (\`<h2>\`) and below. Do not add your own \`<h1>\`.
- \`<h2>\` and \`<h3>\` auto-populate the table of contents (with an "Overview" entry at top).
- Headings get automatic anchor \`id\`s, so you can link within a page: \`[my conclusion](#conclusion)\` or externally \`https://site.com/page/#introduction\`.

## Links and images

\`\`\`md
You can [link to another page](/getting-started/).

![alt text for screen readers](https://example.com/image.png)
![A rocketship in space](../../assets/images/rocket.svg)   <!-- relative, local -->
\`\`\`

Images use Astro's optimized asset support; relative paths to local files are supported and optimized.

## Inline styles

\`**bold**\`, \`_italic_\`, \`~~strikethrough~~\`, and \`\` \`inline code\` \`\` with backticks.

## Asides (callouts / admonitions)

Wrap content in triple colons \`:::\`. Types: \`note\`, \`tip\`, \`caution\`, \`danger\`. Nest any Markdown inside; keep them short.

\`\`\`md
:::note
Body text. Can contain code fences, lists, links.
:::

:::tip[Did you know?]            <!-- custom title in [ ] -->
Body text.
:::

:::tip{icon="heart"}             <!-- custom icon in { }; name from Starlight built-in icons -->
Body text.
:::

:::tip[Did you know?]{icon="heart"}   <!-- title + icon combined -->
Body text.
:::

:::caution
Drawing attention to a gotcha.
:::

:::danger
- Bullet lists work inside
- [Links too](/guides/i18n/)
:::
\`\`\`

## Code blocks (Expressive Code)

Fence with triple backticks plus a language identifier. Text-markers and window-frame plugins are enabled by default. Options go on the opening fence line (Markdown/MDX syntax shown; Markdoc uses \`{% meta="..." %}\`).

\`\`\`\`md
\`\`\`js
// Plain syntax-highlighted block
const x = 1;
\`\`\`
\`\`\`\`

### Titles and frames

- Terminal-style frame is used automatically for shell languages (\`bash\`, \`sh\`).
- Other languages get a code-editor frame when a title is present.
- Set a title via \`title="..."\` on the fence, OR via a file-name comment on the first line.

\`\`\`\`md
\`\`\`js
// my-test-file.js               <!-- file-name comment becomes the tab title -->
console.log('Hello World!');
\`\`\`

\`\`\`bash title="Installing dependencies…"
npm install
\`\`\`

\`\`\`bash frame="none"             <!-- disable the window frame -->
echo "not rendered as a terminal"
\`\`\`
\`\`\`\`

### Text markers (highlighting)

Curly braces mark whole lines/ranges; quotes (or \`/regex/\`) mark text within lines. Use \`ins=\`/\`del=\` for green inserted / red deleted styling.

\`\`\`\`md
\`\`\`js {2-3}                       <!-- highlight lines 2 and 3 -->
function demo() {
	// highlighted
	return 'also highlighted';
}
\`\`\`

\`\`\`js "Individual terms" /Even.*supported/   <!-- mark a string and a regex -->
return 'Even regular expressions are supported';
\`\`\`

\`\`\`js "return true;" ins="inserted" del="deleted"  <!-- default + ins + del markers -->
return true;
\`\`\`
\`\`\`\`

### Diff syntax

Use a \`diff\` fence with \`lang="..."\` to keep source syntax highlighting alongside \`+\`/\`-\` diff markers.

\`\`\`\`md
\`\`\`diff lang="js"
  function thisIsJavaScript() {
-   console.log('Old code to be removed')
+   console.log('New and shiny code!')
  }
\`\`\`
\`\`\`\`

Configure all code-block behavior via Starlight's \`expressiveCode\` config option. Many markers combine.

## Other elements

- Blockquotes: \`>\` at line start.
- Details/accordions: standard HTML \`<details>\` + \`<summary>\` (nest Markdown inside, leave a blank line after \`<summary>\`).
- Footnotes: \`text[^1]\` with \`[^1]: My reference.\` defined elsewhere.
- Lists, tables, and all other standard Markdown are supported.
- Markdoc is supported via \`@astrojs/markdoc\` + the \`@astrojs/starlight-markdoc\` preset (\`starlightMarkdoc()\`); \`headingLinks\` (default \`true\`) toggles clickable heading anchors.

## i18n (essentials)

Configure \`locales\` + \`defaultLocale\` in the \`starlight()\` integration. \`defaultLocale\` provides fallback content and UI labels.

\`\`\`js
starlight({
	defaultLocale: 'en',
	locales: {
		en: { label: 'English' },
		'zh-cn': { label: '简体中文', lang: 'zh-CN' },
		ar: { label: 'العربية', dir: 'rtl' },   // dir: 'rtl' for RTL languages
	},
})
\`\`\`

- Content layout: one folder per locale under \`src/content/docs/\` (e.g. \`en/\`, \`zh-cn/\`, \`ar/\`). Reuse the same file name across languages to link translations and get fallback content (untranslated pages show the \`defaultLocale\` version with a notice).
- Root locale: serve one language with no path prefix via the \`root\` key (\`root: { label, lang }\`; \`lang\` required). Keep its pages directly in \`src/content/docs/\`. For a monolingual non-English site, set only \`root\`.
- UI string translations live in the \`i18n\` data collection: configure \`i18nLoader()\`/\`i18nSchema()\` in \`src/content.config.ts\`, then add \`src/content/i18n/<locale>.json\` files. Translate values only, keep English keys (e.g. \`"search.label": "Buscar"\`). Same JSON file holds \`expressiveCode.*\` and \`pagefind.*\` keys.

## Styling (essentials)

Two routes: custom CSS files, or the Starlight Tailwind plugin.

- Custom CSS: add a file under \`src/\`, override \`--sl-*\` custom properties on \`:root\`, then list its relative path in the \`customCss\` array of \`starlight()\`.

\`\`\`css
/* src/styles/custom.css */
:root {
	--sl-content-width: 50rem;
	--sl-text-5xl: 3.5rem;
}
\`\`\`

\`\`\`js
starlight({ customCss: ['./src/styles/custom.css'] })
\`\`\`

- All theme/color variables are \`--sl-*\` custom properties (full list in Starlight's \`style/props.css\` on GitHub). Theme = gray shades for text/backgrounds plus one accent color for links/active items; override these to retheme.
- Cascade layers: Starlight uses \`@layer\`; any unlayered custom CSS overrides defaults. Order layers via \`@layer my-reset, starlight, my-overrides;\`.
- Tailwind (v4, via \`@tailwindcss/vite\`): install \`@astrojs/starlight-tailwind\`, set up \`src/styles/global.css\` importing the compat package + Tailwind theme/utilities, then add that file as the FIRST entry in \`customCss\`. Style Starlight's UI by setting \`--color-accent-*\`, \`--color-gray-*\`, \`--font-sans\`, \`--font-mono\` in an \`@theme\` block.

\`\`\`css
/* src/styles/global.css */
@layer base, starlight, theme, components, utilities;
@import '@astrojs/starlight-tailwind';
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
\`\`\`

---

# Starlight: Built-in Components

Distilled from withastro/starlight docs + component source (\`packages/starlight/user-components/\`).

Built-in components for \`.mdx\` pages (also usable in \`.astro\`). Not available in plain \`.md\`.

---

## Cross-framework authoring: use the CROSSWALK, not Starlight syntax

This file is **Starlight-only**. If you are authoring for Docusaurus, MkDocs, VitePress, or
another framework, do NOT use \`<Aside>\`, \`<Card>\`, \`<FileTree>\`, \`<Steps>\`, \`<Tabs>\`, or any
\`@astrojs/starlight\` import — those are Starlight-specific and will break other frameworks.

The canonical per-framework syntax lives in the \`CROSSWALK\` const in
\`.claude/workflows/docs-create.js\` (and is injected automatically into author prompts at
runtime). The six framework-neutral constructs it covers are:

| Construct   | Intent                          | Starlight syntax (this file)                   |
|-------------|----------------------------------|------------------------------------------------|
| \`callout\`   | Information callout / admonition | \`:::note\` / \`:::tip\` / \`<Aside>\` in .mdx      |
| \`tabs\`      | Tabbed content switcher          | \`<Tabs>\` + \`<TabItem>\` in .mdx                 |
| \`steps\`     | Numbered sequential procedure    | \`<Steps>\` wrapping an ordered list in .mdx     |
| \`card\`      | Highlighted content card block   | \`<Card>\` inside \`<CardGrid>\` in .mdx           |
| \`filetree\`  | Annotated directory/file tree    | \`<FileTree>\` wrapping a nested list in .mdx    |
| \`code-title\`| Code block with filename label   | Fenced block with \`title="filename.js"\`        |

When authoring outside Starlight: look up your framework's column in the CROSSWALK before
writing any of the above constructs. The CROSSWALK is the authoritative source; this table
is the Starlight column only.

---

## Import

Pull several at once from one entry point:

\`\`\`mdx
import { Aside, Badge, Card, CardGrid, FileTree, Icon, LinkButton, LinkCard, Steps, Tabs, TabItem } from '@astrojs/starlight/components';
\`\`\`

Notes that apply throughout:
- \`icon\` / \`name\` props take a Starlight built-in icon name (string). See \`/reference/icons/\`.
- \`title\` / \`description\` on Card and LinkCard render as HTML (\`set:html\`), so inline markup is allowed.

---

## Aside

Callout box. In \`.md\`/\`.mdx\` you can also use the \`:::note\` / \`:::tip\` / \`:::caution\` / \`:::danger\` colon syntax; the component is for \`.mdx\` when you need it inline.

Props:
- \`type?: 'note' | 'tip' | 'caution' | 'danger'\` — default \`'note'\`.
- \`title?: string\` — heading; defaults to a localized label for the type.
- \`icon?: StarlightIcon\` — override the default per-type icon.

\`\`\`mdx
<Aside type="caution" title="Watch out">Back up before running this.</Aside>
\`\`\`

Colon equivalent: \`:::tip[Did you know?]{icon="heart"}\` ... \`:::\`.

---

## Badge

Small inline label. Renders a \`<span>\`; extra HTML attributes (e.g. \`class\`) pass through.

Props:
- \`text: string\` — **required**, the label.
- \`variant?: 'note' | 'tip' | 'danger' | 'caution' | 'success' | 'default'\` — default \`'default'\`.
- \`size?: 'small' | 'medium' | 'large'\` — default \`'small'\`.

\`\`\`mdx
<Badge text="New" variant="success" size="medium" />
\`\`\`

---

## Card

Boxed content block, usually inside CardGrid.

Props:
- \`title: string\` — **required** (renders as HTML).
- \`icon?: StarlightIcon\`.

\`\`\`mdx
<Card title="Fast" icon="rocket">Built on Astro for top performance.</Card>
\`\`\`

---

## CardGrid

Responsive grid wrapper for Card / LinkCard.

Props:
- \`stagger?: boolean\` — default \`false\`; offsets alternate cards vertically.

\`\`\`mdx
<CardGrid stagger>
  <Card title="Check it out" icon="open-book">Interesting content.</Card>
  <Card title="Other feature" icon="information">More info.</Card>
</CardGrid>
\`\`\`

---

## FileTree

Renders a styled file/directory tree from a Markdown bulleted list in its slot. No props. Bold a name to highlight it; add a \`# comment\` after a name; use a trailing \`...\`/\`…\` placeholder entry for "more files".

\`\`\`mdx
<FileTree>
- src
  - components
    - **Header.astro** the site header
  - pages/
- package.json
</FileTree>
\`\`\`

A name ending in \`/\` (or with children) is treated as a directory.

---

## Icon

Renders one of Starlight's built-in icons.

Props:
- \`name: StarlightIcon\` — **required**.
- \`label?: string\` — accessible label; when set, the icon is exposed to assistive tech (otherwise \`aria-hidden\`).
- \`color?: string\` — CSS color.
- \`size?: string\` — CSS size, default \`'1em'\`.
- \`class?: string\`.

\`\`\`mdx
<Icon name="star" color="goldenrod" size="2rem" label="Featured" />
\`\`\`

---

## LinkButton

Visually-prominent call-to-action link. Renders an \`<a>\`; extra anchor attributes pass through.

Props:
- \`href: string | URL\` — **required**.
- \`variant?: 'primary' | 'secondary' | 'minimal'\` — default \`'primary'\`.
- \`icon?: StarlightIcon\`.
- \`iconPlacement?: 'start' | 'end'\` — default \`'end'\`.

\`\`\`mdx
<LinkButton href="/getting-started/" icon="right-arrow">Get started</LinkButton>
<LinkButton href="/reference/" variant="secondary">Reference</LinkButton>
\`\`\`

---

## LinkCard

Prominent linked card for navigation. Renders an \`<a>\`; extra anchor attributes pass through (e.g. \`target\`).

Props:
- \`title: string\` — **required** (renders as HTML).
- \`href: string | URL\` — **required** (the navigation target).
- \`description?: string\` — supporting text (renders as HTML).

\`\`\`mdx
<LinkCard title="Authoring Content" href="/guides/authoring-content/" description="Learn the Markdown syntax Starlight supports." />
\`\`\`

Group multiple LinkCards inside \`<CardGrid>\` to lay them out side by side.

---

## Steps

Numbers an ordered list to display a sequential procedure. Wrap a single \`<ol>\` (Markdown ordered list). No props.

\`\`\`mdx
<Steps>

1. Install the integration:

   \`\`\`sh
   npx astro add markdoc
   \`\`\`

2. Add the preset to your config.

</Steps>
\`\`\`

---

## Tabs + TabItem

Tabbed interface. \`<Tabs>\` wraps one or more \`<TabItem>\`.

\`Tabs\` props:
- \`syncKey?: string\` — tabs sharing the same key sync their selection across the page and persist it in \`localStorage\` (e.g. one \`syncKey="pkg"\` for all package-manager tab sets).

\`TabItem\` props:
- \`label: string\` — **required**, the tab's visible label.
- \`icon?: StarlightIcon\`.

\`\`\`mdx
<Tabs syncKey="pkg">
  <TabItem label="npm" icon="seti:npm">
    \`\`\`sh
    npm install @astrojs/starlight
    \`\`\`
  </TabItem>
  <TabItem label="pnpm">
    \`\`\`sh
    pnpm add @astrojs/starlight
    \`\`\`
  </TabItem>
</Tabs>
\`\`\`

The first \`TabItem\` is selected by default. For sync to work, the labels must match across the synced tab sets.`
// @generated-end docs-contracts/starlight-contract

// --- IA contract (distilled from docs-site-builder/references/information-architecture.md) -------
// Kept identical to docs-create.js IA_CONTRACT. Design before syntax; injected into Plan + every author.
// @generated-start docs-contracts/ia-contract
const IA_CONTRACT = `DOCS INFORMATION-ARCHITECTURE CONTRACT (distilled from docs-site-builder/references; design before syntax).

---

# Information architecture for docs sites

Framework-agnostic. Read this **before** planning or authoring pages: good documentation is an IA
problem before it is a syntax problem. The runtime copy of this guidance lives inline in
\`.claude/workflows/docs-create.js\` (\`IA_CONTRACT\`); if you change this file, refresh that const.

## Diátaxis: the four quadrants

Every page serves exactly one of four reader needs. The cardinal rule: **do not mix modes on one
page.** A tutorial that stops to explain theory, or a reference that turns into a how-to, fails both
readers.

| Quadrant | Reader is... | Serves | Voice |
|---|---|---|---|
| **Tutorial** | learning | a guided first success | "we will", hand-held, no choices |
| **How-to** | working | a specific task done | "to do X, do Y", goal-directed |
| **Reference** | looking something up | exhaustive, accurate facts | dry, consistent, no narrative |
| **Explanation** | understanding | context and the "why" | discursive, names tradeoffs |

Diagnostic: *learning vs working* (tutorial/how-to are practical steps) crossed with *acquiring
skill vs applying it* (tutorial/explanation orbit study; how-to/reference orbit work).

## Page templates per quadrant

Each page kind has a section skeleton authors must follow.

- **Tutorial** — prerequisites → numbered steps (each with a visible, runnable result) → the final
  result the reader now has → next steps. One happy path, no branching, no "you could also".
- **How-to** — the goal stated up front → ordered steps → a verification step (how the reader
  confirms it worked). Assumes competence; omits teaching.
- **Reference** — consistent, exhaustive entries, grouped or alphabetised, scannable. No narrative,
  no opinion. Same shape for every entry (signature, params, returns, example).
- **Explanation** — context (why this exists) → discussion → tradeoffs and alternatives considered.
  No step-by-step; this is the page that answers "why is it built this way".

Two structural page kinds sit outside the quadrants:
- **index/landing** — routes the reader's journey: what this is, who it's for, the entry points to
  each quadrant. Often \`splash\` template with a hero on a Starlight site.

## Navigation

- **Shallow over deep.** ≤2 sidebar levels by default. A reader should never hunt three folders deep.
- **Group by user task, not by internal module.** "Getting started / Guides / Reference", not your
  package layout.
- **A landing page routes the journey.** First-touch reader lands somewhere that points them at the
  right quadrant for their need.
- Order groups along the reader journey: first-touch → proficient.

## Writing

- **Task-oriented headings.** "Deploy to production", not "Deployment".
- **Examples first.** Show a working example before the exhaustive prose; readers scan for code.
- **One concept per page.** If a page covers two things, it's two pages.
- **Scannable.** Short paragraphs, code early, lists over walls of text.
- **Define jargon once,** on first use, then use it consistently.

## The getting-started rule

A new reader reaches a **first success within ~5 minutes.** If the quickstart can't get someone to a
working result that fast, the IA (or the product's onboarding) is the problem, not the prose. This is
the single highest-leverage page; design the journey backwards from it.`
// @generated-end docs-contracts/ia-contract

// @generated-start docs-contracts/docusaurus-contract
const DOCUSAURUS_CONTRACT = `DOCUSAURUS AUTHORING CONTRACT (distilled from docs-site-builder/frameworks/docusaurus/references; do not re-derive syntax from memory).

---

# Docusaurus: Setup

Distilled from facebook/docusaurus (v3.x). React-based static-site generator for documentation.

## New project

\`\`\`sh
npx create-docusaurus@latest my-site classic
# or with TypeScript
npx create-docusaurus@latest my-site classic --typescript

cd my-site
npm start   # dev server at http://localhost:3000
npm run build   # production build into ./build/
\`\`\`

The \`classic\` preset includes \`@docusaurus/preset-classic\` (docs, blog, pages, themes).

## Project structure

\`\`\`
my-site/
  blog/                  # blog posts (optional)
  docs/                  # documentation markdown
    intro.md
    tutorial-basics/
      create-a-page.md
  src/
    components/          # React components
    css/
      custom.css         # global styles
    pages/               # standalone React/MDX pages
  static/                # assets copied to build root
    img/
  docusaurus.config.js   # main config
  sidebars.js            # sidebar structure
  package.json
\`\`\`

## Dev commands

\`\`\`sh
npm start           # start dev server (http://localhost:3000)
npm run build       # build for production (output: ./build/)
npm run serve       # serve built output locally
npm run clear       # clear generated assets and cache
npm run swizzle     # customize theme components
npm run deploy      # deploy to GitHub Pages
\`\`\`

## Notes

- Content lives in \`docs/\` (Markdown or MDX). Route = \`baseUrl/docs/<slug>\`.
- Blog posts live in \`blog/\`. Each file is a post; dated filename recommended (\`2024-01-01-title.md\`).
- Standalone pages: \`src/pages/*.tsx|md|mdx\` — routed without the \`/docs/\` prefix.
- Docusaurus v3 requires Node.js 18+.

---

# Docusaurus: Configuration (docusaurus.config.js)

Distilled from facebook/docusaurus (v3.x).

\`docusaurus.config.js\` (or \`.ts\`) is the primary config file at the project root.

## Minimal config

\`\`\`js
// docusaurus.config.js
const config = {
  title: 'My Site',
  tagline: 'Dinosaurs are cool',
  url: 'https://your-docusaurus-site.example.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'facebook',   // GitHub org/user (for GitHub Pages deploy)
  projectName: 'docusaurus',      // GitHub repo name
  presets: [
    ['classic', {
      docs: { sidebarPath: './sidebars.js' },
      blog: { showReadingTime: true },
      theme: { customCss: './src/css/custom.css' },
    }],
  ],
  themeConfig: {
    navbar: { title: 'My Site', items: [] },
    footer: { style: 'dark', links: [], copyright: \`Copyright \${new Date().getFullYear()}\` },
  },
};
export default config;
\`\`\`

## Top-level fields

| Field | Type | Notes |
|---|---|---|
| \`title\` | string | Site title in browser tab and navbar |
| \`tagline\` | string | Subtitle used in default home page |
| \`url\` | string | Full URL of your site (production) |
| \`baseUrl\` | string | Base path (e.g. \`/my-project/\` for GitHub Pages sub-paths) |
| \`onBrokenLinks\` | \`'throw'|'warn'|'ignore'\` | Action on broken internal links |
| \`onBrokenMarkdownLinks\` | \`'throw'|'warn'|'ignore'\` | Action on broken markdown links |
| \`favicon\` | string | Path under \`static/\` |
| \`i18n\` | object | Internationalization config (see below) |
| \`plugins\` | array | Plugin entries |
| \`presets\` | array | Preset entries (classic preset bundles docs+blog+pages+theme) |
| \`themeConfig\` | object | Theme-specific config (navbar, footer, colorMode, etc.) |
| \`markdown\` | object | Global markdown options (e.g. \`{ mermaid: true }\`) |

## \`themeConfig\`

### \`navbar\`

\`\`\`js
navbar: {
  title: 'My Site',
  logo: { alt: 'My Logo', src: 'img/logo.svg' },
  items: [
    { type: 'docSidebar', sidebarId: 'tutorialSidebar', position: 'left', label: 'Docs' },
    { to: '/blog', label: 'Blog', position: 'left' },
    { href: 'https://github.com/org/repo', label: 'GitHub', position: 'right' },
    { type: 'docsVersionDropdown', position: 'right' },
    { type: 'localeDropdown', position: 'right' },
  ],
  hideOnScroll: false,
}
\`\`\`

Navbar item types: \`default\` (link), \`docSidebar\`, \`doc\`, \`dropdown\`, \`docsVersion\`,
\`docsVersionDropdown\`, \`localeDropdown\`, \`search\`, \`html\`, \`custom\`.

### \`footer\`

\`\`\`js
footer: {
  style: 'dark',   // 'dark' | 'light'
  links: [
    {
      title: 'Docs',
      items: [{ label: 'Getting started', to: '/docs/intro' }],
    },
    {
      title: 'Community',
      items: [{ label: 'Discord', href: 'https://discord.gg/...' }],
    },
  ],
  copyright: \`Copyright © \${new Date().getFullYear()} My Company\`,
}
\`\`\`

### \`colorMode\`

\`\`\`js
colorMode: {
  defaultMode: 'light',        // 'light' | 'dark'
  disableSwitch: false,
  respectPrefersColorScheme: true,
}
\`\`\`

### \`prism\` (code highlighting)

\`\`\`js
prism: {
  theme: require('prism-react-renderer').themes.github,
  darkTheme: require('prism-react-renderer').themes.dracula,
  additionalLanguages: ['bash', 'python'],
}
\`\`\`

### \`docs\` (classic preset \`docs\` plugin options)

\`\`\`js
docs: {
  sidebarPath: './sidebars.js',
  editUrl: 'https://github.com/org/repo/edit/main/',
  showLastUpdateAuthor: true,
  showLastUpdateTime: true,
  breadcrumbs: true,
  versions: {},        // versioning config
  lastVersion: 'current',
}
\`\`\`

## Sidebar (\`sidebars.js\`)

\`\`\`js
// sidebars.js
const sidebars = {
  tutorialSidebar: [
    'intro',                           // doc id (relative path minus .md)
    {
      type: 'category',
      label: 'Tutorial',
      items: ['tutorial-basics/create-a-page', 'tutorial-basics/create-a-document'],
      collapsible: true,
      collapsed: false,
    },
    { type: 'autogenerated', dirName: 'api' },   // auto from docs/api/
    { type: 'link', label: 'GitHub', href: 'https://github.com/org/repo' },
    { type: 'html', value: '<hr/>' },
  ],
};
export default sidebars;
\`\`\`

Sidebar item types: \`doc\`, \`category\`, \`autogenerated\`, \`link\`, \`html\`, \`ref\`.

### Category shorthand

Placing \`_category_.json\` or \`_category_.yml\` in a \`docs/\` subdirectory generates that category automatically:
\`\`\`json
{ "label": "Tutorial", "position": 2, "collapsed": false }
\`\`\`

## i18n

\`\`\`js
i18n: {
  defaultLocale: 'en',
  locales: ['en', 'fr', 'de'],
  localeConfigs: {
    fr: { label: 'Français', direction: 'ltr' },
  },
}
\`\`\`

---

# Docusaurus: Frontmatter

Distilled from facebook/docusaurus (v3.x).

## Doc pages (\`docs/\`)

\`\`\`yaml
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
\`\`\`

## Blog posts (\`blog/\`)

\`\`\`yaml
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
\`\`\`

## Standalone pages (\`src/pages/\`)

Standalone pages (\`.md\` or \`.tsx\`) don't use doc frontmatter; they're rendered as React pages.
MDX pages may have:
\`\`\`yaml
---
title: My Page
description: A standalone page
---
\`\`\`

## Notes

- \`id\` defaults to the file path relative to \`docs/\`, minus the extension.
- \`slug\` can start with \`/\` (absolute site path) or be relative.
- Boolean defaults: \`hide_title: false\`, \`hide_table_of_contents: false\`, \`draft: false\`.

---

# Docusaurus: Content Authoring

Distilled from facebook/docusaurus (v3.x). Uses MDX v3 (supports React components in \`.mdx\`).

## File types

- \`.md\` — standard Markdown; no JSX/React components.
- \`.mdx\` — MDX (Markdown + JSX). Import and use React components.

## Admonitions (callouts)

\`\`\`md
:::note
Note content.
:::

:::tip[Custom title]
Tip with a custom title.
:::

:::info
:::

:::warning
:::

:::danger
:::
\`\`\`

## Code blocks

Fenced code blocks with syntax highlighting (Prism):

\`\`\`\`md
\`\`\`js title="src/hello.js"
function hello() {
  console.log('Hello, World!');
}
\`\`\`
\`\`\`\`

Line highlighting:
\`\`\`\`md
\`\`\`js {1,3-5}
const a = 1;   // highlighted
const b = 2;
const c = 3;   // highlighted
const d = 4;   // highlighted
const e = 5;   // highlighted
\`\`\`
\`\`\`\`

Show line numbers: \` \`\`\`js showLineNumbers \`

## Tabs (MDX only)

\`\`\`mdx
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
  <TabItem value="apple" label="Apple" default>
    This is an apple.
  </TabItem>
  <TabItem value="orange" label="Orange">
    This is an orange.
  </TabItem>
</Tabs>
\`\`\`

Synced tabs across the page: \`<Tabs groupId="os">\`.

## Details (collapsible)

\`\`\`mdx
<details>
  <summary>Toggle me!</summary>

  Markdown content inside a collapsible block.
</details>
\`\`\`

## Import Markdown

\`\`\`mdx
import MyContent from './myContent.md';

<MyContent />
\`\`\`

## React/JSX in MDX

\`\`\`mdx
import Highlight from '@site/src/components/Highlight';

Some text, then a <Highlight color="#25c2a0">highlighted phrase</Highlight>.
\`\`\`

## Math (KaTeX)

Install \`remark-math\` + \`rehype-katex\`, configure in \`docusaurus.config.js\`, then:
\`\`\`md
Inline: $E = mc^2$

Block:
$$
\int_0^\infty e^{-x} dx = 1
$$
\`\`\`

## Mermaid diagrams

Enable: \`markdown: { mermaid: true }\` + \`@docusaurus/theme-mermaid\` plugin.

\`\`\`\`md
\`\`\`mermaid
graph LR
  A-->B
  B-->C
\`\`\`
\`\`\`\`

## Asset references

\`\`\`md
![My Image](./assets/my-image.png)
\`\`\`

Or in MDX: \`import myImage from './assets/my-image.png'; <img src={myImage} />\`

Static assets (no processing): place in \`static/img/\`; reference as \`/img/filename.png\`.

## Partial documents

Place reusable fragments in \`docs/_partials/\` (underscore prefix hides them from sidebar):
\`\`\`mdx
import Partial from './_partials/common-steps.md';
<Partial />
\`\`\`

## Table of contents

Auto-generated from \`##\` and \`###\` headings. Adjust depth via frontmatter:
\`\`\`yaml
toc_min_heading_level: 2
toc_max_heading_level: 4
\`\`\`

---

# Docusaurus: Built-in Theme Components

Distilled from facebook/docusaurus (v3.x). Use in \`.mdx\` files with \`import\` from \`@theme/\`.

## Tabs / TabItem

\`\`\`mdx
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="platform" queryString>
  <TabItem value="win" label="Windows" default>Windows steps</TabItem>
  <TabItem value="mac" label="macOS">macOS steps</TabItem>
  <TabItem value="linux" label="Linux">Linux steps</TabItem>
</Tabs>
\`\`\`

Props:
- \`Tabs\`: \`groupId\` (string, syncs across same-page instances), \`defaultValue\`, \`values\`, \`queryString\` (persist in URL query param).
- \`TabItem\`: \`value\` (required, unique within \`<Tabs>\`), \`label\` (display name), \`default\` (pre-selected).

## CodeBlock

\`\`\`mdx
import CodeBlock from '@theme/CodeBlock';

<CodeBlock language="js" title="src/hello.js" showLineNumbers>
  {\`function hello() { return 'Hello!'; }\`}
</CodeBlock>
\`\`\`

Props: \`language\`, \`title\`, \`showLineNumbers\`, \`metastring\` (Prism token string).

## Admonition (programmatic form)

\`\`\`mdx
import Admonition from '@theme/Admonition';

<Admonition type="tip" icon="💡" title="My tip">
  Content here.
</Admonition>
\`\`\`

Types: \`note\`, \`tip\`, \`info\`, \`warning\`, \`danger\`.

## DocCardList (index pages)

\`\`\`mdx
import DocCardList from '@theme/DocCardList';

<DocCardList />   // renders cards for all docs in the current category
\`\`\`

## Mermaid (v3.3+)

\`\`\`mdx
import Mermaid from '@theme/Mermaid';

<Mermaid value={\`graph LR\n  A --> B\`} />
\`\`\`

Requires \`@docusaurus/theme-mermaid\` and \`markdown: { mermaid: true }\` in config.

## BrowserWindow (unofficial / theme utility)

Not a core component but commonly used in examples:
\`\`\`mdx
import BrowserWindow from '@site/src/components/BrowserWindow';

<BrowserWindow url="https://example.com">
  Preview content
</BrowserWindow>
\`\`\`

## Swizzling (customising components)

To override a theme component:
\`\`\`sh
npx docusaurus swizzle @docusaurus/theme-classic Footer -- --eject   # copy to src/theme/
\`\`\`

Preferred: \`--wrap\` (wrap the original), \`--eject\` (full copy).
Overridden component lives in \`src/theme/Footer/index.js\`.

## Custom React components

Place in \`src/components/\`. Import with \`@site/src/components/MyComp\` in MDX files.

\`\`\`mdx
import MyCard from '@site/src/components/MyCard';

<MyCard title="Hello">Content</MyCard>
\`\`\`

## Head metadata injection

\`\`\`mdx
import Head from '@docusaurus/Head';

<Head>
  <meta name="twitter:card" content="summary_large_image" />
</Head>
\`\`\``
// @generated-end docs-contracts/docusaurus-contract

// @generated-start docs-contracts/mkdocs-contract
const MKDOCS_CONTRACT = `MKDOCS AUTHORING CONTRACT (distilled from docs-site-builder/frameworks/mkdocs/references; do not re-derive syntax from memory).

---

# MkDocs: Setup

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material. Python-based static-site generator.

## Install

\`\`\`sh
pip install mkdocs
# With Material theme (strongly recommended):
pip install mkdocs-material
\`\`\`

Or with extras (social cards, image processing):
\`\`\`sh
pip install "mkdocs-material[imaging]"
\`\`\`

## New project

\`\`\`sh
mkdocs new my-project   # creates mkdocs.yml + docs/index.md
cd my-project
mkdocs serve            # dev server at http://127.0.0.1:8000
mkdocs build            # output to ./site/
\`\`\`

## Project structure

\`\`\`
my-project/
  docs/
    index.md            # homepage
    getting-started.md
    api/
      reference.md
  mkdocs.yml            # primary config
\`\`\`

## Commands

\`\`\`sh
mkdocs serve            # local dev server (auto-reload)
mkdocs build            # build to ./site/ (publishable)
mkdocs build --clean    # clean build
mkdocs gh-deploy        # deploy to gh-pages branch
mkdocs new <dir>        # scaffold new project
\`\`\`

## Notes

- Python 3.8+ required for MkDocs-Material 9.x.
- \`site/\` is the build output; add it to \`.gitignore\`.
- MkDocs-Material is effectively the canonical MkDocs setup; most real deployments use it.
- Plugins, extensions, and hooks are all configured in \`mkdocs.yml\`.

---

# MkDocs: Configuration (mkdocs.yml)

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material (v9.x).

## Minimal config

\`\`\`yaml
site_name: My Docs
\`\`\`

## Full config example

\`\`\`yaml
site_name: My Project
site_url: https://myproject.example.com/
site_description: Documentation for My Project
site_author: My Name
repo_url: https://github.com/org/repo
repo_name: org/repo

theme:
  name: material
  language: en
  palette:
    - scheme: default
      primary: indigo
      accent: indigo
      toggle:
        icon: material/brightness-7
        name: Switch to dark mode
    - scheme: slate
      primary: indigo
      accent: indigo
      toggle:
        icon: material/brightness-4
        name: Switch to light mode
  font:
    text: Roboto
    code: Roboto Mono
  features:
    - navigation.instant
    - navigation.tabs
    - navigation.sections
    - navigation.expand
    - navigation.top
    - search.highlight
    - search.share
    - content.code.copy
    - content.code.annotate

nav:
  - Home: index.md
  - Getting Started:
    - Installation: getting-started/installation.md
    - Configuration: getting-started/configuration.md
  - API Reference:
    - api/overview.md
    - api/auth.md

plugins:
  - search
  - tags

markdown_extensions:
  - admonition
  - pymdownx.details
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
  - pymdownx.highlight:
      anchor_linenums: true
      line_spans: __span
      pygments_lang_class: true
  - pymdownx.inlinehilite
  - pymdownx.snippets
  - pymdownx.tabbed:
      alternate_style: true
  - pymdownx.emoji:
      emoji_index: !!python/name:material.extensions.emoji.twemoji
      emoji_generator: !!python/name:material.extensions.emoji.to_svg
  - attr_list
  - md_in_html
  - tables
  - toc:
      permalink: true
      title: On this page

extra:
  social:
    - icon: fontawesome/brands/github
      link: https://github.com/org/repo
  version:
    provider: mike

copyright: Copyright &copy; 2024 My Company
\`\`\`

## \`theme.features\` (Material — key ones)

| Feature | Effect |
|---|---|
| \`navigation.instant\` | SPA-style instant loading |
| \`navigation.tabs\` | Top-level nav as tabs |
| \`navigation.sections\` | Render sections in sidebar |
| \`navigation.expand\` | Auto-expand sidebar |
| \`navigation.top\` | Back-to-top button |
| \`navigation.indexes\` | Section index pages (folder with \`index.md\`) |
| \`navigation.footer\` | Prev/next page links in footer |
| \`search.highlight\` | Highlight search terms on page |
| \`search.suggest\` | Inline search suggestions |
| \`content.code.copy\` | Copy button on code blocks |
| \`content.code.annotate\` | Code annotations |
| \`content.tabs.link\` | Linked content tabs |
| \`toc.follow\` | TOC auto-scrolls |

## \`nav\` rules

- If \`nav\` is omitted: MkDocs auto-generates from the file tree.
- Sections: a list under a key. Mix of bare files and sub-sections.
- Index page for a section: a file matching the section name or \`index.md\` in the folder.
- Absolute paths in nav are relative to \`docs/\`.

## Plugins (common)

\`\`\`yaml
plugins:
  - search:                     # built-in full-text search
      lang: en
  - tags:                       # page tagging (Material)
      tags_file: tags.md
  - mike:                       # versioning
  - git-revision-date-localized # show last commit date
  - minify:                     # minify HTML/CSS/JS
      minify_html: true
\`\`\`

## Hooks (\`hooks/\`)

Python scripts in \`hooks/\` that modify build output:
\`\`\`yaml
hooks:
  - hooks/on_page_markdown.py
\`\`\`

---

# MkDocs: Frontmatter

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material (v9.x).

Frontmatter is YAML between \`---\` delimiters at the top of a Markdown file.

## Core MkDocs frontmatter

\`\`\`yaml
---
title: Page Title               # overrides H1/filename as page title
description: Short description  # used in <meta name="description">
hide:
  - navigation                  # hide the left sidebar on this page
  - toc                         # hide the right table of contents
  - footer                      # hide prev/next footer
---
\`\`\`

## Material-specific frontmatter

\`\`\`yaml
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
\`\`\`

## Template frontmatter

\`\`\`yaml
---
template: home.html  # use a custom Jinja2 template for this page
---
\`\`\`

## Notes

- MkDocs frontmatter is minimal; most configuration lives in \`mkdocs.yml\`.
- \`title\` from frontmatter overrides the first \`# H1\` heading and the nav label if no explicit nav entry.
- \`tags\` require the \`tags\` plugin enabled in \`mkdocs.yml\`.
- \`hide: [navigation, toc]\` is useful for landing pages that should show full-width content.
- \`description\` is not displayed on the page itself; it populates \`<meta name="description">\` and social sharing cards.

---

# MkDocs: Content Authoring

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material (v9.x) with pymdownx extensions.

## Admonitions

Requires \`admonition\` + \`pymdownx.details\` extensions.

\`\`\`md
!!! note
    Note content (4-space indented).

!!! tip "Custom title"
    Tip with a custom title.

!!! warning ""
    Warning with no title (empty string).

??? note "Collapsible (closed by default)"
    Expand to see content.

???+ tip "Collapsible (open by default)"
    Open by default.
\`\`\`

Types: \`note\`, \`abstract\`, \`info\`, \`tip\`, \`success\`, \`question\`, \`warning\`, \`failure\`, \`danger\`, \`bug\`, \`example\`, \`quote\`.

## Code blocks

Requires \`pymdownx.highlight\` + \`pymdownx.superfences\`.

\`\`\`\`md
\`\`\`python title="hello.py" linenums="1"
def hello():
    print("Hello, World!")
\`\`\`
\`\`\`\`

Inline highlighting: \`\` \`#!python range()\` \`\` (syntax: \`\` \`#!<lang> code\` \`\`).

Code annotations (requires \`content.code.annotate\` theme feature):
\`\`\`\`md
\`\`\`python
def hello():  # (1)!
    print("Hello")
\`\`\`

1. This is an annotation.
\`\`\`\`

## Content tabs

Requires \`pymdownx.tabbed\` with \`alternate_style: true\`.

\`\`\`md
=== "Python"
    \`\`\`python
    print("Hello")
    \`\`\`

=== "JavaScript"
    \`\`\`js
    console.log("Hello");
    \`\`\`
\`\`\`

## Mermaid diagrams

Requires \`pymdownx.superfences\` with the mermaid custom fence.

\`\`\`\`md
\`\`\`mermaid
graph LR
  A[Start] --> B[End]
\`\`\`
\`\`\`\`

## Math (KaTeX/MathJax)

Enable in config: \`pymdownx.arithmatex\` extension + JS loader.

\`\`\`md
Inline: $E = mc^2$

Block:
$$
\int_0^\infty e^{-x} dx = 1
$$
\`\`\`

## Grids (Material)

Requires \`attr_list\` + \`md_in_html\`.

\`\`\`md
<div class="grid cards" markdown>

- :material-clock-fast:{ .lg .middle } **Set up in 5 minutes**

    Install and configure quickly.

    [:octicons-arrow-right-24: Getting started](getting-started.md)

</div>
\`\`\`

## Buttons

Requires \`attr_list\`.

\`\`\`md
[Subscribe to newsletter](#){ .md-button }
[Download :fontawesome-solid-download:](#){ .md-button .md-button--primary }
\`\`\`

## Images with captions

Requires \`attr_list\` + \`md_in_html\`.

\`\`\`md
![My Image](path/to/image.png){ align=right width=300 }

<figure markdown="span">
  ![Image title](path/to/image.png){ width="300" }
  <figcaption>Image caption</figcaption>
</figure>
\`\`\`

## Snippets (reusable content)

Requires \`pymdownx.snippets\`.

\`\`\`md
--8<-- "includes/common-steps.md"
\`\`\`

Place shared content in \`docs/includes/\`.

## Emoji

Requires \`pymdownx.emoji\`.

\`\`\`md
:material-home: :fontawesome-brands-github: :octicons-arrow-right-24:
\`\`\`

## Keyboard keys

Requires \`pymdownx.keys\`.

\`\`\`md
++ctrl+alt+del++
\`\`\`

---

# MkDocs: Material Components

Distilled from squidfunk/mkdocs-material (v9.x). MkDocs uses Markdown extensions, not importable components.

## Summary

MkDocs-Material uses Markdown extensions and HTML/CSS utility classes rather than React/Vue components.
"Components" here means the patterns you use in Markdown to produce rich UI elements.

## Cards grid

Requires \`attr_list\` + \`md_in_html\`.

\`\`\`md
<div class="grid cards" markdown>

- :material-clock-fast:{ .lg .middle } **Install in 5 minutes**

    ---
    Quick setup for any project.
    [:octicons-arrow-right-24: Getting started](getting-started.md)

- :material-scale-balance:{ .lg .middle } **Open Source**

    ---
    Material for MkDocs is licensed under MIT.

</div>
\`\`\`

## Annotations

Requires \`content.code.annotate\` feature + \`attr_list\`.

\`\`\`md
Lorem ipsum (1) dolor sit amet.
{ .annotate }

1. This is the annotation text.
\`\`\`

## Tooltips

Requires \`pymdownx.snippets\` + \`attr_list\`.

\`\`\`md
[Hover me](example.com "Tooltip text"){ title="Tooltip text" }
\`\`\`

## Details (collapsible blocks)

\`\`\`md
??? "Summary line"
    Content inside the collapsible block.

???+ "Open by default"
    This one starts expanded.
\`\`\`

## Status badges in nav

Set per-page in frontmatter:
\`\`\`yaml
status: new       # shows "New" badge
status: deprecated
\`\`\`

## Content tabs

\`\`\`md
=== "Tab One"
    Content for tab one.

=== "Tab Two"
    Content for tab two.
\`\`\`

## Feedback widget

Configured in \`mkdocs.yml\` analytics section. Renders thumbs up/down per page.

\`\`\`yaml
analytics:
  feedback:
    title: Was this page helpful?
    ratings:
      - icon: material/thumb-up-outline
        name: This page was helpful
        data: 1
        note: Thanks for your feedback!
      - icon: material/thumb-down-outline
        name: This page could be improved
        data: 0
        note: Thanks for the feedback!
\`\`\`

## Blog (Material plugin)

Requires the \`blog\` plugin:
\`\`\`yaml
plugins:
  - blog
\`\`\`

Blog posts live in \`docs/blog/posts/\`.

## Social cards

Automatically generated thumbnails (requires \`[imaging]\` extras):
\`\`\`yaml
plugins:
  - social
\`\`\``
// @generated-end docs-contracts/mkdocs-contract

// @generated-start docs-contracts/vitepress-contract
const VITEPRESS_CONTRACT = `VITEPRESS AUTHORING CONTRACT (distilled from docs-site-builder/frameworks/vitepress/references; do not re-derive syntax from memory).

---

# VitePress: Setup

Distilled from vuejs/vitepress (v1.x). Vue + Vite static-site generator for documentation.

## New project (interactive scaffold)

\`\`\`sh
npm add -D vitepress
npx vitepress init
\`\`\`

The wizard asks: root dir, site title, description, theme (default/custom), TypeScript.

\`\`\`sh
npm run docs:dev     # dev server at http://localhost:5173
npm run docs:build   # build to ./docs/.vitepress/dist/
npm run docs:preview # preview built output
\`\`\`

## Minimal manual setup

\`\`\`sh
mkdir docs && echo '# Hello VitePress' > docs/index.md
npx vitepress dev docs
\`\`\`

## Project structure

\`\`\`
project-root/
  docs/                    # content root (configurable)
    .vitepress/
      config.mts           # primary config file
      theme/               # optional custom theme
        index.ts           # theme entry
        style.css
    index.md               # home page
    getting-started.md
    guide/
      introduction.md
  package.json
\`\`\`

## \`package.json\` scripts

\`\`\`json
{
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs"
  },
  "devDependencies": {
    "vitepress": "^1.0.0"
  }
}
\`\`\`

## Notes

- VitePress v1 requires Node.js 18+.
- Config file: \`.vitepress/config.mts\` (TypeScript recommended) or \`config.js\`.
- Content root defaults to \`docs/\` but can be set with the \`srcDir\` option.
- Build output: \`.vitepress/dist/\` (relative to the docs root).
- \`public/\` inside the docs root serves static assets at the site root.

---

# VitePress: Configuration (.vitepress/config.mts)

Distilled from vuejs/vitepress (v1.x).

## Minimal config

\`\`\`ts
// docs/.vitepress/config.mts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'My Docs',
  description: 'A VitePress Site',
})
\`\`\`

## Full config example

\`\`\`ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  // Site metadata
  title: 'My Docs',
  titleTemplate: ':title - My Docs',   // browser tab pattern
  description: 'Documentation for My Project',
  lang: 'en-US',
  base: '/',                            // set to /repo-name/ for GitHub Pages

  // Build options
  srcDir: '.',                          // relative to config file's dir
  outDir: '../dist',
  cleanUrls: true,                      // drop .html from URLs

  // Head tags
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'og:type', content: 'website' }],
  ],

  // Markdown options
  markdown: {
    lineNumbers: true,
    image: { lazyLoading: true },
    math: true,                         // requires markdown-it-mathjax3
    config(md) { /* remark plugins */ },
  },

  // Theme config
  themeConfig: {
    // Navigation
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
      {
        text: 'v1.x',
        items: [
          { text: '1.0 Changelog', link: '/changelog/1.0' },
          { text: 'v0.x', link: 'https://vitepress-v0.netlify.app' },
        ],
      },
    ],

    // Sidebar
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is VitePress?', link: '/guide/what-is-vitepress' },
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
          collapsed: false,
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [{ text: 'Config', link: '/api/config' }],
        },
      ],
    },

    // Or a flat sidebar (same sidebar everywhere)
    // sidebar: [{ text: 'Guide', items: [...] }],

    // Social links
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' },
      { icon: 'twitter', link: '...' },
      { icon: { svg: '<svg>...</svg>' }, link: '...' },  // custom icon
    ],

    // Footer (not shown on pages with sidebar)
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 My Company',
    },

    // Algolia search
    search: {
      provider: 'algolia',
      options: { appId: '...', apiKey: '...', indexName: '...' },
    },
    // Or local search (built-in, no setup):
    // search: { provider: 'local' },

    // Edit link
    editLink: {
      pattern: 'https://github.com/org/repo/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    // Last updated
    lastUpdated: { text: 'Updated at', formatOptions: { dateStyle: 'full', timeStyle: 'medium' } },

    // Carbon ads
    carbonAds: { code: '...', placement: '...' },

    // Doc footer
    docFooter: { prev: 'Previous page', next: 'Next page' },

    // Aside (table of contents on right)
    aside: true,         // 'left' | true (right) | false
    outline: { level: [2, 3], label: 'On this page' },

    // Language menu (i18n)
    langMenuLabel: 'Language',
    returnToTopLabel: 'Return to top',
  },

  // Internationalization
  locales: {
    root: { label: 'English', lang: 'en' },
    fr: { label: 'Français', lang: 'fr', themeConfig: { nav: [] } },
  },

  // Vite config passthrough
  vite: {
    server: { port: 5173 },
  },
})
\`\`\`

## Sidebar format

\`\`\`ts
// Flat (global): array
sidebar: [
  { text: 'Introduction', link: '/intro' },
  {
    text: 'Guide',
    collapsed: false,
    items: [
      { text: 'Installation', link: '/guide/install' },
      { text: 'Configuration', link: '/guide/config' },
    ],
  },
]

// Per-path: object keyed by path prefix
sidebar: {
  '/guide/': [...],   // active when URL starts with /guide/
  '/api/': [...],
}
\`\`\`

Items can be nested: an item can have \`items\` for sub-sections. Max depth: 6 levels rendered.

---

# VitePress: Frontmatter

Distilled from vuejs/vitepress (v1.x).

## Common page frontmatter

\`\`\`yaml
---
title: Page Title             # browser tab title and <h1> (if no H1 in content)
titleTemplate: false          # disable the title template for this page
description: Page description # <meta name="description">
layout: doc                   # 'doc' (default) | 'home' | 'page' (full-width, no sidebar)
lang: en-US                   # override site lang for this page
dir: ltr                      # text direction 'ltr' | 'rtl'
---
\`\`\`

## Table of contents

\`\`\`yaml
---
outline: [2, 3]       # heading levels to show (number, [min,max], or 'deep' for all)
outline: deep         # all heading levels
outline: false        # disable TOC
---
\`\`\`

## Sidebar and nav

\`\`\`yaml
---
aside: false          # hide the aside/TOC on this page
---
\`\`\`

## Edit link and last updated

\`\`\`yaml
---
editLink: false       # hide the "Edit this page" link on this page
lastUpdated: false    # hide last-updated timestamp for this page
---
\`\`\`

## Home page (layout: home)

\`\`\`yaml
---
layout: home

hero:
  name: "My Project"
  text: "A great tool for developers."
  tagline: Fast, reliable, and easy to use.
  image:
    src: /logo.png
    alt: My Project Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/org/repo

features:
  - icon:
      src: /icons/fast.svg
    title: Blazing Fast
    details: Built on Vite for instant HMR and fast builds.
  - icon: 🔒
    title: Secure
    details: Security-first design.
  - title: Easy to Use
    icon:
      light: /icons/light.png
      dark: /icons/dark.png
    details: Simple configuration.
---
\`\`\`

## Page frontmatter (layout: page)

\`layout: page\` renders the content without the doc sidebar and article header.
Useful for custom landing pages or full-width pages.

## Head tags (per-page)

\`\`\`yaml
---
head:
  - - meta
    - name: twitter:card
      content: summary_large_image
  - - link
    - rel: canonical
      href: https://example.com/page
---
\`\`\`

## Notes

- Frontmatter values override the equivalent site-level \`themeConfig\` settings.
- \`layout: doc\` (default) shows the sidebar + TOC.
- \`layout: page\` removes sidebar and limits the TOC.
- \`layout: home\` renders a special hero/features layout using the \`hero\` and \`features\` frontmatter keys.

---

# VitePress: Content Authoring

Distilled from vuejs/vitepress (v1.x). Uses markdown-it + Vue-in-Markdown.

## Custom containers (callouts)

\`\`\`md
::: info
Information callout.
:::

::: tip Custom Title
Tip with a custom title.
:::

::: warning
Warning callout.
:::

::: danger STOP
Danger callout with custom label.
:::

::: details Click to expand
Hidden content.
:::
\`\`\`

## Code blocks

\`\`\`\`md
\`\`\`js
console.log('Hello, World!')
\`\`\`

\`\`\`ts{1,3-5}
const a = 1     // highlighted
const b = 2
const c = 3     // highlighted
\`\`\`

\`\`\`js:line-numbers
// line numbers enabled
const a = 1
\`\`\`
\`\`\`\`

Focus mode (dim non-focused lines):
\`\`\`\`md
\`\`\`js
export default {
  data() {
    return { // [!code focus]
      msg: 'Hello' // [!code focus]
    }
  }
}
\`\`\`
\`\`\`\`

Diff highlighting:
\`\`\`\`md
\`\`\`js
const removed = 'old' // [!code --]
const added = 'new'   // [!code ++]
\`\`\`
\`\`\`\`

Code group (tabbed):
\`\`\`\`md
::: code-group
\`\`\`sh [npm]
npm install vitepress
\`\`\`
\`\`\`sh [pnpm]
pnpm add vitepress
\`\`\`
\`\`\`sh [yarn]
yarn add vitepress
\`\`\`
:::
\`\`\`\`

## Snippet import

Import code from external files:
\`\`\`md
<<< @/src/example.ts
<<< @/src/example.ts{1,3-5}     # with highlight
<<< @/src/example.ts{ts}        # language override
<<< @/src/example.ts#region     # named region: // #region / // #endregion
\`\`\`

## Vue components in Markdown

VitePress runs Markdown through Vue. Use Vue syntax and global components:

\`\`\`md
The count is {{ 1 + 1 }}.

<span v-if="true">Visible</span>

<Badge type="tip" text="New" />
\`\`\`

Escaped: \`<span v-pre>{{ literal }}</span>\`

## Importing Vue components

Place components in \`docs/.vitepress/theme/\` or any path; import in Markdown:

\`\`\`md
<script setup>
import MyComponent from './MyComponent.vue'
</script>

<MyComponent />
\`\`\`

## Math (requires markdown-it-mathjax3)

Install: \`npm add -D markdown-it-mathjax3\`; enable: \`markdown: { math: true }\` in config.

\`\`\`md
Inline: $E = mc^2$

Block:
$$
\int_0^\infty e^{-x} dx = 1
$$
\`\`\`

## Mermaid (via vitepress-plugin-mermaid or custom)

\`\`\`md
\`\`\`mermaid
sequenceDiagram
  Alice->>John: Hello!
\`\`\`
\`\`\`

## Table of contents (in-page)

Insert \`[[toc]]\` anywhere to render an inline TOC.

## Links

- Internal links: relative paths (\`.md\` or without extension).
  \`[Page](./guide.md)\` or \`[Page](./guide)\` — VitePress rewrites to the final URL.
- External links: auto-opened in new tab with \`rel="noopener noreferrer"\`.

---

# VitePress: Built-in Components

Distilled from vuejs/vitepress (v1.x). Available globally in all \`.md\` and \`.vue\` files.

## Badge

Inline badge for labeling items in text or headings.

\`\`\`md
### My Feature <Badge type="info" text="v1.2" />

Version <Badge type="tip" text="New" />
\`\`\`

Props:
- \`type\`: \`'info'\` | \`'tip'\` | \`'warning'\` | \`'danger'\` (default: \`'tip'\`)
- \`text\`: string displayed in the badge
- \`vertical\`: \`'top'\` | \`'middle'\` (default: \`'top'\`) — vertical alignment relative to surrounding text

## Image (lazy loading)

Standard Markdown images get lazy loading when \`markdown.image.lazyLoading: true\` is set.

\`\`\`md
![Alt text](./image.png)
\`\`\`

To use \`<picture>\` for dark/light variants, use HTML directly or a custom Vue component.

## Custom Theme Components

Place custom Vue components in \`docs/.vitepress/theme/\`:

\`\`\`ts
// docs/.vitepress/theme/index.ts
import DefaultTheme from 'vitepress/theme'
import MyComponent from './MyComponent.vue'

export default {
  ...DefaultTheme,
  enhanceApp({ app }) {
    app.component('MyComponent', MyComponent)
  },
}
\`\`\`

Then use globally in Markdown:
\`\`\`md
<MyComponent title="Hello" />
\`\`\`

## Layout slots

Inject content into VitePress's default layout via named slots:

\`\`\`ts
// docs/.vitepress/theme/index.ts
import DefaultTheme from 'vitepress/theme'
import Announcement from './Announcement.vue'

export default {
  ...DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'aside-top': () => h(Announcement),
    'nav-bar-content-after': () => h(MyBadge),
  }),
}
\`\`\`

Available slots include: \`home-hero-before\`, \`home-hero-info-before\`, \`home-hero-info\`,
\`home-hero-info-after\`, \`home-hero-actions-after\`, \`home-features-before\`, \`home-features-after\`,
\`sidebar-nav-before\`, \`sidebar-nav-after\`, \`aside-top\`, \`aside-bottom\`, \`aside-outline-before\`,
\`aside-outline-after\`, \`aside-ads-before\`, \`aside-ads-after\`, \`doc-before\`, \`doc-after\`,
\`doc-footer-before\`, \`nav-bar-title-before\`, \`nav-bar-title-after\`, \`nav-bar-content-before\`,
\`nav-bar-content-after\`, \`nav-screen-content-before\`, \`nav-screen-content-after\`.

## useData composable

Access VitePress data in custom components:

\`\`\`vue
<script setup>
import { useData } from 'vitepress'
const { theme, page, frontmatter, isDark } = useData()
</script>

<template>
  <h1>{{ frontmatter.title }}</h1>
</template>
\`\`\`

## withBase helper

Prepend \`base\` URL to asset paths in components:

\`\`\`ts
import { withBase } from 'vitepress'
const logoSrc = withBase('/images/logo.png')
\`\`\``
// @generated-end docs-contracts/vitepress-contract

// @generated-start docs-contracts/fumadocs-contract
const FUMADOCS_CONTRACT = `FUMADOCS AUTHORING CONTRACT (distilled from docs-site-builder/frameworks/fumadocs/references; do not re-derive syntax from memory).

---

# Fumadocs: Setup

Distilled from fuma-nama/fumadocs (v14.x). Next.js-based documentation framework.

## New project (recommended)

\`\`\`sh
npm create fumadocs-app@latest
# interactive wizard: project name, content source (fumadocs-mdx or Content Collections)
cd my-app
npm run dev   # dev server at http://localhost:3000
\`\`\`

The wizard scaffolds a complete Next.js App Router project.

## Manual installation (into existing Next.js app)

\`\`\`sh
npm install fumadocs-ui fumadocs-core
npm install fumadocs-mdx   # for MDX content source (most common)
# or: npm install fumadocs-content-collections  # for content-collections source
\`\`\`

### Required peer dependencies

- Next.js 14+ (App Router)
- React 18+

## Project structure (from scaffold)

\`\`\`
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
\`\`\`

## \`next.config.mjs\`

\`\`\`js
import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
}

export default withMDX(config)
\`\`\`

## \`source.config.ts\`

\`\`\`ts
import { defineDocs, defineConfig } from 'fumadocs-mdx/config'

export const docs = defineDocs({
  dir: 'content/docs',
})

export default defineConfig({
  mdxOptions: {
    // remark/rehype plugins
  },
})
\`\`\`

## \`app/layout.tsx\` (root provider)

\`\`\`tsx
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
\`\`\`

## Commands

\`\`\`sh
npm run dev       # development server
npm run build     # production build
npm run start     # serve production build
\`\`\`

## Notes

- Fumadocs is a React/Next.js framework; it does NOT generate a static site without Next.js.
- Deploy to Vercel, Netlify, or any Node-compatible host.
- Content source options: \`fumadocs-mdx\` (recommended, uses Next.js MDX pipeline) or \`fumadocs-content-collections\` (schema-validated).

---

# Fumadocs: Configuration

Distilled from fuma-nama/fumadocs (v14.x).

Configuration is spread across several files, not a single config file.

## Source: \`source.config.ts\`

\`\`\`ts
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
\`\`\`

## Docs route: \`app/docs/[[...slug]]/page.tsx\`

\`\`\`tsx
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
\`\`\`

## Docs layout: \`app/docs/[[...slug]]/layout.tsx\`

\`\`\`tsx
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
\`\`\`

## Source binding: \`lib/source.ts\`

\`\`\`ts
import { docs } from '@/.source'
import { loader } from 'fumadocs-core/source'
import { createMDXSource } from 'fumadocs-mdx'

export const source = loader({
  baseUrl: '/docs',
  source: createMDXSource(docs),
})
\`\`\`

## Navigation: \`meta.json\`

Each content directory can have a \`meta.json\` to control sidebar order and labels:

\`\`\`json
{
  "title": "Getting Started",
  "pages": ["index", "installation", "configuration"],
  "defaultOpen": true
}
\`\`\`

\`pages\` is an ordered list of filenames (without extension). Folders are referenced by their dir name.

## \`fumadocs-ui\` theming

The \`RootProvider\` accepts a \`theme\` prop:
\`\`\`tsx
<RootProvider theme={{ defaultMode: 'dark' }}>
\`\`\`

Custom CSS variables in \`global.css\`:
\`\`\`css
:root {
  --fd-nav-height: 4rem;
  --fd-sidebar-width: 260px;
}
\`\`\`

## Search

Fumadocs ships with built-in Orama search (no config needed) or Algolia:

\`\`\`ts
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
\`\`\`

---

# Fumadocs: Frontmatter

Distilled from fuma-nama/fumadocs (v14.x). Used in \`.mdx\` files in \`content/docs/\`.

## Standard frontmatter

\`\`\`yaml
---
title: Page Title             # (required) displayed as page heading and in nav
description: Short description # shown below title, used in <meta>
icon: FileText                # Lucide icon name — shown in sidebar next to the title
full: false                   # if true: full-width page (no TOC aside)
---
\`\`\`

## Sidebar position and visibility

Sidebar order and structure is controlled by \`meta.json\` files in each directory, NOT by per-file frontmatter.

\`meta.json\` in the same directory:
\`\`\`json
{
  "title": "Guide",
  "pages": ["intro", "setup", "config"],
  "defaultOpen": true
}
\`\`\`

## TOC configuration

\`\`\`yaml
---
toc: true    # default; set false to hide TOC on this page
---
\`\`\`

## Full page width

\`\`\`yaml
---
full: true   # removes the TOC aside, content spans full width
---
\`\`\`

## Custom frontmatter fields

Define additional typed fields in \`source.config.ts\`:

\`\`\`ts
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
\`\`\`

Then access in \`page.data.preview\`, \`page.data.tags\`.

## Notes

- Fumadocs frontmatter is minimal. Most structure (nav, order) comes from \`meta.json\`.
- \`icon\` accepts any Lucide icon name (see https://lucide.dev/) as a string.
- \`title\` is the only required field; pages without it won't render a heading.
- All frontmatter fields are TypeScript-typed via the Zod schema in \`source.config.ts\`.

---

# Fumadocs: Content Authoring

Distilled from fuma-nama/fumadocs (v14.x). Content is \`.mdx\` files in \`content/docs/\`.

## File format

All doc pages use \`.mdx\` (MDX — Markdown + JSX). Standard Markdown works inside MDX.

## Callouts / admonitions

Via the \`Callout\` component (included in \`fumadocs-ui/mdx\` defaults):

\`\`\`mdx
import { Callout } from 'fumadocs-ui/components/callout'

<Callout type="info">This is an info callout.</Callout>
<Callout type="warn">Warning callout.</Callout>
<Callout type="error">Error callout.</Callout>
<Callout title="Custom Title">Note with a title.</Callout>
\`\`\`

Types: \`info\` (default), \`warn\`, \`error\`.

Or use the remark-based syntax (if \`remarkAdmonition\` plugin is configured):
\`\`\`md
> [!NOTE]
> GitHub-style admonition.
\`\`\`

## Code blocks

Standard fenced code blocks with optional title and highlighting via \`rehypeCode\`:

\`\`\`\`md
\`\`\`ts title="hello.ts"
function hello(): string {
  return 'Hello!'
}
\`\`\`
\`\`\`\`

Diff:
\`\`\`\`md
\`\`\`ts
const a = 1  // [!code --]
const b = 2  // [!code ++]
\`\`\`
\`\`\`\`

## Tabs

\`\`\`mdx
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'

<Tabs items={['npm', 'pnpm', 'yarn']}>
  <Tab value="npm">
    \`\`\`sh
    npm install fumadocs-ui
    \`\`\`
  </Tab>
  <Tab value="pnpm">
    \`\`\`sh
    pnpm add fumadocs-ui
    \`\`\`
  </Tab>
  <Tab value="yarn">
    \`\`\`sh
    yarn add fumadocs-ui
    \`\`\`
  </Tab>
</Tabs>
\`\`\`

## Steps

\`\`\`mdx
import { Steps, Step } from 'fumadocs-ui/components/steps'

<Steps>
  <Step>
    ### Install

    Run \`npm install fumadocs-ui\`.
  </Step>
  <Step>
    ### Configure

    Add \`RootProvider\` to your layout.
  </Step>
</Steps>
\`\`\`

## File tree

\`\`\`mdx
import { Files, Folder, File } from 'fumadocs-ui/components/files'

<Files>
  <Folder name="app" defaultOpen>
    <File name="page.tsx" />
    <File name="layout.tsx" />
  </Folder>
  <File name="next.config.mjs" />
</Files>
\`\`\`

## Cards

\`\`\`mdx
import { Cards, Card } from 'fumadocs-ui/components/card'

<Cards>
  <Card title="Getting Started" href="/docs/getting-started" icon={<MyIcon />} />
  <Card title="API Reference" href="/docs/api" description="Full API docs." />
</Cards>
\`\`\`

## Accordion

\`\`\`mdx
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'

<Accordions>
  <Accordion title="What is Fumadocs?">
    Fumadocs is a Next.js documentation framework.
  </Accordion>
  <Accordion title="How do I install it?">
    Run \`npm create fumadocs-app@latest\`.
  </Accordion>
</Accordions>
\`\`\`

## Auto-install snippet (fumadocs-docgen)

\`\`\`mdx
import { AutoTypeTable } from 'fumadocs-typescript/ui'

<AutoTypeTable path="./my-types.ts" name="MyConfig" />
\`\`\`

## MDX defaults

\`defaultMdxComponents\` from \`fumadocs-ui/mdx\` pre-wires all built-in components.
Pass it to \`<MDX components={defaultMdxComponents} />\` in the page component.
Individual components can be added to it:

\`\`\`tsx
import defaultMdxComponents from 'fumadocs-ui/mdx'
const components = { ...defaultMdxComponents, MyComponent }
\`\`\`

---

# Fumadocs: UI Components

Distilled from fuma-nama/fumadocs (v14.x). Import from \`fumadocs-ui/components/*\`.

## Callout

\`\`\`tsx
import { Callout } from 'fumadocs-ui/components/callout'

<Callout type="info" title="Optional title">
  Content here.
</Callout>
\`\`\`

Props: \`type?: 'info' | 'warn' | 'error'\`, \`title?: string\`, \`icon?: ReactNode\`.

## Tabs / Tab

\`\`\`tsx
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'

<Tabs items={['Tab 1', 'Tab 2']} defaultIndex={0} persist groupId="install">
  <Tab value="Tab 1">Content for tab 1</Tab>
  <Tab value="Tab 2">Content for tab 2</Tab>
</Tabs>
\`\`\`

Props:
- \`Tabs\`: \`items\` (string[], required), \`defaultIndex\`, \`persist\` (remember in localStorage), \`groupId\` (sync across instances).
- \`Tab\`: \`value\` (string matching items entry, required).

## Steps / Step

\`\`\`tsx
import { Steps, Step } from 'fumadocs-ui/components/steps'

<Steps>
  <Step>### Step One\n\nContent.</Step>
  <Step>### Step Two\n\nContent.</Step>
</Steps>
\`\`\`

No required props; each \`Step\` renders its children as markdown.

## Cards / Card

\`\`\`tsx
import { Cards, Card } from 'fumadocs-ui/components/card'

<Cards>
  <Card href="/docs/intro" title="Introduction" description="Learn the basics." />
  <Card href="/docs/api" title="API Reference" icon={<BookIcon />} />
</Cards>
\`\`\`

Props for \`Card\`: \`href\` (string), \`title\` (string), \`description?\` (string), \`icon?\` (ReactNode), \`external?\` (boolean).

## Files / Folder / File

\`\`\`tsx
import { Files, Folder, File } from 'fumadocs-ui/components/files'

<Files>
  <Folder name="src" defaultOpen>
    <File name="index.ts" />
    <Folder name="lib">
      <File name="utils.ts" />
    </Folder>
  </Folder>
</Files>
\`\`\`

Props for \`Folder\`: \`name\` (string), \`defaultOpen?\` (boolean).
Props for \`File\`: \`name\` (string), \`icon?\` (ReactNode).

## Accordion / Accordions

\`\`\`tsx
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'

<Accordions type="single" collapsible>
  <Accordion id="faq-1" title="Question 1">Answer 1</Accordion>
  <Accordion id="faq-2" title="Question 2">Answer 2</Accordion>
</Accordions>
\`\`\`

Props for \`Accordions\`: \`type?: 'single' | 'multiple'\`, \`collapsible?\` (boolean).
Props for \`Accordion\`: \`id\` (string), \`title\` (string).

## Codeblock (manual)

\`\`\`tsx
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock'

<CodeBlock filename="hello.ts" allowCopy>
  <Pre>{\`const x = 1;\`}</Pre>
</CodeBlock>
\`\`\`

## ImageZoom

\`\`\`tsx
import { ImageZoom } from 'fumadocs-ui/components/image-zoom'

<ImageZoom src="/screenshot.png" alt="Screenshot" width={800} height={400} />
\`\`\`

Wraps Next.js \`<Image>\` with a click-to-zoom lightbox.

## DocsPage layout components

Used in \`app/docs/[[...slug]]/page.tsx\`:

\`\`\`tsx
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
  DocsCategory,
} from 'fumadocs-ui/page'
\`\`\`

- \`DocsPage\`: root wrapper; accepts \`toc\`, \`full\`, \`tableOfContent\`, \`tableOfContentPopover\`.
- \`DocsBody\`: wraps rendered MDX content.
- \`DocsTitle\`: renders page \`title\` as \`<h1>\`.
- \`DocsDescription\`: renders page \`description\`.
- \`DocsCategory\`: renders child pages as a card grid (for index/category pages).`
// @generated-end docs-contracts/fumadocs-contract

// @generated-start docs-contracts/mdbook-contract
const MDBOOK_CONTRACT = `MDBOOK AUTHORING CONTRACT (distilled from docs-site-builder/frameworks/mdbook/references; do not re-derive syntax from memory).

---

# mdBook: Setup

Distilled from rust-lang/mdBook (v0.4.x). Rust-based Markdown book generator.

## Install

\`\`\`sh
# Via cargo (Rust toolchain required)
cargo install mdbook

# Via pre-built binary (download from GitHub releases):
# https://github.com/rust-lang/mdBook/releases
\`\`\`

## New project

\`\`\`sh
mdbook init my-book
cd my-book
mdbook serve   # dev server at http://localhost:3000
mdbook build   # output to ./book/
\`\`\`

\`mdbook init\` creates:
\`\`\`
my-book/
  book.toml      # configuration
  src/
    SUMMARY.md   # table of contents (drives navigation)
    chapter_1.md
\`\`\`

When prompted, it can generate a \`.gitignore\` for the \`book/\` output.

## Commands

\`\`\`sh
mdbook init [path]        # create new book
mdbook build [path]       # build to book/ (default)
mdbook serve [path]       # build + live-reload dev server
mdbook test [path]        # run Rust doc-tests in code blocks
mdbook clean [path]       # delete build output
mdbook watch [path]       # rebuild on file changes (no server)
\`\`\`

## Project structure

\`\`\`
my-book/
  book.toml              # book configuration
  src/
    SUMMARY.md           # defines the chapter structure (required)
    README.md            # introduction / home page (linked from SUMMARY.md)
    chapter-1.md
    chapter-2/
      README.md          # chapter index page
      sub-section.md
  book/                  # build output (auto-generated, gitignore this)
  theme/                 # optional: override HTML/CSS/JS/handlebars templates
\`\`\`

## Notes

- \`SUMMARY.md\` is the only navigation file. All chapters must be listed there.
- mdBook produces a static HTML site (no JavaScript framework).
- Chapters not linked in \`SUMMARY.md\` are not built.
- mdBook is commonly used for Rust crate documentation (The Rust Book, Rustonomicon, etc.).

---

# mdBook: Configuration (book.toml)

Distilled from rust-lang/mdBook (v0.4.x).

## Minimal config

\`\`\`toml
[book]
title = "My Book"
\`\`\`

## Full config example

\`\`\`toml
[book]
title = "My Book"
authors = ["Jane Smith"]
description = "A book about things."
language = "en"
multilingual = false
src = "src"           # content source directory (default: "src")

[build]
build-dir = "book"   # output directory (default: "book")
create-missing = true  # create missing chapter files from SUMMARY.md

[rust]
edition = "2021"     # Rust edition for doc-tests (default: "2015")

[output.html]
theme = "default"                        # or path to a custom theme dir
default-theme = "light"                  # "light" | "rust" | "coal" | "navy" | "ayu"
preferred-dark-theme = "navy"
git-repository-url = "https://github.com/org/repo"
git-repository-icon = "fa-github"
edit-url-template = "https://github.com/org/repo/edit/main/{path}"
site-url = "/my-book/"                   # for deployment at a sub-path
cname = "book.example.com"
no-section-label = false                 # omit section numbers in sidebar
additional-css = ["theme/custom.css"]
additional-js = ["theme/custom.js"]
mathjax-support = true                   # enable MathJax
google-analytics = "UA-XXXXX-Y"
search.enable = true
search.limit = 30
search.use-boolean-and = true
search.boost-title = 2
search.boost-hierarchy = 1
search.boost-paragraph = 1
search.expand = true
search.heading-split-level = 3
search.copy-js = true

[output.html.print]
enable = true        # print.html page for the entire book
page-break = true    # insert page breaks between chapters in print view

[output.html.fold]
enable = false       # fold/collapse sections in the sidebar
level = 0            # depth at which to fold

[output.html.playground]
editable = false     # allow editing code examples inline
line-numbers = false

[preprocessor.index]
# built-in: converts README.md to index.html
[preprocessor.links]
# built-in: expands {{#include path}} and {{#rustdoc_include ...}}
\`\`\`

## \`SUMMARY.md\` (navigation definition)

This file is required and defines the entire book structure.

\`\`\`md
# Summary

[Introduction](README.md)

- [First Chapter](chapter-1.md)
- [Second Chapter](chapter-2/README.md)
  - [Sub-section](chapter-2/sub-section.md)

---

[Appendix](appendix.md)
[Other references]()   # chapter without a file (coming soon placeholder)
\`\`\`

Rules:
- **Numbered chapters:** items in an ordered/unordered list under a \`# Part Title\`.
- **Prefix chapters:** links before the first list item (not numbered, always visible).
- **Suffix chapters:** links after all list items (not numbered).
- **Draft chapters:** \`[Title]()\` with no link — shows in sidebar but is not built.
- **Separators:** \`---\` adds a horizontal rule between sections.
- \`README.md\` in a directory becomes the chapter index (\`index.html\`).

## Preprocessors

\`\`\`toml
[preprocessor.mermaid]
command = "mdbook-mermaid"   # external preprocessor binary

[preprocessor.admonish]
command = "mdbook-admonish"
\`\`\`

Install external preprocessors via cargo:
\`\`\`sh
cargo install mdbook-mermaid
mdbook-mermaid install   # injects JS into book.toml/theme
\`\`\`

## Output backends

\`\`\`toml
[output.html]      # default HTML output
[output.epub]      # EPUB via mdbook-epub (external)
[output.pdf]       # PDF via mdbook-pdf (external)
[output.markdown]  # raw markdown passthrough (built-in, for testing)
\`\`\`

---

# mdBook: Frontmatter and Page Metadata

Distilled from rust-lang/mdBook (v0.4.x).

## Standard frontmatter (not used by default)

**mdBook does NOT process YAML/TOML frontmatter by default.** Frontmatter blocks are rendered as-is (as a table or code block) unless a preprocessor strips them.

If you need frontmatter processing, add a preprocessor like \`mdbook-preprocessor-front-matter\` or handle it in a custom preprocessor.

## Page metadata via SUMMARY.md

Navigation titles and structure come from \`SUMMARY.md\`, not from per-file frontmatter:

\`\`\`md
- [Custom Title](path/to/file.md)
\`\`\`

The link label in \`SUMMARY.md\` is the chapter's display name in the sidebar and navigation.
The page's \`# H1\` heading is shown at the top of the rendered page.

## Part labels

\`\`\`md
# Part One

- [Chapter 1](ch1.md)

# Part Two

- [Chapter 4](ch4.md)
\`\`\`

Part headings (\`# Title\`) create sidebar sections (not rendered as chapters).

## Draft chapters

\`\`\`md
- [Upcoming Feature]()   # no file path = draft (visible in sidebar, not clickable)
\`\`\`

## Include directives (within chapter files)

These are processed by the built-in \`links\` preprocessor:

\`\`\`md
{{#include path/to/file.md}}
{{#include path/to/file.md:10:20}}       # lines 10-20 only
{{#include path/to/file.md:ANCHOR_NAME}} # named anchor

{{#rustdoc_include path/to/lib.rs:ANCHOR}}  # hide boilerplate, run as doc-test
\`\`\`

Named anchors in source files (Rust, Python, etc.):
\`\`\`rust
// ANCHOR: my_anchor
fn example() {}
// ANCHOR_END: my_anchor
\`\`\`

## Playgrounds

Mark a code block as editable (requires \`[output.html.playground] editable = true\`):
\`\`\`\`md
\`\`\`rust,editable
fn main() {
    println!("Edit me!");
}
\`\`\`
\`\`\`\`

Code block attributes: \`,editable\`, \`,noplayground\`, \`,ignore\`, \`,should_panic\`, \`,no_run\`.

## Notes

- Page title in the browser tab = \`# H1\` heading in the file.
- Sidebar title = the label in \`SUMMARY.md\`.
- There is no per-file slug or URL override; URLs derive from the file path relative to \`src/\`.

---

# mdBook: Content Authoring

Distilled from rust-lang/mdBook (v0.4.x). Chapters are Markdown files in \`src/\`.

## Markdown support

mdBook uses a CommonMark-compatible Markdown parser (pulldown-cmark). Most standard Markdown works.

## Handlebars helpers (built-in template variables)

Available in \`theme/\` override templates (Handlebars), not in content \`.md\` files.
Content files render as-is except for \`{{#include}}\` and other preprocessor directives.

## File includes

Processed by the built-in \`links\` preprocessor (enabled by default):

\`\`\`md
<!-- Include entire file -->
{{#include relative/path/to/file.md}}

<!-- Include line range -->
{{#include src/lib.rs:10:25}}

<!-- Include a named anchor region -->
{{#include src/lib.rs:example_function}}
\`\`\`

In the included file, mark anchors:
\`\`\`rust
// ANCHOR: example_function
pub fn example() -> i32 { 42 }
// ANCHOR_END: example_function
\`\`\`

## Code blocks

Standard fenced code blocks with syntax highlighting (highlight.js):

\`\`\`\`md
\`\`\`rust
fn main() {
    println!("Hello, world!");
}
\`\`\`

\`\`\`python
print("Hello, world!")
\`\`\`
\`\`\`\`

Supported language hints: any language that highlight.js recognizes.

### Rust-specific: runnable examples

\`\`\`\`md
\`\`\`rust
fn main() {
    println!("This runs in the playground!");
}
\`\`\`
\`\`\`\`

To disable (not runnable): \` \`\`\`rust,noplayground \` or \` \`\`\`rust,no_run \`

To mark as expected-to-panic: \` \`\`\`rust,should_panic \`

To hide from rendered output but include in doc-tests: \` \`\`\`rust,ignore \`

## MathJax (if enabled in config)

\`\`\`toml
[output.html]
mathjax-support = true
\`\`\`

Inline: \`\\(E = mc^2\\)\`
Block:
\`\`\`
\\[
\int_0^\infty e^{-x} dx = 1
\\]
\`\`\`

Note: mdBook uses \`\\(\` and \`\\[\` (double backslash), not \`$\` and \`$$\`.

## Admonitions (via mdbook-admonish preprocessor)

Install: \`cargo install mdbook-admonish && mdbook-admonish install\`

\`\`\`\`md
\`\`\`admonish note
This is a note.
\`\`\`

\`\`\`admonish tip title="Pro tip"
Custom title tip.
\`\`\`

\`\`\`admonish warning
Watch out!
\`\`\`
\`\`\`\`

Types: \`note\`, \`abstract\`, \`info\`, \`tip\`, \`success\`, \`question\`, \`warning\`, \`failure\`, \`danger\`, \`bug\`, \`example\`, \`quote\`.

## Mermaid diagrams (via mdbook-mermaid preprocessor)

Install: \`cargo install mdbook-mermaid && mdbook-mermaid install\`

\`\`\`\`md
\`\`\`mermaid
graph LR
  A --> B --> C
\`\`\`
\`\`\`\`

## Table of contents (inline)

No built-in inline TOC. The sidebar auto-generates chapter navigation.
Right-side heading TOC is rendered by the HTML theme from the page's headings.

## Images and assets

Place images in \`src/images/\` (or any subdirectory of \`src/\`).

\`\`\`md
![My Image](images/screenshot.png)
\`\`\`

Relative paths work relative to the chapter file's location within \`src/\`.

## Custom HTML

Raw HTML works in Markdown files. Useful for special layouts.

\`\`\`md
<div class="warning">

This is a custom warning block using raw HTML.

</div>
\`\`\`

---

# mdBook: Theme and Extensions

Distilled from rust-lang/mdBook (v0.4.x). mdBook has no component system; customization is via theme overrides and preprocessors.

## Built-in theme files (override by placing in \`theme/\`)

\`\`\`
theme/
  index.hbs          # main Handlebars page template
  head.hbs           # extra <head> content
  header.hbs         # top bar content
  redirect.hbs       # redirect page template
  toc.js             # table of contents behavior
  favicon.png        # book favicon
  favicon.svg
  book.js            # main JS (search, theme switcher, etc.)
  css/
    chrome.css       # layout/chrome styles
    general.css      # body/typography styles
    print.css        # print-specific styles
    variables.css    # CSS custom properties for theming
  highlight.js       # syntax highlighting
  highlight.css
  tomorrow-night.css
  ayu-highlight.css
\`\`\`

\`mdbook init --theme\` to copy all theme files to \`theme/\` for editing.

## CSS customization

The easiest customization: add a \`custom.css\` and reference it in \`book.toml\`:
\`\`\`toml
[output.html]
additional-css = ["theme/custom.css"]
\`\`\`

CSS custom properties to override (defined in \`theme/css/variables.css\`):
\`\`\`css
:root {
  --bg: white;
  --fg: #333;
  --sidebar-bg: #fafafa;
  --sidebar-fg: #364149;
  --links: #4183c4;
  --inline-code-color: #c0341d;
}
\`\`\`

## JS customization

\`\`\`toml
[output.html]
additional-js = ["theme/custom.js"]
\`\`\`

## Handlebars variables (in \`index.hbs\`)

Available template variables:
\`\`\`handlebars
{{title}}             <!-- page title -->
{{book_title}}        <!-- book title from book.toml -->
{{chapter_title}}     <!-- current chapter title -->
{{path}}              <!-- file path of current chapter -->
{{content}}           <!-- rendered Markdown HTML -->
{{toc}}               <!-- sidebar TOC HTML -->
{{previous}}          <!-- { link, name } or undefined -->
{{next}}              <!-- { link, name } or undefined -->
{{git_repository_url}} <!-- from config -->
{{print_enable}}      <!-- print.html enabled? -->
{{search_enabled}}    <!-- search feature enabled? -->
\`\`\`

## Preprocessors

Preprocessors transform Markdown before rendering. Common ones:

| Preprocessor | Install | Effect |
|---|---|---|
| \`mdbook-admonish\` | \`cargo install mdbook-admonish\` | Callout blocks |
| \`mdbook-mermaid\` | \`cargo install mdbook-mermaid\` | Mermaid diagrams |
| \`mdbook-toc\` | \`cargo install mdbook-toc\` | Inline \`<!-- toc -->\` generation |
| \`mdbook-tabs\` | \`cargo install mdbook-tabs\` | Tabbed content |
| \`mdbook-katex\` | \`cargo install mdbook-katex\` | KaTeX math (alternative to MathJax) |

Custom preprocessor minimal config:
\`\`\`toml
[preprocessor.my-preprocessor]
command = "my-preprocessor-binary"
renderer = ["html"]   # only run for HTML output
\`\`\`

## Output backends (non-HTML)

\`\`\`toml
[output.markdown]   # built-in: markdown passthrough (testing)
[output.epub]       # via mdbook-epub: cargo install mdbook-epub
\`\`\``
// @generated-end docs-contracts/mdbook-contract

// @generated-start docs-contracts/docsify-contract
const DOCSIFY_CONTRACT = `DOCSIFY AUTHORING CONTRACT (distilled from docs-site-builder/frameworks/docsify/references; do not re-derive syntax from memory).

---

# Docsify: Setup

Distilled from docsifyjs/docsify (v4.x). Runtime Markdown renderer — no build step.

## Key concept

Docsify renders Markdown at runtime in the browser. You serve static files (HTML + Markdown);
no build pipeline or compilation step is required.

## Install CLI (optional)

\`\`\`sh
npm i docsify-cli -g
\`\`\`

## New project

\`\`\`sh
docsify init ./docs   # creates docs/index.html, docs/README.md, docs/.nojekyll

cd docs
docsify serve .       # local server at http://localhost:3000
\`\`\`

Without the CLI, just serve the directory with any static file server:
\`\`\`sh
npx serve docs
# or
python3 -m http.server 3000 --directory docs
\`\`\`

## Minimal \`index.html\`

\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Docs</title>
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
</head>
<body>
  <div id="app"></div>
  <script>
    window.$docsify = {
      name: 'My Docs',
      repo: 'https://github.com/org/repo',
      loadSidebar: true,
      subMaxLevel: 2,
    }
  </script>
  <script src="//cdn.jsdelivr.net/npm/docsify@4/lib/docsify.min.js"></script>
</body>
</html>
\`\`\`

## Project structure

\`\`\`
docs/
  .nojekyll          # prevents GitHub Pages from ignoring _ files
  index.html         # entry point (the app shell + config)
  README.md          # home page content
  _sidebar.md        # sidebar navigation (when loadSidebar: true)
  _navbar.md         # top navbar (when loadNavbar: true)
  _coverpage.md      # cover page (when coverpage: true)
  guide/
    README.md        # /guide/ route
    advanced.md      # /guide/advanced route
\`\`\`

## Deployment

Docsify is just static files. Deploy to:
- GitHub Pages: push to \`gh-pages\` branch or \`docs/\` folder
- Netlify / Vercel: serve the \`docs/\` directory
- Any static host

Add \`.nojekyll\` to prevent GitHub from ignoring \`_sidebar.md\` etc.

## Notes

- No build step = instant authoring, but no tree-shaking or pre-rendering.
- Content is fetched via XHR at runtime; SEO requires server-side rendering (not included).
- Docsify v4 uses CDN-based delivery; no npm install needed for the site itself.

---

# Docsify: Configuration (window.$docsify)

Distilled from docsifyjs/docsify (v4.x). All config lives in \`index.html\`.

## Configuration object

\`\`\`js
window.$docsify = {
  // ---- Identity ----
  name: 'My Docs',               // site name (shown in sidebar header)
  nameLink: '/',                 // link for the site name
  logo: '/_media/icon.svg',      // logo next to name in sidebar
  repo: 'https://github.com/org/repo',  // GitHub corner link

  // ---- Entry / routing ----
  homepage: 'README.md',         // default home page file
  basePath: '/base/',            // base path for all requests
  alias: {
    '/old-path': '/new-path',    // URL redirects
  },
  routerMode: 'hash',            // 'hash' (default) | 'history'
  relativePath: false,

  // ---- Sidebar ----
  loadSidebar: true,             // load _sidebar.md for navigation
  loadSidebar: '_sidebar.md',    // custom filename
  hideSidebar: false,
  sidebarDisplayLevel: 1,        // auto-collapse after this level
  subMaxLevel: 2,                // TOC heading depth from page content in sidebar (0 = disabled)
  autoHeader: false,             // auto insert # header before sidebar items

  // ---- Navbar ----
  loadNavbar: true,              // load _navbar.md
  loadNavbar: '_navbar.md',      // custom filename
  mergeNavbar: false,            // merge navbar into sidebar on small screens

  // ---- Cover page ----
  coverpage: true,               // load _coverpage.md
  coverpage: '_coverpage.md',    // custom filename
  onlyCover: false,              // hide sidebar on cover page
  coverpage: ['/', '/zh-cn/'],   // multi-language cover pages

  // ---- Page behavior ----
  maxLevel: 4,                   // maximum TOC heading level
  auto2top: true,                // scroll to top on route change
  executeScript: false,          // execute <script> in content
  noEmoji: false,                // disable emoji parsing
  noCompileLinks: false,         // keep external links unmodified
  externalLinkTarget: '_blank',
  externalLinkRel: 'noopener',
  cornerExternalLinkTarget: '_blank',

  // ---- Search (plugin) ----
  search: {
    maxAge: 86400000,
    paths: 'auto',               // 'auto' | array of paths
    placeholder: 'Type to search',
    noData: 'No Results!',
    depth: 2,
    hideOtherSidebarContent: false,
    namespace: 'my-docs',
  },

  // ---- Pagination (plugin) ----
  pagination: {
    previousText: 'PREV',
    nextText: 'NEXT',
    crossChapter: true,
    crossChapterText: true,
  },

  // ---- Tabs (plugin) ----
  tabs: { persist: true, sync: true, theme: 'material' },

  // ---- Misc ----
  themeColor: '#3F51B5',         // primary color (overrides CSS variable)
  formatUpdated: '{YYYY}/{MM}/{DD}', // last-updated date format
  notFoundPage: '_404.md',       // custom 404 page
}
\`\`\`

## Sidebar (\`_sidebar.md\`)

\`\`\`md
<!-- _sidebar.md -->
- [Home](/)
- [Getting Started](getting-started.md)
- Guide
  - [Installation](guide/installation.md)
  - [Configuration](guide/configuration.md)
  - [Advanced](guide/advanced.md)
- [API Reference](api.md)
- [Changelog](changelog.md)
\`\`\`

Rules:
- Indented items become sub-items.
- Plain text (no link) is a section header.
- Links are relative to the docs root.
- One \`_sidebar.md\` at the root applies everywhere; subdirectories can have their own.

## Navbar (\`_navbar.md\`)

\`\`\`md
<!-- _navbar.md -->
- [EN](/)
- [中文](/zh-cn/)

<!--separator-->
- Links
  - [GitHub](https://github.com/org/repo)
  - [npm](https://npmjs.com/package/my-package)
\`\`\`

## Cover page (\`_coverpage.md\`)

\`\`\`md
<!-- _coverpage.md -->
# My Docs

> A simple documentation site.

- Fast
- Searchable
- Easy to maintain

[Getting Started](getting-started.md)
[GitHub](https://github.com/org/repo)

![color](#f0f0f0)   <!-- background color or image URL -->
\`\`\`

## Themes (CDN)

Change by swapping the \`<link>\` stylesheet in \`index.html\`:

\`\`\`html
<!-- vue (default) -->
<link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
<!-- buble -->
<link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/buble.css">
<!-- dark -->
<link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/dark.css">
<!-- pure -->
<link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/pure.css">
<!-- docsify-darkly (unofficial popular theme) -->
<link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify-darkly-theme@latest/dist/style.min.css">
\`\`\`

---

# Docsify: Frontmatter

Distilled from docsifyjs/docsify (v4.x).

## Key point

**Docsify does not process YAML frontmatter by default.** Frontmatter blocks are displayed as raw Markdown (typically a table or code block) unless a plugin handles them.

## Page identity

- URL = the file path relative to the docs root. No slug customization in frontmatter.
- Page title in browser tab = the first \`# H1\` heading found in the page.
- Sidebar label = the link text in \`_sidebar.md\`, not derived from the file.

## Custom cover page (not frontmatter)

The \`_coverpage.md\` file is the cover page; it uses regular Markdown content.

## Plugin-based frontmatter

Some community plugins add frontmatter support. Example with \`docsify-front-matter\`:

\`\`\`md
---
title: Custom Page Title
keywords: docs, search
---
\`\`\`

Without such a plugin, strip frontmatter manually or the block will render visibly.

## Recommended convention

Since there is no native frontmatter, use H1 headings for page titles:

\`\`\`md
# Getting Started

Content begins here.
\`\`\`

The \`_sidebar.md\` entry controls what the page is called in navigation:
\`\`\`md
- [Getting Started](getting-started.md)
\`\`\`

## Per-directory sidebars

To scope a sidebar to a subdirectory:
1. Create \`guide/_sidebar.md\` with links relative to that directory.
2. Set \`window.$docsify.alias\` if needed to prevent the root sidebar from overriding.

Example:
\`\`\`md
<!-- guide/_sidebar.md -->
- [Back to Home](/)
- [Guide Overview](guide/)
- [Installation](guide/installation.md)
\`\`\`

---

# Docsify: Content Authoring

Distilled from docsifyjs/docsify (v4.x). Content is standard Markdown rendered at runtime.

## Page files

- Every \`.md\` file in the docs root (and subdirectories) is a routable page.
- \`README.md\` is the index page for its directory (\`/\` or \`/guide/\`).
- URLs: \`docs/guide/installation.md\` → \`/#/guide/installation\`.

## Standard Markdown

All CommonMark Markdown is supported. No compile step means no MDX or JSX.

\`\`\`md
# Heading 1

Regular paragraphs, **bold**, _italic_, \`inline code\`.

[Link text](other-page.md)    <!-- relative links work natively -->
[External](https://example.com)

![alt text](/_media/image.png)

| Column A | Column B |
|---|---|
| value    | value    |

> Blockquote for callouts (no admonition plugin by default).

- Unordered list
- Item 2

1. Ordered list
2. Item 2

\`\`\`js
console.log('fenced code block');
\`\`\`
\`\`\`

## Code highlighting

Docsify auto-loads Prism.js. Highlight languages by fencing with the language name:

\`\`\`md
\`\`\`python
def greet(name):
    return f"Hello, {name}"
\`\`\`
\`\`\`

To add extra Prism languages, include them in \`index.html\` before the docsify script:
\`\`\`html
<script src="//cdn.jsdelivr.net/npm/prismjs@1/components/prism-bash.min.js"></script>
\`\`\`

## Linking between pages

\`\`\`md
[Relative link](guide/installation.md)
[Anchor on this page](#section-heading)
[Anchor on another page](guide/installation.md#requirements)
\`\`\`

Docsify rewrites relative \`.md\` links to hash routes automatically.

## Images and media

\`\`\`md
![Logo](/_media/logo.png)
<!-- Serve assets from the docs/ root; /_media/ is a common convention -->
\`\`\`

## Embedding HTML

Since content renders at runtime in the browser, HTML in Markdown works:
\`\`\`html
<div class="tip">This is a tip.</div>
\`\`\`

## Admonitions (plugin)

No built-in admonition syntax. Add the \`docsify-plugin-flexible-alerts\` plugin for:
\`\`\`md
> [!NOTE]
> This is a note.

> [!TIP]
> This is a tip.

> [!WARNING]
> This is a warning.

> [!DANGER]
> This is a danger alert.
\`\`\`

Requires adding the plugin script to \`index.html\`.

## Tabs (plugin)

With \`docsify-tabs\` plugin:
\`\`\`md
<!-- tabs:start -->
#### **Tab One**
Content for tab one.

#### **Tab Two**
Content for tab two.
<!-- tabs:end -->
\`\`\`

## Search

The built-in search plugin indexes all pages. Enable in \`index.html\`:
\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify@4/lib/plugins/search.min.js"></script>
\`\`\`

Configure in \`window.$docsify\`:
\`\`\`js
search: {
  maxAge: 86400000,
  paths: 'auto',
  placeholder: 'Type to search',
  noData: 'No Results!',
  depth: 2,
}
\`\`\`

## Pagination (plugin)

Add \`docsify-pagination\` for prev/next navigation:
\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify-pagination/dist/docsify-pagination.min.js"></script>
\`\`\`

## Notes

- No YAML frontmatter support by default. Use H1 headings for page titles.
- Content is XHR-fetched at runtime — keep files small for fast loads.
- All plugins are added as \`<script>\` tags in \`index.html\`; there is no bundler config.
- For SEO, consider docsify-ssr or a prerender service (Docsify has no static HTML output).

---

# Docsify: Components and Plugins

Distilled from docsifyjs/docsify (v4.x). Docsify has no compiled component system; all
"components" are either raw HTML/Markdown patterns or optional plugins added via CDN scripts.

## Core patterns (no plugin required)

### Callouts / blockquotes

No built-in admonition component. Use blockquotes for emphasis:
\`\`\`md
> **Note:** This is important.

> **Warning:** Be careful here.
\`\`\`

Or use HTML:
\`\`\`html
<div style="border-left: 4px solid #4CAF50; padding: 10px; background: #f9f9f9;">
  This is a tip.
</div>
\`\`\`

### Badges

Use external badge services (no built-in component):
\`\`\`md
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
\`\`\`

### Details/accordion

Standard HTML works:
\`\`\`html
<details>
  <summary>Click to expand</summary>
  Hidden content here.
</details>
\`\`\`

## Plugins (add script tags to \`index.html\`)

### Flexible alerts (admonitions)

\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify-plugin-flexible-alerts"></script>
\`\`\`

Usage:
\`\`\`md
> [!NOTE]
> A note.

> [!TIP]
> A tip.

> [!WARNING]
> A warning.

> [!DANGER]
> Danger!
\`\`\`

### Tabs

\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify-tabs@1"></script>
\`\`\`

Config in \`window.$docsify\`:
\`\`\`js
tabs: { persist: true, sync: true, theme: 'material' }
\`\`\`

Usage:
\`\`\`md
<!-- tabs:start -->
#### **npm**
\`\`\`sh
npm install my-package
\`\`\`

#### **yarn**
\`\`\`sh
yarn add my-package
\`\`\`
<!-- tabs:end -->
\`\`\`

### Copy code button

\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify-copy-code/dist/docsify-copy-code.min.js"></script>
\`\`\`

No config needed; adds a copy button to all fenced code blocks automatically.

### Pagination (prev/next)

\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify-pagination/dist/docsify-pagination.min.js"></script>
\`\`\`

Config:
\`\`\`js
pagination: {
  previousText: 'PREV',
  nextText: 'NEXT',
  crossChapter: true,
}
\`\`\`

### Edit on GitHub

\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify-edit-on-github"></script>
\`\`\`

Config:
\`\`\`js
plugins: [
  EditOnGithubPlugin.create('https://github.com/org/repo/blob/main/docs/')
]
\`\`\`

### Zoom images

\`\`\`html
<script src="//cdn.jsdelivr.net/npm/docsify@4/lib/plugins/zoom-image.min.js"></script>
\`\`\`

All images become click-to-zoom by default. Exclude with \`<!-- {docsify-ignore} -->\` after the image.

### Mermaid diagrams

\`\`\`html
<script src="//cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script src="//cdn.jsdelivr.net/npm/docsify-mermaid@latest/dist/docsify-mermaid.js"></script>
\`\`\`

Config:
\`\`\`js
mermaid: { startOnLoad: true }
\`\`\`

Usage:
\`\`\`md
\`\`\`mermaid
graph TD;
  A-->B;
  B-->C;
\`\`\`
\`\`\`

## Theme customization

Override CSS variables in \`index.html\` or a custom CSS file:
\`\`\`css
:root {
  --theme-color: #3F51B5;
  --sidebar-width: 300px;
  --content-max-width: 900px;
}
\`\`\`

Link a custom stylesheet:
\`\`\`html
<link rel="stylesheet" href="/custom.css">
\`\`\`

## Notes

- There is no component import syntax (no JSX, no MDX).
- All enhancements are opt-in plugins loaded via CDN \`<script>\` tags in \`index.html\`.
- Plugin configuration goes in the \`window.$docsify\` object (see \`configuration.md\`).
- Docsify's plugin API allows custom plugins via \`window.$docsify.plugins\` array, but
  third-party CDN plugins are the common path.`
// @generated-end docs-contracts/docsify-contract

// @generated-start docs-contracts/frameworks
// SPLICE FRAGMENT — single source of truth for the framework-aware docs substrate.
//
// This file is NOT standalone-valid JS. It is inlined verbatim by
// scripts/build-docs-contracts.mjs between the docs-contracts/frameworks generated markers
// into .claude/workflows/docs-create.js and docs-from-code.js. (The marker strings are
// intentionally NOT repeated here: a verbatim copy of an end-marker inside the block would
// make the build splice match the wrong boundary.) It references symbols that
// exist in the HOST workflow's scope, not here:
//   - CONTRACT and the per-framework <FW>_CONTRACT consts (generated contract blocks above this one)
//   - the agent() and log() workflow globals
// Edit HERE, then run: node scripts/build-docs-contracts.mjs  (npm run check enforces no drift).
//
// Contents: CROSSWALK + getCrosswalkColumn + STARLIGHT_LEAK_PATTERNS + the FRAMEWORKS registry
// (13 frameworks) + resolveLinksAndAssets. The build-repair loop (runBuildRepairLoop) stays in
// docs-create.js — it is that workflow's orchestration, not shared substrate.

// --- CROSSWALK: framework-neutral intent -> syntax map ----------------------------------------
// Maps each documentation construct (by intent) to the correct syntax per framework.
// Inject ONLY the active framework's column into author + gate prompts (slice-per-agent rule).
// "filled" frameworks below have confirmed syntax; unfilled entries are null (fall back to docs).
//
// Constructs covered:
//   callout   - information callout / admonition
//   tabs      - tabbed content switcher
//   steps     - numbered sequential procedure
//   card      - highlighted content card block
//   filetree  - annotated directory/file tree
//   code-title - code block with a visible filename/title label
//
// Usage: getCrosswalkColumn(framework) -> string to inject into an author prompt.
// The quality gate also uses this to check for syntax leaks (e.g. <Aside in a mkdocs page).
const CROSSWALK = {
  callout: {
    starlight:  ':::note / :::tip / :::caution / :::danger  (or <Aside type="note|tip|caution|danger"> in .mdx)',
    docusaurus: ':::note / :::tip / :::info / :::warning / :::danger  (CommonMark-adjacent; no import needed)',
    mkdocs:     '!!! note "Optional title" / !!! tip / !!! warning / !!! danger  (Material admonition)',
    vitepress:  '::: info / ::: tip / ::: warning / ::: danger  (followed by content, closed with :::)',
    // frameworks without a confirmed callout short-form (authors consult official docs):
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  tabs: {
    starlight:  '<Tabs syncKey?="pkg"><TabItem label="npm">...</TabItem></Tabs>  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: '<Tabs><TabItem value="npm" label="npm">...</TabItem></Tabs>  (.mdx, import from @docusaurus/theme-common)',
    mkdocs:     '=== "Tab 1"\n    content\n=== "Tab 2"\n    content  (Material tabbed extension, no import)',
    vitepress:  'No native tabs — use <script setup> + component or a custom VitePress plugin',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  steps: {
    starlight:  '<Steps> wrapping a markdown ordered list (1. 2. 3.)  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: 'Plain markdown ordered list (1. 2. 3.) — no special wrapper needed; Docusaurus renders them as steps.',
    mkdocs:     'Plain markdown ordered list (1. 2. 3.); no dedicated steps component in Material.',
    vitepress:  'Plain markdown ordered list (1. 2. 3.); no dedicated steps component.',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  card: {
    starlight:  '<Card title="..." icon?="...">content</Card> inside <CardGrid stagger?>  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: 'No native Card component — use a custom component or admonition with :::tip as a visual workaround.',
    mkdocs:     'No native card — use Material grid cards: <div class="grid cards" markdown> ... </div> (requires grid plugin).',
    vitepress:  'No native card — use a custom Vue component or style a <div class="custom-block tip">.',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  filetree: {
    starlight:  '<FileTree> wrapping a markdown nested list  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: 'No native FileTree — use a code block with bash/text language and indentation to represent structure.',
    mkdocs:     'No native FileTree — use a code block with bash language and indentation.',
    vitepress:  'No native FileTree — use a code block with a bash/text language label.',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  'code-title': {
    starlight:  'Fenced code block with title="filename.js" attribute: ```js title="src/util.js"',
    docusaurus: 'Fenced code block with title="filename.js" meta: ```js title="src/util.js"',
    mkdocs:     'Fenced code block with title added via Material\'s annotations or code block title feature: ``` js title="src/util.js"',
    vitepress:  'Fenced code block with filename label in the info string: ```js [filename.js]  (or use codegroup feature for multiple)',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
}

// getCrosswalkColumn: returns the slice of CROSSWALK for the given framework as an injected string.
// Null entries are omitted (author consults framework docs for those constructs).
// leakPatterns: Starlight-specific patterns that must NOT appear in non-Starlight output.
function getCrosswalkColumn(fw) {
  const lines = []
  for (const [construct, fwMap] of Object.entries(CROSSWALK)) {
    const syntax = fwMap[fw]
    if (syntax) lines.push(`  ${construct}: ${syntax}`)
  }
  if (!lines.length) return null
  return `COMPONENT CROSSWALK for ${fw} (authoritative per-construct syntax — use these, not Starlight syntax):\n${lines.join('\n')}`
}

// Starlight-specific syntax patterns that indicate a syntax leak into other frameworks.
// The quality gate uses these to detect and reject pages that incorrectly include Starlight syntax.
const STARLIGHT_LEAK_PATTERNS = [
  `@astrojs/starlight`,
  `<Aside`,
  `<Card`,
  `<CardGrid`,
  `<FileTree`,
  `<Steps`,
  `<Tabs`,
  `<TabItem`,
  `<LinkCard`,
  `<LinkButton`,
  `<Badge`,
]

// --- FRAMEWORKS registry -----------------------------------------------------------------------
// Single source of truth keyed by framework id. Each entry covers everything a docs-create run
// needs to be framework-aware without branching on strings throughout the script.
//
// Schema per entry:
//   contentRoot    — where page files live (relative to outDir)
//   configFiles    — the config files this framework uses (so the verify stage knows what to write)
//   contract       — inline authoring contract text (authoritative runtime source; null = no inline contract)
//   assemblePrompt — instructions the verify/finalize agent uses to write or update the primary config
//                    (injected into the verify prompt so per-framework config assembly logic lives here;
//                     covers steps 2-3 only; the empirical build gate is scripted via runBuildRepairLoop)
//   validate       — empirical build check: { buildCmd(outDir, scaffoldMode) -> string|null,
//                    parseErrors(stderr) -> string[] }
//                    buildCmd returns the shell command to run (null = not runnable for this framework),
//                    parseErrors extracts human-readable error lines from stderr/stdout.
//                    null validate = no empirical check at all (legacy sentinel for unrecognized frameworks).
//                    parseErrors is consumed by runBuildRepairLoop (defined near the top of this file).
//
// Only Starlight is fully populated. Other frameworks fall back to their refsDir skeletons and
// current-docs lookups (context7/find-docs). Add a new entry — populate all five keys — before
// using a framework id in a run; a missing `contract` means authors get the "no inline contract"
// fallback warning. The sentinel key "_unfilled" is the runtime fallback for any unrecognised
// framework id; do NOT name a real framework "_unfilled".
const FRAMEWORKS = {
  starlight: {
    contentRoot: 'src/content/docs',
    // assetDir: where authored assets (images, diagrams) are placed relative to outDir.
    // resolveLinksAndAssets copies files here and rewrites src/href paths in page content.
    assetDir: 'src/assets',
    configFiles: ['astro.config.mjs', 'src/content.config.ts'],
    // CONTRACT is defined above; bound here so callers reach it through the registry.
    contract: CONTRACT,
    // assemblePrompt covers steps 2-3 (config writing). The empirical build gate is scripted
    // separately (runBuildRepairLoop); assemblePrompt does NOT include a build step.
    // scaffoldMode routing:
    //   content-only (default): write content + config; empirical check skipped unless already buildable.
    //   add-to-existing: same as content-only but SKIP writing astro.config if one already exists.
    //   full-project: scaffold a complete buildable project (package.json + npm install) then run astro check.
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning, site } = opts
      // basePath -> Astro top-level `base` option in defineConfig (e.g. base: '/docs').
      const baseNote = basePath
        ? `   Set base: '${basePath}' in the defineConfig() call (outside starlight()); this makes Astro prefix all routes with the subpath.\n`
        : ''
      // site -> Astro top-level `site` option. Starlight auto-adds @astrojs/sitemap, which requires it;
      // also sets canonical URLs. Without it the build warns and skips the sitemap (non-fatal).
      const siteNote = site
        ? `   Set site: '${site}' in the defineConfig() call (top-level, alongside integrations); required for the sitemap Starlight generates and for canonical URLs.\n`
        : ''
      // i18n -> Starlight locales config (defaultLocale + locales map).
      const i18nNote = i18n
        ? `   Add a locales block inside starlight(): defaultLocale: '${i18n.defaultLocale}', ` +
          `locales: { ${i18n.locales.map(l => `'${l}': { label: '${l}' }`).join(', ')} }. ` +
          `Create src/content/docs/<locale>/ dirs for each locale.\n`
        : ''
      // Starlight has no built-in versioning; note it and skip.
      const versioningNote = versioning
        ? `   NOTE: Starlight has no built-in versioning support. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use community plugins or manual subpath routing if needed.\n`
        : ''
      return (
        `2. Ensure the content collection exists: write ${outDir}/src/content.config.ts with docsLoader()+docsSchema() if missing.\n` +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE (do NOT clobber) ${outDir}/astro.config.mjs: patch the sidebar to reflect the page groups ` +
            `(${groups}). Use slug items for the admitted pages. Derive a title from the brief only if one is missing. ` +
            `If no astro.config exists, create one.\n`
          : `3. Assemble ${outDir}/astro.config.mjs: a starlight() integration whose sidebar reflects the page groups ` +
            `(${groups}). Use slug items for the admitted pages. Derive a title from the brief. ` +
            `If an astro.config already exists, update its sidebar/title rather than clobbering unrelated config.\n`) +
        baseNote + siteNote + i18nNote + versioningNote
      )
    },
    // validate: per-framework empirical build gate. buildCmd returns the shell command to run;
    // parseErrors extracts actionable error lines from build output for the repair loop.
    // prerequisiteNote: checked by runBuildRepairLoop's haiku bash-agent to decide when to skip.
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          // full-project scaffolds first then runs check
          return `npm install --prefix "${outDir}" && npx astro check --root "${outDir}"`
        }
        // content-only / add-to-existing: only run if already installable
        return `npx astro check --root "${outDir}"`
      },
      // prerequisiteNote: used by the bash-agent in runBuildRepairLoop to know when to skip.
      prerequisiteNote: 'has package.json with astro dependency and node_modules present',
      // parseErrors: extract type-check and config error lines from astro check output.
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|✗|✘|cannot|Cannot|failed|Failed/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },
  // --- Docusaurus (facebook/docusaurus v3.x) ----------------------------------------------------
  // Content lives in docs/ (markdown) and src/pages/ (React/MDX standalone pages).
  // Config: docusaurus.config.js + sidebars.js at project root.
  // No inline contract: authors fetch current Docusaurus docs via find-docs/context7.
  docusaurus: {
    contentRoot: 'docs',
    assetDir: 'static',
    configFiles: ['docusaurus.config.js', 'sidebars.js'],
    contract: DOCUSAURUS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Docusaurus `baseUrl` in docusaurus.config.js.
      const baseNote = basePath
        ? `   Set baseUrl: '${basePath}' in docusaurus.config.js (the subpath the site is served under).\n`
        : ''
      // i18n -> Docusaurus i18n config block.
      const i18nNote = i18n
        ? `   Add an i18n block to docusaurus.config.js: { defaultLocale: '${i18n.defaultLocale}', ` +
          `locales: [${i18n.locales.map(l => `'${l}'`).join(', ')}] }. ` +
          `Create i18n/<locale>/docusaurus-plugin-content-docs/current/ dirs for each locale.\n`
        : ''
      // versioning -> Docusaurus versions config.
      const versioningNote = versioning
        ? `   Add docs.versions to the preset config: { current: { label: '${versioning.current}' }` +
          (versioning.versions.length ? `, ${versioning.versions.map(v => `'${v}': { label: '${v}' }`).join(', ')}` : '') +
          ` }. Also set docs.lastVersion: '${versioning.current}'.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) ${outDir}/sidebars.js: patch the sidebar to reflect the page groups ` +
            `(${groups}). Use doc-id or category items. Derive a title only if missing.\n`
          : `2. Write or repair ${outDir}/sidebars.js: a tutorialSidebar (or named per the brief) that groups ` +
            `the admitted pages (${groups}) using category + doc items. ` +
            `If it already exists, update categories/items rather than clobbering unrelated config.\n`) +
        `3. Ensure ${outDir}/docusaurus.config.js exists with title, url, baseUrl, presets: [['classic', {docs:{sidebarPath:'./sidebars.js'}}]]. ` +
        `Update title/sidebar only if already present; never clobber unrelated themeConfig.\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx docusaurus build --out-dir "${outDir}/build" "${outDir}"`
        }
        return `npx docusaurus build --out-dir "${outDir}/build" "${outDir}"`
      },
      prerequisiteNote: 'has package.json with @docusaurus/core and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|\[ERROR\]|failed|Failed|SyntaxError|Cannot/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- MkDocs + Material (v9.x) ----------------------------------------------------------------
  // Content lives in docs/. Config: mkdocs.yml at project root.
  // No inline contract: authors fetch current MkDocs Material docs via find-docs/context7.
  mkdocs: {
    contentRoot: 'docs',
    // MkDocs: assets live alongside content (docs/assets/); relative links work from any page.
    assetDir: 'docs/assets',
    configFiles: ['mkdocs.yml'],
    contract: MKDOCS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> MkDocs site_url (the canonical URL prefix; controls absolute link generation).
      const baseNote = basePath
        ? `   Set site_url: '${basePath}' in mkdocs.yml so absolute links and the sitemap use the correct subpath.\n`
        : ''
      // i18n -> MkDocs i18n plugin (mkdocs-material extra: i18n, or the mkdocs-i18n plugin).
      const i18nNote = i18n
        ? `   Add the i18n plugin to mkdocs.yml: plugins: [i18n: {default_language: '${i18n.defaultLocale}', ` +
          `languages: { ${i18n.locales.map(l => `${l}: { name: '${l}', build: true }`).join(', ')} } }]. ` +
          `Requires mkdocs-material or the mkdocs-i18n package.\n`
        : ''
      // versioning -> mike (the MkDocs versioning tool).
      const versioningNote = versioning
        ? `   NOTE: MkDocs versioning is handled by the 'mike' tool, not by mkdocs.yml config. ` +
          `Add 'mike' to the plugins list so the version switcher appears (current="${versioning.current}"). ` +
          `Run: mike deploy ${versioning.current} latest --update-aliases after building.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) ${outDir}/mkdocs.yml: patch the nav section to reflect the page groups ` +
            `(${groups}). Preserve existing theme, plugins, and markdown_extensions blocks.\n`
          : `2. Write or repair ${outDir}/mkdocs.yml: include site_name (from the brief), theme: {name: material}, ` +
            `and a nav section mapping the page groups (${groups}) to their files. ` +
            `If it already exists, update site_name and nav only.\n`) +
        `3. (no content-collection step for MkDocs.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `pip install mkdocs mkdocs-material 2>&1 | tail -1 && mkdocs build --strict -f "${outDir}/mkdocs.yml"`
        }
        // --strict promotes warnings (missing nav pages, broken links) to errors
        return `mkdocs build --strict -f "${outDir}/mkdocs.yml"`
      },
      prerequisiteNote: 'mkdocs binary available and mkdocs.yml exists in outDir',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /ERROR|WARNING.*not found|error|Failed/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- VitePress (v1.x) -------------------------------------------------------------------------
  // Content lives in docs/ (or the srcDir configured in .vitepress/config.mts).
  // Config: docs/.vitepress/config.mts at project root.
  // No inline contract: authors fetch current VitePress docs via find-docs/context7.
  vitepress: {
    contentRoot: 'docs',
    // VitePress: public/ for global assets; docs/public/ is aliased to the site root.
    assetDir: 'docs/public',
    configFiles: ['docs/.vitepress/config.mts'],
    contract: VITEPRESS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> VitePress `base` in defineConfig (served under a subpath).
      const baseNote = basePath
        ? `   Set base: '${basePath}' in defineConfig() so all assets and links are prefixed with the subpath.\n`
        : ''
      // i18n -> VitePress locales config object.
      const i18nNote = i18n
        ? `   Add a locales object to defineConfig(): { root: { label: '${i18n.defaultLocale}', lang: '${i18n.defaultLocale}' }, ` +
          `${i18n.locales.filter(l => l !== i18n.defaultLocale).map(l => `'/${l}/': { label: '${l}', lang: '${l}' }`).join(', ')} }. ` +
          `Create docs/<locale>/ directories for each non-default locale.\n`
        : ''
      // VitePress has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: VitePress has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a multi-dir approach (docs/v1/, docs/v2/) if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) ${outDir}/docs/.vitepress/config.mts: patch themeConfig.sidebar to reflect ` +
            `the page groups (${groups}). Preserve nav, socialLinks, and other themeConfig keys.\n`
          : `2. Write or repair ${outDir}/docs/.vitepress/config.mts: a defineConfig with title (from the brief), ` +
            `description, and themeConfig.sidebar reflecting the page groups (${groups}) as grouped items with text+link. ` +
            `If it already exists, update title and sidebar only.\n`) +
        `3. (no content-collection step for VitePress.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx vitepress build docs --root "${outDir}"`
        }
        return `npx vitepress build docs --root "${outDir}"`
      },
      prerequisiteNote: 'has package.json with vitepress devDependency and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|\[vitepress\].*warn|dead link|ENOENT/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Fumadocs (fuma-nama/fumadocs v14.x) -----------------------------------------------------
  // Content lives in content/docs/ as .mdx files. No single config file — config is spread across
  // source.config.ts, app/docs/[[...slug]]/page.tsx, layout.tsx, and lib/source.ts.
  // Nav order controlled by meta.json files (not frontmatter).
  // No inline contract: authors fetch current Fumadocs docs via find-docs/context7.
  fumadocs: {
    contentRoot: 'content/docs',
    assetDir: 'public',
    configFiles: ['source.config.ts', 'lib/source.ts'],
    contract: FUMADOCS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Next.js basePath in next.config.mjs (Fumadocs runs on Next.js).
      const baseNote = basePath
        ? `   Add basePath: '${basePath}' to the Next.js config in ${outDir}/next.config.mjs so all routes are prefixed.\n`
        : ''
      // i18n -> Next.js i18n config in next.config.mjs.
      const i18nNote = i18n
        ? `   Add i18n: { defaultLocale: '${i18n.defaultLocale}', locales: [${i18n.locales.map(l => `'${l}'`).join(', ')}] } ` +
          `to the Next.js config in ${outDir}/next.config.mjs. Create app/[lang]/docs/ layout for locale routing.\n`
        : ''
      // Fumadocs has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: Fumadocs has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a route-prefix approach (content/docs/v1/, v2/) if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE meta.json files in each content/docs/ subdirectory to reflect the page groups ` +
            `(${groups}). Each meta.json controls the sidebar order for its directory via the "pages" array.\n`
          : `2. For each page group (${groups}), write or update the meta.json in its content/docs/<group>/ directory. ` +
            `Each meta.json: {"title":"<group>","pages":[...filenames without ext...],"defaultOpen":true}. ` +
            `Ensure source.config.ts exists with defineDocs({dir:'content/docs'}) if missing.\n`) +
        `3. (Fumadocs uses Next.js app router — no single sidebar config file; structure flows from meta.json.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx next build "${outDir}"`
        }
        return `npx next build "${outDir}"`
      },
      prerequisiteNote: 'has package.json with next and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|Failed to compile|Type error|✗/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- mdBook (rust-lang/mdBook v0.4.x) --------------------------------------------------------
  // Content lives in src/. SUMMARY.md (required) defines the entire chapter structure.
  // Config: book.toml at project root. No frontmatter processing by default.
  // No inline contract: authors fetch current mdBook docs via find-docs/context7.
  mdbook: {
    contentRoot: 'src',
    // mdBook: images referenced relatively from src/ live alongside chapter files; src/images/ is convention.
    assetDir: 'src/images',
    configFiles: ['book.toml', 'src/SUMMARY.md'],
    contract: MDBOOK_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> mdBook [output.html] site-url.
      const baseNote = basePath
        ? `   Set site-url = '${basePath}' under [output.html] in book.toml so absolute links use the correct subpath.\n`
        : ''
      // mdBook has limited i18n support; note it.
      const i18nNote = i18n
        ? `   NOTE: mdBook has no built-in i18n. Internationalization (defaultLocale="${i18n.defaultLocale}") is noted ` +
          `but NOT configured — use separate book.toml per language or the mdbook-i18n-helpers crate if needed.\n`
        : ''
      // mdBook has no versioning; note it.
      const versioningNote = versioning
        ? `   NOTE: mdBook has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use subpath deployments (e.g. /v1/, /v2/) if needed.\n`
        : ''
      return (
        `2. Write or repair ${outDir}/src/SUMMARY.md: the required navigation definition. ` +
        `List every admitted page as "- [Title](path/to/file.md)" organized under Part headers (# Part) ` +
        `reflecting the page groups (${groups}). Prefix chapters (before the first list) for any intro/overview pages.\n` +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE (do NOT clobber) ${outDir}/book.toml: patch [book] title only if missing. ` +
            `Preserve all other toml sections.\n`
          : `3. Write or repair ${outDir}/book.toml: [book] with title (from the brief), language="en", src="src". ` +
            `Add [output.html] with git-repository-url if the brief mentions a repo. ` +
            `If it already exists, update [book].title only.\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      // mdbook is a binary (cargo install mdbook); no npm/pip prerequisite.
      buildCmd: (outDir, _scaffoldMode) => `mdbook build "${outDir}"`,
      prerequisiteNote: 'mdbook binary available (install via cargo or prebuilt release)',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /\[ERROR\]|\[WARN\].*missing|error\[|panicked|SUMMARY\.md/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Docsify (docsifyjs/docsify v4.x) --------------------------------------------------------
  // Content lives at the docs root (no subfolder convention). Navigation via _sidebar.md.
  // Config lives entirely in index.html (window.$docsify object). No frontmatter support by default.
  // No inline contract: authors fetch current Docsify docs via find-docs/context7.
  docsify: {
    contentRoot: '.',
    assetDir: '_media',
    configFiles: ['index.html', '_sidebar.md'],
    contract: DOCSIFY_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Docsify window.$docsify.basePath option.
      const baseNote = basePath
        ? `   Set basePath: '${basePath}' in window.$docsify config in index.html.\n`
        : ''
      // Docsify has limited i18n; note it.
      const i18nNote = i18n
        ? `   NOTE: Docsify has no official i18n plugin. Internationalization (defaultLocale="${i18n.defaultLocale}") is noted ` +
          `but NOT configured — use separate index.html + _sidebar.md per locale in subfolders if needed.\n`
        : ''
      // Docsify has no versioning; note it.
      const versioningNote = versioning
        ? `   NOTE: Docsify has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a dropdown navbar or subpath deploy if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/_sidebar.md: patch the navigation to reflect the page groups ` +
            `(${groups}). Preserve any existing entries unrelated to the admitted pages.\n`
          : `2. Write or repair ${outDir}/_sidebar.md: a Docsify sidebar listing all admitted pages ` +
            `grouped by section (plain text heading, no link, followed by indented "- [Title](path.md)" items). ` +
            `Groups: ${groups}. Include a "- [Home](/)" link at the top.\n`) +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE ${outDir}/index.html: patch window.$docsify.name if missing; ` +
            `ensure loadSidebar: true is set. Do NOT clobber other config or CDN script tags.\n`
          : `3. Write or repair ${outDir}/index.html: a minimal Docsify bootstrap with ` +
            `window.$docsify = {name: '<title from brief>', loadSidebar: true, subMaxLevel: 2, repo: ''}. ` +
            `Include CDN scripts for docsify v4. If it already exists, patch name/loadSidebar only.\n`) +
        // Step 4 (empirical build check) is scripted — runBuildRepairLoop returns "skipped" for Docsify
        // because buildCmd returns null. No step 4 needed here.
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      // Docsify is client-side only; no build command.
      buildCmd: (_outDir, _scaffoldMode) => null,
      skipReason: 'docsify has no build step (client-side SPA)',
      parseErrors: (_output) => [],
    },
  },

  // --- Sphinx (sphinx-doc/sphinx v8.x + MyST-Parser for Markdown) --------------------------------
  // Content lives in docs/ as .rst or .md (with MyST-Parser). Config: docs/conf.py at project root.
  // Navigation controlled by toctree directives embedded in index.rst / index.md.
  // No inline contract: authors fetch current Sphinx docs via find-docs/context7.
  sphinx: {
    contentRoot: 'docs',
    assetDir: 'docs/_static',
    configFiles: ['docs/conf.py', 'docs/index.rst'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Sphinx html_baseurl in conf.py (used by the sitemap extension).
      const baseNote = basePath
        ? `   Set html_baseurl = '${basePath}' in conf.py so the canonical sitemap uses the correct subpath.\n`
        : ''
      // i18n -> Sphinx language setting and gettext extraction.
      const i18nNote = i18n
        ? `   Set language = '${i18n.defaultLocale}' in conf.py. For additional locales ` +
          `(${i18n.locales.filter(l => l !== i18n.defaultLocale).join(', ')}), ` +
          `note that Sphinx i18n uses gettext: run 'make gettext' then 'sphinx-intl update -p _build/gettext -l <locale>' ` +
          `to generate per-locale .po files. Document the commands in the README.\n`
        : ''
      // versioning -> Sphinx version/release in conf.py.
      const versioningNote = versioning
        ? `   Set version = '${versioning.current}' and release = '${versioning.current}' in conf.py. ` +
          (versioning.versions.length ? `Prior versions: ${versioning.versions.join(', ')} — use separate Sphinx builds or sphinx-multiversion for a version switcher.\n` : '\n')
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/docs/index.rst (or index.md): patch the toctree directive to include ` +
            `the admitted pages (${groups}). Preserve all existing toctree entries and directives.\n`
          : `2. Write or repair ${outDir}/docs/index.rst: a root document with a toctree listing the admitted ` +
            `pages organized by group (${groups}). Use :maxdepth: 2 and :caption: per group. ` +
            `If an index already exists, add missing toctree entries without removing existing ones.\n`) +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE ${outDir}/docs/conf.py: patch project/author/release only if missing. ` +
            `Preserve existing extensions, html_theme, and other settings.\n`
          : `3. Write or repair ${outDir}/docs/conf.py: set project (from the brief), author, release, ` +
            `extensions = ['myst_parser', 'sphinx.ext.autodoc', 'sphinx.ext.viewcode'], ` +
            `html_theme = 'furo' (or 'sphinx_rtd_theme'), source_suffix = {'.rst':'restructuredtext','.md':'markdown'}. ` +
            `If it already exists, update project/author only.\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `pip install sphinx furo myst-parser 2>&1 | tail -1 && sphinx-build -W -b html "${outDir}/docs" "${outDir}/docs/_build/html"`
        }
        // -W promotes warnings to errors for stricter checking
        return `sphinx-build -W -b html "${outDir}/docs" "${outDir}/docs/_build/html"`
      },
      prerequisiteNote: 'sphinx-build available and docs/conf.py exists in outDir',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /WARNING:|ERROR:|Exception|error:/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Nextra (shuding/nextra v3.x) -------------------------------------------------------------
  // Next.js-based docs framework. Content lives in pages/ (v2) or content/ (v3) as .mdx.
  // Config: theme.config.tsx (Nextra docs theme) + next.config.mjs at project root.
  // No inline contract: authors fetch current Nextra docs via find-docs/context7.
  nextra: {
    contentRoot: 'content',
    assetDir: 'public',
    configFiles: ['next.config.mjs', 'theme.config.tsx'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Next.js basePath in next.config.mjs.
      const baseNote = basePath
        ? `   Add basePath: '${basePath}' to the Next.js config in ${outDir}/next.config.mjs.\n`
        : ''
      // i18n -> Next.js i18n config.
      const i18nNote = i18n
        ? `   Add i18n: { defaultLocale: '${i18n.defaultLocale}', locales: [${i18n.locales.map(l => `'${l}'`).join(', ')}] } ` +
          `to the Next.js config in ${outDir}/next.config.mjs.\n`
        : ''
      // Nextra has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: Nextra has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a content version subpath approach if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE _meta files in each content/ subdirectory to reflect the page groups ` +
            `(${groups}). Each _meta.{js|ts|json} controls sidebar order for its directory.\n`
          : `2. For each page group (${groups}), write or update the _meta.ts file in its content/<group>/ directory. ` +
            `Each _meta.ts exports a default object mapping filenames (without ext) to their display titles. ` +
            `The root content/_meta.ts should list the top-level sections in order.\n`) +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE ${outDir}/theme.config.tsx: patch docsRepositoryBase, project.link, and logo only if missing. ` +
            `Preserve existing navigation and footer configuration.\n`
          : `3. Write or repair ${outDir}/theme.config.tsx: export default { docsRepositoryBase: '', ` +
            `project: { link: '' }, logo: <b>title from brief</b>, useNextSeoProps() { return { titleTemplate: '%s - <title>' } } }. ` +
            `Ensure ${outDir}/next.config.mjs wraps the config with nextra({theme: 'nextra-theme-docs', themeConfig: './theme.config.tsx'}).\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx next build "${outDir}"`
        }
        return `npx next build "${outDir}"`
      },
      prerequisiteNote: 'has package.json with next and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|Failed to compile|Type error|✗/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Mintlify (mintlify/mintlify v4.x) -------------------------------------------------------
  // SaaS-hosted docs platform. Content lives in the repo root (or a configured directory) as .mdx.
  // Config: mint.json (or docs.json in newer versions) at the repo root.
  // No inline contract: authors fetch current Mintlify docs via find-docs/context7.
  mintlify: {
    contentRoot: '.',
    assetDir: 'images',
    configFiles: ['mint.json'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // Mintlify has no configurable basePath in mint.json; SaaS routing controls it.
      const baseNote = basePath
        ? `   NOTE: Mintlify is SaaS-hosted; basePath ("${basePath}") is set in the Mintlify dashboard, ` +
          `not in mint.json. No config key to write here.\n`
        : ''
      // Mintlify localization.
      const i18nNote = i18n
        ? `   Add "localization": { "defaultLocale": "${i18n.defaultLocale}", "locales": [${i18n.locales.map(l => `"${l}"`).join(', ')}] } ` +
          `to mint.json. Create <locale>/ directories for translated pages.\n`
        : ''
      // Mintlify versioning.
      const versioningNote = versioning
        ? `   NOTE: Mintlify versioning is SaaS-managed. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured in mint.json — use version tags in the Mintlify dashboard.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/mint.json: patch the "navigation" array to include the admitted page groups ` +
            `(${groups}). Each group is {"group":"<name>","pages":["path/to/page",...]}. ` +
            `Preserve existing groups and the name/logo/colors blocks.\n`
          : `2. Write or repair ${outDir}/mint.json: include name (from the brief), logo (object with light/dark paths or omit), ` +
            `colors (primary, light, dark), and a navigation array grouping the admitted pages (${groups}). ` +
            `Each navigation entry: {"group":"<group>","pages":["<path without .mdx>",...]}. ` +
            `If it already exists, update name and navigation only.\n`) +
        `3. (Mintlify content-collection step not applicable — mint.json is the sole config.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      // mintlify CLI: `npx mintlify dev` starts a local server; no static build output.
      // Use `mintlify broken-links` for a headless check when available.
      buildCmd: (_outDir, _scaffoldMode) => null,
      skipReason: 'mintlify is SaaS-hosted; no offline build step (use mintlify CLI for local preview)',
      parseErrors: (_output) => [],
    },
  },

  // --- Docsy (google/docsy Hugo theme v0.11.x) -------------------------------------------------
  // Hugo-based documentation theme. Content lives in content/en/ as .md or .html.
  // Config: hugo.toml (or config.toml) at project root; Docsy module in go.mod.
  // No inline contract: authors fetch current Docsy docs via find-docs/context7.
  docsy: {
    contentRoot: 'content/en',
    assetDir: 'static/images',
    configFiles: ['hugo.toml', 'go.mod'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Hugo baseURL in hugo.toml.
      const baseNote = basePath
        ? `   Set baseURL = '${basePath}' in hugo.toml (or preserve an existing baseURL if already set).\n`
        : ''
      // i18n -> Hugo multilingual config in hugo.toml.
      const i18nNote = i18n
        ? `   Add [languages] blocks to hugo.toml for each locale: ` +
          `${i18n.locales.map(l => `[languages.${l}] { languageName = '${l}'${l === i18n.defaultLocale ? ', weight = 1' : ''} }`).join('; ')}. ` +
          `Create content/<locale>/ directories for each non-default locale. Docsy picks up multilingual ` +
          `routes automatically when [languages] is configured.\n`
        : ''
      // Docsy/Hugo has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: Docsy/Hugo has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a version dropdown in config/menus.toml or subpath deploys if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/hugo.toml: patch [params] title and [[menus.main]] entries only if missing. ` +
            `Preserve existing module, markup, and taxonomies blocks.\n`
          : `2. Write or repair ${outDir}/hugo.toml: set [module] imports = [{path:"github.com/google/docsy"}], ` +
            `[params] with ui.breadcrumb_disable=false, ui.sidebar_menu_compact=true, ` +
            `title (from the brief), and [languages.en]. ` +
            `Add [[menus.main]] entries for top-level page groups (${groups}). ` +
            `If it already exists, update title and menus.main only.\n`) +
        `3. Each content group goes in ${outDir}/content/en/<group>/_index.md with frontmatter title and weight for ordering. ` +
        `Admitted pages live at ${outDir}/content/en/<group>/<page>.md.\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, _scaffoldMode) => `hugo --source "${outDir}"`,
      prerequisiteNote: 'hugo binary available and go.mod references github.com/google/docsy',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /ERROR|WARN.*ref|error:|panic/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Scalar (scalar/scalar v1.x) ----------------------------------------------------------------
  // OpenAPI reference renderer. Not a prose-page authoring tool: the "pages" contract is replaced
  // by a single renderer config (scalar.config.json or similar) that points at an OpenAPI spec.
  // The assemblePrompt skips the per-page MDX authoring and instead writes the renderer config.
  // args.sources should include the OpenAPI spec path (e.g. openapi.yaml).
  // No inline contract: authors work from current Scalar docs (find-docs / context7).
  scalar: {
    contentRoot: '.',
    assetDir: null, // API renderer; no prose asset directory
    configFiles: ['scalar.config.json'],
    contract: null,
    assemblePrompt: (outDir, _groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath/i18n/versioning: not applicable for API renderers (Scalar is a client-side spec renderer).
      const notesNote = [
        basePath ? `NOTE: basePath ("${basePath}") is not configurable in scalar.config.json; set it in the serving proxy/CDN.` : '',
        i18n ? `NOTE: Scalar has no i18n config; locale (${i18n.defaultLocale}) not applied.` : '',
        versioning ? `NOTE: Scalar has no versioning config; version (${versioning.current}) not applied.` : '',
      ].filter(Boolean).map(n => `   ${n}\n`).join('')
      const specNote = `Use the OpenAPI spec provided in sources (e.g. openapi.yaml / openapi.json) as the spec path.`
      return (
        `2. Write ${outDir}/scalar.config.json: a Scalar renderer config referencing the OpenAPI spec. ` +
        `Minimum shape: {"openapi":"<path-to-spec>","info":{"title":"<API title from spec or brief>"},"servers":[]}. ` +
        `If the spec is a URL, use the url field instead of a file path. ${specNote}\n` +
        `3. (No content-collection step — Scalar renders directly from the OpenAPI spec; do NOT author MDX prose pages.)\n` +
        notesNote
      )
    },
    validate: {
      // Scalar is a browser renderer; no static build. CLI validate only available with @scalar/cli.
      buildCmd: (_outDir, _scaffoldMode) => null,
      skipReason: 'scalar renders client-side (serve with any static file server or the scalar CLI)',
      parseErrors: (_output) => [],
    },
  },

  // --- Redocly (Redocly/redoc v2.x + redocly CLI) -----------------------------------------------
  // OpenAPI reference renderer. Not a prose-page authoring tool: the "pages" contract is replaced
  // by redocly.yaml (the Redocly CLI config) that points at an OpenAPI spec and controls theming.
  // The assemblePrompt skips per-page MDX authoring and instead writes the Redocly config.
  // args.sources should include the OpenAPI spec path (e.g. openapi.yaml).
  // No inline contract: authors work from current Redocly docs (find-docs / context7).
  redocly: {
    contentRoot: '.',
    assetDir: null, // API renderer; no prose asset directory
    configFiles: ['redocly.yaml'],
    contract: null,
    assemblePrompt: (outDir, _groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath/i18n/versioning: not applicable for API renderers (Redocly is a spec-driven renderer).
      const notesNote = [
        basePath ? `NOTE: basePath ("${basePath}") is not configurable in redocly.yaml; set it in the serving proxy/CDN.` : '',
        i18n ? `NOTE: Redocly has no i18n config in redocly.yaml; locale (${i18n.defaultLocale}) not applied.` : '',
        versioning ? `NOTE: Redocly versioning is handled via separate API definitions in the apis block; version (${versioning.current}) not applied here.` : '',
      ].filter(Boolean).map(n => `   ${n}\n`).join('')
      const specNote = `Use the OpenAPI spec provided in sources (e.g. openapi.yaml) as the spec path.`
      return (
        `2. Write ${outDir}/redocly.yaml: a Redocly CLI config referencing the OpenAPI spec. ` +
        `Minimum shape:\n` +
        `  apis:\n` +
        `    main@latest:\n` +
        `      root: <path-to-spec>  # relative to redocly.yaml\n` +
        `  theme:\n` +
        `    openapi:\n` +
        `      generateCodeSamples:\n` +
        `        languages: [curl, JavaScript, Python]\n` +
        `${specNote}\n` +
        `If the brief names a theme or custom logo, add a [theme.colors] or [theme.logo] section. ` +
        `If it already exists, patch the apis root path and theme block only; do NOT clobber other keys.\n` +
        `3. (No content-collection step — Redocly renders directly from the OpenAPI spec; do NOT author MDX prose pages.)\n` +
        notesNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx @redocly/cli lint "${outDir}/redocly.yaml"`
        }
        return `npx @redocly/cli lint "${outDir}/redocly.yaml"`
      },
      prerequisiteNote: '@redocly/cli available (npx resolves it) and redocly.yaml exists in outDir',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|\[error\]|✗|warning:/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // Fallback entry for any framework not yet registered above. Authors work from current official
  // docs (find-docs / context7) rather than an inline contract. contentRoot/configFiles/validate
  // are null because they are framework-specific and unknown at author time.
  _unfilled: {
    contentRoot: null,
    assetDir: null,
    configFiles: [],
    contract: null,
    // scaffoldMode is plumbed through for consistency; full-project is unsupported for unfilled frameworks.
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // For unknown frameworks: pass the values through as plain instructions; the agent consults current docs.
      const baseNote = basePath
        ? `   If the framework has a config key for the serving subpath, set it to '${basePath}'.\n`
        : ''
      const i18nNote = i18n
        ? `   If the framework supports i18n, configure the default locale ("${i18n.defaultLocale}") ` +
          `and additional locales (${i18n.locales.join(', ')}) per current framework docs.\n`
        : ''
      const versioningNote = versioning
        ? `   If the framework supports versioning, set the current version to "${versioning.current}" per current framework docs.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) the primary config — patch nav/sidebar to reflect the page groups: ${groups}; ` +
            `update the title only if missing. Use current framework config syntax.\n`
          : `2. Write or repair the primary config (nav/sidebar reflecting the page groups: ${groups}; title derived from the brief). ` +
            `Use current framework config syntax; if a config already exists, update nav/title rather than clobbering unrelated config.\n`) +
        `3. (no Astro content collection step for this framework.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    // _unfilled: no validate config — runBuildRepairLoop returns "skipped: no validate config".
    validate: null,
  },
}

// --- resolveLinksAndAssets (shared helper) -----------------------------------------------------
// Runs after Author, before Quality gate. Scans each written page for local asset references
// (markdown images, HTML img src), copies found files to the framework's assetDir, and rewrites
// the page's src/href to the framework-correct route.
//
// WHY a scripted agent step rather than leaving it to the quality gate:
//   - The quality gate should DROP broken links, not fix them. Fixing before the gate means
//     the gate sees a clean slate and can catch REAL authoring errors, not copy-omissions.
//   - One Haiku agent per batch (all pages together) is cheaper than per-page author ops.
//   - The gate already checks that paths resolve; this step ensures they do.
//
// Returns { copied: [{src, dest}], rewritten: [{page, from, to}], skipped: string[] }.
// Skips cleanly when fwEntry.assetDir is null (API renderers: Scalar, Redocly).
//
// Usage: const linkResult = await resolveLinksAndAssets(written, outDir, fwEntry, framework)
async function resolveLinksAndAssets(writtenNotes, outDir, fwEntry, framework) {
  if (!fwEntry.assetDir) {
    return { copied: [], rewritten: [], skipped: [`${framework} has no assetDir; link resolution skipped`] }
  }
  const assetDir = `${outDir}/${fwEntry.assetDir}`
  const pageList = writtenNotes.map(n => `${outDir}/${n.path}`).join('\n')
  const result = await agent(
    `You are a link-and-asset resolver for a ${framework} docs site at "${outDir}".\n\n` +
    `TASK: For each page listed below, find all local (non-http/https) asset references — ` +
    `markdown image syntax \`![alt](path)\`, HTML \`<img src="path">\`, and \`<source src="path">\` — ` +
    `then for each referenced local file:\n` +
    `1. If the source file EXISTS at the path as written (relative to the page's directory or absolute), ` +
    `   copy it to "${assetDir}/<filename>" using the Bash tool: \`mkdir -p "${assetDir}" && cp "<src>" "${assetDir}/<filename>"\`.\n` +
    `2. Rewrite the reference in the page to the framework-correct route:\n` +
    `   - ${framework === 'starlight' ? 'Starlight: use a relative path from the page to src/assets/, e.g. ../../assets/image.png for a page two levels deep.' :
       framework === 'docusaurus' ? 'Docusaurus: use an absolute path from the site root, e.g. /img/image.png (maps to static/img/).' :
       framework === 'mkdocs' ? 'MkDocs: use a relative path from the page to assets/, e.g. ../assets/image.png.' :
       framework === 'vitepress' ? 'VitePress: use an absolute path, e.g. /image.png (maps to docs/public/).' :
       framework === 'mdbook' ? 'mdBook: use a relative path from the page to images/, e.g. ../images/image.png.' :
       framework === 'docsify' ? 'Docsify: use an absolute path, e.g. /_media/image.png.' :
       framework === 'sphinx' ? 'Sphinx: use a path relative to _static/, e.g. ../_static/image.png.' :
       framework === 'nextra' ? 'Nextra: use an absolute path from public/, e.g. /image.png.' :
       framework === 'mintlify' ? 'Mintlify: use a path under images/, e.g. /images/image.png.' :
       framework === 'docsy' ? 'Hugo/Docsy: use an absolute path, e.g. /images/image.png (maps to static/images/).' :
       `use a path relative to the framework's asset directory.`}\n` +
    `   Use the Edit tool to rewrite the reference in the page file.\n` +
    `3. If the source file does NOT exist at the referenced path, record it in "skipped" with the reason ` +
    `   "source not found" — do not attempt to copy a file that does not exist.\n` +
    `4. External URLs (http/https/ftp) and root-relative paths that already point into the asset dir ` +
    `   are SKIPPED (no action needed).\n\n` +
    `PAGES:\n${pageList}\n\n` +
    `Return: copied (array of {src, dest} for each file copied), ` +
    `rewritten (array of {page, from, to} for each link rewritten), ` +
    `skipped (array of strings explaining what was skipped and why), ` +
    `summary (one sentence).`,
    {
      label: 'resolve-links-assets',
      phase: 'Author',
      model: 'haiku',
      schema: {
        type: 'object', required: ['copied', 'rewritten', 'skipped', 'summary'], additionalProperties: false,
        properties: {
          copied: { type: 'array', items: {
            type: 'object', required: ['src', 'dest'], additionalProperties: false,
            properties: { src: { type: 'string' }, dest: { type: 'string' } }
          }},
          rewritten: { type: 'array', items: {
            type: 'object', required: ['page', 'from', 'to'], additionalProperties: false,
            properties: { page: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }
          }},
          skipped: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
      },
    },
  )
  return result ?? { copied: [], rewritten: [], skipped: ['resolve-links-assets agent returned null'], summary: 'skipped' }
}
// @generated-end docs-contracts/frameworks
// --- args / guards -----------------------------------------------------------------------------
const root = typeof args === 'string' ? args : args?.root ?? '.'
const outDir = typeof args?.outDir === 'string' ? args.outDir : null
const framework = args?.framework ?? 'starlight'
// Resolve the registry entry; unknown frameworks fall back to the _unfilled sentinel.
const fwEntry = FRAMEWORKS[framework] ?? FRAMEWORKS._unfilled
const brief = typeof args?.brief === 'string' ? args.brief : ''
// scaffoldMode: 'content-only' (default) | 'add-to-existing' | 'full-project'. Default preserves prior behavior.
const SCAFFOLD_MODES = ['content-only', 'add-to-existing', 'full-project']
const scaffoldMode = SCAFFOLD_MODES.includes(args?.scaffoldMode) ? args.scaffoldMode : 'content-only'
const board = args?.board ?? '.eatahorse-docs'
const workerModel = args?.workerModel ?? 'sonnet'      // page authoring is real writing, not mechanical -> sonnet (model-routing.md)
const maxRounds = Math.min(args?.maxRounds ?? 3, 10)
const includeTutorials = args?.includeTutorials === true
const filesPerPage = args?.filesPerPage ?? 12          // soft ceiling: split oversized modules into sub-pages at plan time so no author reads 40 files
const include = args?.include ?? ''
const exclude = args?.exclude ?? ''
const explicitPages = Array.isArray(args?.pages) ? args.pages.filter(Boolean) : null
const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
// verify: opt-in end-to-end build gate. Default false on purpose — it pulls deps and runs a build of
// generated config (mirrors the scaffold verify=false rejected-relitigation note). See plan.
const verify = args?.verify === true
// site: full production URL (e.g. 'https://docs.example.com'). Threaded into Starlight's defineConfig
// `site:` (Starlight auto-adds @astrojs/sitemap, which needs it; also fixes canonical URLs). Null = absent.
const site = typeof args?.site === 'string' && args.site.trim() ? args.site.trim() : null

// basePath: subpath the site is served under (e.g. '/docs'). Passed to assemblePrompt for frameworks that
// have a config key for it (Astro base, Docusaurus baseUrl, etc.). Null = not specified.
const basePath = typeof args?.basePath === 'string' && args.basePath.trim() ? args.basePath.trim() : null

// i18n: {defaultLocale, locales} — enable multi-locale output. Null = not specified.
// Guard: must be an object with a non-empty defaultLocale string and a non-empty locales array.
const i18n = (
  args?.i18n && typeof args.i18n === 'object' &&
  typeof args.i18n.defaultLocale === 'string' && args.i18n.defaultLocale &&
  Array.isArray(args.i18n.locales) && args.i18n.locales.length > 0
) ? { defaultLocale: args.i18n.defaultLocale, locales: args.i18n.locales } : null

// versioning: {current, versions?} — the current version label and optional prior versions list.
// Null = not specified.
const versioning = (
  args?.versioning && typeof args.versioning === 'object' &&
  typeof args.versioning.current === 'string' && args.versioning.current
) ? { current: args.versioning.current, versions: Array.isArray(args.versioning.versions) ? args.versioning.versions : [] } : null

if (basePath) log(`basePath="${basePath}" will be injected into framework config where supported`)
if (i18n) log(`i18n enabled: defaultLocale="${i18n.defaultLocale}", locales=[${i18n.locales.join(', ')}]`)
if (versioning) log(`versioning enabled: current="${versioning.current}"${versioning.versions.length ? `, versions=[${versioning.versions.join(', ')}]` : ''}`)

if (!outDir) return { error: 'args.outDir is required (dir to write the docs site into)', got: { root, outDir } }

// Page paths MUST be contentRoot-relative (e.g. "src/content/docs/x.md"), one convention across the
// planner and the generator lanes. Lane workers sometimes echo the outDir-prefixed path they wrote
// ("docs/src/content/docs/x.md"); left unnormalized that divergence silently breaks gather-admitted
// (string match), the quality gate (reads `${outDir}/${path}` -> "docs/docs/..."), and config assembly.
// Normalize at every ingestion point. See plan: "Core defect".
const _relOutDir = String(outDir).replace(/^\.\//, '').replace(/\/+$/, '')
const normPagePath = (pp) => {
  let s = String(pp ?? '').replace(/^\.\//, '')
  if (_relOutDir && s.startsWith(_relOutDir + '/')) s = s.slice(_relOutDir.length + 1)
  return s
}

const ENUM_CAP = 5000        // hard cap on source files enumerated in one run
const LIVE_CAP = 40          // max pages authored per ROUND; the rest stay in backlog and carry forward
const RUN_TOUCH_CAP = 200    // ponytail: per-RUN ceiling on distinct pages authored; keeps authors+sync+gate under the 1000-agent lifetime cap. rerun continues from backlog. raise if a run must cover more pages in one pass.
const BUDGET_FLOOR = 50_000  // stop opening new rounds below this many remaining output tokens
const MAX_ATTEMPTS = 2       // drop a page after this many failed rounds so a permanently-failing one isn't re-run every round

// Only registered frameworks with a populated `contract` field have an inline authoring contract.
// Other frameworks (fwEntry === _unfilled) work from the current official docs (find-docs / context7).
const authoringContract = fwEntry.contract
  ?? `AUTHORING NOTE: there is NO inline syntax contract for "${framework}". Do NOT emit Starlight syntax. ` +
     `Author from the CURRENT official ${framework} documentation (use the find-docs skill / context7). ` +
     `Never invent config keys, frontmatter, or component syntax from memory. Mark anything you are unsure of.`
if (!fwEntry.contract) log(`framework="${framework}" has no inline contract; authors work from current ${framework} docs. Starlight is the first-class path.`)

// --- LANG_RULES — table-driven, language-general lane detection + generation ---------------------
// One entry per language; the Detect stage classifies the gitignore-respecting tracked file set
// against `signals` (manifest/config files) + `ext` (source extensions), and the Generate stage
// injects `docComment` / `publicApi` / `generator` into ONE generic data-driven lane contract (no
// per-language bespoke block). `generator: null` means there is no doc tool — author from a source parse.
// Sliced per agent: each lane worker is handed only its own language's rule, never the whole table.
// The two cross-cutting lanes (openapi spec-derived, cli-help entrypoint capture) are NOT languages and
// stay out of this table — they keep their bespoke LANE_CONTRACTS in the Generate stage.
const LANG_RULES = {
  typescript: { signals: ['tsconfig.json'], ext: ['.ts', '.tsx', '.mts', '.cts'], docComment: 'JSDoc /** */ above declarations', publicApi: '`export`ed symbols not marked @internal', generator: 'npx typedoc --json', pageGroup: 'TypeScript Reference' },
  javascript: { signals: ['package.json'], ext: ['.js', '.mjs', '.cjs', '.jsx'], docComment: 'JSDoc /** */', publicApi: '`export` / `module.exports`', generator: null, pageGroup: 'JavaScript Reference' },
  python: { signals: ['pyproject.toml', 'setup.py', 'setup.cfg', 'conf.py'], ext: ['.py'], docComment: 'triple-quoted docstrings (module/class/function)', publicApi: 'names in `__all__`, else names without a leading underscore', generator: 'python -m pdoc', pageGroup: 'Python Reference' },
  rust: { signals: ['Cargo.toml'], ext: ['.rs'], docComment: '/// outer and //! inner doc comments', publicApi: 'items marked `pub`', generator: 'cargo doc --no-deps', pageGroup: 'Rust API Reference' },
  go: { signals: ['go.mod'], ext: ['.go'], docComment: '// lines immediately above a declaration', publicApi: 'exported identifiers (Capitalized)', generator: 'go doc -all ./...', pageGroup: 'Go Reference' },
  java: { signals: ['pom.xml', 'build.gradle'], ext: ['.java'], docComment: 'Javadoc /** */', publicApi: '`public` types/members', generator: 'javadoc', pageGroup: 'Java Reference' },
  csharp: { signals: ['*.csproj', '*.sln'], ext: ['.cs'], docComment: 'XML doc comments ///', publicApi: '`public` types/members', generator: 'docfx', pageGroup: 'C# Reference' },
  ruby: { signals: ['Gemfile', '*.gemspec'], ext: ['.rb'], docComment: 'YARD # comment blocks above defs', publicApi: 'public methods (before a `private`)', generator: 'yard', pageGroup: 'Ruby Reference' },
  php: { signals: ['composer.json'], ext: ['.php'], docComment: 'phpDoc /** */', publicApi: '`public` (or unmodified) methods/functions', generator: 'phpDocumentor', pageGroup: 'PHP Reference' },
  cpp: { signals: ['CMakeLists.txt', 'Doxyfile'], ext: ['.h', '.hpp', '.hh', '.cpp', '.cc', '.cxx'], docComment: 'Doxygen /** */, ///, or //!', publicApi: 'declarations in public headers / after `public:`', generator: 'doxygen', pageGroup: 'C++ Reference' },
  kotlin: { signals: ['build.gradle.kts', 'settings.gradle.kts'], ext: ['.kt'], docComment: 'KDoc /** */', publicApi: '`public` (the default visibility)', generator: 'dokka', pageGroup: 'Kotlin Reference' },
  swift: { signals: ['Package.swift'], ext: ['.swift'], docComment: 'DocC /// or /** */', publicApi: '`public` / `open`', generator: 'swift doc', pageGroup: 'Swift Reference' },
}
// Cross-cutting (non-language) lanes, kept out of LANG_RULES; detection signals only.
const XCUT_RULES = {
  openapi: { signalGlobs: ['openapi.json', 'openapi.yaml', 'openapi.yml', 'swagger.json', 'swagger.yaml', 'swagger.yml', '*api*.yaml', '*api*.json'], generator: 'OpenAPI/Swagger spec; reference pages from spec paths and schemas', pageGroup: 'API Reference' },
  'cli-help': { entrypoints: ['package.json "bin"', 'main.py', 'cli.py', '__main__.py', 'cmd/*', 'main.rs', 'bin/*'], generator: 'CLI --help capture; reference pages from help text', pageGroup: 'CLI Reference' },
}
const LANG_IDS = Object.keys(LANG_RULES)

// --- schemas -----------------------------------------------------------------------------------
const ENUM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['files', 'total', 'truncated'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    total: { type: 'integer' },
    truncated: { type: 'boolean' },
  },
}

// Plan: reader-facing pages, each carrying a file SCOPE so the author + grounding gate know which source to
// read. Tutorials/getting-started land in `deferred` unless includeTutorials.
const PLAN_SCHEMA = {
  type: 'object', required: ['pages'], additionalProperties: false,
  properties: {
    pages: { type: 'array', items: {
      type: 'object', required: ['path', 'title', 'kind', 'group', 'brief', 'diataxisType', 'template', 'scope'], additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'repo-relative under outDir, e.g. src/content/docs/reference/cli.md(x)' },
        title: { type: 'string' },
        kind: { enum: ['index', 'splash', 'guide', 'reference'] },
        group: { type: 'string', description: 'sidebar group label' },
        brief: { type: 'string', description: 'what this page must cover' },
        diataxisType: { enum: ['tutorial', 'howto', 'reference', 'explanation', 'index', 'splash'] },
        template: { type: 'string', description: 'section skeleton for this diataxisType' },
        scope: { type: 'array', items: { type: 'string' }, description: 'the source files this page documents (the author + gate read these)' },
      } } },
    deferred: { type: 'array', items: {
      type: 'object', required: ['title', 'reason'], additionalProperties: false,
      properties: { title: { type: 'string' }, reason: { type: 'string' } },
      description: 'pages that need a human brief (e.g. tutorials whose intent is not in the source)' } },
  },
}

const SEED_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['cards'],
  properties: { cards: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['title', 'mdPath', 'status'],
    properties: { title: { type: 'string' }, mdPath: { type: 'string' }, status: { type: 'string' } } } } },
}

const SYNC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['activeRemaining', 'done'],
  properties: { activeRemaining: { type: 'integer' }, done: { type: 'integer' } },
}

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['hollow', 'checked'],
  properties: { hollow: { type: 'array', items: { type: 'string' } }, checked: { type: 'integer' } },
}

const DONE_TITLES_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['titles'],
  properties: { titles: { type: 'array', items: { type: 'string' } } },
}

// DOCS_GATE_SCHEMA: per-page quality-gate verdict for the docs-from-code pipeline.
// Mirrors docs-create.js GATE_SCHEMA. pass=false means the page is dropped before config assembly.
const DOCS_GATE_SCHEMA = {
  type: 'object', required: ['pages', 'admitted', 'dropped'], additionalProperties: false,
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object', required: ['path', 'pass', 'issues'], additionalProperties: false,
        properties: {
          path: { type: 'string' },
          pass: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' }, description: 'specific problems found; empty when pass=true' },
        },
      },
    },
    admitted: { type: 'array', items: { type: 'string' }, description: 'paths of pages that passed all checks' },
    dropped: { type: 'array', items: { type: 'string' }, description: 'paths of pages that failed at least one check; do not reach config assembly' },
    summary: { type: 'string', description: 'one sentence: overall result and how many passed/failed' },
  },
}

const FINAL_SCHEMA = {
  type: 'object', required: ['configWritten', 'buildResult', 'summary'], additionalProperties: false,
  properties: {
    configWritten: { type: 'boolean' },
    buildResult: { type: 'string', description: 'astro check output summary, or "skipped: not a buildable project"' },
    planPath: { type: 'string', description: 'path to the written .docs-plan.md' },
    decisions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// GENERATE_SCHEMA: output from a single lane worker that ran its generator (or captured --help) and
// wrote reference page(s) under outDir. Each worker returns one entry; the Generate phase collects
// all of them and merges the produced pages into the Plan so they are treated as pre-authored
// (scope-backed from real tool output, not invented prose).
const GENERATE_SCHEMA = {
  type: 'object', required: ['laneId', 'pages', 'succeeded'], additionalProperties: false,
  properties: {
    laneId: { type: 'string', description: 'the lane id this worker ran, e.g. openapi, rustdoc' },
    succeeded: { type: 'boolean', description: 'true if the generator ran and produced at least one page' },
    failureReason: { type: 'string', description: 'why the generator could not run (tool not installed, parse error, etc.); empty when succeeded' },
    pages: {
      type: 'array',
      description: 'one entry per reference page written to disk by this worker',
      items: {
        type: 'object',
        required: ['path', 'title', 'group', 'brief', 'scope'],
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'repo-relative under outDir, e.g. src/content/docs/reference/api.md' },
          title: { type: 'string' },
          group: { type: 'string', description: 'sidebar group label, e.g. "API Reference"' },
          brief: { type: 'string', description: 'one sentence: what this page documents and its source provenance' },
          scope: { type: 'array', items: { type: 'string' }, description: 'signal files + any source files read to produce this page' },
        },
      },
    },
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['documented', 'undocumented'],
      description: 'doc-coverage for this lane: public symbols WITH vs WITHOUT a doc comment. Optional; language lanes should report it.',
      properties: {
        documented: { type: 'integer', description: 'count of public symbols that DO have a doc comment' },
        undocumented: {
          type: 'array',
          description: 'public symbols that LACK a doc comment',
          items: {
            type: 'object', required: ['symbol', 'file', 'kind'], additionalProperties: false,
            properties: {
              symbol: { type: 'string', description: 'the public symbol name, e.g. parseConfig' },
              file: { type: 'string', description: 'repo-relative source file the symbol is declared in' },
              kind: { type: 'string', description: 'symbol kind: function, class, method, type, const, etc.' },
            },
          },
        },
      },
    },
  },
}

// DETECT_SCHEMA: per-lane detection result. Each lane describes one tooling-backed reference source
// applicable to the repo. Lanes feed into the Plan phase so the planner knows which reference pages
// can be generated from tooling vs authored from prose. A lane whose `applicable` is false is omitted
// from downstream prompts (zero cost to the Plan agent).
const DETECT_SCHEMA = {
  type: 'object', required: ['lanes', 'signals'], additionalProperties: false,
  properties: {
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'applicable', 'signal', 'generator', 'pageGroup'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'lane id: a language id (typescript, javascript, python, rust, go, java, csharp, ruby, php, cpp, kotlin, swift) or a cross-cutting id (openapi, cli-help)' },
          applicable: { type: 'boolean', description: 'true when the signal file(s) OR 1+ source files of the language ext were found in the tracked set' },
          signal: { type: 'string', description: 'the file or pattern that triggered detection, or empty string' },
          generator: { type: 'string', description: 'tooling command or approach for this lane' },
          pageGroup: { type: 'string', description: 'suggested sidebar group label for generated reference pages' },
          notes: { type: 'string', description: 'any relevant details, e.g. multiple spec files found, or generator not installed' },
        },
      },
      description: 'one entry per candidate lane; applicable=false lanes are present so the Plan agent knows what was checked',
    },
    signals: {
      type: 'array', items: { type: 'string' },
      description: 'list of signal files found in the repo, for logging',
    },
  },
}

// Sliced per-agent: cli(...) hands each board-touching prompt ONLY the commands its steps call. Page
// authors run NO CLI — they get CARD_MD (markdown layout) only. Keep `reopen` consistent with the sibling
// CMD in eatahorse{,-research}.js by hand (no runtime sharing in the VM sandbox).
const CLI_HEAD =
  `Eatahorse CLI (stdlib python, no deps): python3 "${scriptPath}" --board "${board}" <cmd>. ` +
  `If absent: find . -name eatahorse.py -path '*eatahorse*'.`
const CMD = {
  report: `report --json -> {counts, active, done}  (read "active" and "done")`,
  list:   `list [--status s] [--json] -> cards (id,title,status,path)`,
  show:   `show <id> [--json] -> card incl. "description" (holds page path + scope)`,
  init:   `init "<name>"  (errors if a board exists)`,
  add:    `add "<title>" --status backlog -d "<desc>" --bite "author it" --accept "page written and grounded in source"`,
  done:   `done <id>  (check all bites + acceptance and move to done; survives sync, unlike a bare --status done)`,
  reopen: `reopen <id> [--gap "<why hollow>"]  (atomic: uncheck acceptance + add gap bite + move doing)`,
  sync:   `sync  (reconcile cards <-> state.json + board.md; run after edits)`,
}
const cli = (...k) => CLI_HEAD + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
// Card layout only — for the page author, which writes its page file + edits its own card markdown, no CLI.
const CARD_MD =
  `Card markdown: a "## Notes" section + checkbox sections "## One-bite-at-a-time plan" and ` +
  `"## Acceptance checks" with "- [ ]"/"- [x]" items. In "## Notes" record ONE line: the written page path ` +
  `+ a one-line grounding summary (do NOT paste the page body here). Tick ALL boxes to auto-complete on sync.`

// 1. Enumerate — haiku, mechanical. List the SOURCE files to document. Script can't touch the FS.
phase('Enumerate')
const enumed = await agent(
  `List the source files to document under "${root}". ALWAYS operate ON "${root}", never the current working ` +
    `directory: use \`git -C "${root}" ls-files\` when "${root}" is a git repo, else \`find "${root}" -type f\`. ` +
    `(Do NOT run a bare \`git ls-files\` — that lists the CWD, which may be a different repo.) ` +
    `SKIP .git, node_modules, dist/build, vendored, lockfiles, binary/media, and SKIP the docs ` +
    `output dir "${outDir}" and the board dir "${board}" (do not document generated output). ` +
    `${include ? `INCLUDE only paths matching: ${include}. ` : ''}${exclude ? `EXCLUDE paths matching: ${exclude}. ` : ''}` +
    `Return repo-relative paths. Cap the list at ${ENUM_CAP}; if more exist set truncated=true and report the true total.`,
  { label: 'enumerate', model: 'haiku', schema: ENUM_SCHEMA },
)
const files = (enumed?.files ?? []).filter(Boolean)
if (!files.length) return { root, outDir, error: 'no source files enumerated', written: false }
if (enumed.truncated) log(`enumerate: capped at ${files.length} of ${enumed.total} files; the rest are not covered this run`)

// 2. Detect — haiku, mechanical. Map repo signals to applicable generator lanes. Runs after enumeration so
//    it can grep the file list rather than doing its own filesystem walk. Feeds the Plan phase so the planner
//    knows which reference sections can be generated from tooling (backed by real tool output) vs authored
//    from prose alone.
phase('Detect')
// Build the table-driven, gitignore-honoring detection prompt from LANG_RULES + XCUT_RULES.
// The classification is driven off the ALREADY-ENUMERATED `files` (which came from
// `git -C root ls-files`, so gitignored paths — node_modules, vendor, build output — are already
// excluded). The agent may ALSO run `git -C root ls-files` directly to re-confirm, but NEVER a raw
// recursive `find` that would walk ignored dirs. A language lane is applicable if any of its signal
// files OR 1+ source files of its ext appear in the tracked set.
const langTableRows = LANG_IDS.map((id) => {
  const r = LANG_RULES[id]
  return `| ${id} | ${r.signals.join(', ')} | ${r.ext.join(', ')} | ${r.generator ?? '(none — source-parse)'} |`
}).join('\n')
const xcutRows =
  `| openapi | ${XCUT_RULES.openapi.signalGlobs.join(', ')} (an *api*.yaml/json counts ONLY if its root has \`openapi:\`/\`swagger:\`) | ${XCUT_RULES.openapi.generator} |\n` +
  `| cli-help | entrypoints: ${XCUT_RULES['cli-help'].entrypoints.join(', ')} | ${XCUT_RULES['cli-help'].generator} |`
const detection = await agent(
  `You are a documentation-tooling detector. Identify which reference-doc generator lanes apply to the repo at "${root}".\n\n` +
  `GITIGNORE DISCIPLINE: classify the TRACKED file set only. The list below comes from \`git -C "${root}" ls-files\`, ` +
  `so gitignored paths (node_modules, vendor/, dist/build) are ALREADY excluded — do NOT run a raw recursive ` +
  `\`find\` that would walk ignored directories. If you want to re-confirm signals, run \`git -C "${root}" ls-files\` ` +
  `directly (still gitignore-respecting); never a bare \`find "${root}"\`.\n\n` +
  `Tracked source files (${files.length}):\n${JSON.stringify(files)}\n\n` +
  `LANGUAGE LANES — a lane is applicable if ANY of its signal files OR 1+ source files of its extension(s) appear ` +
  `in the tracked set:\n\n` +
  `| Lane ID | Signal files | Source extensions | Generator |\n` +
  `|---------|--------------|-------------------|-----------|\n` +
  `${langTableRows}\n\n` +
  `DISAMBIGUATION: javascript and typescript share package.json. A repo with tsconfig.json is a typescript lane; ` +
  `treat it as javascript ONLY if there is a package.json and NO tsconfig.json. Signal globs like \`*.csproj\`/\`*.gemspec\` ` +
  `match by suffix anywhere in the tracked set.\n\n` +
  `CROSS-CUTTING LANES (not languages):\n\n` +
  `| Lane ID | Signal | Generator |\n` +
  `|---------|--------|-----------|\n` +
  `${xcutRows}\n\n` +
  `For each applicable lane, READ the signal file (or a representative source file) to confirm it is real, set ` +
  `signal to the matched path, and pageGroup to a sensible sidebar group. For an openapi candidate, READ the ` +
  `matched *api*.yaml/json and keep it ONLY if its root has \`openapi:\` or \`swagger:\`.\n` +
  `Return EVERY lane (all ${LANG_IDS.length} languages + openapi + cli-help) with applicable=true/false, so the ` +
  `Plan agent knows what was checked. Also return signals: the flat list of all signal/source files that triggered ` +
  `an applicable lane.`,
  { label: 'detect', model: 'haiku', schema: DETECT_SCHEMA },
)
const activeLanes = (detection?.lanes ?? []).filter((l) => l.applicable)
if (activeLanes.length) {
  log(`detect: ${activeLanes.length} generator lane(s) applicable: ${activeLanes.map((l) => l.id).join(', ')} (signals: ${(detection?.signals ?? []).join(', ')})`)
} else {
  log('detect: no generator lanes detected; all reference pages will be authored from source prose')
}

// 2b. Generate — haiku/sonnet workers, one per active lane. Each worker runs its generator (or
//     captures --help) against the repo and writes one or more reference pages directly to outDir.
//     Workers emit structured page metadata so the Plan phase can include them as PRE-AUTHORED pages
//     (scope-backed from real tool output) rather than prose-authored pages that must clear the
//     grounding gate. A lane worker that cannot run its generator (tool not installed, parse error)
//     sets succeeded=false and pages=[]; those lanes fall back to Plan phase prose authoring so the
//     planner knows to include a conventionally authored reference page instead.
//
//     Per-lane worker contracts (inline; workflow stages cannot auto-load skills):
//     - openapi (cross-cutting, bespoke): read the spec file, extract paths+schemas+descriptions, write endpoint pages.
//     - cli-help (cross-cutting, bespoke): run the CLI with --help (and sub-commands), write command reference.
//     - all 12 LANGUAGE lanes (typescript, python, rust, go, java, csharp, ...): ONE generic, DATA-DRIVEN
//       contract — the matched LANG_RULES entry's docComment / publicApi / generator are injected into the
//       prompt, so a single contract documents any language (run the generator if available, else READ the
//       source files of the language's extensions and extract publicApi symbols with their docComment).
//
//     Doc-coverage: every LANGUAGE lane also reports public symbols that LACK a doc comment, returned in
//     coverage:{documented, undocumented[]}. The Generate phase aggregates undocumented symbols across lanes
//     and writes ONE documentation-gaps reference page after the parallel fan-out (see below).
//
//     Sliced per agent: each language worker gets ONLY its own language's rules, not the whole table.
//     Model: haiku for simple captures / source-parse extraction (cli-help, go, and language lanes whose
//     generator is null or a plain doc tool); sonnet for spec parsing (openapi, typescript/typedoc, python,
//     rust) where the output demands more judgment. (model-routing.md: cheapest that fits.)
//     No CLI (eatahorse) access: workers only write page files + return structured metadata.
phase('Generate')
let generatedPages = []    // pages produced by lane workers; merged into Plan as pre-authored entries
let docGaps = []           // aggregated undocumented public symbols across all language lanes (doc-coverage)
if (activeLanes.length && !explicitPages) {
  // Bespoke per-lane contracts for the CROSS-CUTTING (non-language) lanes only. Language lanes use the
  // generic data-driven contract built from LANG_RULES below (sliced per agent).
  const LANE_CONTRACTS = {
    openapi: `
OPENAPI LANE WORKER CONTRACT:
1. READ the signal file (OpenAPI/Swagger spec). It may be JSON or YAML.
2. Parse the spec: extract title, version, server URLs, paths (method + path + summary + parameters + request/response schemas), and component schemas.
3. Produce 1-3 reference page(s) under "${outDir}/src/content/docs/reference/":
   - An overview page (index of endpoints grouped by tag, with the API title/version).
   - One page per tag group if there are 5+ endpoints; otherwise one combined "Endpoints" page.
   - A "Schemas" page if the spec has 3+ component schemas.
4. Each page: write valid ${framework} markdown with frontmatter (title required, diataxisType hint in a comment).
   Content MUST come from the spec — copy summaries/descriptions verbatim, list parameters with types, show example request/response from the spec's examples field if present.
   Tag each page with a comment: <!-- generated: openapi lane, signal: <signal_file> -->
5. Return the list of pages written (path, title, group="API Reference", brief, scope=[signal_file]).
`,
    'cli-help': `
CLI HELP LANE WORKER CONTRACT:
1. Identify the CLI entry point from the signal file. Try, in order:
   a. If signal is package.json: check the "bin" field for the command name and entry path. Run \`node <entry> --help\`.
   b. If signal is a .py file: run \`python <signal> --help\`.
   c. If signal is a .go file in cmd/: run \`go run <signal> --help\` or find the built binary.
   d. If signal is a .rs file: run \`cargo run -- --help\` from the Cargo.toml directory.
   Capture --help output. Then discover sub-commands by parsing top-level help for command names and running \`<cmd> <sub> --help\` for each (up to 20 sub-commands).
2. Produce reference page(s) under "${outDir}/src/content/docs/reference/":
   - One "CLI Reference" overview page listing all commands with their one-line summaries.
   - One page per sub-command group if there are 5+ sub-commands.
3. Content MUST come from the actual --help output captured — copy flag names, descriptions, and examples verbatim.
   Tag each page: <!-- generated: cli-help lane, signal: <signal_file> -->
4. Return pages written (path, title, group="CLI Reference", brief, scope=[signal_file]).
`,
  }

  // Build the GENERIC, DATA-DRIVEN language-lane contract from a matched LANG_RULES entry. ONE template
  // documents any of the 12 languages: run the generator if available, else READ the source files of the
  // language's extensions and extract `publicApi` symbols with their `docComment`. The worker is sliced per
  // agent — it sees only THIS language's rule, never the whole table.
  const langContract = (id, rule) => `
LANGUAGE LANE WORKER CONTRACT (lane: ${id}). You document ONE language using ONLY its own rules:
  - Doc-comment convention: ${rule.docComment}
  - Public API surface:     ${rule.publicApi}
  - Generator tool:         ${rule.generator ?? '(none — there is no doc generator; extract directly from source)'}
  - Source extensions:      ${rule.ext.join(', ')}
Steps:
1. ${rule.generator
      ? `Attempt the generator from "${root}": \`${rule.generator}\`. If it is not installed or fails, FALL BACK to a source parse (step 2).`
      : `There is no doc generator for this language — go straight to the source parse (step 2).`}
2. SOURCE PARSE (the grounded path): READ the tracked source files with extensions ${rule.ext.join(', ')}, identify the
   PUBLIC API (${rule.publicApi}), and for each public symbol collect its doc comment (${rule.docComment}).
3. Write 1-3 reference page(s) under "${outDir}/src/content/docs/reference/", grouped by module/namespace; merge trivial
   single-symbol modules. List each public symbol with its signature and its doc text. NEVER invent a signature.
   Tag each page: <!-- generated: ${id} lane, signal: ${'${signal}'} -->
4. DOC-COVERAGE: also report public symbols that LACK a doc comment. Return coverage:{documented:<count with a doc comment>,
   undocumented:[{symbol, file, kind}]} listing every public symbol that has NO doc comment.
5. Return the pages written (path, title, group="${rule.pageGroup}", brief, scope=[the source files you read]).
`

  const laneResults = await parallel(
    activeLanes.map((lane) => () => {
      const rule = LANG_RULES[lane.id]        // sliced: only this lane's rule is injected
      const contract = LANE_CONTRACTS[lane.id]
        ?? (rule ? langContract(lane.id, rule).replace('${signal}', lane.signal) : `
GENERIC GENERATOR LANE WORKER CONTRACT (lane: ${lane.id}):
Signal file: ${lane.signal}. Generator approach: ${lane.generator}.
Read the signal file, extract any API/command/schema documentation it describes, and write 1-2 reference
pages under "${outDir}/src/content/docs/reference/". Content MUST come from the signal file — no invented API.
Tag each page: <!-- generated: ${lane.id} lane, signal: ${lane.signal} -->
`)
      // Model: sonnet where parsing demands judgment (openapi spec, the 4 richer language parses);
      // haiku for plain captures + the remaining language source-parses (mechanical extraction).
      const sonnetLanes = ['openapi', 'typescript', 'python', 'rust', 'java', 'csharp']
      return agent(
        `You are a reference-documentation generator for the "${lane.id}" lane.\n` +
        `Repository root: "${root}"\n` +
        `Output directory: "${outDir}"\n` +
        `Signal file: "${lane.signal}"\n` +
        `Generator: ${lane.generator}\n` +
        (lane.notes ? `Notes from detection: ${lane.notes}\n` : '') +
        `\n${contract}\n` +
        `IMPORTANT RULES:\n` +
        `- Write page files using the Write tool (create parent directories with Bash if needed).\n` +
        `- Every page MUST have valid frontmatter with at least a "title" field.\n` +
        `- diataxisType for ALL generated pages is "reference".\n` +
        `- All content MUST be grounded in what you actually read/ran — never invent API signatures, flags, or schemas.\n` +
        `- If the generator tool is not installed and the fallback source read also fails (empty/unreadable), set succeeded=false with a clear failureReason.\n` +
        `- On any error: still return a valid JSON result with succeeded=false, pages=[], failureReason explaining why.\n` +
        `Return your result as JSON matching the schema.`,
        { label: `generate:${lane.id}`, phase: 'Generate', model: sonnetLanes.includes(lane.id) ? 'sonnet' : 'haiku', schema: GENERATE_SCHEMA },
      )
    }),
  )

  for (const result of laneResults) {
    if (!result) continue
    if (result.succeeded && result.pages?.length) {
      log(`generate:${result.laneId}: wrote ${result.pages.length} page(s): ${result.pages.map((p) => p.path).join(', ')}`)
      generatedPages = generatedPages.concat(
        result.pages.map((p) => ({
          ...p,
          path: normPagePath(p.path),   // lane workers may echo the outDir-prefixed path; force contentRoot-relative
          kind: 'reference',
          diataxisType: 'reference',
          template: 'consistent, exhaustive entries grouped or alphabetised, scannable; no narrative, no opinion',
          _generated: true,    // flag: skip prose-authoring loop, go straight to quality gate
          _laneId: result.laneId,   // which lane produced this page (for the failedLanes check in Plan)
        })),
      )
    } else {
      log(`generate:${result.laneId}: failed (${result.failureReason ?? 'unknown'}); planner will add a prose-authored fallback`)
    }
    // Doc-coverage: aggregate undocumented public symbols regardless of page-write success.
    for (const u of result.coverage?.undocumented ?? []) {
      if (u?.symbol && u?.file) docGaps.push({ ...u, lane: result.laneId })
    }
  }
  if (generatedPages.length) log(`generate: ${generatedPages.length} pre-authored reference page(s) from lane workers`)
  if (docGaps.length) log(`doc-coverage: ${docGaps.length} undocumented public symbol(s) across lanes`)

  // DOC-COVERAGE PAGE: if any public symbol lacks a doc comment, write ONE reference page listing the gaps
  // grouped by file. The page joins generatedPages as a pre-authored entry so it flows through Seed + the
  // quality gate like any other generated reference page. Zero gaps -> skip the page (still reported as 0).
  if (docGaps.length) {
    const gapsPath = `src/content/docs/reference/documentation-gaps.md`   // plain markdown reference; no components needed
    // Group by file for a stable, scannable layout.
    const byFile = {}
    for (const g of docGaps) (byFile[g.file] ??= []).push(g)
    const gapBody =
      `---\ntitle: Documentation gaps\ndescription: Public API symbols that lack a doc comment.\n---\n` +
      `<!-- generated: doc-coverage, ${docGaps.length} undocumented public symbol(s) -->\n\n` +
      `These public API symbols were found WITHOUT a doc comment during reference generation. Documenting ` +
      `them (in the source) closes the gap.\n\n` +
      Object.keys(byFile).sort().map((file) =>
        `## \`${file}\`\n\n` +
        byFile[file].map((g) => `- \`${g.symbol}\` (${g.kind})`).join('\n')
      ).join('\n\n') + '\n'
    const wrote = await agent(
      `Write EXACTLY this documentation-gaps reference page to "${outDir}/${gapsPath}" using the Write tool ` +
      `(create parent dirs with Bash if needed). Write the content VERBATIM — do not add, reword, or invent. ` +
      `Then return {written:true}. Content:\n\n${gapBody}`,
      { label: 'doc-coverage-page', phase: 'Generate', model: 'haiku',
        schema: { type: 'object', required: ['written'], additionalProperties: false, properties: { written: { type: 'boolean' } } } },
    )
    if (wrote?.written) {
      generatedPages.push({
        path: gapsPath, title: 'Documentation gaps', group: 'Documentation gaps',
        brief: `${docGaps.length} public symbol(s) without a doc comment, grouped by file`,
        scope: [...new Set(docGaps.map((g) => g.file))].slice(0, 12),
        kind: 'reference', diataxisType: 'reference',
        template: 'consistent, exhaustive entries grouped or alphabetised, scannable; no narrative, no opinion',
        _generated: true,
      })
      log(`doc-coverage: wrote ${gapsPath} (${docGaps.length} gap(s))`)
    }
  }
}

// 3. Plan — strong model (inherits session; this is the decompose stage where a mistake propagates). One
//    call frames IA over the tree + entry points and emits the PAGE plan: group by reader task, tag Diátaxis,
//    attach a file SCOPE, split modules over ~${filesPerPage} files into sub-pages, defer tutorials.
phase('Plan')
let pages = explicitPages
let deferred = []
if (!pages) {
  // Build the lanes context block injected into the Plan prompt. Only applicable lanes are shown;
  // if none apply, the block is omitted entirely (no token cost).
  // Generated pages are listed so the planner knows NOT to re-plan those pages from prose.
  const generatedPathSet = new Set(generatedPages.map((p) => p.path))
  const lanesWithPages = new Set(generatedPages.map((p) => p._laneId).filter(Boolean))
  const failedLanes = activeLanes.filter((l) => !lanesWithPages.has(l.id))
  const lanesBlock = activeLanes.length
    ? `GENERATOR LANES DETECTED (${activeLanes.length}):\n` +
      (generatedPages.length
        ? `PRE-AUTHORED REFERENCE PAGES (${generatedPages.length}) — do NOT re-plan these pages; they are already written:\n` +
          generatedPages.map((p) => `  - ${p.path} (${p.title}): ${p.brief}`).join('\n') + '\n\n'
        : '') +
      (failedLanes.length
        ? `LANE FALLBACKS (generator did not run; plan prose-authored reference pages for these):\n` +
          failedLanes.map((l) =>
            `- ${l.id}: signal="${l.signal}" generator="${l.generator}" pageGroup="${l.pageGroup}"${l.notes ? ` notes="${l.notes}"` : ''}`
          ).join('\n') + '\n\n'
        : '')
    : ''
  const plan = await agent(
    `You are planning a ${framework} documentation site generated FROM a codebase. Apply the IA contract: ` +
      `group BY READER TASK (not internal module layout), merge trivial dirs, split god-modules.\n\n` +
      `Source files (${files.length}${enumed.truncated ? ` of ${enumed.total}` : ''}):\n${JSON.stringify(files)}\n\n` +
      (brief ? `Author brief / focus:\n${brief}\n\n` : '') +
      lanesBlock +
      `READ the entry points first to frame the IA: the README, the package/manifest file, and the public ` +
      `exports / main modules / CLI entry. Then produce a FOCUSED set of pages (prefer FEWER, well-scoped ` +
      `pages over many thin ones). For each page give:\n` +
      `- path: repo-relative under "${outDir}", e.g. src/content/docs/reference/cli.md (use .mdx ONLY if it needs components)\n` +
      `- title, kind (index|splash|guide|reference), group (sidebar group label), brief (what it must cover).\n` +
      `- diataxisType: the ONE reader need this page serves.\n` +
      `- template: the section skeleton for that diataxisType (from the IA contract), tailored to this page.\n` +
      `- scope: the SOURCE files this page documents (the author and the grounding gate read exactly these). ` +
      `Keep scope <= ~${filesPerPage} files; if a module is bigger, SPLIT it into sub-pages.\n\n` +
      `DEFAULT to pages a codebase can GROUND: reference pages + module overviews + one index/splash. ` +
      (includeTutorials
        ? `You MAY also include tutorial/getting-started pages; ground every concrete claim in source.\n`
        : `Put any tutorial/getting-started page into \`deferred\` (with a reason) instead of \`pages\` — its ` +
          `intent is not in the source and a guessed tutorial would fail the grounding gate.\n`) + `\n` +
      `IA CONTRACT\n${IA_CONTRACT}\n\nAuthoring contract for reference:\n${authoringContract}`,
    { label: 'plan', schema: PLAN_SCHEMA },
  )
  pages = (plan?.pages ?? []).filter(Boolean)
  deferred = plan?.deferred ?? []
  // Merge lane-generated pages into the plan. Exclude any generated path the planner independently
  // re-planned (planner wins: its scope + brief may be richer). Generated pages not in the plan go
  // in as pre-authored entries (they're already on disk; Seed will mark them done immediately).
  if (generatedPages.length) {
    const plannedPaths = new Set(pages.map((p) => p.path))
    const newGenerated = generatedPages.filter((p) => !plannedPaths.has(p.path))
    pages = pages.concat(newGenerated)
    if (newGenerated.length) log(`merged ${newGenerated.length} generated page(s) not covered by the plan`)
  }
}
// Force ONE path convention across planner, explicit, and generated pages before anything keys off
// p.path (Seed titles, gather-admitted, the gate's `${outDir}/${path}` read). Normalize each page object
// EXACTLY ONCE: generated pages were already normalized at merge above, and normPagePath is NOT a fixed
// point when outDir equals a leading path segment (e.g. outDir="src", page "src/src/..."), so applying it
// twice could over-strip. The identity set skips the already-normalized generated objects.
const _alreadyNormalized = new Set(generatedPages)
for (const p of pages) if (p && !_alreadyNormalized.has(p)) p.path = normPagePath(p.path)
if (!pages.length) return { root, outDir, error: 'planning produced no pages', written: false }
const pageByPath = new Map(pages.map((p) => [p.path, p]))
const generatedPathSet = new Set(generatedPages.map((p) => p.path))
log(`planned ${pages.length} page(s)${deferred.length ? `; deferred ${deferred.length} (needs human brief)` : ''}: ${pages.map((p) => p.path).join(', ')}`)

// 3. Seed — haiku. One card per PAGE (title = page path). The card description holds the page path + scope
//    so the grounding gate can recover which source to re-read. Resume-safe: don't re-add or un-done cards.
//    Generated pages (already written by lane workers) are seeded with status "done" directly so they skip
//    the prose-authoring loop but still flow through the quality gate.
phase('Seed')
const descOf = (p) => `path=${p.path} | diataxis=${p.diataxisType} | scope=${(p.scope ?? []).join(',')} | ${p.brief}` +
  (generatedPathSet.has(p.path) ? ' | generated=true' : '')
const seed = await agent(
  `Ensure an Eatahorse board exists at "${board}" and holds one card per page below. Steps:\n` +
    `1. \`report --json\`; if it errors (no board), \`init "Docs: ${root.replace(/"/g, "'")}"\`.\n` +
    `2. \`list --json\` to see existing cards. For EACH page whose "path" is NOT already a card title:\n` +
    `   - If the page description contains "generated=true" (lane worker already wrote it): ` +
    `\`add "<path>" -d "<description>" --accept "page written and grounded in source"\` (it lands in backlog).\n` +
    `   - Otherwise: \`add "<path>" --status backlog -d "<description>" --bite "author it" --accept "page written and grounded in source"\`.\n` +
    `   Do NOT re-add existing titles and do NOT change cards already done (supports resume).\n` +
    `2b. For every card you ADDED for a "generated=true" page, run \`done <id>\` (get the id from \`list --json\`) ` +
    `to tick its acceptance and move it to done. A bare \`--status done\` is NOT enough: an unchecked ` +
    `acceptance check reverts the card to doing on the next sync, so generated pages would fall out of the ` +
    `admitted set. \`done\` actually checks the acceptance, so the card stays done.\n` +
    `3. \`sync\`, then \`list --json\`. Return EVERY card as {title, mdPath (its "path" field), status}.\n` +
    `Do not author anything yet.\n\n${cli('report', 'init', 'add', 'done', 'sync', 'list')}\n\n` +
    `Pages (title=path, with description):\n${JSON.stringify(pages.map((p) => ({ title: p.path, description: descOf(p) })))}`,
  { label: 'seed', model: 'haiku', schema: SEED_SCHEMA },
)
if (!seed?.cards?.length) return { root, outDir, board, error: 'seed returned no cards', written: false }
const cardByTitle = new Map(seed.cards.map((c) => [c.title, c]))

// 4 + 5. Author rounds (loop-until-dry) + grounding gate. Authors write ONLY their own page file + own card
//    markdown and run NO CLI; ONE sync agent per round is the sole state writer; the gate re-reads the page's
//    SCOPE source and reopens pages whose claims aren't code-backed. Caps mirror eatahorse-research.js.
//    Generated pages skip this loop (already seeded as done); they go straight to the quality gate.
const notDone = (c) => c.status !== 'done' && c.status !== 'dropped'
let pending = seed.cards.filter(notDone).map((c) => c.title)
let round = 0
let activeRemaining = pending.length
const touched = new Set()
const attempts = new Map()
const keepRetryable = (titles) => {
  const giveUp = titles.filter((t) => (attempts.get(t) ?? 0) >= MAX_ATTEMPTS)
  if (giveUp.length) log(`dropping ${giveUp.length} page(s) after ${MAX_ATTEMPTS} failed rounds: ${giveUp.join(', ')}`)
  return titles.filter((t) => (attempts.get(t) ?? 0) < MAX_ATTEMPTS)
}

phase('Author')
while (pending.length && round < maxRounds && (!budget.total || budget.remaining() > BUDGET_FLOOR)) {
  const retryable = keepRetryable(pending)
  const retry = retryable.filter((t) => touched.has(t))
  const fresh = retryable.filter((t) => !touched.has(t)).slice(0, Math.max(0, RUN_TOUCH_CAP - touched.size))
  const batch = [...retry, ...fresh].slice(0, LIVE_CAP)
  if (!batch.length) break
  round++
  for (const t of batch) {
    attempts.set(t, (attempts.get(t) ?? 0) + 1)
    touched.add(t)
  }
  log(`round ${round}: authoring ${batch.length} page(s) (${touched.size}/${pages.length} touched this run)`)
  await parallel(
    batch.map((title) => () => {
      const card = cardByTitle.get(title)
      const p = pageByPath.get(title) ?? { path: title, title, kind: 'reference', group: 'Reference', brief: '', diataxisType: 'reference', template: '', scope: [] }
      return agent(
        `Author ONE ${framework} documentation page FROM SOURCE, save it to disk, then mark its card. Do NOT run ` +
          `any eatahorse command and do NOT touch any other card or page.\n\n` +
          `1. READ the scope source files below — they are the FACTUAL BASIS. Every signature, export, config ` +
          `key, CLI flag, or example MUST come from the code; never invent API. Cite file:area where useful.\n` +
          `   scope: ${JSON.stringify(p.scope ?? [])}\n\n` +
          `2. WRITE the page (Write tool, create parent dirs) to: ${outDir}/${p.path}\n` +
          `   - title: ${p.title}\n   - kind: ${p.kind}\n   - sidebar group: ${p.group}\n   - must cover: ${p.brief}\n` +
          `   - Diátaxis type: ${p.diataxisType} (serve this ONE reader need; do NOT mix modes)\n` +
          `   - section template: ${p.template || '(use the matching skeleton from the IA contract)'}\n` +
          `   Valid frontmatter (title required; template: splash + hero only for a splash page). Use .mdx with ` +
          `the correct import line iff you use components, else .md. Write the RIGHT SHAPE for the Diátaxis type ` +
          `(a reference is exhaustive/scannable with no narrative; an explanation discusses why/tradeoffs).\n\n` +
          `3. EDIT the card markdown file "${card?.mdPath ?? '(find it under ' + board + '/tasks by title)'}": put ONE ` +
          `line in "## Notes" — the written page path + a one-line grounding summary (which source backs it). ` +
          `Tick EVERY checkbox in "## One-bite-at-a-time plan" and "## Acceptance checks" (- [ ] -> - [x]); ` +
          `ticking acceptance marks the card done on the next sync. Leave frontmatter and other sections intact.\n\n` +
          `If the scope is unreadable/empty so the page can't be grounded, say so in "## Notes" and do NOT tick ` +
          `acceptance (leave it for the gate).\n\n` +
          `Card markdown layout:\n${CARD_MD}\n\nIA CONTRACT\n${IA_CONTRACT}\n\nAUTHORING CONTRACT\n${authoringContract}`,
        { label: `author:${title}`, phase: 'Author', model: workerModel },
      )
    }),
  )

  // Single serialized writer: reconcile the round's card edits into state.json + board.md.
  const sync = await agent(
    `Run \`python3 "${scriptPath}" --board "${board}" sync\` then \`report --json\`. Return activeRemaining ` +
      `(the "active" count) and done (the "done" count). Reporting only; change nothing else.\n\n${cli('sync', 'report')}`,
    { label: `sync:${round}`, phase: 'Author', model: 'haiku', schema: SYNC_SCHEMA },
  )
  if (sync) activeRemaining = sync.activeRemaining

  // Grounding gate (strong model, fresh context): re-read each sampled page's SCOPE SOURCE and the written
  // page; reopen any whose claims the code doesn't back. This is the REAL verifier (hallucinated-API guard),
  // not shape-checking. Reopened cards re-queue for the next round.
  phase('Gate')
  await agent(
    `You are a GROUNDING gate for a code->docs board at "${board}"; the site is written under "${outDir}". ` +
      `Sample up to 8 cards marked done (\`list --status done --json\`, then \`show <id> --json\`). For each ` +
      `sampled card: read its "description" to get the page path + scope, READ those scope SOURCE files, and ` +
      `READ the written page at "${outDir}/<path>". Judge whether the page's concrete claims (signatures, ` +
      `exports, config keys, CLI flags, examples) are actually BACKED by the source — not hallucinated, vague, ` +
      `or empty. For any page NOT grounded, reopen it atomically: \`reopen <id> --gap "<what's unbacked>"\` ` +
      `(unchecks acceptance, notes the gap, moves to doing). Then \`sync\`. Return reopened (hollow) card ` +
      `TITLES and how many you checked.\n\n${cli('list', 'show', 'reopen', 'sync')}`,
    { label: `gate:${round}`, phase: 'Gate', schema: GATE_SCHEMA },
  )

  // Re-derive the carry queue from the board (source of truth).
  const reload = await agent(
    `\`python3 "${scriptPath}" --board "${board}" list --json\`. Return EVERY card as {title, mdPath (its ` +
      `"path"), status}.\n\n${cli('list')}`,
    { label: `reload:${round}`, phase: 'Author', model: 'haiku', schema: SEED_SCHEMA },
  )
  if (reload?.cards?.length) {
    for (const c of reload.cards) cardByTitle.set(c.title, c)
    pending = keepRetryable(reload.cards.filter(notDone).map((c) => c.title))
  } else {
    pending = []
  }
}

const carryOver = pending.filter((t) => !touched.has(t)).length
if (carryOver) log(`carry-over: ${carryOver} page(s) left in backlog (touched ${touched.size}/${pages.length} this run); rerun to continue`)
const stopReason =
  activeRemaining <= 0 ? 'all pages done'
  : touched.size >= RUN_TOUCH_CAP && carryOver ? 'run touch cap (backlog carried)'
  : round >= maxRounds ? 'round cap'
  : pending.length ? 'budget floor'
  : 'no pending'

// 6a. Gather admitted — haiku. Read which page cards survived the gate (done) off the durable board, so a
//     resumed run assembles the WHOLE admitted set, not just this run's slice.
phase('Assemble')
const admittedTitles =
  (
    await agent(
      `\`python3 "${scriptPath}" --board "${board}" list --status done --json\` and return the "title" (page path) ` +
        `of every done card.\n\n${cli('list')}`,
      { label: 'gather-admitted', model: 'haiku', schema: DONE_TITLES_SCHEMA },
    )
  )?.titles ?? []
// Match on the normalized relative path so a board title written under a different convention
// (e.g. an outDir-prefixed title) still maps to its page instead of silently dropping out.
const admittedSet = new Set(admittedTitles.map((t) => normPagePath(t)))
let admittedPages = pages.filter((p) => admittedSet.has(normPagePath(p.path)))
log(`admitted ${admittedPages.length}/${pages.length} grounded page(s)`)

// --- Link/asset resolution (scripted Haiku step; runs before quality gate) --------------------
// Mirrors docs-create.js: fixes broken asset references before the gate so the gate catches
// real authoring errors, not copy-omissions.
if (admittedPages.length) {
  phase('Resolve links/assets')
  const linkResult = await resolveLinksAndAssets(admittedPages, outDir, fwEntry, framework)
  log(`links/assets: ${linkResult.copied?.length ?? 0} copied, ${linkResult.rewritten?.length ?? 0} rewritten, ${linkResult.skipped?.length ?? 0} skipped`)
}

// 6b. Quality gate (strong model, fresh context) — runs after the grounding gate has filtered pages
//     by code backing; this layer checks shape and syntax orthogonal concerns:
//       1. Diataxis adherence: page serves exactly ONE reader need, no mode-mixing.
//       2. Internal link/asset resolution: relative paths must be resolvable under outDir.
//       3. Crosswalk no-leak: Starlight-specific syntax must not appear in non-Starlight pages.
//     Emits per-page {path, pass, issues[]} and drops failing pages before config assembly.
//     Model: Opus — same justification as docs-create.js: a weak gate rubber-stamps.
//     NOTE: grounding (hallucinated API) is handled upstream in the author-loop gate; this gate
//     checks the structural/shape concerns the grounding gate does not cover.
if (admittedPages.length) {
  phase('Quality gate')
  // STARLIGHT_LEAK_PATTERNS comes from the shared frameworks substrate (generated block above).
  const leakNote = framework !== 'starlight' && STARLIGHT_LEAK_PATTERNS.length
    ? `SYNTAX LEAK CHECK — REJECT any page that contains Starlight-specific patterns. These must NOT ` +
      `appear in ${framework} output:\n${STARLIGHT_LEAK_PATTERNS.map((p) => `  - ${p}`).join('\n')}\n`
    : ''
  const docsGate = await agent(
    `You are the quality gate for a ${framework} docs site at "${outDir}". The grounding gate already ` +
    `confirmed each page's concrete claims are backed by source code. Now check SHAPE for each page:\n` +
    `${admittedPages.map((p, i) => `${i + 1}. ${outDir}/${p.path}  (declared type: ${p.diataxisType})`).join('\n')}\n\n` +
    `For EACH page above:\n` +
    `1. READ the page file.\n` +
    `2. Check ALL three criteria and report specific issues for any that fail:\n` +
    `   a. DIATAXIS: Does the page serve exactly the declared Diátaxis type and NOT mix modes? ` +
    `(A reference must be exhaustive/scannable with no narrative; a tutorial must be task-ordered ` +
    `with a visible outcome; a how-to must be goal-then-steps-then-verify; an explanation must ` +
    `discuss context/why without step-by-step.) Mode-mixing fails.\n` +
    `   b. LINKS/ASSETS: Are all internal links and image src paths resolvable under "${outDir}"? ` +
    `External http/https URLs are fine; only check relative internal paths.\n` +
    `   c. CROSSWALK NO-LEAK: ${leakNote || 'N/A (Starlight is the target; no leak check).'}\n` +
    `3. For each page return {path, pass, issues} — pass=true only if ALL checks pass. ` +
    `issues is an empty array when pass=true; list every specific issue when pass=false.\n\n` +
    `A page that fails on ONE criterion is dropped before config assembly. Be strict.\n\n` +
    `Return: pages (per-page verdict), admitted (paths of pass=true pages), dropped (paths of pass=false pages), summary.\n\n` +
    `IA CONTRACT\n${IA_CONTRACT}`,
    { label: 'docs-quality-gate', phase: 'Quality gate', model: 'opus', schema: DOCS_GATE_SCHEMA },
  )
  if (docsGate) {
    // The gate is shown pages as `${outDir}/${p.path}` and echoes verdict paths with that prefix, while
    // p.path is contentRoot-relative — normalize BOTH sides or the filter drops every page (the bug that
    // made admitted collapse to 0 even when the gate passed pages). Mirror gather-admitted.
    const gateAdmitted = new Set((docsGate.admitted ?? admittedPages.map((p) => p.path)).map((t) => normPagePath(t)))
    const gateDropped = docsGate.dropped ?? []
    if (gateDropped.length) log(`quality gate dropped ${gateDropped.length} page(s): ${gateDropped.join(', ')}`)
    admittedPages = admittedPages.filter((p) => gateAdmitted.has(normPagePath(p.path)))
    log(`quality gate: ${admittedPages.length} page(s) admitted for config assembly`)
  }
}

// 6b. Assemble — sonnet, single serialized finalize. Wire the admitted pages into config (content.config.ts
//     + astro.config sidebar), write the durable .docs-plan.md, and run astro check ONLY if buildable.
//     Per-page grounding already happened in the loop gate; this is config + light shape + empirical build.
const assembleGroups = [...new Set(admittedPages.map((p) => p.group))].join(', ') || '(none)'
// Empirical-check step. The shared assemblePrompt is config-only (the build step lives here so it is
// framework-general, driven by fwEntry.validate.buildCmd which the shared registry now provides for
// all frameworks — not just Starlight's astro check). content-only/add-to-existing run the build only
// if the project is already installable; full-project's buildCmd installs first.
const assembleBuildCmd = fwEntry.validate?.buildCmd?.(outDir, scaffoldMode)
const buildStep = assembleBuildCmd
  ? `6. EMPIRICAL CHECK: if "${outDir}" is a buildable project (${fwEntry.validate.prerequisiteNote ?? 'build deps installed'}), ` +
    `run \`${assembleBuildCmd}\` and summarize pass/fail in buildResult. If it is NOT buildable` +
    `${scaffoldMode === 'full-project' ? '' : ' (and scaffoldMode is not full-project)'}, set buildResult to ` +
    `"skipped: not a buildable project" — do NOT install deps yourself.\n`
  : `6. EMPIRICAL CHECK: set buildResult to "skipped: ${fwEntry.validate?.skipReason ?? 'framework build not run'}".\n`
const final = admittedPages.length
  ? await agent(
      `You are the finalizer for a ${framework} docs site at "${outDir}". These pages were authored and passed ` +
        `the grounding gate (admitted):\n${JSON.stringify(admittedPages.map((p) => ({ path: p.path, group: p.group, diataxisType: p.diataxisType })), null, 2)}\n\n` +
        `Do, in order:\n` +
        fwEntry.assemblePrompt(outDir, assembleGroups, scaffoldMode, { basePath, i18n, versioning, site }) +
        `4. Light IA pass: confirm each admitted page matches its declared Diátaxis type; fix tiny shape ` +
        `mismatches in place with Edit, note them in decisions. (Deep grounding already happened upstream.)\n` +
        `5. Write ${outDir}/.docs-plan.md: the admitted page list + sidebar structure + decisions + the deferred ` +
        `pages below (needs human brief). This is the durable record.\n` +
        `   deferred: ${JSON.stringify(deferred)}\n` +
        buildStep + `\n` +
        `Return configWritten, buildResult, planPath, decisions, summary.\n\n` +
        `IA CONTRACT\n${IA_CONTRACT}\n\nAUTHORING CONTRACT\n${authoringContract}`,
      { label: 'assemble', model: 'sonnet', schema: FINAL_SCHEMA },
    )
  : { configWritten: false, buildResult: 'skipped: no admitted pages', summary: 'no pages were grounded this run' }

// 6c. Opt-in build verifier (verify=true) — strengthen the assemble step's "only if already buildable" check
//     into a real end-to-end install+build. Default OFF: it pulls deps and builds generated config (same
//     opt-in stance as the scaffold workflow's verify=false). Catches stale dep pins (ERESOLVE) and config
//     syntax that the LLM gates miss. Only meaningful when config was actually written.
let verified = null
let verifyResult = null
// Require a CONFIRMED config write (=== true), not "not-false": if the finalizer agent died, `final` is
// null and `final?.configWritten !== false` would be true, sending the verifier to build a site whose
// config was never assembled — failing for a reason unrelated to deps and masking the finalizer death.
if (verify && admittedPages.length && final?.configWritten === true) {
  phase('Verify')
  verifyResult = await agent(
    `You are the build verifier for the ${framework} docs site at "${outDir}". Make it build end-to-end:\n` +
      `1. Ensure "${outDir}/package.json" exists with the pinned dependencies AND scripts (dev/build/preview) ` +
      `from the authoring contract. Create it if missing; if it exists, only add what is missing — do NOT clobber.\n` +
      `2. Run \`npm install --prefix "${outDir}"\`. If it fails with a peer/ERESOLVE conflict, REPORT the exact ` +
      `conflict in buildResult — do NOT retry with --force or --legacy-peer-deps (that hides a real version bug).\n` +
      `3. Build: \`npm run build --prefix "${outDir}"\`.\n` +
      `4. Return verified=true ONLY if BOTH install and build succeed. On any failure set verified=false and put ` +
      `the first ~15 lines of the actual error in buildResult. Never edit page content to force a green build.\n\n` +
      `AUTHORING CONTRACT\n${authoringContract}`,
    { label: 'verify', model: 'sonnet', schema: { type: 'object', properties: { verified: { type: 'boolean' }, buildResult: { type: 'string' } }, required: ['verified', 'buildResult'] } },
  )
  // Distinguish a genuine build failure (verifyResult.verified === false) from a dead verify agent
  // (verifyResult === null): the latter is UNKNOWN, not "failed" — don't fail the whole run on a
  // transient agent death, and don't let buildResult contradict a forced-false verdict.
  verified = verifyResult ? (verifyResult.verified ?? false) : null
  if (verifyResult == null) log('verify: agent returned nothing — build status UNKNOWN (not a failure)')
  else log(verified ? 'verify: build OK' : `verify: build FAILED — ${verifyResult?.buildResult ?? 'no detail'}`)
}

// Loud failure: pages were planned/authored but none reached config assembly. The run wrote no usable
// config; it MUST NOT read as success. (Pre-fix, this returned written:true silently.)
const noConfigDespitePages = pages.length > 0 && admittedPages.length === 0
if (noConfigDespitePages)
  log(`ERROR: ${pages.length} page(s) planned but 0 admitted — NO config written, site is not buildable. ` +
      `Check the quality gate verdicts and page-path conventions.`)
const ok = !noConfigDespitePages && verified !== false
const runError = noConfigDespitePages ? 'no pages admitted — config not written'
  : verified === false ? 'build verification failed'
  : null

// 7. Write-back — sonnet. Persist a short CLAUDE.md section + deferred/skipped constraints so a rerun and a
//    human know what was covered and what still needs a brief.
phase('Write-back')
await agent(
  `Append a short dated section to the DOCUMENTED repo's CLAUDE.md at "${root}/CLAUDE.md" (NOT the current ` +
    `working directory's CLAUDE.md — run notes about "${root}" belong with "${root}"). Create it if absent; ` +
    `MERGE, do not clobber. Record: ` +
    `the codebase documented ("${root}"), the docs site location ("${outDir}"), how many pages were admitted ` +
    `(${admittedPages.length} of ${pages.length} planned this run${carryOver ? `, ${carryOver} left in backlog for a rerun` : ''}), ` +
    `the board ("${board}"), the doc-coverage gap count (${docGaps.length} public symbol(s) found without a doc ` +
    `comment${docGaps.length ? `; see ${outDir}/src/content/docs/reference/documentation-gaps.md` : ''}), and — as ` +
    `CONSTRAINTS so a rerun does not re-walk them — the DEFERRED pages that ` +
    `need a human brief and any source skipped. Keep it short; do not document the obvious file tree.\n\n` +
    `Deferred (needs human brief): ${JSON.stringify(deferred)}\n` +
    `stopReason="${stopReason}"; rounds=${round}; admitted page paths: ${JSON.stringify(admittedPages.map((p) => p.path))}\n` +
    `Finalizer summary: ${final?.summary ?? '(none)'} ; buildResult: ${final?.buildResult ?? '(none)'}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  root,
  outDir,
  framework,
  scaffoldMode,
  board,
  planned: pages.length,
  generated: generatedPages.length,
  admitted: admittedPages.length,
  deferred: deferred.length,
  undocumentedCount: docGaps.length,
  touched: touched.size,
  carryOver,
  rounds: round,
  activeRemaining,
  stopReason,
  detectedLanes: activeLanes.map((l) => l.id),
  generatedLanes: generatedPages.length ? [...new Set(generatedPages.flatMap((p) => p.scope ?? []))].slice(0, 10) : [],
  configWritten: final?.configWritten ?? false,
  buildResult: verifyResult?.buildResult ?? final?.buildResult,
  verified,
  planPath: final?.planPath,
  written: true,
  ok,
  error: runError,
}
