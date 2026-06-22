---
name: dynamic-workflow-authoring
description: Author, debug, and save Codex dynamic workflows — the JS files in .Codex/workflows/*.js that the Workflow runtime runs to orchestrate many subagents via agent(), parallel(), and pipeline(). Use this whenever the user writes, edits, saves, or debugs such a script, says "write a workflow" or "ultracode", or describes a task needing many coordinated, rerunnable subagents (a parallel codebase audit, a large migration, multi-source cross-checked research, or multi-angle planning). Also use — even when it looks answerable directly — for anything INSIDE a workflow script: errors like "agent type not found"/agentType, args, schema, pipeline vs parallel, the decompose→workers→gate→synthesize spine (unverified synthesis → add a gate), or gotchas like Date.now() throwing. Do NOT use for CI pipelines (GitHub Actions or YAML "workflows"), other vendors' engines (Vercel Workflow DevKit, Temporal, n8n, LangGraph), writing one subagent definition, or a one-off "spawn a couple subagents and tell me" needing no script.
---

# Authoring dynamic workflows

A dynamic workflow is a JavaScript script the Codex runtime executes in the background,
spawning subagents from `agent()` calls. Intermediate results live in script variables, so the
session's context holds only the final return value. Requires Codex v2.1.154+.

## First: should this even be a workflow?

Default to a conversation + subagents. Escalate to a workflow ONLY when one of these holds:

- The task needs more agents than one conversation can coordinate (codebase-wide audit, 500-file migration).
- You want the orchestration codified to rerun it (a review you run every branch).
- The quality bar needs a repeatable pattern: adversarial cross-check, or multi-angle drafting merged at the end.

If a three-message conversation with two subagents would do, do that instead. A workflow is token-heavy.

## Quick start — the minimal spine

```js
export const meta = {                          // MUST be a pure literal: no vars, calls, spreads
  name: 'my-workflow',
  description: 'One line shown in the approval dialog.',
  phases: [{ title: 'Decompose' }, { title: 'Workers' }, { title: 'Gate' }, { title: 'Synthesize' }],
}

const NOTE = { type:'object', required:['notes'], properties:{ notes:{ type:'array', items:{
  type:'object', required:['type','where','evidence'], additionalProperties:false, properties:{
    type:{ enum:['finding','failure','constraint'] }, where:{ type:'string' }, evidence:{ type:'string' } }}}}}

const question = args?.question ?? 'default question'

phase('Decompose')                             // strong model (omit `model` → inherits session model)
const plan = await agent(`Break "${question}" into 2-4 independent sub-questions. Return JSON.`,
  { label:'decompose', schema:{ type:'object', required:['subs'], properties:{ subs:{ type:'array', items:{ type:'string' }}}}})

phase('Workers')                               // cheap model, parallel, compact notes only
const notes = (await parallel(plan.subs.map((sub,i) => () =>
  agent(`Answer with compact notes (no transcript): ${sub}`, { label:`worker:${i}`, phase:'Workers', model:'haiku', schema:NOTE }))
)).filter(Boolean).flatMap(r => r.notes)

phase('Gate')                                  // fresh-context verifier, strong model, DROPS unsupported notes
const admitted = (await agent(`For each note, keep it ONLY if its evidence supports the claim. Return survivors unchanged.\n\n${JSON.stringify(notes)}`,
  { label:'gate', schema:NOTE }))?.notes ?? []

phase('Synthesize')                            // strong model, from admitted notes only
const answer = await agent(`Answer "${question}" from these notes only; cite each note's "where".\n\n${JSON.stringify(admitted)}`, { label:'synthesize' })

return { question, answer, kept: admitted.length, dropped: notes.length - admitted.length }
```

## The spine (the default shape)

1. **Decompose** — strong model; sets the trajectory, the one place a mistake propagates everywhere.
2. **Parallel workers** — cheapest model that fits; return compact structured notes, never transcripts.
3. **Admission gate** — fresh-context verifier on the strong model; drops unsupported notes BEFORE they flow on. Required whenever a later stage depends on earlier findings.
4. **Synthesize** — strong model; from admitted notes only.

Use `pipeline()` (no barrier) by default for multi-stage per-item work; use `parallel()` (barrier)
only when a stage genuinely needs all prior results at once (dedup, early-exit on zero, cross-item compare).

## Runtime API (the hooks available in a script)

- `agent(prompt, opts?) → Promise<result>` — spawn a subagent. With `schema`, returns the validated object; without, returns its final text. Returns `null` on user-skip or terminal error: **always `.filter(Boolean)`**.
- `parallel(thunks) → Promise<any[]>` — BARRIER; awaits all. A throwing thunk resolves to `null`.
- `pipeline(items, ...stages) → Promise<any[]>` — each item flows through all stages independently, NO barrier. Stage gets `(prev, original, index)`. Default for multi-stage work.
- `phase(title)` / `log(msg)` — progress grouping and narrator lines.
- `args` — the value passed at invocation, verbatim (can be a string, array, or object; `undefined` if omitted).
- `budget` — `{ total, spent(), remaining() }` token target; gate dynamic loops on `budget.total`.
- `workflow(nameOrRef, args?)` — run another workflow inline (one level deep).

`agent` opts: `{ label, phase, schema, model, effort, isolation:'worktree', agentType }`.
See [REFERENCE.md](REFERENCE.md) for full signatures, the `meta` rules, caps, resume, and `args`/save.

## Models — cheap first

Default workers to `haiku`. Escalate per stage, never globally. Reserve the strong model (omit
`model` to inherit the session's) for **decompose, the admission gate, and synthesis** — the stages
where an error propagates. Never under-spend the gate; a weak verifier rubber-stamps. If you escalate
a worker stage, write the reason in a comment.

## Verified gotchas (these bite)

- **No `Date.now()` / `Math.random()` / argless `new Date()`** — they throw (would break resume). Pass timestamps via `args`; vary randomness by index.
- **No filesystem/shell from the script itself** — only agents touch files. Durable knowledge must be written back by a finalize-stage agent, or it evaporates with the run.
- **`meta` must be a pure literal** — no variables, function calls, spreads, or interpolation.
- **`agentType` resolves only session-registered agents** — a file freshly copied to `.Codex/agents/` won't resolve same-session. A worker's full contract belongs INLINE in its prompt; bundled skills/agents are portable copies, not the runtime source.
- **No `skills` option on `agent()`** — you cannot load a skill into a stage at runtime.
- **It's plain JS, not TS** — no type annotations, interfaces, or generics. Top-level `await`/`return` are legal (the runtime wraps the script in an async fn), so `node --check` may warn "illegal return" — that's expected.
- **Caps:** 16 concurrent agents, 1000 total per run, 4096 items per `parallel`/`pipeline` call.

## Study the canonical example

[`references/deep-research.js`](references/deep-research.js) is the bundled `/deep-research` workflow,
extracted verbatim. It is the best teacher for: a real `pipeline()` with in-stage URL dedup, the
3-vote adversarial verifier, defensive null handling everywhere, and a salvage `return` at every
failure point. Read it before writing anything non-trivial. The repo's own
`.Codex/workflows/{starter,security-audit,scaffold}.js` are heavily-commented local examples.

For this repo's design opinions (notes schema, write-back, diversity-vs-coverage knob), see
`.Codex/rules/` and the `workflow-guardrails` skill — don't duplicate them here.

## Lint a workflow before saving it

```
python3 scripts/validate.py .Codex/workflows/        # files or dirs; --strict fails on warnings too
```

Stdlib-only static linter for the checkable rules above: meta-literal violations, the
throws-at-runtime calls, fs/shell from the script, `skills:`/`agentType` misuse, missing
`.filter(Boolean)`, phase/meta drift, and (if `node` is present) JS syntax. It can't check
runtime-only things (item counts vs caps, whether notes are "compact") — those stay judgment.

