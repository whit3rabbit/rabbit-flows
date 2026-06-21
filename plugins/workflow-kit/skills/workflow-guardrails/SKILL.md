---
name: workflow-guardrails
description: Discipline for authoring Claude Code dynamic workflows. Use when writing or reviewing a .claude/workflows/*.js script, deciding whether a task even needs a workflow, or choosing how many agents and which models to spend. Travels as a skill because a plugin's CLAUDE.md does not load.
---

# Workflow guardrails

Default to LESS: a conversation with subagents beats a workflow; a three-agent workflow
beats a thirty-agent one. Add machinery only when a concrete need forces it, and note the
need in the workflow's header comment.

> Generated from `.claude/rules/` by `scripts/build-skill.mjs`. Edit the rules, not this file.

## Workflow design

### When it's actually a workflow

Conversation + subagents is the default. Escalate to a workflow only when the task
needs more agents than one conversation can coordinate, OR you want the orchestration
codified so you can rerun it. Otherwise, don't.

### The spine

Decompose → parallel workers → admission gate → synthesize. The script holds the loop
and the intermediate state, so the session's context holds only the final answer.
Use a small DAG when stages depend on each other (skeleton before tests, manifest
before CI); pure fan-out only when the stages are genuinely independent.

### Communication: notes, not chatter

- Workers never message each other and never share a mutable store.
- Pass shared context as **read-only constraints** in the prompt.
- Workers return compact notes — `{type: finding|failure|constraint, where, evidence}`.
  Distilled conclusions, not transcripts. Keep raw detail retrievable only if a later
  stage actually needs it.
- **Failures and constraints are first-class.** A later phase MUST read prior constraints
  so it doesn't re-walk a dead end. This is the cheapest, most durable gain available —
  it survives even a strong base model.

### Verification / admission gate (required when stages depend on each other)

- A fresh-context verifier checks each note against its evidence and DROPS the unsupported
  ones before they flow downstream. Mirror `/deep-research`: cross-check, then filter.
- Run it on the strong model, in a context separate from the workers'. A weak or
  same-context verifier rubber-stamps.
- For code, pair LLM review with an empirical check: build / lint / test and report.

### Diversity vs coverage (the one knob)

- **Hard / ambiguous / irreversible decision** → independent attempts, kept BLIND to each
  other, merged only at the end. Coupling early kills the diversity that made running
  multiple attempts worth it.
- **Coverage** (audit, migration, scan) → independent lanes, but share failures and
  constraints early so lanes don't collide on the same dead ends.
- Default to independent-then-merge for anything expensive to reverse.

### Runtime binding (verified; re-check if the platform changes)

Workflow stages cannot AUTO-LOAD skills or named agents via `agent()`. How a worker actually reaches them:

- **Agents.** `agent(prompt, opts)` has no way to inject a definition; the only role knob is `agentType`,
  which resolves ONLY agents already in the session registry (built-ins + plugin agents, namespaced
  `<plugin>:<name>`). A file freshly copied to `.claude/agents/` does not resolve in the same session,
  and the bare-name (npx-copy) vs `<plugin>:`-prefixed (marketplace) split means one hardcoded
  `agentType` can't serve both install paths. Empirically: `agent({agentType:'architect'})` errors
  "agent type not found".
- **Skills.** `agent()` has NO `skills` option either. A worker CAN still invoke a skill through the
  `Skill` tool, but ONLY if that skill is registered in the session (coordinator `skillTools` / a loaded
  plugin) — a skill created or copied this session does NOT resolve until the session reloads (same
  gotcha as `agentType`). So you can neither force-load a skill nor depend on a freshly-authored one
  being callable mid-run. (Source: WORKFLOW_ANALYSIS.md, "Worker Skill Access".)
- So a worker's full contract MUST be inline in its prompt. For fan-out that leans on a skill, distill
  the skill's references into an inline `const` contract and inject it into every worker: one source
  read at author time, zero per-item `Skill`/`Read` calls at run time (the cheap, deterministic path).
  Pass a `refsDir` arg only as a deep-escalation fallback for cases the inline contract doesn't cover.
  Bundled skills/agents (`requires-skills`, manifest) are the portable human + Skill-tool copy, not the
  runtime source — don't keep the contract in two live copies; refresh the `const` when the skill
  changes. Worked example: `.claude/workflows/docs-create.js`.
- SLICE that inline contract per agent; don't inject the whole surface into every prompt. Build it from a
  command/section dict and hand each agent only the keys its own steps call (comment the call site with why).
  A worker that runs NO tool gets ONLY the data fragment it needs (e.g. a card-markdown layout), never the
  command surface — that both saves tokens at fan-out scale AND removes the temptation to run a tool it was
  told not to. Risk: under-slicing = an agent missing a command it needs; keep keys exact to the prompt.
  Worked example: `.claude/workflows/eatahorse{,-research}.js` (the `CMD`/`cli(...)` slicer).
- The runtime API (`agent/phase/parallel/schema/meta`) is otherwise unspecified — verify a new
  signature once by running a 1-agent probe workflow before building three workflows on it.

## Model routing — cheapest that fits

Default to Haiku. Escalate per stage, never globally. If you escalate, note why in the script.

| Stage | Model | Why |
|---|---|---|
| Fan-out reads, grep/extract, run-and-report, classify, dedupe | Haiku | Mechanical, parallel, checkable |
| Implementation, investigation, drafting | Sonnet | Workhorse; best cost/quality balance |
| Decompose / plan | Opus | Sets the trajectory; errors propagate |
| Admission gate / verifier | Opus | A weak verifier rubber-stamps |
| Final synthesis | Opus | Distillation and judgment |

Principles:

- Spend strong-model tokens only where a mistake propagates (decompose, the gate).
  Spend cheap tokens where work is parallel and verifiable.
- Subagents take a `model` in frontmatter; a workflow stage can route to a different
  model than the session. Use it — don't let everything inherit Opus by default.
- For coverage work, more agents on a cheaper model usually beats fewer on an expensive
  one. Prefer breadth at Haiku over depth at Opus unless the stage needs judgment.
- A "verify" stage is the exception to cheap-first: never under-spend the gate, or it
  will pass through the errors the whole spine exists to catch.

## Memory: write it back, keep it lean

### Write-back (required)

Durable knowledge a workflow produces MUST be written to `CLAUDE.md` / `.claude/rules/`
in a finalize stage — by an agent, since the script itself can't touch the filesystem.
Workflow script variables evaporate when the run ends; only the memory files persist.
This is the bridge the platform doesn't give you. Build it every time the run learns
something worth keeping.

### What goes in CLAUDE.md

- Commands (build / run / test) — the single highest-value thing for a future session.
- Hard constraints, and the WHY behind decisions.
- Rejected alternatives and why they were rejected — so they don't get re-litigated.

### What stays out

- Anything discoverable in one session: the file tree, obvious module names, the
  framework version. Don't document what reading the repo already reveals.
- Keep CLAUDE.md under ~200 lines. Push detail into `.claude/rules/`.
- Don't `@`-import everything inline — imports expand into context every session and
  defeat the point of a lean constitution.

### Auto-memory

Let auto-memory (`~/.claude/projects/`) capture what Claude observes on its own across
sessions. Don't pre-write those facts into CLAUDE.md; you'll only duplicate and drift.
