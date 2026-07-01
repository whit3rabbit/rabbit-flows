# rabbit-flows

[![CI](https://github.com/whit3rabbit/rabbit-flows/actions/workflows/ci.yml/badge.svg)](https://github.com/whit3rabbit/rabbit-flows/actions/workflows/ci.yml)
[![Publish](https://github.com/whit3rabbit/rabbit-flows/actions/workflows/publish.yml/badge.svg)](https://github.com/whit3rabbit/rabbit-flows/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/@whit3rabbit/rabbit-flows.svg)](https://www.npmjs.com/package/@whit3rabbit/rabbit-flows)
[![npm downloads](https://img.shields.io/npm/dm/@whit3rabbit/rabbit-flows.svg)](https://www.npmjs.com/package/@whit3rabbit/rabbit-flows)
[![Docker Pulls](https://img.shields.io/docker/pulls/followthewhit3rabbit/rabbit-flow-designer.svg)](https://hub.docker.com/r/followthewhit3rabbit/rabbit-flow-designer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`rabbit-flows` allows you to make and install Claude Code dynamic workflows with the skills and agents they need.

The installer copies plain files into `.claude`, records a receipt, and can uninstall only the files it placed.

Developers can modify dynamic workflows/skills to create their own installers so users can easily create their own workflows. It comes with a frontend visual designer too, although I suggest sticking with Claude to help design your workflow.

## Requirements

- Claude Code v2.1.154+.
- Dynamic workflows enabled in `/config`. On Pro, this is off by default.
- Node.js 18+ for the installer.

## Install

```bash
npx @whit3rabbit/rabbit-flows
```

## CLI

```bash
npx @whit3rabbit/rabbit-flows                         # interactive install/uninstall menu
npx @whit3rabbit/rabbit-flows --list                 # list workflows
npx @whit3rabbit/rabbit-flows install --workflow scaffold
npx @whit3rabbit/rabbit-flows install --all
npx @whit3rabbit/rabbit-flows uninstall --workflow scaffold
npx @whit3rabbit/rabbit-flows uninstall --all

npx @whit3rabbit/rabbit-flows import ./my-flow-bundle.zip    # add a shared bundle to your catalog
npx @whit3rabbit/rabbit-flows import --list                  # list imported bundles
npx @whit3rabbit/rabbit-flows import --remove my-flow        # drop one from the catalog
```

Flags:

- `--scope user|project`, defaults to `user`.
- `--force`, overwrite on install and back up displaced files (on `import`, replace an existing bundle).
- `--check`, check manifest files and workflow headers for drift.
- `--yes` (import only), consent without a prompt (required for non-interactive import).

Scopes:

- `user`: `~/.claude`
- `project`: `./.claude`

Install writes `<scope>/.rabbit-flows-receipt.json`. `--force` backups go under `<scope>/.rabbit-flows-backups/<timestamp>/`.

## Bundles (share a workflow)

A **bundle** is a `.zip` packaging one workflow plus the skills/agents it depends on. Build one in
the [Visual Designer](frontend/) ("Download bundle" in the generated-code panel, after Save to repo)
and share the file. `rabbit-flows import <bundle.zip>` validates it, stores it under
`~/.rabbit-flows/`, and registers it so its workflow shows up in the install menu tagged
`(imported)` — then install it like any built-in.

**A bundle is third-party code.** Its skill scripts and workflow run with **your** permissions when
the workflow runs; there is no sandbox. On import, rabbit-flows prints the archive sha256 and lists
every executable script the bundle ships, then asks you to confirm. Treat an unknown bundle like
`npm install` of an unknown package: only import what you trust. Imports can never shadow a built-in
workflow (that is refused outright), and the archive never controls where files are written.
The bundle format is documented in [docs/bundle-format.md](docs/bundle-format.md).

## Workflows

Two ways to trigger a workflow:

- **Easy (recommended): just say what you want.** A front-door skill recognizes the request,
  asks a couple of questions, then launches the workflow for you. Say "audit this repo for
  security bugs", "start a new Rust CLI project", or "document this codebase".
- **Power user: call the workflow by name with JSON args.** Skips the discussion; you supply the
  args yourself.

| Workflow | Say this (front door) | Power-user command |
|---|---|---|
| [`eatahorse`](docs/eatahorse.md) | "break this goal into tasks" → `eatahorse` skill | `/eatahorse { "goal": "Add OAuth login", "execute": true }` |
| [`eatahorse-plan`](docs/eatahorse.md) | "plan this work without executing" → `eatahorse` skill | `/eatahorse-plan { "goal": "Add OAuth login" }` |
| [`eatahorse-execute`](docs/eatahorse.md) | "work an existing board" → `eatahorse` skill | `/eatahorse-execute { "board": ".eatahorse-auth" }` |
| [`security-audit`](docs/security-audit.md) | "audit my code for vulnerabilities" → `audit-codebase` skill | `/security-audit { "scope": "src", "focus": ["authz", "ssrf"] }` |
| [`docs-from-code`](docs/docs-from-code.md) | "document this codebase" → `document` skill | `/docs-from-code { "root": "src", "outDir": "./docs-site", "framework": "mkdocs" }` |
| [`docs-create`](docs/docs-create.md) | "write docs from this brief" → `document` skill | `/docs-create { "brief": "Docs for the qz CLI compressor", "outDir": "./docs-site", "framework": "docusaurus" }` |
| [`docs-migrate`](docs/docs-migrate.md) | "migrate these docs to Starlight" → `document` skill | `/docs-migrate { "from": "mkdocs", "to": "starlight", "outDir": "./docs-site" }` |
| [`docs-scrape`](docs/docs-scrape.md) | "save these docs locally" → `docs-scraper` skill | `/docs-scrape { "url": "https://example.com/docs", "outDir": "./corpus", "maxPages": 3 }` |
| [`scaffold`](docs/scaffold.md) | "start a new project" → `new-project` skill | `/scaffold { "brief": "A CLI todo app in Rust", "dir": "./todo", "write": false }` |

The front-door skill ships with its workflow (see the skills table below), so the natural-language
path works as soon as the workflow is installed. `starter.js` is a reference example for the workflow
spine and is not in the installer catalog.

### Running the Designer via Docker

You can use the Rabbit Flow Designer to visually inspect, edit, and validate workflows in a local Docker container:

```bash
# Build the image
docker build -t rabbit-flow-designer .

# Run in read-only mode to view and validate workflows:
docker run --rm -p 3001:3001 \
  -v "$(pwd)/.claude/workflows:/app/.claude/workflows:ro" \
  -v "$(pwd)/.claude/skills:/app/.claude/skills:ro" \
  -v "$(pwd)/plugins:/app/plugins:ro" \
  rabbit-flow-designer
```

See [Docker (Visual Designer)](#docker-visual-designer) for full instructions, including mounting writeable paths and using Docker Compose.

## Safe Defaults

`scaffold` defaults to `write:true` and `verify:false`.

- `write:false`: dry run, no files written.
- `write:true, verify:false`: write files, run deterministic checks, execute no generated project code.
- `write:true, verify:true`: also run the generated install/build/test commands.

Use `verify:true` only when you want generated dependencies and scripts to execute.

`docs-scrape` needs network access and writes under `outDir`. Start with a low `maxPages` before crawling a large site.

## Docs Frameworks

`docs-create` and `docs-from-code` accept `framework`.

Supported ids:

```text
starlight, docusaurus, mkdocs, vitepress, fumadocs, mdbook, docsify,
sphinx, nextra, mintlify, docsy, scalar, redocly
```

These have baked inline authoring contracts:

```text
starlight, docusaurus, mkdocs, vitepress, fumadocs, mdbook, docsify
```

The remaining frameworks author from current docs at runtime. `full-project` scaffolding is Starlight-only.

## Skills

The installer copies the skills listed for the selected workflow in `installer/manifest.json`.

Front-door dependency skills gather inputs, then launch a workflow:

| Skill | Purpose |
|---|---|
| `new-project` | Intake for `scaffold`. |
| `audit-codebase` | Intake for `security-audit`. |
| `document` | Single entry point for all docs workflows: --from-code, --from-brief, --migrate, --scrape. Includes a conversational fallback (Tier 2) when workflows are off. |
| `eatahorse` | Drives Kanban boards directly, and is the intake for the `eatahorse`, `eatahorse-plan`, and `eatahorse-execute` workflows. |
| `docs-scraper` | Detects a docs site and extracts markdown; intake for `docs-scrape`. |

Specialist dependency skills (used inside a workflow, not a user front door):

| Skill | Purpose |
|---|---|
| `architect` | Produces one architecture proposal from a brief. |
| `secure-review` | Evidence-backed defensive code review. |
| `docs-site-builder` | Docs framework authoring reference. |

Authoring skills:

| Skill | Location | Purpose |
|---|---|---|
| `dynamic-workflow-authoring` | `.claude/skills/dynamic-workflow-authoring/` | Workflow authoring and linting reference for this repo. |
| `workflow-guardrails` | `plugins/workflow-kit/skills/workflow-guardrails/` | Rules for keeping workflow orchestration small and verifiable. |

## Repo Paths

| Path | Purpose |
|---|---|
| `.claude/workflows/*.js` | Workflow scripts. |
| `.claude/skills/dynamic-workflow-authoring/` | Local workflow authoring skill and `validate.py`. |
| `.claude/rules/` | Workflow authoring rules. |
| `installer/manifest.json` | Installer catalog and dependency map. |
| `bin/cli.mjs` | Installer CLI. |
| `plugins/workflow-kit/skills/` | Marketplace skills. |
| `plugins/workflow-kit/agents/` | Marketplace agents. |

## Add a Workflow

1. Add `.claude/workflows/<name>.js`.
2. Add reusable skills under `plugins/workflow-kit/skills/<name>/SKILL.md`.
3. Add fixed-model agents under `plugins/workflow-kit/agents/<name>.md`.
4. Add the workflow to `installer/manifest.json`.
5. Keep the workflow `// requires-skills:` and `// requires-agents:` headers in sync with the manifest.
6. Run `npm run check`.

If you edit `.claude/rules/`, run `npm run build:skill` before `npm run check`.

Generated docs contracts in `.claude/workflows/docs-create.js` and `.claude/workflows/docs-from-code.js` come from `scripts/build-docs-contracts.mjs`. Edit the source references, regenerate, then run `npm run check`.

## Marketplace Plugin

The marketplace plugin installs skills and agents without cloning this repo:

```bash
/plugin marketplace add whit3rabbit/rabbit-flows
/plugin install workflow-kit@rabbit-flows
```

The plugin does not install workflows. Use the `npx` installer when you need workflows plus dependencies.

## Docker (Visual Designer)

The Rabbit Flow Designer can run in Docker — no Node.js install needed on the host:

```bash
# Build from repo root:
docker build -t rabbit-flow-designer .

# Run (read-only — view workflows, validate, no writes):
docker run --rm -p 3001:3001 \
  -v "$(pwd)/.claude/workflows:/app/.claude/workflows:ro" \
  -v "$(pwd)/.claude/skills:/app/.claude/skills:ro" \
  -v "$(pwd)/plugins:/app/plugins:ro" \
  rabbit-flow-designer

# Run with saving (writable workflows + auth token):
docker run --rm -p 127.0.0.1:3001:3001 \
  -e RFD_TOKEN=change-me \
  -v "$(pwd)/.claude/workflows:/app/.claude/workflows" \
  -v "$(pwd)/.claude/skills:/app/.claude/skills:ro" \
  -v "$(pwd)/plugins:/app/plugins:ro" \
  rabbit-flow-designer
```

Or use docker compose:

```bash
docker compose -f frontend/docker-compose.yml up --build
```

Pre-built images are published on each version tag:

```bash
docker pull followthewhit3rabbit/rabbit-flow-designer:latest
# Or a specific version:
docker pull followthewhit3rabbit/rabbit-flow-designer:0.1.0
```

Open http://localhost:3001/flow.html. The container runs as a non-root `node` user; writable mounts need host dirs owned by UID 1000.
