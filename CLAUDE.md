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
python3 plugins/workflow-kit/skills/eatahorse/scripts/test_eatahorse.py   # eatahorse CLI self-checks (stdlib, no framework); run after editing eatahorse.py
python3 plugins/workflow-kit/skills/secure-review/scripts/test_recon.py   # security-audit recon self-checks (stdlib, degraded mode); run after editing recon.py. ALSO run under the venv: `bash plugins/workflow-kit/skills/secure-review/scripts/setup_venv.sh && plugins/workflow-kit/skills/secure-review/scripts/.venv/bin/python plugins/workflow-kit/skills/secure-review/scripts/test_recon.py` — several tests are tree-sitter-gated and SKIP in stdlib; the call-graph/import regressions live on the precise backend, so a green stdlib run alone is blind to them.
```

Editing a file in `.claude/rules/` without `build:skill` leaves the shipped skill stale; `check` (also in CI) fails the commit.

The `@generated-start/@generated-end` blocks in `.claude/workflows/docs-{create,from-code}.js` are build artifacts of `node scripts/build-docs-contracts.mjs` — NEVER hand-edit between the markers; edit the source, regenerate (no `--check`), then re-run `npm run check`. Sources: `CONTRACT`/`IA_CONTRACT` and the six per-framework `<FW>_CONTRACT` blocks distill from `docs-site-builder/references/` + `docs-site-builder/frameworks/<fw>/references/`; the `frameworks` block (CROSSWALK + the 13-entry FRAMEWORKS registry + resolveLinksAndAssets) is spliced VERBATIM from `docs-site-builder/frameworks/registry.js` — a splice fragment, NOT standalone JS: it references `CONTRACT`/`<FW>_CONTRACT` and the `agent()`/`log()` workflow globals from the host scope, and the per-framework `<FW>_CONTRACT` consts must stay spliced ABOVE the `frameworks` block. A verbatim splice source must NOT contain a literal `@generated-end docs-contracts/<name>` substring anywhere (even in a comment) — the build's `indexOf` matches it and silently truncates the block. `docs-migrate.js` is deliberately NOT wired into these blocks (migration-specific consts; no FRAMEWORKS registry). `npm run check` = three gates: installer manifest, `build:skill`, and `build:docs-contracts` drift.

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
- **Write-back:** durable knowledge a run produces MUST be written to `CLAUDE.md` /
  `.claude/rules/` in a finalize stage. Script variables evaporate. (`.claude/rules/memory.md`)

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

## docs-factory: dead ends (don't re-litigate)

Multi-framework docs factory work (FRAMEWORKS registry, per-framework adapters, validators,
component crosswalk, quality gate, docs-migrate). Live card status lives in the Eatahorse board
and git history, not here.

- EH-0017 (generated-docs lanes) / EH-0018 (`docs-migrate.js`) acceptance is **empirical**: static
  checks (`npm run check`, `validate.py --strict`) pass but do NOT substitute for a live run. Don't
  mark done until `outDir` artifacts (`MIGRATION.md`, `.source-corpus`, reference pages) exist on disk.
- `docs-migrate.js` exists and lints — gap is runtime verification only. Don't re-implement it.

## docs-from-code run: 2026-06-22

**Codebase documented:** `.` (rabbit-flows repo root)
**Docs site:** `./docs`
**Board:** `.eatahorse-docs`
**Pages:** 11 grounded pages written to `./docs/src/content/docs/`; site recovered to buildable (hand-wrote `astro.config.mjs`, `package.json`, `src/content.config.ts`, `tsconfig.json`; `npm run build` green). The run's `admitted:0`/`configWritten:false` was a bug (two path-convention mismatches in gather-admitted + the quality-gate filter), FIXED 2026-06-23 along with a loud-fail and an opt-in `verify` build gate; ignore the original "0 admitted" write-back.
**Doc-coverage gaps:** 125 public symbols without a doc comment; see `./docs/src/content/docs/reference/documentation-gaps.md`

CONSTRAINTS (do not re-walk these without a human brief):

- **Deferred, needs human brief, "Quickstart: install and run your first workflow":** a 5-minute getting-started tutorial requires a chosen demo workflow, the exact install/enable steps, and the expected on-screen result. Onboarding intent not present in source; a guessed tutorial fails the grounding gate.
- **Deferred, needs human brief, "Tutorial: author your own dynamic workflow":** the pedagogical path (what to build first, the worked example, the sample task) is editorial intent. `dynamic-workflow-authoring` skill and `starter.js` provide raw material, but the teaching sequence must be specified by a human.

## security-audit hardening: 2026-06-23

**Goal:** implement the 12-item hardening plan at `.claude/plans/i-reviewed-your-workflow-skill-witty-wand.md`
**Board:** `.eatahorse-secaudit` (12/12 cards done; board cleared; 25 iterations)
**Files changed:** `.claude/workflows/security-audit.js`, `plugins/workflow-kit/skills/secure-review/scripts/recon.py`, `plugins/workflow-kit/skills/secure-review/scripts/test_recon.py`

**Completed (all 12 cards, P0 -> P1 -> P2):**

- **EH-0001 (P0)** Fixed diff-mode shell bug: `auditDir` derived from `reconOut`, `mkdir -p` added, trailing `.` removed from redirect target in diffStep.
- **EH-0002 (P0)** Split diff-mode index into `reconReachOut` (full-repo, used for callers/reachability) and `reconAuditOut` (changed-files, used for lane sharding/fileCount). Paths mode: both equal `reconOut`.
- **EH-0003 (P0)** Gate INVALID rule softened: incomplete call graph alone is not a rejection ground; rejection requires a specific contradicting code fact. Lean-valid clause appended to gate prompt.
- **EH-0004 (P0)** Fixed `calls_in()` nested-function call attribution: seed stack with own-body children, skip nested `FN_TYPES` scopes. Test added.
- **EH-0005 (P0, was riskiest)** Qualifier-aware `_resolve_call_target`: captures qualifier at extraction for both Python AST and tree-sitter backends; gates resolution by qualifier (only unqualified cross-file, self./this. same-file, or proven-internal qualifiers resolve). Drops qualified-external without bare-name fallback. Test added.
- **EH-0006 (P0)** Import regexes now run against comment-stripped source when tree-sitter backend was not used; when tree-sitter ran, imports are taken from AST import nodes. Eliminates false filegraph edges from commented-out requires.
- **EH-0007 (P1)** `VERDICT_SCHEMA` extended with `crux`, `confidence`, `checks` (array of `{kind, command_or_file, result}`). Gate prompt requires concrete recon facts; report prompt cites crux/checks per finding.
- **EH-0008 (P1)** `walk_files` returns `(included, skipped:[{path,reason}])` with reasons: symlink/unsupported/gitignored/too_large. Counts threaded into `build_index` summary and surfaced via `cmd_index`/`cmd_summary`. Report prompt states skipped files by reason. Test added.
- **EH-0009 (P1)** Config/IaC include-but-don't-parse tier: `CONFIG_EXTENSIONS` (.yml, .yaml, .json, .toml, .ini, .env, .tf, .tfvars, .hcl, .xml, .properties, .conf, .cfg, .sql, .graphql, .proto) + `SPECIAL_FILENAMES` (Dockerfile, docker-compose.*, Makefile, CMakeLists.txt). `parse_file` gives them `backend='config'`, 0 functions; they land in `files[]` and get sharded for secrets/IaC review. Test added.
- **EH-0010 (P1)** `cmd_extract` fallback window: `--context-lines N` (default ~60) prints a line-centered window with `# fallback window, not exact function` marker when no enclosing span is found. Mirrored into `reconBlock` in security-audit.js. Test added.
- **EH-0011 (P2, was riskiest workflow change)** Multi-round deep gate, opt-in: args `gateRounds` (default 1, cap 5) and `deepGateSeverities` (default `['critical','high']`). After first gate, VALID findings at those severities get 2 blind independent reviewers; on disagreement, one Opus arbiter arbitrates using only structured inputs. Cheap-first deviation documented in workflow header comment.
- **EH-0012 (P2)** Per-run artifacts finalize agent (Haiku, `writeArtifacts` default true): writes `{auditDir}/runs/<ts>/` with recon.json-ref, lanes.json, candidates.json, verdicts.json, confirmed.json, coverage.md (skipped-by-reason), report.md.

CONSTRAINTS (verified, do not re-implement):
- `reconBlock` (security-audit.js) is the runtime source for recon command surface; every new flag must be mirrored there.
- Acceptance gate for any future edit: `test_recon.py` green, `validate.py --strict` on `.claude/workflows`, `npm run check`.
- Live smoke (paths mode + diff mode) is empirical only; static gates passing does not substitute for a real run.
- EH-0005 qualifier representation ripples through all call-graph consumers; regression-test `calls_in` before and after any further recon.py edits near `_resolve_call_target`.
