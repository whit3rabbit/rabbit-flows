# mdBook (SKELETON — not filled in yet)

This framework has no distilled references yet. Until it does, author from the current official
docs (use the `find-docs` skill / context7), not from memory.

## Quick facts (unverified stubs — confirm against current docs)

- Rust-based. Install: `cargo install mdbook`. New project: `mdbook init`.
- Config: `book.toml`. Nav/structure: `src/SUMMARY.md` (the table of contents drives the book).
- Content: Markdown under `src/`. Serve: `mdbook serve`. Build: `mdbook build`.
- Docs: https://rust-lang.github.io/mdBook/

## To fill this in

Mirror the Starlight set (see `../../SKILL.md`):
1. Clone https://github.com/rust-lang/mdBook.
2. Distill setup / `book.toml` / `SUMMARY.md` structure / preprocessors into compact `references/*.md`.
3. Rewrite this README as: scaffold → configure → author → content → components, pointing at them.
