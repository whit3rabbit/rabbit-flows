# rabbit-flows

Claude Code dynamic workflows, and an `npx` installer that bundles each workflow with the
skills and agents it depends on.

The platform shares workflows by repo clone and skills/agents by plugin marketplace, but
gives you no way to install *a workflow and its dependencies together*. This installer is
that missing path.

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
/deep-research   Latest evidence on intermittent fasting and HbA1c
/scaffold        { "brief": "A CLI todo app in Rust", "dir": "./todo", "write": false }
/security-audit  { "scope": "src", "focus": ["authz", "ssrf"] }
```

`/scaffold` only writes files when `write: true`, and only EXECUTES the generated
install/build/test when `verify: true` (both default true). Use `write: false` for a
dry run, or `write: true, verify: false` to write the scaffold and inspect it before
running anything.

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
