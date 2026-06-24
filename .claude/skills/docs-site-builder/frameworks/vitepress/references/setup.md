# VitePress: Setup

Distilled from vuejs/vitepress (v1.x). Vue + Vite static-site generator for documentation.

## New project (interactive scaffold)

```sh
npm add -D vitepress
npx vitepress init
```

The wizard asks: root dir, site title, description, theme (default/custom), TypeScript.

```sh
npm run docs:dev     # dev server at http://localhost:5173
npm run docs:build   # build to ./docs/.vitepress/dist/
npm run docs:preview # preview built output
```

## Minimal manual setup

```sh
mkdir docs && echo '# Hello VitePress' > docs/index.md
npx vitepress dev docs
```

## Project structure

```
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
```

## `package.json` scripts

```json
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
```

## Notes

- VitePress v1 requires Node.js 18+.
- Config file: `.vitepress/config.mts` (TypeScript recommended) or `config.js`.
- Content root defaults to `docs/` but can be set with the `srcDir` option.
- Build output: `.vitepress/dist/` (relative to the docs root).
- `public/` inside the docs root serves static assets at the site root.
