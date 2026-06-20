# Starlight: Content Authoring

Distilled from withastro/starlight docs (guides: authoring-content, i18n, css-and-tailwind).

Write content as `.md`/`.mdx` (or Markdoc) under `src/content/docs/`. Standard Markdown works; the features below are Starlight/Astro additions. MDX and Markdoc differ in syntax, so confirm per format.

## Frontmatter

Set per-page metadata between `---` fences at the top of the file. Every page MUST include `title`.

```md
---
title: My page title
description: How to use Markdown in Starlight
---

Page content follows the second `---`.
```

## Headings

- The page `title` becomes the top-level `<h1>` automatically; start body content with paragraph text, then use `##` (`<h2>`) and below. Do not add your own `<h1>`.
- `<h2>` and `<h3>` auto-populate the table of contents (with an "Overview" entry at top).
- Headings get automatic anchor `id`s, so you can link within a page: `[my conclusion](#conclusion)` or externally `https://site.com/page/#introduction`.

## Links and images

```md
You can [link to another page](/getting-started/).

![alt text for screen readers](https://example.com/image.png)
![A rocketship in space](../../assets/images/rocket.svg)   <!-- relative, local -->
```

Images use Astro's optimized asset support; relative paths to local files are supported and optimized.

## Inline styles

`**bold**`, `_italic_`, `~~strikethrough~~`, and `` `inline code` `` with backticks.

## Asides (callouts / admonitions)

Wrap content in triple colons `:::`. Types: `note`, `tip`, `caution`, `danger`. Nest any Markdown inside; keep them short.

```md
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
```

## Code blocks (Expressive Code)

Fence with triple backticks plus a language identifier. Text-markers and window-frame plugins are enabled by default. Options go on the opening fence line (Markdown/MDX syntax shown; Markdoc uses `{% meta="..." %}`).

````md
```js
// Plain syntax-highlighted block
const x = 1;
```
````

### Titles and frames

- Terminal-style frame is used automatically for shell languages (`bash`, `sh`).
- Other languages get a code-editor frame when a title is present.
- Set a title via `title="..."` on the fence, OR via a file-name comment on the first line.

````md
```js
// my-test-file.js               <!-- file-name comment becomes the tab title -->
console.log('Hello World!');
```

```bash title="Installing dependencies…"
npm install
```

```bash frame="none"             <!-- disable the window frame -->
echo "not rendered as a terminal"
```
````

### Text markers (highlighting)

Curly braces mark whole lines/ranges; quotes (or `/regex/`) mark text within lines. Use `ins=`/`del=` for green inserted / red deleted styling.

````md
```js {2-3}                       <!-- highlight lines 2 and 3 -->
function demo() {
	// highlighted
	return 'also highlighted';
}
```

```js "Individual terms" /Even.*supported/   <!-- mark a string and a regex -->
return 'Even regular expressions are supported';
```

```js "return true;" ins="inserted" del="deleted"  <!-- default + ins + del markers -->
return true;
```
````

### Diff syntax

Use a `diff` fence with `lang="..."` to keep source syntax highlighting alongside `+`/`-` diff markers.

````md
```diff lang="js"
  function thisIsJavaScript() {
-   console.log('Old code to be removed')
+   console.log('New and shiny code!')
  }
```
````

Configure all code-block behavior via Starlight's `expressiveCode` config option. Many markers combine.

## Other elements

- Blockquotes: `>` at line start.
- Details/accordions: standard HTML `<details>` + `<summary>` (nest Markdown inside, leave a blank line after `<summary>`).
- Footnotes: `text[^1]` with `[^1]: My reference.` defined elsewhere.
- Lists, tables, and all other standard Markdown are supported.
- Markdoc is supported via `@astrojs/markdoc` + the `@astrojs/starlight-markdoc` preset (`starlightMarkdoc()`); `headingLinks` (default `true`) toggles clickable heading anchors.

## i18n (essentials)

Configure `locales` + `defaultLocale` in the `starlight()` integration. `defaultLocale` provides fallback content and UI labels.

```js
starlight({
	defaultLocale: 'en',
	locales: {
		en: { label: 'English' },
		'zh-cn': { label: '简体中文', lang: 'zh-CN' },
		ar: { label: 'العربية', dir: 'rtl' },   // dir: 'rtl' for RTL languages
	},
})
```

- Content layout: one folder per locale under `src/content/docs/` (e.g. `en/`, `zh-cn/`, `ar/`). Reuse the same file name across languages to link translations and get fallback content (untranslated pages show the `defaultLocale` version with a notice).
- Root locale: serve one language with no path prefix via the `root` key (`root: { label, lang }`; `lang` required). Keep its pages directly in `src/content/docs/`. For a monolingual non-English site, set only `root`.
- UI string translations live in the `i18n` data collection: configure `i18nLoader()`/`i18nSchema()` in `src/content.config.ts`, then add `src/content/i18n/<locale>.json` files. Translate values only, keep English keys (e.g. `"search.label": "Buscar"`). Same JSON file holds `expressiveCode.*` and `pagefind.*` keys.

## Styling (essentials)

Two routes: custom CSS files, or the Starlight Tailwind plugin.

- Custom CSS: add a file under `src/`, override `--sl-*` custom properties on `:root`, then list its relative path in the `customCss` array of `starlight()`.

```css
/* src/styles/custom.css */
:root {
	--sl-content-width: 50rem;
	--sl-text-5xl: 3.5rem;
}
```

```js
starlight({ customCss: ['./src/styles/custom.css'] })
```

- All theme/color variables are `--sl-*` custom properties (full list in Starlight's `style/props.css` on GitHub). Theme = gray shades for text/backgrounds plus one accent color for links/active items; override these to retheme.
- Cascade layers: Starlight uses `@layer`; any unlayered custom CSS overrides defaults. Order layers via `@layer my-reset, starlight, my-overrides;`.
- Tailwind (v4, via `@tailwindcss/vite`): install `@astrojs/starlight-tailwind`, set up `src/styles/global.css` importing the compat package + Tailwind theme/utilities, then add that file as the FIRST entry in `customCss`. Style Starlight's UI by setting `--color-accent-*`, `--color-gray-*`, `--font-sans`, `--font-mono` in an `@theme` block.

```css
/* src/styles/global.css */
@layer base, starlight, theme, components, utilities;
@import '@astrojs/starlight-tailwind';
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
```
