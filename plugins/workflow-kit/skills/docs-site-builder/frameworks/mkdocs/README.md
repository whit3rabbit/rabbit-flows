# MkDocs (SKELETON — not filled in yet)

This framework has no distilled references yet. Until it does, author from the current official
docs (use the `find-docs` skill / context7), not from memory.

## Quick facts (unverified stubs — confirm against current docs)

- Python-based. Install: `pip install mkdocs mkdocs-material` (Material is the common theme).
- New project: `mkdocs new .` → creates `mkdocs.yml` + `docs/index.md`.
- Config: `mkdocs.yml` (`site_name`, `theme`, `nav`, `plugins`, `markdown_extensions`).
- Content: Markdown under `docs/`. Serve: `mkdocs serve`. Build: `mkdocs build`.
- Material docs: https://squidfunk.github.io/mkdocs-material/

## To fill this in

Mirror the Starlight set (see `../../SKILL.md`):
1. Clone https://github.com/squidfunk/mkdocs-material and https://github.com/mkdocs/mkdocs.
2. Distill setup / `mkdocs.yml` config / nav / Material components into compact `references/*.md` here.
3. Rewrite this README as: scaffold → configure → author → content → components, pointing at them.
