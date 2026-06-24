# Docusaurus: Setup

Distilled from facebook/docusaurus (v3.x). React-based static-site generator for documentation.

## New project

```sh
npx create-docusaurus@latest my-site classic
# or with TypeScript
npx create-docusaurus@latest my-site classic --typescript

cd my-site
npm start   # dev server at http://localhost:3000
npm run build   # production build into ./build/
```

The `classic` preset includes `@docusaurus/preset-classic` (docs, blog, pages, themes).

## Project structure

```
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
```

## Dev commands

```sh
npm start           # start dev server (http://localhost:3000)
npm run build       # build for production (output: ./build/)
npm run serve       # serve built output locally
npm run clear       # clear generated assets and cache
npm run swizzle     # customize theme components
npm run deploy      # deploy to GitHub Pages
```

## Notes

- Content lives in `docs/` (Markdown or MDX). Route = `baseUrl/docs/<slug>`.
- Blog posts live in `blog/`. Each file is a post; dated filename recommended (`2024-01-01-title.md`).
- Standalone pages: `src/pages/*.tsx|md|mdx` — routed without the `/docs/` prefix.
- Docusaurus v3 requires Node.js 18+.
