# Workflow Authoring

This repo authors Claude Code dynamic workflows (`.claude/workflows/*.js`) and the
subagents and skills they use. This file governs **how** workflows are built here.
Optimize for the simplest thing that works, not the most sophisticated.

## Prime directive

Default to LESS. A conversation with subagents beats a workflow; a three-agent
workflow beats a thirty-agent one. Add machinery only when a concrete task need
forces it, and write the need down. Sophistication that isn't pulling its weight
is a bug, not a feature.

## Don't

- Don't build a workflow when a conversation + subagents will do. Workflows are for
  tasks one conversation can't coordinate, or orchestration worth rerunning.
  `/deep-research` is the reference example.
- Don't add agents you can't justify per token. Every stage earns its cost or it's cut.
- Don't chase papers, frameworks, or whatever is "latest." The platform already
  implements the patterns that are validated. Prefer native features over custom machinery.
- Don't build for accuracy gains that won't appear. On a strong model the coordination
  lift is small; the real wins are repeatability, clean context, and the verification gate.
- Don't have agents message each other or share a mutable memory pool. See `.claude/rules/workflow-design.md`.

## The spine (every workflow, unless you note an exception)

1. **Decompose** — sets the trajectory; the one place a mistake propagates everywhere. Strong model.
2. **Parallel workers** — return compact structured notes, never raw transcripts. Cheapest model that fits.
3. **Admission gate** — a fresh-context verifier drops unsupported notes before they flow on. Strong model.
4. **Synthesize** — from admitted notes only. Strong model.

## Models: cheap first

Default to Haiku. Escalate per stage, never globally. Reserve the strong model for
decompose, the admission gate, and synthesis — the stages where errors propagate.
If you escalate a stage, note why. See `.claude/rules/model-routing.md`.

## Required conventions (the platform won't enforce these — we do)

- **Verification gate:** any workflow whose later stages depend on earlier findings MUST
  include one. (`.claude/rules/workflow-design.md`)
- **Note schema:** workers emit `{type: finding|failure|constraint, where, evidence}`.
  Failures and constraints are first-class; later phases MUST read prior constraints. (`.claude/rules/workflow-design.md`)
- **Write-back:** durable knowledge a run produces MUST be written to `CLAUDE.md` /
  `.claude/rules/` in a finalize stage. Script variables evaporate. (`.claude/rules/memory.md`)

## Reuse & cost

- Parameterize with `args`; never hardcode paths or questions.
- Save to `.claude/workflows/` (shared) or `~/.claude/workflows/` (personal).
- Encode repeated specialist roles as skills in `plugins/workflow-kit/skills/`, not re-prompted
  each run (they travel via the plugin; a workflow's own one-off skill can live in `.claude/skills/`).
- Workflows are token-heavy. Test on a small slice before full scale. Caps: 16 concurrent / 1000 agents per run.

## Repository structure

This repo is both a working project and a distributable marketplace.

```
.
├── CLAUDE.md                       # this file — authoring rules for the repo
├── .claude/
│   ├── workflows/                  # the workflow scripts (shared by clone)
│   └── rules/                      # detailed rules (load as project context)
├── .claude-plugin/
│   └── marketplace.json            # catalog of the plugin(s) below
├── scripts/build-skill.mjs         # generates the guardrails skill from the rules
└── plugins/
    └── workflow-kit/               # the installable, cross-project plugin
        ├── .claude-plugin/plugin.json
        ├── skills/                 # specialist roles + generated guardrails skill
        └── agents/                 # subagent roles (model set in frontmatter)
```

Two homes, two ways to share:

- **Workflows + CLAUDE.md + rules → shared by repo clone.** Workflows are not a plugin
  component; they live in `.claude/workflows/` and reach anyone who clones. CLAUDE.md and
  rules load as project context here.
- **Skills + agents → shared by plugin/marketplace.** These install into *other* projects
  without cloning. A plugin's CLAUDE.md does NOT load, so the guardrails travel as a skill
  (`skills/workflow-guardrails/`), generated from the rules — never hand-edited.

Where new things go:

- New workflow → `.claude/workflows/<name>.js` (save via `/workflows` → `s`); parameterize with `args`.
  Then register it in `installer/manifest.json` (file + `skills`/`agents` deps) so `npx` can bundle it; `npm run check` asserts no drift.
- Reusable specialist role (secure-review, source-eval, verify-findings) → a skill in the plugin, called by a worker phase.
- Subagent role with a fixed model → `plugins/workflow-kit/agents/<role>.md` (`model:` in frontmatter).
- New rule of thumb → `.claude/rules/`. The guardrails skill is generated from these by `npm run build:skill`; edit the rules, not the skill.

## Bending

These are defaults, not laws. Deviate when the task warrants — and write the reason in
the workflow's header comment. An unexplained deviation is a bug, not a choice.

**Before authoring a workflow, read the relevant file in `.claude/rules/`.**
