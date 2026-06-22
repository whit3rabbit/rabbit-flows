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
```

Editing a file in `.claude/rules/` without `build:skill` leaves the shipped skill stale; `check` (also in CI) fails the commit.

The `CONTRACT`/`IA_CONTRACT` consts in `.claude/workflows/docs-{create,from-code}.js` are `@generated-start/@generated-end` build artifacts from `docs-site-builder/references/` — edit freely OUTSIDE the markers, but a change INSIDE them needs `node scripts/build-docs-contracts.mjs` (no `--check`) to regenerate, then re-run `npm run check`. `npm run check` = three gates: installer manifest, `build:skill`, and `build:docs-contracts` drift.

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

## Eatahorse run: docs-factory (2026-06-21, 40 iterations)

**Goal:** Turn docs-site-builder from Starlight-only into a multi-framework docs factory: FRAMEWORKS
registry, per-framework adapters, validators, component crosswalk, quality gate, contract-generation
automation, generated-docs lanes, docs-migrate workflow, i18n/versioning/basePath args, and upgraded
document-codebase intake.

**Completed (EH-0001 to EH-0008):**
- FRAMEWORKS registry defined; Starlight seeded as reference entry.
- `isStarlight` branch replaced in `docs-create.js` and `docs-from-code.js` with registry dispatch.
- First-wave adapters: Docusaurus, MkDocs+Material/Zensical, VitePress, Fumadocs, mdBook, Docsify.
- Second-wave adapters: Sphinx, Nextra, Mintlify, Docsy, Scalar, Redocly.
- Framework-native validators with build-error-fed repair loops.
- Framework-neutral component crosswalk (non-Starlight pages no longer leak Starlight syntax).
- Docs quality gate (Diataxis, link/asset resolution, no Starlight-only syntax, source-backed reference pages) running before build.
- Contract-generation automation (`npm run build:docs-contracts`) wired into `npm run check`; drift between skill references and inline workflow contracts now fails CI.

**Remaining:**
- EH-0019 (doing): links-and-assets handling plus i18n, versioning, basePath args across docs workflows. Two of three acceptance criteria unmet: basePath config injection and broken-link resolution in the quality gate need a real run to verify.
- EH-0017 (blocked): Generated-docs lanes in docs-from-code (OpenAPI, TypeDoc, Sphinx/mkdocstrings/pdoc, rustdoc, go doc, CLI --help). Detection and worker bites done; acceptance item 2 unverified: no run artifacts on disk, so the OpenAPI/TypeDoc reference-page output has never been observed.
- EH-0018 (blocked): docs-migrate workflow. Static checks (npm run check, validate.py --strict) pass. Acceptance item 3 is the blocker: the from=mkdocs to=starlight run has never executed. The assemble stage writes `outDir/MIGRATION.md` and acquisition writes `outDir/.source-corpus` on every run; neither exists anywhere in the repo, which is the proof the run never ran. Admonition conversion (`!!! note` to `:::note`) cannot be confirmed without run output.
- EH-0020 (backlog): Upgrade document-codebase intake to named framework choices (starlight, docusaurus, mkdocs, vitepress, ...) and add scaffoldMode question. Pure SKILL.md edit, no workflow change, no manifest impact.

**Constraints for next run (skip these dead ends):**
- EH-0017/EH-0018 acceptance gaps are empirical: static analysis cannot substitute. Both need a live workflow run that produces output files on disk. Do not mark done until outDir artifacts exist.
- EH-0018 `docs-migrate.js` exists and passes lint; the gap is runtime verification only. Do not re-implement the workflow from scratch.
- The run stopped at iteration cap (40), not a logic failure. Resume by running the board unattended again from the current state; EH-0019 and the two blocked cards are the only open work.
