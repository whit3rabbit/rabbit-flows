# mdBook

Rust-based static-site generator for book-style documentation (v0.4.x). CommonMark Markdown;
no components or JSX. Navigation is driven entirely by `src/SUMMARY.md`.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — `cargo install mdbook`, `mdbook init`, project structure. → `references/setup.md`
2. **Configure** — `book.toml`: book metadata, output.html options (theme, edit URL, MathJax,
   search), preprocessors, output backends. → `references/configuration.md`
3. **Author pages and structure** — `src/SUMMARY.md` defines all chapters and navigation;
   no frontmatter system. Chapter ordering, prefix/suffix chapters, draft entries (`[Title]()`),
   separators (`---`). → `references/frontmatter.md`
4. **Rich content** — file includes (`{{#include}}`), Rust playground code blocks, MathJax
   (double-backslash syntax), admonitions via `mdbook-admonish`, Mermaid via `mdbook-mermaid`.
   → `references/content-authoring.md`
5. **Theme and extensions** — override theme files (`theme/index.hbs`, CSS, JS), Handlebars
   variables, CSS custom properties, external preprocessors. → `references/components.md`

For a single narrow question (e.g. "how do I include a file range?") read just the one
relevant reference.

## Quick facts

- Install: `cargo install mdbook` (Rust toolchain required) or download binary from GitHub releases
- New project: `mdbook init my-book` — creates `book.toml` + `src/SUMMARY.md`
- Config file: `book.toml` at project root
- Content: Markdown files under `src/` — ALL chapters must be listed in `src/SUMMARY.md`
- Dev: `mdbook serve` (live-reload at http://localhost:3000) | Build: `mdbook build`
- Navigation: `SUMMARY.md` only — files not listed there are not built
- No frontmatter system: page title comes from the first `#` heading or the SUMMARY.md entry label
- File includes: `{{#include relative/path.md}}` or `{{#include src/lib.rs:10:25}}` (line range)
  or `{{#include src/lib.rs:anchor_name}}` (named anchors via `// ANCHOR: name`)
- Math: enable `mathjax-support = true` in `[output.html]`; syntax is `\\(inline\\)` and `\\[block\\]`
- Admonitions: opt-in via `cargo install mdbook-admonish && mdbook-admonish install`
- Validate: `mdbook build` catches chapters referenced in SUMMARY.md that don't exist

## Authoring guidance

- `SUMMARY.md` is the single source of truth for navigation. Edit it first before creating files;
  or set `create-missing = true` in `[build]` to auto-create missing chapter files.
- mdBook has no component system. Rich UI (admonitions, Mermaid, tabs) requires external preprocessors
  installed via cargo. Add them to `book.toml` before using their syntax.
- Theme customization: run `mdbook init --theme` to copy theme files to `theme/`; then add
  `additional-css` or `additional-js` in `[output.html]` for targeted overrides without replacing
  the full theme.
- For Rust projects: `mdbook test` runs Rust doc-tests embedded in code blocks.
