# Docsify: Content Authoring

Distilled from docsifyjs/docsify (v4.x). Content is standard Markdown rendered at runtime.

## Page files

- Every `.md` file in the docs root (and subdirectories) is a routable page.
- `README.md` is the index page for its directory (`/` or `/guide/`).
- URLs: `docs/guide/installation.md` → `/#/guide/installation`.

## Standard Markdown

All CommonMark Markdown is supported. No compile step means no MDX or JSX.

```md
# Heading 1

Regular paragraphs, **bold**, _italic_, `inline code`.

[Link text](other-page.md)    <!-- relative links work natively -->
[External](https://example.com)

![alt text](/_media/image.png)

| Column A | Column B |
|---|---|
| value    | value    |

> Blockquote for callouts (no admonition plugin by default).

- Unordered list
- Item 2

1. Ordered list
2. Item 2

```js
console.log('fenced code block');
```
```

## Code highlighting

Docsify auto-loads Prism.js. Highlight languages by fencing with the language name:

```md
```python
def greet(name):
    return f"Hello, {name}"
```
```

To add extra Prism languages, include them in `index.html` before the docsify script:
```html
<script src="//cdn.jsdelivr.net/npm/prismjs@1/components/prism-bash.min.js"></script>
```

## Linking between pages

```md
[Relative link](guide/installation.md)
[Anchor on this page](#section-heading)
[Anchor on another page](guide/installation.md#requirements)
```

Docsify rewrites relative `.md` links to hash routes automatically.

## Images and media

```md
![Logo](/_media/logo.png)
<!-- Serve assets from the docs/ root; /_media/ is a common convention -->
```

## Embedding HTML

Since content renders at runtime in the browser, HTML in Markdown works:
```html
<div class="tip">This is a tip.</div>
```

## Admonitions (plugin)

No built-in admonition syntax. Add the `docsify-plugin-flexible-alerts` plugin for:
```md
> [!NOTE]
> This is a note.

> [!TIP]
> This is a tip.

> [!WARNING]
> This is a warning.

> [!DANGER]
> This is a danger alert.
```

Requires adding the plugin script to `index.html`.

## Tabs (plugin)

With `docsify-tabs` plugin:
```md
<!-- tabs:start -->
#### **Tab One**
Content for tab one.

#### **Tab Two**
Content for tab two.
<!-- tabs:end -->
```

## Search

The built-in search plugin indexes all pages. Enable in `index.html`:
```html
<script src="//cdn.jsdelivr.net/npm/docsify@4/lib/plugins/search.min.js"></script>
```

Configure in `window.$docsify`:
```js
search: {
  maxAge: 86400000,
  paths: 'auto',
  placeholder: 'Type to search',
  noData: 'No Results!',
  depth: 2,
}
```

## Pagination (plugin)

Add `docsify-pagination` for prev/next navigation:
```html
<script src="//cdn.jsdelivr.net/npm/docsify-pagination/dist/docsify-pagination.min.js"></script>
```

## Notes

- No YAML frontmatter support by default. Use H1 headings for page titles.
- Content is XHR-fetched at runtime — keep files small for fast loads.
- All plugins are added as `<script>` tags in `index.html`; there is no bundler config.
- For SEO, consider docsify-ssr or a prerender service (Docsify has no static HTML output).
