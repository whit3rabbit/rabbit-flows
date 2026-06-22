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
// }

// requires-skills: docs-site-builder
export const meta = {
  name: 'docs-create',
  description: 'Author a documentation site from a brief: plan pages, fan out authors, verify and assemble config. Starlight is first-class; other frameworks are authored from current docs.',
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
the single highest-leverage page; design the journey backwards from it.`
// @generated-end docs-contracts/ia-contract

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
      const { basePath, i18n, versioning } = opts
      // basePath -> Astro top-level `base` option in defineConfig (e.g. base: '/docs').
      const baseNote = basePath
        ? `   Set base: '${basePath}' in the defineConfig() call (outside starlight()); this makes Astro prefix all routes with the subpath.\n`
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
        baseNote + i18nNote + versioningNote
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
    contract: null,
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
    contract: null,
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
    contract: null,
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
    contract: null,
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
    contract: null,
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
    contract: null,
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

if (basePath) log(`basePath="${basePath}" will be injected into framework config where supported`)
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
    `Apply the IA contract below. Return: audiences (and their goal), the reader journey (ordered, ` +
    `first-touch -> proficient), the Diátaxis split (how many of tutorial/howto/reference/explanation this ` +
    `set needs and why), and the sidebar SHAPE (group structure + ordering, not raw pages yet).\n\n` +
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
    `framed IA above. For each page give:\n` +
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
const gateAdmittedPaths = new Set(gate?.admitted ?? writtenPaths)
const gateDroppedPaths = gate?.dropped ?? []
const admittedNotes = written.filter(n => gateAdmittedPaths.has(n.path))
log(`quality gate: ${admittedNotes.length}/${written.length} admitted${gateDroppedPaths.length ? `; dropped: ${gateDroppedPaths.join(', ')}` : ''}`)
if (!admittedNotes.length) {
  return { error: 'quality gate dropped all pages', gateResult: gate }
}

// Admitted page objects (for config assembly groups).
const admittedPages = pages.filter(p => gateAdmittedPaths.has(p.path))

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
  fwEntry.assemblePrompt(outDir, [...new Set(admittedPages.map(p => p.group))].join(', '), scaffoldMode, { basePath, i18n, versioning }) +
  `4. WRITE-BACK: write ${outDir}/.docs-plan.md capturing the final page list, sidebar structure, and any decisions/constraints ` +
  `(e.g. rejected/dropped pages and why) so a future run or human has the durable record.\n\n` +
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
