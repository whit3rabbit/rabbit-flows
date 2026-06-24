# mdBook: Frontmatter and Page Metadata

Distilled from rust-lang/mdBook (v0.4.x).

## Standard frontmatter (not used by default)

**mdBook does NOT process YAML/TOML frontmatter by default.** Frontmatter blocks are rendered as-is (as a table or code block) unless a preprocessor strips them.

If you need frontmatter processing, add a preprocessor like `mdbook-preprocessor-front-matter` or handle it in a custom preprocessor.

## Page metadata via SUMMARY.md

Navigation titles and structure come from `SUMMARY.md`, not from per-file frontmatter:

```md
- [Custom Title](path/to/file.md)
```

The link label in `SUMMARY.md` is the chapter's display name in the sidebar and navigation.
The page's `# H1` heading is shown at the top of the rendered page.

## Part labels

```md
# Part One

- [Chapter 1](ch1.md)

# Part Two

- [Chapter 4](ch4.md)
```

Part headings (`# Title`) create sidebar sections (not rendered as chapters).

## Draft chapters

```md
- [Upcoming Feature]()   # no file path = draft (visible in sidebar, not clickable)
```

## Include directives (within chapter files)

These are processed by the built-in `links` preprocessor:

```md
{{#include path/to/file.md}}
{{#include path/to/file.md:10:20}}       # lines 10-20 only
{{#include path/to/file.md:ANCHOR_NAME}} # named anchor

{{#rustdoc_include path/to/lib.rs:ANCHOR}}  # hide boilerplate, run as doc-test
```

Named anchors in source files (Rust, Python, etc.):
```rust
// ANCHOR: my_anchor
fn example() {}
// ANCHOR_END: my_anchor
```

## Playgrounds

Mark a code block as editable (requires `[output.html.playground] editable = true`):
````md
```rust,editable
fn main() {
    println!("Edit me!");
}
```
````

Code block attributes: `,editable`, `,noplayground`, `,ignore`, `,should_panic`, `,no_run`.

## Notes

- Page title in the browser tab = `# H1` heading in the file.
- Sidebar title = the label in `SUMMARY.md`.
- There is no per-file slug or URL override; URLs derive from the file path relative to `src/`.
