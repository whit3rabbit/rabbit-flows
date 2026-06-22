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
//     MkDocs/mike); noted and skipped for frameworks without built-in versioning.
//
// requires-skills: eatahorse, docs-site-builder, document-codebase
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

\`docsLoader()\` uses the Content Layer API (Astro v5+). For an older project that can't
migrate collections yet, the \`legacy.collectionsBackwardsCompat\` flag preserves v4 behavior.

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

// --- FRAMEWORKS registry -----------------------------------------------------------------------
// Mirror of docs-create.js FRAMEWORKS. Single source of truth per framework; keyed by framework id.
// Only Starlight has an inline authoring contract; other frameworks fall back to current official docs.
// The sentinel key "_unfilled" is the runtime fallback for any unrecognised framework id.
// assemblePrompt is injected into the finalize agent (step 1-3 block in Phase 6b).
const FRAMEWORKS = {
  starlight: {
    contentRoot: 'src/content/docs',
    configFiles: ['astro.config.mjs', 'src/content.config.ts'],
    assetDir: 'src/assets',
    contract: CONTRACT,
    // scaffoldMode routing (mirrors docs-create.js):
    //   content-only (default): write content + config; empirical check skipped unless already buildable.
    //   add-to-existing: same but PATCH existing astro.config rather than assembling from scratch.
    //   full-project: scaffold a complete buildable project (package.json + npm install) then run astro check.
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Astro top-level `base` option in defineConfig.
      const baseNote = basePath
        ? `   Set base: '${basePath}' in the defineConfig() call (outside starlight()) in astro.config.mjs.\n`
        : ''
      // i18n -> Starlight locales config.
      const i18nNote = i18n
        ? `   Add locales: { ${i18n.locales.map(l => `'${l}': { label: '${l}' }`).join(', ')} } and defaultLocale: '${i18n.defaultLocale}' ` +
          `inside the starlight() integration config.\n`
        : ''
      // Starlight has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: Starlight has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use manual subpath routing or community plugins if needed.\n`
        : ''
      return (
        `1. Ensure the content collection exists: write ${outDir}/src/content.config.ts with docsLoader()+docsSchema() if missing.\n` +
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) ${outDir}/astro.config.mjs: patch the sidebar to reflect the admitted ` +
            `page groups (${groups}). Use slug items for the admitted pages; update the title only if missing.\n`
          : `2. Assemble ${outDir}/astro.config.mjs: a starlight() integration whose sidebar reflects the admitted ` +
            `page groups (${groups}). Use slug items for the admitted pages; derive a title from the repo/brief. ` +
            `If an astro.config already exists, update its sidebar/title rather than clobbering unrelated config.\n`) +
        (scaffoldMode === 'full-project'
          ? `3. SCAFFOLD: if "${outDir}" has no package.json, create a minimal one (name from repo/brief, astro + @astrojs/starlight as deps). ` +
            `Run \`npm install --prefix "${outDir}"\` (or skip if node_modules already present). ` +
            `Then run \`npx astro check\` from "${outDir}" and summarize pass/fail in buildResult.\n`
          : `3. EMPIRICAL CHECK: if "${outDir}" is a buildable Astro project (has package.json with astro + node_modules), ` +
            `run \`npx astro check\` from there and summarize pass/fail in buildResult. If it is NOT buildable (no install), ` +
            `set buildResult to "skipped: not a buildable project" — do NOT run npm install. ` +
            `// ponytail: content + config only by design; scaffolding a full installable project is the upgrade if astro check must always run.\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: null,
  },
  _unfilled: {
    contentRoot: null,
    configFiles: [],
    assetDir: null,
    contract: null,
    // scaffoldMode is plumbed through for consistency; full-project is unsupported for unfilled frameworks.
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      const baseNote = basePath
        ? `   If the framework has a config key for the serving subpath, set it to '${basePath}'.\n`
        : ''
      const i18nNote = i18n
        ? `   If the framework supports i18n, configure defaultLocale="${i18n.defaultLocale}" ` +
          `and locales=[${i18n.locales.join(', ')}] per current framework docs.\n`
        : ''
      const versioningNote = versioning
        ? `   If the framework supports versioning, set the current version to "${versioning.current}" per current framework docs.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `1. UPDATE (do NOT clobber) the primary config — patch nav/sidebar to reflect groups: ${groups}; ` +
            `update the title only if missing. Use current framework config syntax.\n`
          : `1. Write or repair the primary config (nav/sidebar reflecting groups: ${groups}; title from repo/brief), ` +
            `using current framework config syntax; update rather than clobber an existing config.\n`) +
        `2. (no Astro content collection step for this framework.)\n` +
        `3. EMPIRICAL CHECK: set buildResult to "skipped: framework build not run".\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: null,
  },
}

// --- resolveLinksAndAssets (shared helper; mirrored from docs-create.js) -----------------------
// Runs after authoring, before the quality gate. Scans each written page for local asset
// references (markdown images, HTML img src), copies found files to the framework's assetDir,
// and rewrites the page's src/href to the framework-correct route.
// Returns { copied, rewritten, skipped }. Skips cleanly when fwEntry.assetDir is null.
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
       `use a path relative to the framework's asset directory.`}\n` +
    `   Use the Edit tool to rewrite the reference in the page file.\n` +
    `3. If the source file does NOT exist at the referenced path, record it in "skipped" with the reason ` +
    `   "source not found" — do not attempt to copy a file that does not exist.\n` +
    `4. External URLs (http/https/ftp) and root-relative paths that already point into the asset dir ` +
    `   are SKIPPED (no action needed).\n\n` +
    `PAGES:\n${pageList}\n\n` +
    `Return: copied (array of {src, dest}), rewritten (array of {page, from, to}), ` +
    `skipped (array of strings), summary (one sentence).`,
    {
      label: 'resolve-links-assets',
      phase: 'Resolve links/assets',
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
    `\`add "<path>" --status done -d "<description>" --bite "generated by lane worker [x]" --accept "page written and grounded in source [x]"\`. ` +
    `Use checked bites/acceptance so the card is immediately done.\n` +
    `   - Otherwise: \`add "<path>" --status backlog -d "<description>" --bite "author it" --accept "page written and grounded in source"\`.\n` +
    `   Do NOT re-add existing titles and do NOT change cards already done (supports resume).\n` +
    `3. \`sync\`, then \`list --json\`. Return EVERY card as {title, mdPath (its "path" field), status}.\n` +
    `Do not author anything yet.\n\n${cli('report', 'init', 'add', 'sync', 'list')}\n\n` +
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
const admittedSet = new Set(admittedTitles)
let admittedPages = pages.filter((p) => admittedSet.has(p.path))
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
  const starlightLeakPatterns = [
    '@astrojs/starlight', '<Aside', '<Card', '<CardGrid', '<FileTree',
    '<Steps', '<Tabs', '<TabItem', '<LinkCard', '<LinkButton', '<Badge',
  ]
  const leakNote = framework !== 'starlight' && starlightLeakPatterns.length
    ? `SYNTAX LEAK CHECK — REJECT any page that contains Starlight-specific patterns. These must NOT ` +
      `appear in ${framework} output:\n${starlightLeakPatterns.map((p) => `  - ${p}`).join('\n')}\n`
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
    const gateAdmitted = new Set(docsGate.admitted ?? admittedPages.map((p) => p.path))
    const gateDropped = docsGate.dropped ?? []
    if (gateDropped.length) log(`quality gate dropped ${gateDropped.length} page(s): ${gateDropped.join(', ')}`)
    admittedPages = admittedPages.filter((p) => gateAdmitted.has(p.path))
    log(`quality gate: ${admittedPages.length} page(s) admitted for config assembly`)
  }
}

// 6b. Assemble — sonnet, single serialized finalize. Wire the admitted pages into config (content.config.ts
//     + astro.config sidebar), write the durable .docs-plan.md, and run astro check ONLY if buildable.
//     Per-page grounding already happened in the loop gate; this is config + light shape + empirical build.
const assembleGroups = [...new Set(admittedPages.map((p) => p.group))].join(', ') || '(none)'
const final = admittedPages.length
  ? await agent(
      `You are the finalizer for a ${framework} docs site at "${outDir}". These pages were authored and passed ` +
        `the grounding gate (admitted):\n${JSON.stringify(admittedPages.map((p) => ({ path: p.path, group: p.group, diataxisType: p.diataxisType })), null, 2)}\n\n` +
        `Do, in order:\n` +
        fwEntry.assemblePrompt(outDir, assembleGroups, scaffoldMode, { basePath, i18n, versioning }) +
        `4. Light IA pass: confirm each admitted page matches its declared Diátaxis type; fix tiny shape ` +
        `mismatches in place with Edit, note them in decisions. (Deep grounding already happened upstream.)\n` +
        `5. Write ${outDir}/.docs-plan.md: the admitted page list + sidebar structure + decisions + the deferred ` +
        `pages below (needs human brief). This is the durable record.\n` +
        `   deferred: ${JSON.stringify(deferred)}\n\n` +
        `Return configWritten, buildResult, planPath, decisions, summary.\n\n` +
        `IA CONTRACT\n${IA_CONTRACT}\n\nAUTHORING CONTRACT\n${authoringContract}`,
      { label: 'assemble', model: 'sonnet', schema: FINAL_SCHEMA },
    )
  : { configWritten: false, buildResult: 'skipped: no admitted pages', summary: 'no pages were grounded this run' }

// 7. Write-back — sonnet. Persist a short CLAUDE.md section + deferred/skipped constraints so a rerun and a
//    human know what was covered and what still needs a brief.
phase('Write-back')
await agent(
  `Append a short dated section to the project's CLAUDE.md (create if absent; MERGE, do not clobber). Record: ` +
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
  buildResult: final?.buildResult,
  planPath: final?.planPath,
  written: true,
}
