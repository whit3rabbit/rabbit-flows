# rabbit-flows

Workflows that help you through tedious tasks using Claude Code dynamic workflows. Prioritizes using less tokens when possible but with optimized speed to get the job done.

Includes an `npx` installer that bundles each workflow with the skills and agents it depends on.

The platform shares workflows by repo clone and skills/agents by plugin marketplace, but gives you no way to install *a workflow and its dependencies together*. This installer is
that missing path.

## How to Install

```bash
```

## Catalog

### Workflows (`/name`, run via `/workflows`)

| Workflow | What it does | Example |
|---|---|---|
| `starter` | Reference spine: decompose a question, fan out workers, gate their notes, synthesize a cited answer. | `/starter What are the tradeoffs between SQLite and Postgres for a single-node app?` |
| `scaffold` | Start a project from scratch and stub+document the whole tree under a per-file line ceiling. | `/scaffold { "brief": "A CLI todo app in Rust", "dir": "./todo", "write": false }` |
| `security-audit` | Defensive audit: map the attack surface, fan out audit lanes, gate findings to drop false positives, report with remediation. | `/security-audit { "scope": "src", "focus": ["authz", "ssrf"] }` |
| `docs-create` | Author a Starlight docs site from a brief: plan pages, fan out authors, verify and assemble config. | `/docs-create { "brief": "Docs for the qz CLI compressor", "outDir": "./docs-site" }` |
| `docs-from-code` | Document an existing codebase into a Starlight site via a durable Eatahorse board, each page grounded in source. | `/docs-from-code { "root": "src", "outDir": "./docs-site" }` |
| `docs-scrape` | Ingest an external documentation website into a local markdown corpus. | `/docs-scrape { "url": "https://example.com/docs", "outDir": "./corpus", "maxPages": 3 }` |
| `eatahorse` | Decompose a goal into an Eatahorse Kanban board and optionally work it unattended one bite at a time. | `/eatahorse { "goal": "Add OAuth login", "execute": true }` |
| `eatahorse-research` | Research every file in a folder using the board as a durable, resumable ledger. | `/eatahorse-research { "root": "src", "question": "What does each module do?" }` |

### Front-door skills (conversational intake → launch a workflow)

| Skill | What it does | Example |
|---|---|---|
| `new-project` | Gathers a brief through a short discussion, then launches `scaffold` with the answers. | "Start a new Rust CLI todo app from scratch." |
| `document-codebase` | Gathers options, then launches `docs-from-code` (or drives the same board conversationally when workflows are off). | "Document this codebase into a docs site." |

### Specialist skills (roles bundled into a workflow; also usable directly)

| Skill | What it does | Example |
|---|---|---|
| `architect` | Proposes one software architecture from a brief, blind to other attempts, for a merge gate to judge. | "Propose an architecture for a multi-tenant billing service." |
| `secure-review` | Defensive code review that emits evidence-backed findings without exploit code. | "Review `src/auth` for injection and authz bugs." |
| `docs-site-builder` | Authoring reference for building and configuring Astro Starlight docs sites. | "Set up a Starlight docs site for this project." |
| `docs-scraper` | Detects a docs platform and extracts clean markdown for mirroring a site. | "Save these docs locally as markdown." |
| `eatahorse` | Lightweight one-bite-at-a-time Kanban boards (`.eatahorse` JSON + markdown cards). | "Track this work as a Kanban board." |

### Authoring skills (help you build workflows; load in this repo)

| Skill | What it does | Example |
|---|---|---|
| `dynamic-workflow-authoring` | Helps write, debug, and save workflow scripts; bundles the `validate.py` linter. | "Write a workflow that audits every file in parallel." |
| `workflow-guardrails` | Discipline for whether a task needs a workflow and how many agents/models to spend; travels to installs as a skill. | "Should this task be a workflow or just subagents?" |

## Where things live

| Path | What it is |
|---|---|
| `.claude/workflows/*.js` | The workflow scripts themselves (see [Catalog](#catalog) above). Each runs via `/workflows`. Shared by cloning this repo. |
| `.claude/skills/dynamic-workflow-authoring/` | A skill that helps you **write and debug** workflow scripts. Loads automatically when you work in this repo. Its `scripts/validate.py` lints workflow files (the linter CI runs). |
| `plugins/workflow-kit/skills/`, `.../agents/` | Specialist roles (e.g. `architect`, `secure-review`) that some workflows lean on. These ship via the marketplace plugin and the installer copies them next to the workflow that needs them. |
| `installer/manifest.json` | The catalog: maps each workflow to the skills/agents it bundles. |
| `bin/cli.mjs` | The `npx` installer. |

New workflows go in `.claude/workflows/<name>.js` (save with `/workflows` → `s`), then get
an entry in `installer/manifest.json`. Authoring rules live in `CLAUDE.md` + `.claude/rules/`.

## Prerequisites

Dynamic workflows need Claude Code **v2.1.154+**. On a Pro plan they are off by default:
enable the **Dynamic workflows** row in `/config`, or `/workflows` does nothing.

## Install a workflow

```bash
npx @whit3rabbit/rabbit-flows            # interactive menu
npx @whit3rabbit/rabbit-flows --list     # show the catalog
npx @whit3rabbit/rabbit-flows --workflow starter --scope project   # non-interactive
```

The menu lets you pick workflows; each selected workflow copies its `.js` into
`<scope>/workflows/` and every skill/agent it needs into `<scope>/skills/` and
`<scope>/agents/`. Scope is **project** (`./.claude`) or **user** (`~/.claude`).

These are plain file copies, not plugin-managed installs, so there is no
`/plugin update` for them: re-run with `--force` to overwrite and update.

Flags: `--workflow a,b` (skip menu), `--scope project|user` (defaults to `project`
when omitted non-interactively), `--force` (overwrite existing), `--list`, `--check`.

## Run a workflow

After installing, enable **Dynamic workflows** in `/config`, then run one by name.
Pass structured inputs as an `args` object:

```
/starter         What are the tradeoffs between SQLite and Postgres for a single-node app?
/scaffold        { "brief": "A CLI todo app in Rust", "dir": "./todo", "write": false }
/security-audit  { "scope": "src", "focus": ["authz", "ssrf"] }
/docs-create     { "brief": "Docs for the qz CLI compressor", "outDir": "./docs-site" }
/docs-scrape     { "url": "https://example.com/docs", "outDir": "./corpus", "maxPages": 3 }
```

`/docs-scrape` needs network egress (WebFetch) and writes under `outDir`. Start with a small
`maxPages` to slice-test a site before a full crawl.

`/scaffold` only writes files when `write: true`, and only EXECUTES the generated
install/build/test when `verify: true` (both default true). Use `write: false` for a
dry run, or `write: true, verify: false` to write the scaffold and inspect it before
running anything. `dir` defaults to `./scaffold-out` (a fresh subdir, never your cwd);
pass `dir` to override.

## Repo layout

```
.claude/workflows/        workflow scripts (the installable units)
.claude/rules/            authoring rules (load as project context here)
installer/manifest.json   catalog: each workflow + its skill/agent deps
bin/cli.mjs               the installer
plugins/workflow-kit/     the marketplace plugin (skills + agents)
```

## Add a workflow to the catalog

1. Drop the script in `.claude/workflows/<name>.js`.
2. Put any reusable specialist skill in `plugins/workflow-kit/skills/<name>/SKILL.md`,
   and any fixed-model subagent in `plugins/workflow-kit/agents/<name>.md`.
3. Add an entry to `installer/manifest.json` listing the workflow file and its
   `skills`/`agents` by name.
4. `npm run check` asserts every referenced file exists (run it in CI to catch drift).
5. If you touched a file in `.claude/rules/`, run `npm run build:skill` to regenerate the
   `workflow-guardrails` skill (never hand-edit it); `npm run check` fails if it drifts.

## The marketplace plugin

The skills and agents also install cross-project without cloning:

```bash
/plugin marketplace add whit3rabbit/rabbit-flows
/plugin install workflow-kit@rabbit-flows
```

(`workflow-kit` is the plugin; `rabbit-flows` is the marketplace it ships in. `marketplace add`
registers it under the marketplace's manifest name, not the repo name, so the two now match.)

Authoring discipline lives in `CLAUDE.md` + `.claude/rules/` (loaded when working in this
repo) and travels to installers as the `workflow-guardrails` skill.
