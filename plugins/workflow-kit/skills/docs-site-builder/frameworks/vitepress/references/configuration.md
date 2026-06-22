# VitePress: Configuration (.vitepress/config.mts)

Distilled from vuejs/vitepress (v1.x).

## Minimal config

```ts
// docs/.vitepress/config.mts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'My Docs',
  description: 'A VitePress Site',
})
```

## Full config example

```ts
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
```

## Sidebar format

```ts
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
```

Items can be nested: an item can have `items` for sub-sections. Max depth: 6 levels rendered.
