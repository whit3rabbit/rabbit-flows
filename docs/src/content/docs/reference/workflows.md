---
title: Workflows catalog
description: Exhaustive reference for every installable rabbit-flows workflow — args, invocation, and skill dependencies.
sidebar:
  label: Workflows catalog
  order: 1
---

Run an installed workflow by name in Claude Code. Pass a JSON args object after the command name:

```
/workflow-name { "key": "value" }
```

Most workflows also accept a bare string shortcut where the primary arg is obvious (noted per entry). Workflows run in the background with no interactive I/O; all inputs must be in `args` before the run starts.

Install any workflow with the `npx` installer:

```bash
npx @whit3rabbit/rabbit-flows install --workflow <name>
```

---

`starter.js` is a reference-only spine example (the canonical decompose/workers/gate/synthesize skeleton). It is not in the installer catalog and cannot be installed or run.

---

## docs-create

**Purpose:** Author a documentation site from a written brief. Plans pages, fans out one author per page, runs a quality gate, and assembles the site config.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `brief` | `string` (required) | What the docs cover, plus any authoring instructions. |
| `outDir` | `string` (required) | Absolute or repo-relative directory to write the site into. |
| `framework` | `string` | Target framework. Default `starlight`. Supported: `starlight`, `docusaurus`, `mkdocs`, `vitepress`, `fumadocs`, `mdbook`, `docsify`, `sphinx`, `nextra`, `mintlify`, `docsy`, `scalar`, `redocly`. |
| `scaffoldMode` | `'content-only' \| 'add-to-existing' \| 'full-project'` | Default `content-only` (write page content and config only). `add-to-existing` skips config clobbering. `full-project` scaffolds a complete buildable project (Starlight only). |
| `sources` | `string[]` | Files the page authors should read as source material. |
| `pages` | `object[]` | Skip Frame IA and Plan; author exactly these pages. Each item: `{path, title, kind, group, brief, diataxisType?, template?}`. |
| `basePath` | `string` | Subpath the site is served from, e.g. `/docs`. Mapped to the framework's base config key where supported. |
| `i18n` | `{defaultLocale: string, locales: string[]}` | Enable multi-locale output. Mapped to each framework's i18n config block where supported. |
| `versioning` | `{current: string, versions?: string[]}` | Set the docs version label. Mapped where supported (Docusaurus, MkDocs/mike, Sphinx). |
| `refsDir` | `string` | Deep-escalation fallback pointing at the `docs-site-builder` references directory. |

**Example:**

```
/docs-create { "brief": "Docs for the qz CLI compressor", "outDir": "./docs-site", "framework": "docusaurus" }
```

**Depends on:** `docs-site-builder`, `document`

---

## docs-from-code

**Purpose:** Document a whole codebase into a docs site using an Eatahorse board as a durable, resumable ledger. Enumerates source files, frames information architecture, plans one card per module page, fans out grounded authors in gated rounds until the board is clear, then assembles config and writes back.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `root` | `string` | Source root to document. Also accepts a bare string: `/docs-from-code <path>`. Default `.`. |
| `outDir` | `string` (required) | Directory to write the docs site into. |
| `framework` | `string` | Target framework. Default `starlight`. Same supported set as `docs-create`. |
| `brief` | `string` | Additional authoring instructions injected into the plan. |
| `board` | `string` | Board directory. Default `.eatahorse` in the project root. |
| `workerModel` | `string` | Model for page author workers. Default `sonnet`. |
| `maxRounds` | `number` | Maximum author loop rounds. Default `3`. |
| `includeTutorials` | `boolean` | Default `false`. When `true`, Plan also authors tutorial/getting-started pages (which require intent the source rarely states). |
| `filesPerPage` | `number` | Target source files per documentation page. |
| `pages` | `object[]` | Skip Plan; author exactly these pages. |
| `include` | `string` | Glob filter: keep only matching source files. |
| `exclude` | `string` | Glob filter: drop matching source files. |
| `scaffoldMode` | `'content-only' \| 'add-to-existing' \| 'full-project'` | Default `content-only`. |
| `basePath` | `string` | Subpath the site is served from, e.g. `/docs`. |
| `i18n` | `{defaultLocale: string, locales: string[]}` | Multi-locale config. |
| `versioning` | `{current: string, versions?: string[]}` | Version label. |
| `scriptPath` | `string` | Path to `eatahorse.py`. Default: bundled skill copy. |

**Example:**

```
/docs-from-code { "root": "src", "outDir": "./docs-site", "framework": "mkdocs" }
```

**Depends on:** `eatahorse`, `docs-site-builder`, `document`

---

## docs-migrate

**Purpose:** Migrate a documentation site from one framework to another. Acquires the source corpus, maps pages via a crosswalk, fans out one conversion worker per page, gates for syntax leaks, and assembles the target config.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `from` | `string` (required) | Source framework: `mkdocs`, `starlight`, `docusaurus`, `vitepress`, `gitbook`, `sphinx`, `generic`. |
| `to` | `string` (required) | Target framework: `starlight`, `docusaurus`, `vitepress`, `mkdocs`. |
| `source` | `string` (required) | Source URL or local directory path. |
| `outDir` | `string` (required) | Where to write the migrated site. |
| `maxPages` | `number` | Default `50`, hard cap `200`. |
| `title` | `string` | Site title. Default: derived from source. |
| `repoUrl` | `string` | Force git acquisition path. |
| `scriptsDir` | `string` | Where `scrape.py` and `setup_venv.sh` live. Default: bundled skill copy. |
| `refsDir` | `string` | Deep-escalation fallback for `docs-scraper` references. |

**Example:**

```
/docs-migrate { "from": "mkdocs", "to": "starlight", "source": "https://example.com/docs", "outDir": "./docs-site" }
```

**Depends on:** `docs-scraper`, `docs-site-builder`, `document`

---

## docs-scrape

**Purpose:** Ingest a documentation website into a local markdown corpus. Detects the platform, picks the cheapest acquisition path (git clone, Python scraper via trafilatura, Playwright render, or per-page WebFetch), gates the pages, and assembles the corpus.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `url` | `string` (required) | Docs root or entry URL. |
| `outDir` | `string` (required) | Where to write the corpus. |
| `maxPages` | `number` | Default `50`, hard cap `500`. |
| `platform` | `string` | Override auto-detection: `starlight`, `docusaurus`, `mkdocs`, `vitepress`, `fumadocs`, `gitbook`, `sphinx`, `docsify`, `generic`. |
| `repoUrl` | `string` | Force or seed the git acquisition path. |
| `strategy` | `'git' \| 'python' \| 'playwright' \| 'webfetch'` | Override the auto-selected acquisition strategy. |
| `include` | `string[]` | URL-glob filters: keep only matching pages. |
| `exclude` | `string[]` | URL-glob filters: drop matching pages. |
| `format` | `'tree' \| 'single'` | Default `tree` (one `.md` file per page). `single` concatenates into one corpus file. |
| `scriptsDir` | `string` | Where `scrape.py` and `setup_venv.sh` live. Default: bundled skill copy. |
| `refsDir` | `string` | Deep-escalation fallback for `docs-scraper` references. |

**Example:**

```
/docs-scrape { "url": "https://example.com/docs", "outDir": "./corpus", "maxPages": 3 }
```

Start with a low `maxPages` before crawling a large site; the Python scraper sidesteps the per-page model cost but still hits the network.

**Depends on:** `docs-scraper`

---

## eatahorse

**Purpose:** Decompose a goal into an Eatahorse Kanban board and gate the plan. Optionally work the board unattended one bite at a time in a Ralph-style loop: a fresh-context worker per iteration, completion-gated, until the board is clear or caps are hit. Writes decisions back to `CLAUDE.md`.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `goal` | `string` | The objective to break down. Also accepts a bare string: `/eatahorse <goal>`. |
| `execute` | `boolean` | Default `false` (plan only, no code written). `true` runs the unattended Ralph loop. |
| `board` | `string` | Board directory. Default `.eatahorse`. |
| `maxIterations` | `number` | Hard loop cap. Default `40`, max `200`. |
| `workerModel` | `string` | Model for execute-loop workers. Default `sonnet`. |
| `scriptPath` | `string` | Path to `eatahorse.py`. Default: bundled skill copy. |

**Example:**

```
/eatahorse { "goal": "Add OAuth login", "execute": true }
```

`execute:true` makes unattended edits to the project. Run on a scratch project or a slice first, and confirm the session allowlist covers the operations the workers need.

**Depends on:** `eatahorse`

---

## eatahorse-research

**Purpose:** Research every file in a folder using an Eatahorse board as a durable, resumable ledger. Enumerates files, seeds one card per file, fans out parallel research workers in gated rounds until the board is dry, and synthesizes a cited report.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `root` | `string` | Folder to research. Also accepts a bare string: `/eatahorse-research <path>`. Default `.`. |
| `question` | `string` | Research question applied to every file. Default: `Summarize what each file does and flag anything notable.` |
| `include` | `string` | Glob filter: keep only matching files. |
| `exclude` | `string` | Glob filter: drop matching files. |
| `board` | `string` | Board directory. Default `.eatahorse-research`. |
| `workerModel` | `string` | Model for research workers. Default `haiku`. |
| `maxRounds` | `number` | Maximum research loop rounds. Default `3`, max `10`. |
| `out` | `string` | Output report path. Default `eatahorse-research.md`. |
| `scriptPath` | `string` | Path to `eatahorse.py`. Default: bundled skill copy. |

**Example:**

```
/eatahorse-research { "root": "src", "question": "What does each module do?" }
```

Files beyond the per-run cap stay in `backlog` on the board and carry to the next run. Re-run the workflow to continue; the board tracks what is already done.

**Depends on:** `eatahorse`

---

## scaffold

**Purpose:** Start a project from scratch and stub the whole file tree. Runs a discussion-driven brief (via the `new-project` front-door skill), researches dependencies, runs independent blind architecture proposals merged at a decision gate, fans out cheap workers to build every file stub under a configurable line ceiling, then writes decisions back to `CLAUDE.md`.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `brief` | `string` | Project description. Also accepts a bare string: `/scaffold <brief>`. |
| `dir` | `string` | Output directory. Default `./scaffold-out`. Must be a fresh relative subdirectory (not `.`, `~`, or a traversal path). Pass `allowAbsoluteDir:true` to use an absolute path. |
| `write` | `boolean` | Default `true`. `false` stops after the architecture decision (dry run, nothing written). |
| `verify` | `boolean` | Default `false`. `true` runs the generated install/build/test commands (executes unreviewed generated code). |
| `attempts` | `number` | Number of independent blind architecture proposals. Default `2`, max `6`. |
| `debate` | `boolean` | Default `false`. `true` runs one blind rebuttal round before the decision gate. |
| `polish` | `boolean` | Default `false`. `true` adds a Sonnet once-over pass after build (duplication, consistency, API-match). |
| `maxFileLines` | `number` | Per-file line ceiling. Default `400`, range `80`-`1000`. |
| `interface` | `string` | Project interface type: `cli`, `tui`, `gui`, `library`, `service`. Default `unspecified`. |
| `targetOS` | `string \| string[]` | Target OS(es). Default `cross-platform`. |
| `language` | `string` | Language or runtime preference. Default: model picks the best fit. |
| `license` | `string` | License identifier. Default `unspecified`. |
| `publish` | `boolean` | Whether the project will be published. Default `false`. |
| `apiSurface` | `string` | Public API surface description. Default `none stated`. |
| `priorArt` | `string` | Inspired-by or prior art notes. Default `none stated`. |
| `frontend` | `boolean` | Whether a frontend is involved. |
| `backend` | `boolean` | Whether a backend is involved. |
| `deps` | `string` | Dependency preferences. Default `no preference stated`. |

**Example:**

```
/scaffold { "brief": "A CLI todo app in Rust", "dir": "./todo", "write": false }
```

Use `verify:false` (the default) until you are ready to run the generated code. Use `write:false` to review the architecture before any files are written.

**Depends on:** `architect`, `new-project`

---

## security-audit

**Purpose:** Defensive code audit over committed code. Builds a deterministic recon index (symbols, call graph, entry points), maps the attack surface, fans out audit lanes, gates findings to drop false positives (reachability-strict, defaults to INVALID), and reports with remediation guidance. Never produces exploit code or payloads.

**Args:**

| Key | Type | Meaning |
|---|---|---|
| `scope` | `string` | Path, folder, or `.` for the whole repo. Also accepts a bare string: `/security-audit <path>`. Default `.`. |
| `focus` | `string[]` | Vulnerability classes to prioritize, e.g. `["authz", "ssrf"]`. |
| `maxLanes` | `number` | Maximum parallel audit lanes. Default `8`, hard cap `16`. |
| `mode` | `'paths' \| 'diff'` | Default `paths` (audit committed code under scope). `diff` audits only files changed since `since`. |
| `since` | `string` | Git ref for diff mode. Default `HEAD~1`. |
| `partitionThreshold` | `number` | File count above which to switch from thematic to file-partition coverage. Default `40`. |
| `workerModel` | `string` | Model for audit lane workers. Default `haiku`. |
| `gateModel` | `string` | Model for the per-finding gate. Default `sonnet`. |
| `planModel` | `string` | Model for the map stage. Default `opus`. |
| `reportModel` | `string` | Model for the final report. Default `opus`. |
| `baselinePath` | `string` | Path for the triage baseline file. Default `.security-audit/baseline.md`. |
| `writeBaseline` | `boolean` | Default `true`. Write confirmed findings to the baseline so re-runs suppress accepted items. |
| `reconScript` | `string` | Path to `recon.py`. Default: bundled skill copy. |
| `reconOut` | `string` | Path for the recon index JSON. Default `.security-audit/recon.json`. |

**Example:**

```
/security-audit { "scope": "src", "focus": ["authz", "ssrf"] }
```

**Depends on:** `secure-review`
