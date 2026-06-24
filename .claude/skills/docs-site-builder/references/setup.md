# Starlight: Setup

Distilled from withastro/starlight docs (cloned github.com/withastro/starlight, English docs). `@astrojs/starlight` v0.40.0.

Starlight is an Astro integration (a documentation theme built on Astro). Set up either from the starter template or by adding it to an existing Astro project.

## New project (template)

Run in your terminal, then start the dev server:

```sh
# npm
npm create astro@latest -- --template starlight
# pnpm
pnpm create astro --template starlight
# yarn
yarn create astro --template starlight
```

```sh
npm run dev   # pnpm dev / yarn dev
```

Dev server prints a local URL. Add pages by creating Markdown in `src/content/docs/`.

Update Starlight (and other Astro packages):

```sh
npx @astrojs/upgrade   # pnpm dlx / yarn dlx
```

## Add to an existing Astro project (manual)

Requires an existing Astro project. Three steps: add the integration, configure it, set up the content collection.

### 1. Add the integration

```sh
npx astro add starlight   # pnpm astro add starlight / yarn astro add starlight
```

This installs required deps and adds Starlight to the `integrations` array in the Astro config.

### 2. Configure in `astro.config.mjs`

```js
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
```

`title` is the minimum. See the configuration reference for all options.

### 3. Configure the content collection

Starlight is built on Astro content collections, configured in `src/content.config.ts`
(current docs use `src/content.config.ts`, NOT the legacy `src/content/config.ts`).
Add a `docs` collection using Starlight's `docsLoader()` and `docsSchema()`:

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

`docsLoader()` uses the Content Layer API (Astro v5+). For an older project that can't
migrate collections yet, the `legacy.collectionsBackwardsCompat` flag preserves v4 behavior.

### 4. Add content

Create `src/content/docs/` and an `index.md` (the homepage):

```md
---
# src/content/docs/index.md
title: My docs
description: Learn more about my project.
---

Welcome to my project!
```

File-based routing: every `.md`, `.mdx`, or `.mdoc` file in `src/content/docs/` becomes a
page. Frontmatter (`title`, `description`, etc.) controls how each page renders.

## Project structure

Key files and directories:

- `astro.config.mjs` — Astro config; holds the Starlight integration and its options.
- `src/content.config.ts` — content collections config; adds Starlight's frontmatter schemas.
- `src/content/docs/` — content. Each `.md` / `.mdx` / `.mdoc` here becomes a page.
- `src/content/i18n/` (optional) — translation data for internationalization.
- `src/` — other source (components, styles, images).
- `public/` — static assets served as-is (favicon, fonts, PDFs), not processed by Astro.

Example tree:

```
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
```

## Notes

- Mount docs at a subpath by nesting content under a subdirectory of `src/content/docs/`
  (e.g. `src/content/docs/guides/` serves pages under `/guides/`).
- Starlight pages are pre-rendered by default regardless of output mode. For SSR, add an
  Astro server adapter; opt a page out of pre-rendering with the `prerender: false` config option.
