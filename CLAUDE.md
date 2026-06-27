# Workflow Authoring

This repo authors Claude Code dynamic workflows (`.claude/workflows/*.js`) and the
subagents and skills they use. This file governs **how** workflows are built here.
Optimize for the simplest thing that works, not the most sophisticated.

## Commands

```bash
npm run build:skill   # regenerate guardrails skill from .claude/rules/ (run after editing any rule)
npm run check         # assert no drift: guardrails skill matches rules AND installer manifest matches workflows
python3 .claude/skills/dynamic-workflow-authoring/scripts/validate.py .claude/workflows --strict   # lint workflow scripts (NOT scripts/validate.py); --selftest checks the linter. CI runs this. NOTE: its pure-literal check false-flags "(" in meta.description — keep meta strings paren-free.
npx @whit3rabbit/rabbit-flows --list   # preview the installable workflow catalog
npm test               # installer CLI self-checks (node --test over test/*.test.mjs: cli.test.mjs + bundle.test.mjs); run after editing bin/cli.mjs
node --test test/bundle.test.mjs   # BUNDLE import self-checks (readBundle guards + import->install flow); run after editing bin/bundle.mjs, bin/registry.mjs, or the import path in bin/cli.mjs
node frontend/test-bundle.mjs      # frontend bundle EXPORT self-checks (gatherBundle); run after editing frontend/src/server/bundle.js
python3 plugins/workflow-kit/skills/eatahorse/scripts/test_eatahorse.py   # eatahorse CLI self-checks (stdlib, no framework); run after editing eatahorse.py
python3 plugins/workflow-kit/skills/eatahorse/scripts/test_build_inventory.py   # Kahn topo/layer/cycle pass self-checks; run after editing build_inventory.py
python3 plugins/workflow-kit/skills/eatahorse/scripts/test_diff_test.py   # differential-equivalence harness self-checks; run after editing diff_test.py
python3 plugins/workflow-kit/skills/eatahorse/scripts/test_cmd_drift.py   # guards the four-copy inline CMD maps: every verb a workflow advertises must exist in eatahorse.py; run after editing any eatahorse.js/eatahorse-research.js/eatahorse-port-pipeline.js/docs-from-code.js CMD map or eatahorse.py subcommands
python3 plugins/workflow-kit/skills/secure-review/scripts/test_recon.py   # security-audit recon self-checks (stdlib, degraded mode); run after editing recon.py. ALSO run under the venv: `bash plugins/workflow-kit/skills/secure-review/scripts/setup_venv.sh && plugins/workflow-kit/skills/secure-review/scripts/.venv/bin/python plugins/workflow-kit/skills/secure-review/scripts/test_recon.py` — several tests are tree-sitter-gated and SKIP in stdlib; the call-graph/import regressions live on the precise backend, so a green stdlib run alone is blind to them.
```

Editing a file in `.claude/rules/` without `build:skill` leaves the shipped skill stale; `check` (also in CI) fails the commit.

The `@generated-start/@generated-end` blocks in `.claude/workflows/docs-{create,from-code}.js` are build artifacts of `node scripts/build-docs-contracts.mjs` — NEVER hand-edit between the markers; edit the source, regenerate (no `--check`), then re-run `npm run check`. Sources: `CONTRACT`/`IA_CONTRACT` and the six per-framework `<FW>_CONTRACT` blocks distill from `docs-site-builder/references/` + `docs-site-builder/frameworks/<fw>/references/`; the `frameworks` block (CROSSWALK + the 13-entry FRAMEWORKS registry + resolveLinksAndAssets) is spliced VERBATIM from `docs-site-builder/frameworks/registry.js` — a splice fragment, NOT standalone JS: it references `CONTRACT`/`<FW>_CONTRACT` and the `agent()`/`log()` workflow globals from the host scope, and the per-framework `<FW>_CONTRACT` consts must stay spliced ABOVE the `frameworks` block. A verbatim splice source must NOT contain a literal `@generated-end docs-contracts/<name>` substring anywhere (even in a comment) — the build's `indexOf` matches it and silently truncates the block. `docs-migrate.js` is deliberately NOT wired into these blocks (migration-specific consts; no FRAMEWORKS registry).

A SECOND, independent generator owns the `arg-contract/*` marker blocks: `node scripts/build-arg-contract.mjs` generates the docs-from-code ARG surfaces (the uniform guard block + the header `Knobs` comment in `docs-from-code.js`, and the Workflow args block + Defaults line in `document-codebase/SKILL.md`) from the single source `installer/arg-schemas/docs-from-code.mjs`. Edit the SCHEMA + regenerate (no `--check`); never hand-edit between `@generated-start/@generated-end arg-contract/*`. Bespoke validators (`i18n`/`versioning`/`refine`) and derived consts (`root`/`fwEntry`/`mode`/`updateMode`/`normPagePath`) stay HAND-WRITTEN below the generated guard block (`kind:'custom'`), down to the `// --- end args / guards` sentinel; `--check` lints that every schema arg name set-matches the `args?.X` accesses in that region, so a hand-added guard or a dropped arg fails the build. `npm run check` = FOUR gates: installer manifest, `build:skill`, `build:docs-contracts`, and `build:arg-contract` drift.

When `validate.py` reports a workflow JS syntax error it points at `:1` generically; `node --check` is no help (it stops at the expected top-level-`return` "Illegal return"). The cause is usually unbalanced parens, e.g. `(await parallel(...)).filter()` needs the grouping paren or `.filter` binds to the promise.

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

## Rejected (don't re-litigate)

- scaffold `verify` defaults **false** on purpose: it executes unreviewed generated code. Opt-in only.
- No transactional/staging-FS/lock-file scaffold rewrite: workflow scripts have no FS access (only agents
  write). See `docs/WORKFLOW_ANALYSIS.md`.

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
- **Write-back:** durable knowledge a run produces MUST be persisted in a finalize stage (script
  variables evaporate). Cross-cutting rules → `.claude/rules/`; a SPECIFIC workflow's run log /
  hardening history → `docs/<workflow>-workflow-log.md` (not `CLAUDE.md` — keep the constitution lean).
  (`.claude/rules/memory.md`)

## Reuse & cost

- Parameterize with `args`; never hardcode paths or questions.
- A workflow `.js` runs in the background with NO user IO: it cannot ask the user anything mid-run.
  For interactive intake (a discussion/interview), put the Q&A in a front-door SKILL that runs
  AskUserQuestion then calls `Workflow()` with the answers as `args`. Example: `new-project` skill
  → `scaffold` workflow. The skill name is independent of the workflow `meta.name` (separate registries).
- Save to `.claude/workflows/` (shared) or `~/.claude/workflows/` (personal).
- Specialist roles travel as skills/agents in the plugin (portability + Skill-tool/human use), but
  workflow stages do NOT auto-load them: `agent()` has no `skills` option, and `agentType` resolves
  only session-registered, plugin-namespaced agents. A worker's contract lives INLINE in its prompt;
  the bundled skill is a portable copy, not the runtime source. Detail: `.claude/rules/workflow-design.md`.
- Workflows are token-heavy. Test on a small slice before full scale. Caps: 16 concurrent / 1000 agents per run.

## Repository structure

This repo is both a working project and a distributable marketplace.

```
.
├── CLAUDE.md                       # this file — authoring rules for the repo
├── docs/WORKFLOW_ANALYSIS.md       # how the runtime actually works (VM sandbox, journal, caps, gotchas)
├── .claude/
│   ├── workflows/                  # the workflow scripts (shared by clone)
│   ├── rules/                      # detailed rules (load as project context)
│   └── skills/                     # dynamic-workflow-authoring (how-to + validate.py linter)
├── .claude-plugin/
│   └── marketplace.json            # catalog of the plugin(s) below
├── bin/cli.mjs                     # the npx installer
├── installer/manifest.json         # catalog: each workflow + its skill/agent deps
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
  The workflow's `// requires-skills:` header must set-match manifest `skills[]` exactly (front-door skills included, e.g. `docs-from-code` lists `eatahorse, docs-site-builder, document-codebase`) or `check` fails.
- Reusable specialist role (secure-review, source-eval, verify-findings) → a skill in the plugin, called by a worker phase.
- Subagent role with a fixed model → `plugins/workflow-kit/agents/<role>.md` (`model:` in frontmatter).
- New rule of thumb → `.claude/rules/`. The guardrails skill is generated from these by `npm run build:skill`; edit the rules, not the skill.

## Bending

These are defaults, not laws. Deviate when the task warrants — and write the reason in
the workflow's header comment. An unexplained deviation is a bug, not a choice.

**Before authoring a workflow, read the relevant file in `.claude/rules/`.** For the runtime API
(`agent`/`parallel`/`pipeline`/opts/caps) and the canonical `/deep-research` script saved verbatim,
see the `dynamic-workflow-authoring` skill in `.claude/skills/` — the rules cover *what* good looks like, the skill covers *how* to write the script.

For how the runtime *actually behaves* (VM sandbox limits, the resume journal and worker
hash, concurrency/agent caps, `args` JSON parsing, rejected `isolation:'remote'`, the hidden
45s retry, and other doc-vs-implementation gaps), read **`docs/WORKFLOW_ANALYSIS.md`**. Consult it
when a workflow behaves unexpectedly or you need a runtime detail the rules/skill don't cover.

## Per-workflow logs (load only when relevant)

Run history, hardening rounds, and per-workflow constraints live in `docs/<workflow>-workflow-log.md`,
NOT here — so this constitution stays lean and a session working on one workflow doesn't load another's
history. **Before editing a workflow or its skill/recon engine, read its log.** When a run produces
durable knowledge, append it to that file (one per workflow), and add a pointer row here if new.

| Working on… | Read first |
|---|---|
| `security-audit` / `secure-review` / `recon.py` | `docs/security-audit-workflow-log.md` |
| `docs-from-code` / `docs-create` / `docs-migrate` / docs factory | `docs/docs-from-code-workflow-log.md` |
| `scaffold` / `new-project` | `docs/scaffold-workflow-log.md` |
| `eatahorse` / `eatahorse-research` / `eatahorse.py` / port pipeline | `docs/eatahorse-workflow-log.md` |
| `frontend/` Visual Workflow Designer (server, parser, codegen) | `docs/frontend-designer-workflow-log.md` + `frontend/CLAUDE.md` |
| bundle import/export (`bin/bundle.mjs`, `bin/registry.mjs`, `frontend/src/server/bundle.js`) | `docs/bundle-format.md` |

Workflow OUTPUT can be sensitive: a `security-audit` run writes a vulnerability inventory to
`.security-audit/` — gitignored here, and the workflow ensures gitignore in any target repo. Do not
commit or publish those artifacts.
