# VitePress: Frontmatter

Distilled from vuejs/vitepress (v1.x).

## Common page frontmatter

```yaml
---
title: Page Title             # browser tab title and <h1> (if no H1 in content)
titleTemplate: false          # disable the title template for this page
description: Page description # <meta name="description">
layout: doc                   # 'doc' (default) | 'home' | 'page' (full-width, no sidebar)
lang: en-US                   # override site lang for this page
dir: ltr                      # text direction 'ltr' | 'rtl'
---
```

## Table of contents

```yaml
---
outline: [2, 3]       # heading levels to show (number, [min,max], or 'deep' for all)
outline: deep         # all heading levels
outline: false        # disable TOC
---
```

## Sidebar and nav

```yaml
---
aside: false          # hide the aside/TOC on this page
---
```

## Edit link and last updated

```yaml
---
editLink: false       # hide the "Edit this page" link on this page
lastUpdated: false    # hide last-updated timestamp for this page
---
```

## Home page (layout: home)

```yaml
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
```

## Page frontmatter (layout: page)

`layout: page` renders the content without the doc sidebar and article header.
Useful for custom landing pages or full-width pages.

## Head tags (per-page)

```yaml
---
head:
  - - meta
    - name: twitter:card
      content: summary_large_image
  - - link
    - rel: canonical
      href: https://example.com/page
---
```

## Notes

- Frontmatter values override the equivalent site-level `themeConfig` settings.
- `layout: doc` (default) shows the sidebar + TOC.
- `layout: page` removes sidebar and limits the TOC.
- `layout: home` renders a special hero/features layout using the `hero` and `features` frontmatter keys.
