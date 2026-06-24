---
title: Install and manage workflows
description: How to install, list, and uninstall rabbit-flows workflows with the npx CLI.
sidebar:
  label: Install and manage workflows
  order: 1
---

Get one or more workflows into `.claude` so Claude Code can run them.

## Prerequisites

- Claude Code v2.1.154 or later.
- Dynamic workflows enabled in `/config`. On Claude Pro this is off by default; toggle it before running a workflow.
- Node.js 18 or later (for the `npx` installer).

## Install workflows

### Interactive menu

Run without arguments to open the interactive install menu:

```bash
npx @whit3rabbit/rabbit-flows
```

The menu asks:

1. **Install or Uninstall** — choose Install.
2. **Pick workflows** — multi-select; each workflow lists its name and a one-line description.
3. **Scope** — `user` (applies to all your projects) or `project` (this repo only). See [Choose a scope](#choose-a-scope).

The installer copies the workflow script and all skills and agents it depends on into the selected `.claude` directory, then writes a receipt file.

### Non-interactive: one workflow

```bash
npx @whit3rabbit/rabbit-flows install --workflow scaffold
```

Install multiple workflows in one call by passing a comma-separated list:

```bash
npx @whit3rabbit/rabbit-flows install --workflow scaffold,security-audit
```

### Non-interactive: everything in the catalog

```bash
npx @whit3rabbit/rabbit-flows install --all
```

### Overwrite existing files

By default the installer skips a destination file that already exists. Pass `--force` to overwrite:

```bash
npx @whit3rabbit/rabbit-flows install --workflow scaffold --force
```

When `--force` displaces a file that was not placed by rabbit-flows, that file is backed up before being overwritten. Backups land in `<scope>/.rabbit-flows-backups/<timestamp>/` and are restored automatically if you later uninstall that workflow. (Source: `bin/cli.mjs`, `place` function and `BACKUP_ROOT` constant.)

## Choose a scope

The `--scope` flag controls where files go. Default is `user`.

| Scope | Target directory | When to use |
|---|---|---|
| `user` | `~/.claude` | Workflows available across all your projects |
| `project` | `./.claude` | Workflows scoped to the current repo only |

```bash
npx @whit3rabbit/rabbit-flows install --workflow eatahorse --scope project
```

Scope can be combined with any install or uninstall command.

## List available workflows

Print the catalog without installing anything:

```bash
npx @whit3rabbit/rabbit-flows --list
```

Output shows each workflow name, description, and the skills and agents it bundles. (Source: `bin/cli.mjs`, `list` function.)

## Uninstall workflows

### Interactive menu

```bash
npx @whit3rabbit/rabbit-flows
```

Choose **Uninstall** from the first prompt, then pick which workflows to remove.

### Non-interactive: one or more workflows

```bash
npx @whit3rabbit/rabbit-flows uninstall --workflow scaffold
npx @whit3rabbit/rabbit-flows uninstall --workflow scaffold,security-audit
```

### Non-interactive: everything

```bash
npx @whit3rabbit/rabbit-flows uninstall --all
```

The uninstaller reads the receipt and removes only the files it placed. Shared skills or agents are kept if any remaining installed workflow still needs them. Any backed-up file is restored to its original path. When the receipt is empty after removal it is deleted along with the backup directory. (Source: `bin/cli.mjs`, `uninstall` function.)

## Check for drift

`--check` verifies that every file referenced in `installer/manifest.json` exists on disk and that each workflow's `// requires-skills:` / `// requires-agents:` header comments match the manifest. Exit code is non-zero on any mismatch; useful in CI.

```bash
npx @whit3rabbit/rabbit-flows --check
```

## The receipt file

Every install writes `<scopeRoot>/.rabbit-flows-receipt.json`. It records:

- Which workflows rabbit-flows installed.
- Every file it placed, with its type (`workflow`, `skill`, or `agent`) and name.
- The backup path for any file that was displaced with `--force`.

Uninstall reads the receipt to know exactly which files to remove; it never removes a file it did not place. If you want to see what is currently installed, inspect the receipt or re-run `--list`.

```bash
cat ~/.claude/.rabbit-flows-receipt.json
# or for project scope:
cat .claude/.rabbit-flows-receipt.json
```

## Verify the install

After installing, confirm the workflow files are in place:

```bash
npx @whit3rabbit/rabbit-flows --list
# or inspect the receipt directly
cat ~/.claude/.rabbit-flows-receipt.json
```

Then enable dynamic workflows in Claude Code (`/config`) if you have not already, and run a workflow by name, for example `/scaffold`.

## Next steps

See the [CLI reference](/reference/cli/) for a full flag listing and exit codes.
