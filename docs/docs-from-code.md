# Docs From Code Workflow

The `docs-from-code` workflow generates a comprehensive documentation site directly from an existing codebase. It scans files, constructs an information architecture, plans pages representing codebase modules, authors grounded technical pages, and registers them in the site's sidebar config.

## Overview

To remain robust and resumeable over large codebases, this workflow creates an internal **Eatahorse board** (`.eatahorse`) to track page authoring tasks. Each page requires two-stage verification (page written, and grounding verified by a separate gate) before being completed.

Associated skills:
- **`document`** (Front-door skill): Conversational entry point.
- **`eatahorse`** (Specialist dependency): Drives task planning, tracking, and execution loops.
- **`docs-site-builder`** (Specialist dependency): Controls site framework adapter generation and verification.

---

## `docs-from-code`

### Args

| Key | Type | Meaning |
|---|---|---|
| `outDir` | `string` (required) | Directory to write the docs site files to. |
| `root` | `string` | Source root to document. Also accepts a bare string: `/docs-from-code <path>`. Default `.`. |
| `framework` | `string` | Target framework. Default: `starlight`. Supported: `starlight`, `docusaurus`, `mkdocs`, `vitepress`, `fumadocs`, `mdbook`, `docsify`, `sphinx`, `nextra`, `mintlify`, `docsy`, `scalar`, `redocly`. |
| `brief` | `string` | Additional instructions/context for the documentation planner and writers. |
| `board` | `string` | Directory to save the Eatahorse board. Default: `.eatahorse` in the project root. |
| `workerModel` | `string` | Model to use for page author workers. Default `sonnet`. |
| `maxRounds` | `number` | Maximum loop rounds for parallel authors. Default `3`. |
| `includeTutorials` | `boolean` | Default `false`. If `true`, plans tutorial pages (requires extra context, which may fail grounding if not detailed). |
| `filesPerPage` | `number` | Target count of source files covered per documentation page. |
| `include` | `string` | Glob pattern to restrict source scanning (e.g. `src/**/*.ts`). |
| `exclude` | `string` | Glob pattern to ignore matching source files. |
| `scaffoldMode` | `'content-only' \| 'add-to-existing' \| 'full-project'` | Default: `content-only`. |
| `basePath` | `string` | Subpath the site is served from (e.g. `/docs`). |
| `i18n` | `object` | Enable multi-locale translations: `{defaultLocale: string, locales: string[]}`. |
| `versioning` | `object` | Set version configuration: `{current: string, versions?: string[]}`. |
| `scriptPath` | `string` | Path to `eatahorse.py`. Default: uses the bundled skill copy. |

### Example

```json
/docs-from-code {
  "root": "src",
  "outDir": "./docs-site",
  "framework": "mkdocs",
  "include": "src/**/*.rs"
}
```
