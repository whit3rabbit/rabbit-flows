# VitePress: Built-in Components

Distilled from vuejs/vitepress (v1.x). Available globally in all `.md` and `.vue` files.

## Badge

Inline badge for labeling items in text or headings.

```md
### My Feature <Badge type="info" text="v1.2" />

Version <Badge type="tip" text="New" />
```

Props:
- `type`: `'info'` | `'tip'` | `'warning'` | `'danger'` (default: `'tip'`)
- `text`: string displayed in the badge
- `vertical`: `'top'` | `'middle'` (default: `'top'`) — vertical alignment relative to surrounding text

## Image (lazy loading)

Standard Markdown images get lazy loading when `markdown.image.lazyLoading: true` is set.

```md
![Alt text](./image.png)
```

To use `<picture>` for dark/light variants, use HTML directly or a custom Vue component.

## Custom Theme Components

Place custom Vue components in `docs/.vitepress/theme/`:

```ts
// docs/.vitepress/theme/index.ts
import DefaultTheme from 'vitepress/theme'
import MyComponent from './MyComponent.vue'

export default {
  ...DefaultTheme,
  enhanceApp({ app }) {
    app.component('MyComponent', MyComponent)
  },
}
```

Then use globally in Markdown:
```md
<MyComponent title="Hello" />
```

## Layout slots

Inject content into VitePress's default layout via named slots:

```ts
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
```

Available slots include: `home-hero-before`, `home-hero-info-before`, `home-hero-info`,
`home-hero-info-after`, `home-hero-actions-after`, `home-features-before`, `home-features-after`,
`sidebar-nav-before`, `sidebar-nav-after`, `aside-top`, `aside-bottom`, `aside-outline-before`,
`aside-outline-after`, `aside-ads-before`, `aside-ads-after`, `doc-before`, `doc-after`,
`doc-footer-before`, `nav-bar-title-before`, `nav-bar-title-after`, `nav-bar-content-before`,
`nav-bar-content-after`, `nav-screen-content-before`, `nav-screen-content-after`.

## useData composable

Access VitePress data in custom components:

```vue
<script setup>
import { useData } from 'vitepress'
const { theme, page, frontmatter, isDark } = useData()
</script>

<template>
  <h1>{{ frontmatter.title }}</h1>
</template>
```

## withBase helper

Prepend `base` URL to asset paths in components:

```ts
import { withBase } from 'vitepress'
const logoSrc = withBase('/images/logo.png')
```
