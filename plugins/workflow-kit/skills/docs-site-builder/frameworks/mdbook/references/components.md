# mdBook: Theme and Extensions

Distilled from rust-lang/mdBook (v0.4.x). mdBook has no component system; customization is via theme overrides and preprocessors.

## Built-in theme files (override by placing in `theme/`)

```
theme/
  index.hbs          # main Handlebars page template
  head.hbs           # extra <head> content
  header.hbs         # top bar content
  redirect.hbs       # redirect page template
  toc.js             # table of contents behavior
  favicon.png        # book favicon
  favicon.svg
  book.js            # main JS (search, theme switcher, etc.)
  css/
    chrome.css       # layout/chrome styles
    general.css      # body/typography styles
    print.css        # print-specific styles
    variables.css    # CSS custom properties for theming
  highlight.js       # syntax highlighting
  highlight.css
  tomorrow-night.css
  ayu-highlight.css
```

`mdbook init --theme` to copy all theme files to `theme/` for editing.

## CSS customization

The easiest customization: add a `custom.css` and reference it in `book.toml`:
```toml
[output.html]
additional-css = ["theme/custom.css"]
```

CSS custom properties to override (defined in `theme/css/variables.css`):
```css
:root {
  --bg: white;
  --fg: #333;
  --sidebar-bg: #fafafa;
  --sidebar-fg: #364149;
  --links: #4183c4;
  --inline-code-color: #c0341d;
}
```

## JS customization

```toml
[output.html]
additional-js = ["theme/custom.js"]
```

## Handlebars variables (in `index.hbs`)

Available template variables:
```handlebars
{{title}}             <!-- page title -->
{{book_title}}        <!-- book title from book.toml -->
{{chapter_title}}     <!-- current chapter title -->
{{path}}              <!-- file path of current chapter -->
{{content}}           <!-- rendered Markdown HTML -->
{{toc}}               <!-- sidebar TOC HTML -->
{{previous}}          <!-- { link, name } or undefined -->
{{next}}              <!-- { link, name } or undefined -->
{{git_repository_url}} <!-- from config -->
{{print_enable}}      <!-- print.html enabled? -->
{{search_enabled}}    <!-- search feature enabled? -->
```

## Preprocessors

Preprocessors transform Markdown before rendering. Common ones:

| Preprocessor | Install | Effect |
|---|---|---|
| `mdbook-admonish` | `cargo install mdbook-admonish` | Callout blocks |
| `mdbook-mermaid` | `cargo install mdbook-mermaid` | Mermaid diagrams |
| `mdbook-toc` | `cargo install mdbook-toc` | Inline `<!-- toc -->` generation |
| `mdbook-tabs` | `cargo install mdbook-tabs` | Tabbed content |
| `mdbook-katex` | `cargo install mdbook-katex` | KaTeX math (alternative to MathJax) |

Custom preprocessor minimal config:
```toml
[preprocessor.my-preprocessor]
command = "my-preprocessor-binary"
renderer = ["html"]   # only run for HTML output
```

## Output backends (non-HTML)

```toml
[output.markdown]   # built-in: markdown passthrough (testing)
[output.epub]       # via mdbook-epub: cargo install mdbook-epub
```
