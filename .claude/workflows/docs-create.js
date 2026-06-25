// docs-create — author a documentation site (Astro Starlight) from a brief, in one rerunnable run.
//
// WHY this shape (deviations from the default spine, noted per CLAUDE.md "Bending"):
//   - The author workers do NOT load the docs-site-builder skill at runtime. They CAN'T: agent() has
//     no `skills` option, and a worker only sees a skill via the Skill tool if it's registered in the
//     session (WORKFLOW_ANALYSIS.md). Even when available, running the full skill dance (read SKILL.md
//     -> pick refs -> read refs) on every page is MORE calls, the opposite of the goal here. So the
//     skill's distilled contract is baked inline below (CONTRACT) and injected into every author. That
//     is the sanctioned pattern: the inline prompt is the runtime source; the skill is the portable copy.
//     `refsDir` is passed only as a deep-escalation fallback for edge cases the contract doesn't cover.
//   - The admission gate is a SINGLE batched call over all pages, not one verifier per page. Pages are
//     small and independent; one strong-model pass keeps the call count low (the explicit ask) while
//     still being a fresh-context check separate from the authors. It also pairs LLM review with an
//     empirical `astro build`/`astro check` when the target is a buildable project (workflow-design.md).
//   - A QUALITY GATE phase runs between Author and Verify & finalize (strong model, fresh context per
//     workflow-design.md). It reads each written page and checks: Diataxis adherence (no mode-mixing),
//     internal link/asset path resolution, crosswalk no-leak check (Starlight syntax in non-Starlight
//     output), and that reference pages cite their sources. Emits per-page {path, pass, issues[]} and
//     drops failures so only admitted pages reach config assembly + the empirical build. This mirrors
//     the deep-research admission-gate pattern and is kept separate from the verify agent (config assembly).
//   - A FRAME IA stage runs before Plan (strong model, inherits session). Good docs are an information-
//     architecture problem before a syntax one: this pass frames audiences, the reader journey, the
//     Diátaxis split, and the sidebar shape, so Plan can tag each page with a diataxisType + section
//     template and authors write the RIGHT SHAPE of page (a reference isn't secretly a tutorial). It
//     sets the trajectory, so it gets the strong model (model-routing.md). Skipped when `pages` is
//     supplied. Its contract is baked inline below (IA_CONTRACT), same runtime-source rule as CONTRACT.
//
// Calls per run ~= 1 (frame IA) + 1 (plan) + N (one author per page) + 1 (link/asset resolve) + 1 (quality gate) + 1 (verify & finalize).
// The link/asset resolver (one Haiku batch call) runs between Author and Quality gate; it copies
// referenced local assets to the framework's assetDir and rewrites src/href paths so the quality
// gate sees resolved routes, not authoring placeholders.
//
// args: {
//   brief:         string  (required) what the docs cover + any authoring instructions
//   outDir:        string  (required) absolute or repo-relative dir to write the site into
//   sources?:      string[]          files the authors should read as source material
//   framework?:    string            default 'starlight' (only framework with an inline contract)
//   scaffoldMode?: 'content-only' | 'add-to-existing' | 'full-project'
//                  default 'content-only' — write page content + config only (today's behavior).
//                  'add-to-existing' — same but never scaffold the project; skip config clobbering.
//                  'full-project'    — scaffold a complete buildable project (package.json, install, etc.).
//   pages?:        [{path,title,kind,group,brief,diataxisType?,template?}]  skip Frame IA + Plan, author exactly these
//   refsDir?:      string            default points at this repo's docs-site-builder references
//   basePath?:     string            subpath the site is served from, e.g. '/docs' or '/my-lib'.
//                  Mapped to the framework's base/baseUrl/site_url config key when supported.
//                  Ignored with a log note for frameworks that don't support it (Docsify, Fumadocs, Mintlify, etc.).
//   i18n?:         {defaultLocale: string, locales: string[]}  enable multi-locale output.
//                  Mapped to each framework's i18n/locales config block where supported; skipped with a note where not.
//   versioning?:   {current: string, versions?: string[]}  set the docs version label and, where supported
//                  (Docusaurus, MkDocs/mike, Sphinx), the versioned build config. Skipped with a note elsewhere.
//   site?:         string            full production URL, e.g. 'https://docs.example.com'. Set as Astro `site:`
//                  in defineConfig (Starlight auto-adds @astrojs/sitemap, which needs it); skipped elsewhere.
// }

// requires-skills: docs-site-builder, document
export const meta = {
  name: 'docs-create',
  description: 'Author a documentation site from a written brief, no codebase needed: plan the pages, write each one, then verify and assemble the site config. Starlight is first-class; other frameworks are authored from current docs.',
  whenToUse: 'Use to create docs from an idea or brief when there is no codebase yet. Front door: the document skill.',
  phases: [
    { title: 'Frame IA', detail: 'one strong-model call: brief -> audiences, journey, Diátaxis split, sidebar shape' },
    { title: 'Plan', detail: 'one strong-model call: IA + brief -> page list, each tagged diataxisType + template' },
    { title: 'Author', detail: 'one Sonnet worker per page; each writes its file from the inline contract' },
    { title: 'Resolve links/assets', detail: 'one Haiku batch call: copy referenced local assets to assetDir, rewrite src/href to framework-correct routes' },
    { title: 'Quality gate', detail: 'one Opus call: per-page Diataxis adherence, link/asset resolution, crosswalk no-leak, reference sources; drops failures before build' },
    { title: 'Verify & finalize', detail: 'one strong-model call: review admitted pages vs contract, fix, write astro.config + decisions' },
  ],
}

// --- Starlight authoring contract (distilled from the docs-site-builder skill, v0.40.0) ---------
// This is the authors' single source of truth at runtime. If the skill's references change, refresh
// this block from plugins/workflow-kit/skills/docs-site-builder/references/*.md. Keep it compact.
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
// Framework-agnostic docs DESIGN guidance, injected into Plan + every author so pages get the right
// SHAPE, not just valid syntax. Runtime source of truth; refresh from the reference if it changes.
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
the single highest-leverage page; design the journey backwards from it.

## Archetypes: what docs a project needs

Diátaxis shapes a page *once you've decided to write it*. This decides **which pages a given project
should have, and whether it needs a site at all.** Identify the archetype first, then plan the
minimum-viable set for it — do not pour every project into the full four-quadrant spread.

| Archetype | Must-have | High-value | Skip / deprioritize |
|---|---|---|---|
| **CLI tool** | command reference, quickstart | install/config how-to | tutorials, deep explanation |
| **Library / SDK** | API reference, getting-started | how-tos, tutorials, key-concepts explanation | ops/deployment |
| **Service / API** | endpoint reference (OpenAPI), auth + deploy runbook | integration how-tos | beginner tutorial |
| **Internal tool / app** | README, runbook, ADRs | onboarding how-to | public splash, marketing |
| **Framework / platform** | getting-started, guides, full reference | tutorials, explanation, migration guides | — (the full spread fits) |

**Minimum-viable-docs baseline (every archetype clears this floor):** a one-paragraph "what this is
+ who it's for", a getting-started that hits first success in ~5 min (the rule above), and one
reference surface for the project's primary interface (commands, API, or endpoints). Everything else
is earned by the archetype, not added by default.

**Two skeletons the four quadrants don't cover** (use when the archetype calls for them):
- **ADR** (architecture decision record) — context (forces at play) → decision → consequences
  (what this commits us to, what it rules out). One decision per record, dated, immutable once
  accepted.
- **Runbook** — symptom / trigger → diagnosis steps → remediation → escalation + rollback. Written
  for an on-call reader at 3am: scannable, imperative, no theory.
- "CLI command page" is a reference entry (signature, flags, example) and "library quickstart" is a
  tutorial — variants of existing quadrants, not new shapes.

**Does this even need a multi-page site?** Match output shape to archetype + size, and record the
verdict so the reader can act on it:
- **single-file** (one README/markdown file) — a CLI or small library whose whole surface fits one
  scannable page. A multi-page site here is overhead.
- **embedded** (docstrings / inline API comments in source, not a separate site) — a library whose
  API reference belongs next to the code it documents.
- **site** — anything with multiple audiences, a real reader journey, or a reference surface too
  large for one page (frameworks, platforms, larger services).

This is a recommendation the planner records, not a branch it takes: note the archetype and the
recommended shape even when the run still builds a site, so a maintainer sees "this is a CLI tool; a
single README likely suffices" and can choose.`
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
// --- Repair loop constants ---------------------------------------------------------------------
// MAX_REPAIR_ITERS: max times the build-error-fed fix agent retries before giving up.
// Kept low: each iteration is a Sonnet agent call + a build run. 3 covers most transient issues.
const MAX_REPAIR_ITERS = 3

// REPAIR_SCHEMA: the fix agent emits what it changed so the loop can log progress.
const REPAIR_SCHEMA = {
  type: 'object', required: ['filesEdited', 'summary'], additionalProperties: false,
  properties: {
    filesEdited: { type: 'array', items: { type: 'string' }, description: 'absolute paths of files the agent changed' },
    summary: { type: 'string', description: 'one sentence: what was wrong and what was fixed' },
  },
}

// runBuildRepairLoop: runs fw.validate.buildCmd in a bash agent, feeds errors to a Sonnet fix
// agent if the build fails, and repeats up to MAX_REPAIR_ITERS. Returns { buildResult, repairIterations }.
// Skips cleanly when buildCmd returns null (client-side frameworks), when no validate config, or
// when the project is not yet installable (no node_modules / binary absent) and scaffoldMode is
// not 'full-project' (because full-project installs as part of the build command itself).
// Called after the verify/finalize agent (steps 1-3+5) so it only sees a post-gated, config-assembled site.
async function runBuildRepairLoop(fw, outDir, scaffoldMode, authoringContract, framework) {
  if (!fw.validate) {
    return { buildResult: 'skipped: no validate config', repairIterations: 0 }
  }
  const cmd = fw.validate.buildCmd(outDir, scaffoldMode)
  if (!cmd) {
    return { buildResult: `skipped: ${fw.validate.skipReason ?? 'no build step'}`, repairIterations: 0 }
  }

  // 'not buildable' gate: for content-only and add-to-existing modes, verify that install
  // prerequisites are met before burning agent calls on a doomed build. full-project mode
  // includes the install step in buildCmd itself, so it always proceeds.
  if (scaffoldMode !== 'full-project' && fw.validate.prerequisiteNote) {
    const prereqCheck = await agent(
      `Check whether this project at "${outDir}" satisfies the following build prerequisite:\n` +
      `"${fw.validate.prerequisiteNote}"\n\n` +
      `Concretely: look for package.json, node_modules, required binaries, or config files as implied ` +
      `by the prerequisite description. Return {"buildable": true} if prerequisites are met, ` +
      `{"buildable": false} if they are not (e.g. node_modules missing, binary not found).`,
      {
        label: 'prereq-check',
        phase: 'Verify & finalize',
        model: 'haiku',
        schema: {
          type: 'object', required: ['buildable'], additionalProperties: false,
          properties: { buildable: { type: 'boolean' } },
        },
      },
    )
    if (!prereqCheck?.buildable) {
      log(`build skipped: not buildable — ${fw.validate.prerequisiteNote}`)
      return { buildResult: `skipped: not buildable (${fw.validate.prerequisiteNote})`, repairIterations: 0 }
    }
  }

  let iterations = 0
  let buildResult = 'pending'

  for (let iter = 0; iter <= MAX_REPAIR_ITERS; iter++) {
    // Run the build via a bash agent (Haiku is sufficient for run-and-report).
    const buildAgent = await agent(
      `Run this exact shell command from the repo root and report the outcome:\n\`\`\`\n${cmd}\n\`\`\`\n` +
      `Return a JSON object with:\n` +
      `- exitCode: number (0 = success)\n` +
      `- stdout: string (first 4000 chars of combined stdout+stderr)\n` +
      `- passed: boolean (exitCode === 0)`,
      {
        label: `build-check:iter${iter}`,
        phase: 'Verify & finalize',
        model: 'haiku',
        schema: {
          type: 'object', required: ['exitCode', 'stdout', 'passed'], additionalProperties: false,
          properties: {
            exitCode: { type: 'number' },
            stdout: { type: 'string' },
            passed: { type: 'boolean' },
          },
        },
      },
    )

    if (!buildAgent) {
      buildResult = 'skipped: build agent returned null'
      break
    }

    if (buildAgent.passed) {
      buildResult = iter === 0
        ? 'pass (first run)'
        : `pass after ${iter} repair iteration${iter === 1 ? '' : 's'}`
      iterations = iter
      break
    }

    // Build failed — parse errors and decide whether to repair.
    const rawErrors = fw.validate.parseErrors(buildAgent.stdout ?? '')
    const errorSummary = rawErrors.length
      ? rawErrors.slice(0, 20).join('\n')
      : buildAgent.stdout?.slice(0, 2000) ?? '(no output)'

    if (iter === MAX_REPAIR_ITERS) {
      buildResult = `fail after ${iter} repair iteration${iter === 1 ? '' : 's'}: ${errorSummary.slice(0, 300)}`
      iterations = iter
      break
    }

    // Pass errors to a Sonnet fix agent.
    log(`build failed (iter ${iter}); ${rawErrors.length} error line(s) — invoking repair agent`)
    await agent(
      `You are repairing a ${framework} documentation site at "${outDir}" that failed its build check.\n\n` +
      `BUILD ERRORS (iter ${iter + 1}/${MAX_REPAIR_ITERS}):\n${errorSummary}\n\n` +
      `Your job: read the failing files, fix ONLY the errors listed above using the Edit tool. ` +
      `Do NOT restructure content or change prose. Target the specific files mentioned in the error output.\n\n` +
      `AUTHORING CONTRACT\n${authoringContract}`,
      { label: `repair:iter${iter}`, phase: 'Verify & finalize', model: 'sonnet', schema: REPAIR_SCHEMA },
    )
  }

  return { buildResult, repairIterations: iterations }
}

// --- args / guards -----------------------------------------------------------------------------
const brief = typeof args?.brief === 'string' ? args.brief : null
const outDir = typeof args?.outDir === 'string' ? args.outDir : null
// The quality gate is shown pages as `${outDir}/${path}` and may echo verdict paths WITH that prefix,
// while page paths are stored outDir-relative. Normalize both sides of the admitted/dropped match or the
// gate silently drops every page. Mirrors docs-from-code's normPagePath.
const _relOutDir = String(outDir ?? '').replace(/^\.\//, '').replace(/\/+$/, '')
const normPagePath = (pp) => {
  let s = String(pp ?? '').replace(/^\.\//, '')
  if (_relOutDir && s.startsWith(_relOutDir + '/')) s = s.slice(_relOutDir.length + 1)
  return s
}
const framework = args?.framework ?? 'starlight'
// Resolve the registry entry; unknown frameworks fall back to the _unfilled sentinel.
const fwEntry = FRAMEWORKS[framework] ?? FRAMEWORKS._unfilled
const sources = Array.isArray(args?.sources) ? args.sources : []
const explicitPages = Array.isArray(args?.pages) ? args.pages.filter(Boolean) : null
// scaffoldMode: 'content-only' (default) | 'add-to-existing' | 'full-project'. Default preserves prior behavior.
const SCAFFOLD_MODES = ['content-only', 'add-to-existing', 'full-project']
const scaffoldMode = SCAFFOLD_MODES.includes(args?.scaffoldMode) ? args.scaffoldMode : 'content-only'
// Starlight refs are distilled; other frameworks point at their (skeleton) folder, not the Starlight refs.
const refsDir = args?.refsDir ?? (fwEntry.contentRoot
  ? 'plugins/workflow-kit/skills/docs-site-builder/references'
  : `plugins/workflow-kit/skills/docs-site-builder/frameworks/${framework}`)

// basePath: subpath the site is served under (e.g. '/docs'). Passed to assemblePrompt for frameworks that
// have a config key for it (Astro base, Docusaurus baseUrl, MkDocs site_url, etc.). Null = not specified.
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

// site: full production URL (e.g. 'https://docs.example.com'). Set as Astro `site:` in defineConfig
// (Starlight auto-adds @astrojs/sitemap, which needs it; also fixes canonical URLs). Null = not specified.
const site = typeof args?.site === 'string' && args.site.trim() ? args.site.trim() : null

if (basePath) log(`basePath="${basePath}" will be injected into framework config where supported`)
if (site) log(`site="${site}" will be set as the production URL in framework config where supported`)
if (i18n) log(`i18n enabled: defaultLocale="${i18n.defaultLocale}", locales=[${i18n.locales.join(', ')}]`)
if (versioning) log(`versioning enabled: current="${versioning.current}"${versioning.versions.length ? `, versions=[${versioning.versions.join(', ')}]` : ''}`)

if (!brief || !outDir) {
  return { error: 'args.brief and args.outDir are required', got: { brief, outDir } }
}

// crosswalkNote: the active framework's crosswalk column, ready to inject into prompts.
// Null when the framework has no filled crosswalk entries (authors fall back to framework docs).
const crosswalkNote = getCrosswalkColumn(framework)

// leakNote: for the quality gate — what Starlight patterns must NOT appear in non-Starlight output.
// Only injected when framework is not starlight (no leak risk within Starlight itself).
const leakNote = framework !== 'starlight' && STARLIGHT_LEAK_PATTERNS.length
  ? `SYNTAX LEAK CHECK — REJECT or FIX any page that contains Starlight-specific patterns. ` +
    `These patterns must NOT appear in ${framework} output:\n` +
    STARLIGHT_LEAK_PATTERNS.map(p => `  - ${p}`).join('\n') + '\n'
  : ''

// Only registered frameworks with a populated `contract` field have an inline authoring contract.
// Other frameworks (fwEntry === _unfilled) work from the current official docs (find-docs / context7).
const authoringContract = fwEntry.contract
  ?? `AUTHORING NOTE: there is NO inline syntax contract for "${framework}". Do NOT emit Starlight syntax. ` +
     `Author from the CURRENT official ${framework} documentation (use the find-docs skill / context7). ` +
     `Never invent config keys, frontmatter, or component syntax from memory. Mark anything you are unsure of. ` +
     `Work from the current docs, NOT from this workflow's contract block.`
if (!fwEntry.contract) {
  log(`framework="${framework}" has no inline contract; authors will work from current ${framework} docs. Starlight is the first-class path.`)
}

const sourcesNote = sources.length
  ? `\nSource material to read first (use as the factual basis, do not invent):\n${sources.map(s => `- ${s}`).join('\n')}`
  : '\nNo source files provided; write from the brief and general knowledge, and mark anything uncertain.'

// --- schemas -----------------------------------------------------------------------------------
const IA_SCHEMA = {
  type: 'object', required: ['audiences', 'journey', 'diataxis', 'sidebar'], additionalProperties: false,
  properties: {
    archetype: { type: 'string', description: 'project archetype per the IA contract: cli | library | service-api | internal-tool | framework-platform (or the closest fit + why)' },
    siteRecommendation: { enum: ['site', 'single-file', 'embedded'], description: 'advisory output shape for this archetype+scope; recorded even though this run still builds a site' },
    audiences: { type: 'array', items: { type: 'string' }, description: 'who the docs serve + their goal' },
    journey: { type: 'array', items: { type: 'string' }, description: 'ordered steps: first-touch -> proficient' },
    diataxis: {
      type: 'object', additionalProperties: false,
      properties: {
        tutorial: { type: 'string', description: 'count/intent of tutorial pages this set needs' },
        howto: { type: 'string' }, reference: { type: 'string' }, explanation: { type: 'string' },
      },
    },
    sidebar: { type: 'array', items: { type: 'object' }, description: 'group structure + ordering (the shape, not raw pages)' },
  },
}

const PLAN_SCHEMA = {
  type: 'object', required: ['pages'], additionalProperties: false,
  properties: {
    pages: { type: 'array', items: {
      type: 'object', required: ['path', 'title', 'kind', 'group', 'brief', 'diataxisType', 'template'], additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'repo-relative under outDir, e.g. src/content/docs/guides/intro.md(x)' },
        title: { type: 'string' },
        kind: { enum: ['index', 'splash', 'guide', 'reference'] },
        group: { type: 'string', description: 'sidebar group label, e.g. Guides / Reference' },
        brief: { type: 'string', description: 'what this page must cover' },
        diataxisType: { enum: ['tutorial', 'howto', 'reference', 'explanation', 'index', 'splash'], description: 'the ONE reader need this page serves' },
        template: { type: 'string', description: 'the section skeleton the author must follow for this diataxisType' },
      } } },
    sidebar: { type: 'array', items: { type: 'object' }, description: 'optional explicit astro.config sidebar' },
  },
}

const NOTE_SCHEMA = {
  type: 'object', required: ['path', 'status', 'kind'], additionalProperties: false,
  properties: {
    path: { type: 'string' },
    status: { enum: ['written', 'failed'] },
    kind: { type: 'string' },
    componentsUsed: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    failure: { type: 'string', description: 'why it failed, if status=failed (first-class, read by finalize)' },
  },
}

// GATE_SCHEMA: per-page quality-gate verdict. pass=false means the page is dropped before config assembly.
const GATE_SCHEMA = {
  type: 'object', required: ['pages', 'admitted', 'dropped'], additionalProperties: false,
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object', required: ['path', 'pass', 'issues'], additionalProperties: false,
        properties: {
          path: { type: 'string' },
          pass: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' }, description: 'list of specific problems found; empty when pass=true' },
        },
      },
    },
    admitted: { type: 'array', items: { type: 'string' }, description: 'paths of pages that passed (pass=true)' },
    dropped: { type: 'array', items: { type: 'string' }, description: 'paths of pages that failed (pass=false); do not reach build' },
    summary: { type: 'string', description: 'one sentence: overall result and how many passed/failed' },
  },
}

const FINAL_SCHEMA = {
  type: 'object', required: ['admitted', 'rejected', 'summary'], additionalProperties: false,
  properties: {
    admitted: { type: 'array', items: { type: 'string' } },
    rejected: { type: 'array', items: {
      type: 'object', required: ['path', 'reason'], additionalProperties: false,
      properties: { path: { type: 'string' }, reason: { type: 'string' } } } },
    fixed: { type: 'array', items: { type: 'string' }, description: 'pages the gate edited in place' },
    configWritten: { type: 'boolean' },
    // buildResult and repairIterations are filled in by the scripted repair loop (not the verify agent).
    buildResult: { type: 'string', description: 'build check summary: "pass", "fail after N iterations: <errors>", or "skipped: <reason>"' },
    repairIterations: { type: 'number', description: 'number of repair iterations the scripted loop ran (0 = first-run pass or skipped)' },
    decisions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// --- Frame IA (strong model; sets the trajectory, skipped when pages are supplied) --------------
let ia = null
if (!explicitPages) {
  phase('Frame IA')
  ia = await agent(
    `You are framing the information architecture for a ${framework} documentation site BEFORE any pages ` +
    `are planned. Brief:\n${brief}\n${sourcesNote}\n\n` +
    `Apply the IA contract below. FIRST identify the project archetype (Archetypes section) and pick the ` +
    `minimum-viable doc set for it -- do not default to the full four-quadrant spread. THEN return: archetype; ` +
    `siteRecommendation (site|single-file|embedded -- the honest output shape for this archetype+scope, recorded ` +
    `even though this run still builds a site); audiences (and their goal); the reader journey (ordered, ` +
    `first-touch -> proficient); the Diátaxis split (how many of tutorial/howto/reference/explanation this ` +
    `set needs and why, weighted by the archetype's must-have/skip columns); and the sidebar SHAPE (group ` +
    `structure + ordering, not raw pages yet).\n\n` +
    `IA CONTRACT\n${IA_CONTRACT}`,
    { label: 'frame-ia', schema: IA_SCHEMA },
  )
  if (ia) log(`IA: ${ia.audiences?.length ?? 0} audience(s), ${ia.journey?.length ?? 0} journey step(s)`)
}
const iaNote = ia
  ? `\nFRAMED INFORMATION ARCHITECTURE (honor this; do not re-derive it):\n${JSON.stringify(ia, null, 2)}\n`
  : ''

// --- Plan --------------------------------------------------------------------------------------
phase('Plan')
let pages = explicitPages
if (!pages) {
  const plan = await agent(
    `You are planning a ${framework} documentation site. Brief:\n${brief}\n${sourcesNote}\n${iaNote}\n` +
    `Produce a focused set of pages (prefer FEWER, well-scoped pages over many thin ones) that realizes the ` +
    `framed IA above. Honor the framed archetype: cover its must-have doc set and the minimum-viable baseline, ` +
    `and do NOT add pages the archetype's skip column deprioritizes.\nFor each page give:\n` +
    `- path: repo-relative under "${outDir}", e.g. src/content/docs/guides/getting-started.md (use .mdx ONLY if it needs components, .md otherwise)\n` +
    `- title, kind (index|splash|guide|reference), group (sidebar group label), brief (what it must cover).\n` +
    `- diataxisType (tutorial|howto|reference|explanation|index|splash): the ONE reader need this page serves.\n` +
    `- template: the section skeleton for that diataxisType (from the IA contract), tailored to this page.\n` +
    `Map groups + ordering to the framed sidebar. Include exactly one landing page (kind index or splash) if the brief implies a homepage.\n\n` +
    `IA CONTRACT\n${IA_CONTRACT}\n\n` +
    `Authoring contract for reference:\n${CONTRACT}`,
    { label: 'plan', schema: PLAN_SCHEMA },
  )
  pages = (plan?.pages ?? []).filter(Boolean)
}
if (!pages.length) return { error: 'planning produced no pages', brief }
log(`planned ${pages.length} page(s): ${pages.map(p => p.path).join(', ')}`)

// --- Author (fan-out: one worker per page, each writes its own file) ----------------------------
phase('Author')
const notes = (await parallel(pages.map((p, i) => () =>
  agent(
    `Write ONE ${framework} documentation page and save it to disk. ` +
    (fwEntry.contract
      ? `Do not re-derive ${framework} syntax: the contract below is authoritative. Only Read a file under "${refsDir}" ` +
        `if the contract genuinely does not cover something you need (avoid extra reads, this run optimizes for fewer calls).`
      : `Author from the current official ${framework} docs (find-docs / context7); do not invent config or component ` +
        `syntax. "${refsDir}" is a skeleton, not a syntax source.`) + `\n\n` +
    `PAGE\n- file: ${outDir}/${p.path}\n- title: ${p.title}\n- kind: ${p.kind}\n- sidebar group: ${p.group}\n- must cover: ${p.brief}\n` +
    `- Diátaxis type: ${p.diataxisType ?? '(infer from kind/brief)'}  (serve this ONE reader need; do NOT mix modes)\n` +
    `- section template to follow: ${p.template ?? '(use the matching skeleton from the IA contract)'}\n` +
    `${sourcesNote}\n\n` +
    `Write the RIGHT SHAPE for the Diátaxis type: a tutorial is task-ordered and outcome-first; a reference is ` +
    `exhaustive, consistent and scannable with no narrative; a how-to is goal-then-steps-then-verify; an explanation ` +
    `discusses context and tradeoffs without step-by-step. Follow the section template.\n\n` +
    `Rules: valid frontmatter (title required; template: splash + a hero block only for a splash page). ` +
    `Use .mdx with the correct import line if and only if you use components. Write the file with the Write tool ` +
    `(create parent dirs). Keep prose tight and technical.\n\n` +
    `IA CONTRACT\n${IA_CONTRACT}\n\n` +
    (crosswalkNote ? `${crosswalkNote}\n\n` : '') +
    `AUTHORING CONTRACT\n${authoringContract}`,
    { label: `author:${p.path || i}`, phase: 'Author', model: 'sonnet', schema: NOTE_SCHEMA },
  ),
))).filter(Boolean)

const written = notes.filter(n => n.status === 'written')
const failed = notes.filter(n => n.status === 'failed')
log(`authored ${written.length}/${pages.length} page(s)${failed.length ? `; ${failed.length} failed` : ''}`)
if (!written.length) return { error: 'no pages were written', notes }

// --- Link/asset resolution (scripted Haiku step; runs before quality gate) --------------------
// Copies referenced local assets to the framework's assetDir and rewrites links so the quality
// gate sees resolved paths, not broken references authors may have written as placeholders.
phase('Resolve links/assets')
const linkResult = await resolveLinksAndAssets(written, outDir, fwEntry, framework)
log(`links/assets: ${linkResult.copied?.length ?? 0} copied, ${linkResult.rewritten?.length ?? 0} rewritten, ${linkResult.skipped?.length ?? 0} skipped`)

// --- Quality gate (strong model, fresh context per workflow-design.md) -------------------------
// Runs before config assembly and the empirical build. Checks each written page for:
//   1. Diataxis adherence: does the page serve exactly ONE reader need (no mode-mixing)?
//   2. Internal link + asset resolution: are all [[wiki]]/[text](path) links and image src paths
//      resolvable within the site? A broken internal link is reported as failed, not silently passed.
//   3. Crosswalk no-leak: for non-Starlight frameworks, no Starlight-specific syntax (<Aside>, <Steps>,
//      @astrojs/starlight imports, etc.) appears in the page.
//   4. Reference pages cite sources: reference/API pages include at least one code example or cite a
//      concrete source (not pure narrative). Pages that only describe without showing are flagged.
// Emits per-page {path, pass, issues[]}. Only admitted (pass=true) pages reach Verify & finalize.
// Model: Opus (strong model) -- the gate's whole purpose is filtering; a weak gate rubber-stamps.
phase('Quality gate')
const writtenPaths = written.map(n => n.path)
const gate = await agent(
  `You are the quality gate for a ${framework} docs site at "${outDir}". The authors just wrote these pages:\n` +
  `${writtenPaths.map((p, i) => `${i + 1}. ${outDir}/${p}`).join('\n')}\n\n` +
  `For EACH page above:\n` +
  `1. READ the page file.\n` +
  `2. Check ALL four criteria and report specific issues for any that fail:\n` +
  `   a. DIATAXIS: The declared type is listed below. Does the page serve exactly that ONE reader need ` +
  `and NOT mix modes? (A reference must be exhaustive/scannable with no narrative; a tutorial must be ` +
  `task-ordered with a visible outcome; a how-to must be goal-then-steps-then-verify; an explanation ` +
  `must discuss context/why without step-by-step.) Mode-mixing means the page fails.\n` +
  `      ${pages.filter(p => writtenPaths.includes(p.path)).map(p => `${p.path}: ${p.diataxisType ?? '(untyped)'}`).join('; ')}\n` +
  `   b. LINKS/ASSETS: Are all internal links (markdown [text](./path), [[wiki-links]], image src) ` +
  `resolvable within "${outDir}"? A link that points outside the site or to a non-existent file is an ` +
  `issue. (External http/https URLs are OK; only check internal relative paths.)\n` +
  `   c. CROSSWALK NO-LEAK: ${leakNote || 'N/A (Starlight is the target; no leak check needed).'}\n` +
  `   d. REFERENCE SOURCES: If the page is a reference or API page (diataxisType="reference"), ` +
  `it must contain at least one code block or concrete signature. A reference page that is pure ` +
  `narrative with no examples or signatures fails this check.\n` +
  `3. For each page return {path, pass, issues} — pass=true only if ALL four checks pass. ` +
  `List every specific issue in the issues array (empty array when pass=true).\n\n` +
  `A page that fails on ONE criterion is dropped (not silently passed). Only admitted pages reach ` +
  `config assembly and the empirical build. Be strict: the whole point of this gate is to stop bad ` +
  `pages from reaching the build, not to rubber-stamp them.\n\n` +
  `Return: pages (per-page verdict), admitted (paths of pass=true pages), dropped (paths of pass=false pages), summary.\n\n` +
  (leakNote ? `${leakNote}\n` : '') +
  (crosswalkNote ? `${crosswalkNote}\n\n` : '') +
  `IA CONTRACT\n${IA_CONTRACT}`,
  { label: 'quality-gate', phase: 'Quality gate', model: 'opus', schema: GATE_SCHEMA },
)

// Compute admitted set: pages that passed the quality gate. Fall back to all written if gate returned null.
const gateAdmittedPaths = new Set((gate?.admitted ?? writtenPaths).map(p => normPagePath(p)))
const gateDroppedPaths = gate?.dropped ?? []
const admittedNotes = written.filter(n => gateAdmittedPaths.has(normPagePath(n.path)))
log(`quality gate: ${admittedNotes.length}/${written.length} admitted${gateDroppedPaths.length ? `; dropped: ${gateDroppedPaths.join(', ')}` : ''}`)
if (!admittedNotes.length) {
  return { error: 'quality gate dropped all pages', gateResult: gate }
}

// Admitted page objects (for config assembly groups).
const admittedPages = pages.filter(p => gateAdmittedPaths.has(normPagePath(p.path)))

// --- Verify & finalize (single fresh-context strong pass + write-back; build is scripted below) -
// Step 4 (empirical build gate) is deliberately omitted from the verify agent prompt: the scripted
// repair loop below runs the build, parses errors, and loops a fix agent (Sonnet) up to
// MAX_REPAIR_ITERS times. The verify agent handles only steps 1-3 and 4 (write-back).
// NOTE: This agent now receives only admitted pages (those that passed the quality gate above).
phase('Verify & finalize')
const final = await agent(
  `You are the verification gate and finalizer for a ${framework} docs site at "${outDir}". A fan-out of ` +
  `authors wrote these pages; the quality gate already checked Diataxis adherence, link resolution, ` +
  `crosswalk no-leak, and reference sources. Only the pages that PASSED the quality gate are listed here:\n` +
  `${JSON.stringify(admittedNotes, null, 2)}\n\n` +
  `Quality gate dropped these pages (do NOT include them in config):\n` +
  `${gateDroppedPaths.length ? gateDroppedPaths.join(', ') : '(none)'}\n\n` +
  `Each admitted page was planned with a Diátaxis type (already verified by the quality gate):\n` +
  `${admittedPages.map(p => `- ${p.path}: ${p.diataxisType ?? '(untyped)'}`).join('\n')}\n\n` +
  `Do, in order:\n` +
  `1. READ each admitted page file. Check it against the contract for syntax correctness: valid frontmatter, ` +
  (fwEntry.contract ? `.mdx iff components are used, correct component imports and prop names, valid Aside/Tabs/Steps usage, `
                    : `correct ${framework} config/component syntax (verify against current ${framework} docs, not memory), `) +
  `Fix small problems in place with the Edit tool. If a page is broken beyond a quick fix, reject it (record path + reason).\n` +
  `(Diataxis adherence was already checked by the quality gate -- skip that check here.)\n` +
  fwEntry.assemblePrompt(outDir, [...new Set(admittedPages.map(p => p.group))].join(', '), scaffoldMode, { basePath, i18n, versioning, site }) +
  `4. WRITE-BACK: write ${outDir}/.docs-plan.md capturing the final page list, sidebar structure, and any decisions/constraints ` +
  `(e.g. rejected/dropped pages and why) so a future run or human has the durable record. ` +
  `Include a "Doc strategy" line recording the archetype and the advisory output shape so a maintainer can act on it: ` +
  `archetype=${ia?.archetype ?? '(unframed)'}, recommended-shape=${ia?.siteRecommendation ?? 'site'} ` +
  `(if single-file or embedded, note that a full site may be more than this project needs).\n\n` +
  `NOTE: The empirical build check (running the framework build command and repairing errors) is handled ` +
  `separately by the orchestrating script after you finish. Do NOT attempt to run the build yourself.\n\n` +
  `Return admitted paths, rejected {path,reason}, pages you fixed, configWritten, decisions, and a short summary.\n\n` +
  (leakNote ? `${leakNote}\n` : '') +
  (crosswalkNote ? `${crosswalkNote}\n\n` : '') +
  `IA CONTRACT\n${IA_CONTRACT}\n\n` +
  `AUTHORING CONTRACT\n${authoringContract}`,
  { label: 'verify-finalize', schema: FINAL_SCHEMA },
)

// --- Scripted build + repair loop (post-verify, pre-return) ------------------------------------
// Runs the framework's build command, feeds parsed errors to a Sonnet fix agent on failure,
// and retries up to MAX_REPAIR_ITERS times. Fills buildResult + repairIterations in the output.
// Skips cleanly when the framework has no build step (client-side SPA, no install, etc.).
const buildRepair = await runBuildRepairLoop(fwEntry, outDir, scaffoldMode, authoringContract, framework)
log(`build result: ${buildRepair.buildResult}`)

return {
  framework,
  scaffoldMode,
  outDir,
  planned: pages.length,
  authored: written.length,
  authorFailures: failed.map(n => ({ path: n.path, failure: n.failure })),
  gateAdmitted: admittedNotes.length,
  gateDropped: gateDroppedPaths,
  buildResult: buildRepair.buildResult,
  repairIterations: buildRepair.repairIterations,
  ...(final ?? { error: 'verify-finalize returned null', notes }),
}
