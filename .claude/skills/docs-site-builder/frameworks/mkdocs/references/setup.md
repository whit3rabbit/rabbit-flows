# MkDocs: Setup

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material. Python-based static-site generator.

## Install

```sh
pip install mkdocs
# With Material theme (strongly recommended):
pip install mkdocs-material
```

Or with extras (social cards, image processing):
```sh
pip install "mkdocs-material[imaging]"
```

## New project

```sh
mkdocs new my-project   # creates mkdocs.yml + docs/index.md
cd my-project
mkdocs serve            # dev server at http://127.0.0.1:8000
mkdocs build            # output to ./site/
```

## Project structure

```
my-project/
  docs/
    index.md            # homepage
    getting-started.md
    api/
      reference.md
  mkdocs.yml            # primary config
```

## Commands

```sh
mkdocs serve            # local dev server (auto-reload)
mkdocs build            # build to ./site/ (publishable)
mkdocs build --clean    # clean build
mkdocs gh-deploy        # deploy to gh-pages branch
mkdocs new <dir>        # scaffold new project
```

## Notes

- Python 3.8+ required for MkDocs-Material 9.x.
- `site/` is the build output; add it to `.gitignore`.
- MkDocs-Material is effectively the canonical MkDocs setup; most real deployments use it.
- Plugins, extensions, and hooks are all configured in `mkdocs.yml`.
