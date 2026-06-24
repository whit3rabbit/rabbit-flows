# Starlight: Configuration (astro.config)

Distilled from withastro/starlight docs.

Configure the `starlight()` integration in `astro.config.mjs`. Only `title` is required.

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [starlight({ title: 'My docs site' })],
});
```

## Common options

### `title` (required)
`string | Record<string, string>` — site title (browser tab + metadata). Object form for multilingual sites, keyed by BCP-47 tag.
```ts
title: { en: 'My docs site', de: 'Meine Doku' }
```

### `description`
`string` — default `<meta name="description">` when a page has none in frontmatter.

### `logo`
`{ alt?, replacesTitle? } & ({ src } | { light; dark })` — image in the nav bar. Use `src` for one image, or `light`/`dark` for theme-specific.
```js
logo: { src: './src/assets/my-logo.svg' }
```

### `social`
`Array<{ label: string; icon: StarlightIcon; href: string }>` — icon links in the header.
```js
social: [
  { icon: 'github', label: 'GitHub', href: 'https://github.com/withastro' },
  { icon: 'discord', label: 'Discord', href: 'https://astro.build/chat' },
]
```

### `sidebar`
`SidebarItem[]` — navigation items. See the Sidebar section below.

### `locales` / `defaultLocale`
`locales: { [dir: string]: { label: string; lang?: string; dir?: 'ltr'|'rtl' } }` — keyed by the content subdirectory. `defaultLocale` names the fallback (match a `locales` key). Use a `root` locale to serve the default language without a `/lang/` prefix.
```js
defaultLocale: 'en',
locales: {
  en: { label: 'English' },
  'zh-cn': { label: '简体中文', lang: 'zh-CN' },
  ar: { label: 'العربية', dir: 'rtl' },
}
```

### `customCss`
`string[]` — CSS files (local paths or npm modules) to customize styling.
```js
customCss: ['./src/custom.css', '@fontsource/roboto']
```

### `head`
`Array<{ tag: string; attrs?: Record<string,string|boolean|undefined>; content?: string }>` — extra `<head>` tags (analytics, scripts). Converted to raw HTML; no Astro script/style processing.
```js
head: [{ tag: 'script', attrs: { src: 'https://cdn.usefathom.com/script.js', 'data-site': 'ID', defer: true } }]
```

### `editLink`
`{ baseUrl: string }` — enables "Edit this page". Final link = `baseUrl` + page path.
```js
editLink: { baseUrl: 'https://github.com/withastro/starlight/edit/main/' }
```

### `lastUpdated`
`boolean` (default `false`) — show last-updated date in footer. Uses Git history; may be inaccurate on shallow-clone deploys. Overridable per page via frontmatter.

### `pagination`
`boolean` (default `true`) — previous/next page links in the footer. Overridable via `prev`/`next` frontmatter.

### `tableOfContents`
`false | { minHeadingLevel?: number; maxHeadingLevel?: number }` (default `{ min: 2, max: 3 }`) — right-side TOC. Set `false` to disable.

### `expressiveCode`
`StarlightExpressiveCodeOptions | boolean` (default `true`) — code-block rendering (highlighting, filenames). Accepts all Expressive Code options plus Starlight-specific `themes`, `useStarlightDarkModeSwitch`, `useStarlightUiThemeColors`. Set `false` to disable.
```js
expressiveCode: { styleOverrides: { borderRadius: '0.5rem' } }
```

### `components`
`Record<string, string>` — override Starlight's built-in components with your own paths. See the Overrides Reference for overridable names.
```js
components: { SocialLinks: './src/components/MySocialLinks.astro' }
```

### `plugins`
`StarlightPlugin[]` — extend Starlight with plugins.
```js
plugins: [starlightThemePlugin()]
```

### `favicon`
`string` (default `'/favicon.svg'`) — path in `public/` to an `.ico`/`.gif`/`.jpg`/`.png`/`.svg` icon. Add fallback variants via `head`.
```js
favicon: '/images/favicon.svg'
```

### `credits`
`boolean` (default `false`) — show a "Built with Starlight" footer link.

## The long tail (no example)

- `markdown` — `{ headingLinks?: boolean; processedDirs?: string[] }`. Toggle clickable heading anchors; add dirs to the Markdown pipeline.
- `pagefind` — `boolean | PagefindOptions` (default `true`). Built-in search; set `false` to disable. Cannot be used with `prerender: false`.
- `prerender` — `boolean` (default `true`). Set `false` to render pages on demand via an SSR adapter.
- `titleDelimiter` — `string` (default `'|'`). Separator in `<title>` between page and site title.
- `disable404Route` — `boolean` (default `false`). Set `true` to use a custom `src/pages/404.astro`.
- `routeMiddleware` — `string | string[]`. Paths to route middleware that modify Starlight's route data.

## Sidebar

A sidebar is an array of `SidebarItem`. Item shapes:

- **Internal link** — `{ slug: string; label?; badge?; attrs?; translations? }`. Page title is the default label. Shorthand: a bare string `'guides/intro'`.
- **External / non-docs link** — `{ link: string; label: string; badge?; attrs?; translations? }`. `link` may be a site path (`'/shop/'`) or a URL.
- **Group** — `{ label: string; items: SidebarItem[]; collapsed?: boolean; badge?; translations? }`. Groups nest; `items` may hold links, sub-groups, and autogenerate entries.
- **Autogenerate** — `{ autogenerate: { directory: string; collapsed?: boolean; attrs? } }`. Generates links/sub-groups from a docs directory, sorted alphabetically by file id. Customize per page via `sidebar` frontmatter (`label`, `order`, `badge`, `hidden`, `attrs`).

```ts
type SidebarItem =
  | string
  | ({ translations?: Record<string, string>; badge?: string | BadgeConfig } & (
      | { link: string; label: string; attrs?: Record<string, string|number|boolean|undefined> }
      | { slug: string; label?: string; attrs?: Record<string, string|number|boolean|undefined> }
      | { label: string; items: SidebarItem[]; collapsed?: boolean }
    ))
  | { autogenerate: { directory: string; collapsed?: boolean; attrs?: Record<string, string|number|boolean|undefined> } };

interface BadgeConfig { text: string; variant?: 'note'|'tip'|'caution'|'danger'|'success'|'default'; class?: string }
```

**Badges:** `badge` on a link or group. String shorthand uses the accent color; object form sets `variant` (built-in style) and optional `class` (custom CSS).

**Collapsing:** groups expand by default. `collapsed: true` on a group, or `autogenerate.collapsed: true` for autogenerated sub-groups.

**Translations:** `translations: { 'pt-BR': 'Label' }` on any item; `label` is the default locale. `slug` links auto-use translated page titles. Multilingual `badge.text` may be an object keyed by BCP-47 tag.

### Realistic full example

```js
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
```
