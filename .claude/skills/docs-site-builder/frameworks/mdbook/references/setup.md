# mdBook: Setup

Distilled from rust-lang/mdBook (v0.4.x). Rust-based Markdown book generator.

## Install

```sh
# Via cargo (Rust toolchain required)
cargo install mdbook

# Via pre-built binary (download from GitHub releases):
# https://github.com/rust-lang/mdBook/releases
```

## New project

```sh
mdbook init my-book
cd my-book
mdbook serve   # dev server at http://localhost:3000
mdbook build   # output to ./book/
```

`mdbook init` creates:
```
my-book/
  book.toml      # configuration
  src/
    SUMMARY.md   # table of contents (drives navigation)
    chapter_1.md
```

When prompted, it can generate a `.gitignore` for the `book/` output.

## Commands

```sh
mdbook init [path]        # create new book
mdbook build [path]       # build to book/ (default)
mdbook serve [path]       # build + live-reload dev server
mdbook test [path]        # run Rust doc-tests in code blocks
mdbook clean [path]       # delete build output
mdbook watch [path]       # rebuild on file changes (no server)
```

## Project structure

```
my-book/
  book.toml              # book configuration
  src/
    SUMMARY.md           # defines the chapter structure (required)
    README.md            # introduction / home page (linked from SUMMARY.md)
    chapter-1.md
    chapter-2/
      README.md          # chapter index page
      sub-section.md
  book/                  # build output (auto-generated, gitignore this)
  theme/                 # optional: override HTML/CSS/JS/handlebars templates
```

## Notes

- `SUMMARY.md` is the only navigation file. All chapters must be listed there.
- mdBook produces a static HTML site (no JavaScript framework).
- Chapters not linked in `SUMMARY.md` are not built.
- mdBook is commonly used for Rust crate documentation (The Rust Book, Rustonomicon, etc.).
