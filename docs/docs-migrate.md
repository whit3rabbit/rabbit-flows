# Docs Migrate Workflow

The `docs-migrate` workflow migrates a documentation site from one framework to another. It scrapes the source corpus, maps the information architecture, converts pages to the target format (fixing framework-specific tags/components), detects leftover syntax, and configures the target workspace.

## Overview

Associated skills:
- **`document`** (Front-door skill): Conversational entry point.
- **`docs-scraper`** (Front-door & specialist): Fetches existing docs from URL or git repo.
- **`docs-site-builder`** (Specialist dependency): Controls site framework adapter generation and verification.

---

## `docs-migrate`

### Args

| Key | Type | Meaning |
|---|---|---|
| `from` | `string` (required) | Source framework: `mkdocs`, `starlight`, `docusaurus`, `vitepress`, `gitbook`, `sphinx`, `generic`. |
| `to` | `string` (required) | Target framework: `starlight`, `docusaurus`, `vitepress`, `mkdocs`. |
| `source` | `string` (required) | Source directory path, Git repository URL, or public URL. |
| `outDir` | `string` (required) | Output directory where the migrated site will be written. |
| `maxPages` | `number` | Limit on pages converted. Default `50`, hard cap `200`. |
| `title` | `string` | Title of the new site. Default: derived from source. |
| `repoUrl` | `string` | Explicitly enforce git acquisition strategy with this URL. |
| `scriptsDir` | `string` | Where `scrape.py` and `setup_venv.sh` live. Default: uses bundled skill copy. |
| `refsDir` | `string` | Fallback directory path for the `docs-scraper` references. |

### Example

```json
/docs-migrate {
  "from": "mkdocs",
  "to": "starlight",
  "source": "https://example.com/docs",
  "outDir": "./docs-site"
}
```
