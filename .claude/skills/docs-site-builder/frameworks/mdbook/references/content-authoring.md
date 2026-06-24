# mdBook: Content Authoring

Distilled from rust-lang/mdBook (v0.4.x). Chapters are Markdown files in `src/`.

## Markdown support

mdBook uses a CommonMark-compatible Markdown parser (pulldown-cmark). Most standard Markdown works.

## Handlebars helpers (built-in template variables)

Available in `theme/` override templates (Handlebars), not in content `.md` files.
Content files render as-is except for `{{#include}}` and other preprocessor directives.

## File includes

Processed by the built-in `links` preprocessor (enabled by default):

```md
<!-- Include entire file -->
{{#include relative/path/to/file.md}}

<!-- Include line range -->
{{#include src/lib.rs:10:25}}

<!-- Include a named anchor region -->
{{#include src/lib.rs:example_function}}
```

In the included file, mark anchors:
```rust
// ANCHOR: example_function
pub fn example() -> i32 { 42 }
// ANCHOR_END: example_function
```

## Code blocks

Standard fenced code blocks with syntax highlighting (highlight.js):

````md
```rust
fn main() {
    println!("Hello, world!");
}
```

```python
print("Hello, world!")
```
````

Supported language hints: any language that highlight.js recognizes.

### Rust-specific: runnable examples

````md
```rust
fn main() {
    println!("This runs in the playground!");
}
```
````

To disable (not runnable): ` ```rust,noplayground ` or ` ```rust,no_run `

To mark as expected-to-panic: ` ```rust,should_panic `

To hide from rendered output but include in doc-tests: ` ```rust,ignore `

## MathJax (if enabled in config)

```toml
[output.html]
mathjax-support = true
```

Inline: `\\(E = mc^2\\)`
Block:
```
\\[
\int_0^\infty e^{-x} dx = 1
\\]
```

Note: mdBook uses `\\(` and `\\[` (double backslash), not `$` and `$$`.

## Admonitions (via mdbook-admonish preprocessor)

Install: `cargo install mdbook-admonish && mdbook-admonish install`

````md
```admonish note
This is a note.
```

```admonish tip title="Pro tip"
Custom title tip.
```

```admonish warning
Watch out!
```
````

Types: `note`, `abstract`, `info`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`.

## Mermaid diagrams (via mdbook-mermaid preprocessor)

Install: `cargo install mdbook-mermaid && mdbook-mermaid install`

````md
```mermaid
graph LR
  A --> B --> C
```
````

## Table of contents (inline)

No built-in inline TOC. The sidebar auto-generates chapter navigation.
Right-side heading TOC is rendered by the HTML theme from the page's headings.

## Images and assets

Place images in `src/images/` (or any subdirectory of `src/`).

```md
![My Image](images/screenshot.png)
```

Relative paths work relative to the chapter file's location within `src/`.

## Custom HTML

Raw HTML works in Markdown files. Useful for special layouts.

```md
<div class="warning">

This is a custom warning block using raw HTML.

</div>
```
