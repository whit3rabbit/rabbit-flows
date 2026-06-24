---
title: CLI Reference
description: rabbit-flows CLI commands and options
---

<!-- generated: cli-help lane, signal: bin/cli.mjs -->

`rabbit-flows` is an installer that bundles Claude Code workflows with the skills and agents they depend on.

## Installation

```bash
npx @whit3rabbit/rabbit-flows
```

## Usage

### Interactive Mode

Run without arguments to open an interactive menu (requires TTY):

```bash
npx @whit3rabbit/rabbit-flows
```

This will prompt you to choose between `install` or `uninstall`, select workflows, and choose a scope.

### Commands

#### Install

Install one or more workflows to your `.claude` directory:

```bash
npx @whit3rabbit/rabbit-flows install --workflow <name>
npx @whit3rabbit/rabbit-flows install --workflow <name1>,<name2>
npx @whit3rabbit/rabbit-flows install --all
```

The install command copies workflow files and all their skill/agent dependencies, records a receipt, and can uninstall only the files it placed.

#### Uninstall

Remove installed workflows:

```bash
npx @whit3rabbit/rabbit-flows uninstall --workflow <name>
npx @whit3rabbit/rabbit-flows uninstall --workflow <name1>,<name2>
npx @whit3rabbit/rabbit-flows uninstall --all
```

Shared skills and agents are kept if other installed workflows still need them.

#### List

Show all available workflows:

```bash
npx @whit3rabbit/rabbit-flows --list
```

Output includes each workflow name, description, and bundled dependencies.

#### Check

Verify the manifest and workflow headers for consistency:

```bash
npx @whit3rabbit/rabbit-flows --check
```

This asserts that all referenced files exist and that each workflow's header comment matches the manifest declaration. Useful for CI.

## Global Flags

### `--scope user|project`

Where to install workflows. Defaults to `user`.

- `user`: `~/.claude` (all your projects)
- `project`: `./.claude` (current repo only)

### `--force`

Overwrite existing files on install. A backup of any displaced user file is kept under `<scope>/.rabbit-flows-backups/<timestamp>/`. Restore with `--force` during uninstall.

## Output

### Install Receipt

Each install writes a receipt file at `<scope>/.rabbit-flows-receipt.json`. This ledger tracks:

- Which workflows were installed
- Which files were copied
- Backups of any displaced user files

Uninstall uses the receipt to remove only the files it placed, leaving user files intact.

## Available Workflows

| Workflow | Description |
|---|---|
| `security-audit` | Defensive code audit: map attack surface, fan out audit lanes, gate findings to drop false positives, report with remediation. |
| `scaffold` | Start a project from scratch and stub+document the whole tree: discuss the brief, research deps, draft blind architecture attempts merged to one, forward-review, fan out cheap workers to build every file under a 400-line ceiling, verify, write back the decisions. |
| `docs-create` | Author a documentation site from a brief: plan pages, fan out authors, verify + assemble config. Targets Starlight, Docusaurus, MkDocs, VitePress, Fumadocs, mdBook, or Docsify via the framework arg. |
| `docs-scrape` | Ingest a documentation website into a local markdown corpus: detect platform, enumerate pages, fetch+extract, gate, assemble. |
| `eatahorse` | Decompose a goal into an Eatahorse Kanban board and gate the plan; optionally work it unattended one bite at a time in a Ralph-style loop, a fresh-context completion-gated worker each iteration, then write back the decisions. |
| `eatahorse-research` | Research every file in a folder using an Eatahorse board as a durable resumable ledger: enumerate, auto-pick scale by file count, seed one card per unit, then loop research rounds of parallel workers gated and synced until dry, and synthesize a cited report. |
| `docs-from-code` | Document a whole codebase into a docs site using an Eatahorse board as a durable resumable ledger: enumerate source, frame IA and plan one card per module page, fan out grounded authors gated and synced until dry, then assemble config and write back. Targets Starlight, Docusaurus, MkDocs, and other supported frameworks via the framework arg. |
| `docs-migrate` | Migrate a documentation site from one framework to another: acquire source corpus, map pages via crosswalk, fan out conversion workers, gate for syntax leaks, assemble target config. |

## Examples

List all workflows:

```bash
npx @whit3rabbit/rabbit-flows --list
```

Install a single workflow to user scope:

```bash
npx @whit3rabbit/rabbit-flows install --workflow scaffold
```

Install multiple workflows:

```bash
npx @whit3rabbit/rabbit-flows install --workflow security-audit,docs-create
```

Install all workflows to project scope:

```bash
npx @whit3rabbit/rabbit-flows install --all --scope project
```

Install with force overwrite:

```bash
npx @whit3rabbit/rabbit-flows install --workflow eatahorse --force
```

Uninstall a workflow:

```bash
npx @whit3rabbit/rabbit-flows uninstall --workflow scaffold
```

Uninstall all installed workflows:

```bash
npx @whit3rabbit/rabbit-flows uninstall --all
```

Check manifest integrity:

```bash
npx @whit3rabbit/rabbit-flows --check
```

## Requirements

- Claude Code v2.1.154+
- Dynamic workflows enabled in `/config` (off by default on Pro)
- Node.js 18+ (for the installer only)
