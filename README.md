# rabbit-flows

`rabbit-flows` installs Claude Code dynamic workflows with the skills and agents they need.

The installer copies plain files into `.claude`, records a receipt, and can uninstall only the files it placed.

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
```

Flags:

- `--scope user|project`, defaults to `user`.
- `--force`, overwrite on install and back up displaced files.
- `--check`, check manifest files and workflow headers for drift.

Scopes:

- `user`: `~/.claude`
- `project`: `./.claude`

Install writes `<scope>/.rabbit-flows-receipt.json`. `--force` backups go under `<scope>/.rabbit-flows-backups/<timestamp>/`.

## Workflows

Run installed workflows by name in Claude Code. Pass JSON args after the command.

| Workflow | Purpose | Example |
|---|---|---|
| `scaffold` | Create a project from a brief, compare architectures, build file stubs under a line ceiling. | `/scaffold { "brief": "A CLI todo app in Rust", "dir": "./todo", "write": false }` |
| `security-audit` | Map attack surface, run audit lanes, gate findings, report remediation. | `/security-audit { "scope": "src", "focus": ["authz", "ssrf"] }` |
| `docs-create` | Create a docs site from a brief. | `/docs-create { "brief": "Docs for the qz CLI compressor", "outDir": "./docs-site", "framework": "docusaurus" }` |
| `docs-from-code` | Generate source-grounded docs from an existing codebase. | `/docs-from-code { "root": "src", "outDir": "./docs-site", "framework": "mkdocs" }` |
| `docs-scrape` | Convert an external docs site into a local markdown corpus. | `/docs-scrape { "url": "https://example.com/docs", "outDir": "./corpus", "maxPages": 3 }` |
| `docs-migrate` | Migrate docs from one framework to another. | `/docs-migrate { "from": "mkdocs", "to": "starlight", "outDir": "./docs-site" }` |
| `eatahorse` | Create an Eatahorse board and optionally work it one bite at a time. | `/eatahorse { "goal": "Add OAuth login", "execute": true }` |
| `eatahorse-research` | Research files through a durable Eatahorse board and synthesize a cited report. | `/eatahorse-research { "root": "src", "question": "What does each module do?" }` |

`starter.js` is a reference example for the workflow spine. It is not in the installer catalog.

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
| `document` | Routes a docs brief, codebase, or migration to the right docs workflow. |
| `document-codebase` | Intake for `docs-from-code`; can fall back to a conversational board. |

Specialist dependency skills:

| Skill | Purpose |
|---|---|
| `architect` | Produces one architecture proposal from a brief. |
| `secure-review` | Evidence-backed defensive code review. |
| `docs-site-builder` | Docs framework authoring reference. |
| `docs-scraper` | Docs site detection and markdown extraction. |
| `eatahorse` | Lightweight Kanban boards in `.eatahorse` files. |

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
