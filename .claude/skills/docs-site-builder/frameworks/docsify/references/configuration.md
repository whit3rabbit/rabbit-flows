# Docsify: Configuration (window.$docsify)

Distilled from docsifyjs/docsify (v4.x). All config lives in `index.html`.

## Configuration object

```js
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
```

## Sidebar (`_sidebar.md`)

```md
<!-- _sidebar.md -->
- [Home](/)
- [Getting Started](getting-started.md)
- Guide
  - [Installation](guide/installation.md)
  - [Configuration](guide/configuration.md)
  - [Advanced](guide/advanced.md)
- [API Reference](api.md)
- [Changelog](changelog.md)
```

Rules:
- Indented items become sub-items.
- Plain text (no link) is a section header.
- Links are relative to the docs root.
- One `_sidebar.md` at the root applies everywhere; subdirectories can have their own.

## Navbar (`_navbar.md`)

```md
<!-- _navbar.md -->
- [EN](/)
- [中文](/zh-cn/)

<!--separator-->
- Links
  - [GitHub](https://github.com/org/repo)
  - [npm](https://npmjs.com/package/my-package)
```

## Cover page (`_coverpage.md`)

```md
<!-- _coverpage.md -->
# My Docs

> A simple documentation site.

- Fast
- Searchable
- Easy to maintain

[Getting Started](getting-started.md)
[GitHub](https://github.com/org/repo)

![color](#f0f0f0)   <!-- background color or image URL -->
```

## Themes (CDN)

Change by swapping the `<link>` stylesheet in `index.html`:

```html
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
```
