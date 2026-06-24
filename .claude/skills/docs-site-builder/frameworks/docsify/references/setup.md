# Docsify: Setup

Distilled from docsifyjs/docsify (v4.x). Runtime Markdown renderer — no build step.

## Key concept

Docsify renders Markdown at runtime in the browser. You serve static files (HTML + Markdown);
no build pipeline or compilation step is required.

## Install CLI (optional)

```sh
npm i docsify-cli -g
```

## New project

```sh
docsify init ./docs   # creates docs/index.html, docs/README.md, docs/.nojekyll

cd docs
docsify serve .       # local server at http://localhost:3000
```

Without the CLI, just serve the directory with any static file server:
```sh
npx serve docs
# or
python3 -m http.server 3000 --directory docs
```

## Minimal `index.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Docs</title>
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
</head>
<body>
  <div id="app"></div>
  <script>
    window.$docsify = {
      name: 'My Docs',
      repo: 'https://github.com/org/repo',
      loadSidebar: true,
      subMaxLevel: 2,
    }
  </script>
  <script src="//cdn.jsdelivr.net/npm/docsify@4/lib/docsify.min.js"></script>
</body>
</html>
```

## Project structure

```
docs/
  .nojekyll          # prevents GitHub Pages from ignoring _ files
  index.html         # entry point (the app shell + config)
  README.md          # home page content
  _sidebar.md        # sidebar navigation (when loadSidebar: true)
  _navbar.md         # top navbar (when loadNavbar: true)
  _coverpage.md      # cover page (when coverpage: true)
  guide/
    README.md        # /guide/ route
    advanced.md      # /guide/advanced route
```

## Deployment

Docsify is just static files. Deploy to:
- GitHub Pages: push to `gh-pages` branch or `docs/` folder
- Netlify / Vercel: serve the `docs/` directory
- Any static host

Add `.nojekyll` to prevent GitHub from ignoring `_sidebar.md` etc.

## Notes

- No build step = instant authoring, but no tree-shaking or pre-rendering.
- Content is fetched via XHR at runtime; SEO requires server-side rendering (not included).
- Docsify v4 uses CDN-based delivery; no npm install needed for the site itself.
