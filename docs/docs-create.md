# Docs Create Workflow

The `docs-create` workflow authors a comprehensive documentation site from a written brief without requiring an existing codebase. It plans the information architecture, writes pages in parallel, runs a quality gate to verify them, and generates framework-specific configuration files.

## Overview

Associated skills:
- **`document`** (Front-door skill): Conversational entry point for all documentation workflows.
- **`docs-site-builder`** (Specialist dependency): Manages page-authoring templates, frameworks, and configuration generation.

---

## `docs-create`

### Args

| Key | Type | Meaning |
|---|---|---|
| `brief` | `string` (required) | Description of what the documentation should cover and target audience instructions. |
| `outDir` | `string` (required) | Absolute or project-relative output directory to write the site files to. |
| `framework` | `string` | Target framework. Default: `starlight`. Supported: `starlight`, `docusaurus`, `mkdocs`, `vitepress`, `fumadocs`, `mdbook`, `docsify`, `sphinx`, `nextra`, `mintlify`, `docsy`, `scalar`, `redocly`. |
| `scaffoldMode` | `'content-only' \| 'add-to-existing' \| 'full-project'` | Default: `content-only`. `add-to-existing` preserves existing files and skips config clobbering. `full-project` generates a complete, runnable workspace project (currently Starlight-only). |
| `sources` | `string[]` | Reference source files to read as background material. |
| `pages` | `object[]` | Pre-defined page list to bypass planning. Each item: `{path, title, kind, group, brief, diataxisType?, template?}`. |
| `basePath` | `string` | Base routing path where the site is served from (e.g. `/docs`). |
| `i18n` | `object` | Enable multi-locale translations: `{defaultLocale: string, locales: string[]}`. |
| `versioning` | `object` | Set version configuration: `{current: string, versions?: string[]}`. |
| `refsDir` | `string` | Fallback directory path for the `docs-site-builder` references. |

### Example

```json
/docs-create {
  "brief": "Documentation for rabbit-flows including installation and configuration.",
  "outDir": "./docs-site",
  "framework": "docusaurus",
  "scaffoldMode": "full-project"
}
```

---

## Supported Frameworks

Refer to [Docs Frameworks](file:///Users/whit3rabbit/Documents/GitHub/rabbit-flows/README.md#docs-frameworks) for the list of built-in and runtime-constructed frameworks.
