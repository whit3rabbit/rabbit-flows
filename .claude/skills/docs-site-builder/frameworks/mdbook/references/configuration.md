# mdBook: Configuration (book.toml)

Distilled from rust-lang/mdBook (v0.4.x).

## Minimal config

```toml
[book]
title = "My Book"
```

## Full config example

```toml
[book]
title = "My Book"
authors = ["Jane Smith"]
description = "A book about things."
language = "en"
multilingual = false
src = "src"           # content source directory (default: "src")

[build]
build-dir = "book"   # output directory (default: "book")
create-missing = true  # create missing chapter files from SUMMARY.md

[rust]
edition = "2021"     # Rust edition for doc-tests (default: "2015")

[output.html]
theme = "default"                        # or path to a custom theme dir
default-theme = "light"                  # "light" | "rust" | "coal" | "navy" | "ayu"
preferred-dark-theme = "navy"
git-repository-url = "https://github.com/org/repo"
git-repository-icon = "fa-github"
edit-url-template = "https://github.com/org/repo/edit/main/{path}"
site-url = "/my-book/"                   # for deployment at a sub-path
cname = "book.example.com"
no-section-label = false                 # omit section numbers in sidebar
additional-css = ["theme/custom.css"]
additional-js = ["theme/custom.js"]
mathjax-support = true                   # enable MathJax
google-analytics = "UA-XXXXX-Y"
search.enable = true
search.limit = 30
search.use-boolean-and = true
search.boost-title = 2
search.boost-hierarchy = 1
search.boost-paragraph = 1
search.expand = true
search.heading-split-level = 3
search.copy-js = true

[output.html.print]
enable = true        # print.html page for the entire book
page-break = true    # insert page breaks between chapters in print view

[output.html.fold]
enable = false       # fold/collapse sections in the sidebar
level = 0            # depth at which to fold

[output.html.playground]
editable = false     # allow editing code examples inline
line-numbers = false

[preprocessor.index]
# built-in: converts README.md to index.html
[preprocessor.links]
# built-in: expands {{#include path}} and {{#rustdoc_include ...}}
```

## `SUMMARY.md` (navigation definition)

This file is required and defines the entire book structure.

```md
# Summary

[Introduction](README.md)

- [First Chapter](chapter-1.md)
- [Second Chapter](chapter-2/README.md)
  - [Sub-section](chapter-2/sub-section.md)

---

[Appendix](appendix.md)
[Other references]()   # chapter without a file (coming soon placeholder)
```

Rules:
- **Numbered chapters:** items in an ordered/unordered list under a `# Part Title`.
- **Prefix chapters:** links before the first list item (not numbered, always visible).
- **Suffix chapters:** links after all list items (not numbered).
- **Draft chapters:** `[Title]()` with no link — shows in sidebar but is not built.
- **Separators:** `---` adds a horizontal rule between sections.
- `README.md` in a directory becomes the chapter index (`index.html`).

## Preprocessors

```toml
[preprocessor.mermaid]
command = "mdbook-mermaid"   # external preprocessor binary

[preprocessor.admonish]
command = "mdbook-admonish"
```

Install external preprocessors via cargo:
```sh
cargo install mdbook-mermaid
mdbook-mermaid install   # injects JS into book.toml/theme
```

## Output backends

```toml
[output.html]      # default HTML output
[output.epub]      # EPUB via mdbook-epub (external)
[output.pdf]       # PDF via mdbook-pdf (external)
[output.markdown]  # raw markdown passthrough (built-in, for testing)
```
