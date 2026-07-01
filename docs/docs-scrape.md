# Docs Scrape Workflow

The `docs-scrape` workflow ingests an external documentation website into a local markdown corpus. It auto-detects the platform (e.g. Docusaurus, Starlight, MkDocs) and selects the most efficient acquisition strategy to save pages as structured markdown files.

## Overview

Supported strategies:
- **`git`**: Clones the source repository directly (preferred when a repo is public).
- **`python`**: Runs a fast, local Python scraper via `trafilatura` to extract page content.
- **`playwright`**: Employs headless Playwright rendering for Javascript-heavy or SPA documentation sites.
- **`webfetch`**: Performs standard HTTP fetches on a page-by-page basis.

Associated skills:
- **`docs-scraper`** (Front-door skill): Handles conversational configuration, strategy selection, and executes python/Playwright scripts.

---

## `docs-scrape`

### Args

| Key | Type | Meaning |
|---|---|---|
| `url` | `string` (required) | Entry point or root URL of the target documentation site. |
| `outDir` | `string` (required) | Output directory where the markdown corpus will be written. |
| `maxPages` | `number` | Limit on the number of scraped pages. Default `50`, hard cap `500`. |
| `platform` | `string` | Override auto-detection: `starlight`, `docusaurus`, `mkdocs`, `vitepress`, `fumadocs`, `gitbook`, `sphinx`, `docsify`, `generic`. |
| `repoUrl` | `string` | Force/seed the repository path for Git cloning. |
| `strategy` | `'git' \| 'python' \| 'playwright' \| 'webfetch'` | Force a specific scraping acquisition strategy. |
| `include` | `string[]` | URL-glob filters (e.g. `["**/api/**"]`) to only include matching pages. |
| `exclude` | `string[]` | URL-glob filters to drop matching pages. |
| `format` | `'tree' \| 'single'` | Default `tree` (one markdown file per page). `single` concatenates all output into one file. |
| `scriptsDir` | `string` | Where `scrape.py` and `setup_venv.sh` live. Default: uses bundled skill copy. |
| `refsDir` | `string` | Fallback directory path for the `docs-scraper` references. |

### Example

```json
/docs-scrape {
  "url": "https://example.com/docs",
  "outDir": "./corpus",
  "maxPages": 10,
  "format": "tree"
}
```
