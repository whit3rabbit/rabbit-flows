# Workflow design

## When it's actually a workflow

Conversation + subagents is the default. Escalate to a workflow only when the task
needs more agents than one conversation can coordinate, OR you want the orchestration
codified so you can rerun it. Otherwise, don't.

## The spine

Decompose → parallel workers → admission gate → synthesize. The script holds the loop
and the intermediate state, so the session's context holds only the final answer.
Use a small DAG when stages depend on each other (skeleton before tests, manifest
before CI); pure fan-out only when the stages are genuinely independent.

## Communication: notes, not chatter

- Workers never message each other and never share a mutable store.
- Pass shared context as **read-only constraints** in the prompt.
- Workers return compact notes — `{type: finding|failure|constraint, where, evidence}`.
  Distilled conclusions, not transcripts. Keep raw detail retrievable only if a later
  stage actually needs it.
- **Failures and constraints are first-class.** A later phase MUST read prior constraints
  so it doesn't re-walk a dead end. This is the cheapest, most durable gain available —
  it survives even a strong base model.

## Verification / admission gate (required when stages depend on each other)

- A fresh-context verifier checks each note against its evidence and DROPS the unsupported
  ones before they flow downstream. Mirror `/deep-research`: cross-check, then filter.
- Run it on the strong model, in a context separate from the workers'. A weak or
  same-context verifier rubber-stamps.
- For code, pair LLM review with an empirical check: build / lint / test and report.

## Diversity vs coverage (the one knob)

- **Hard / ambiguous / irreversible decision** → independent attempts, kept BLIND to each
  other, merged only at the end. Coupling early kills the diversity that made running
  multiple attempts worth it.
- **Coverage** (audit, migration, scan) → independent lanes, but share failures and
  constraints early so lanes don't collide on the same dead ends.
- Default to independent-then-merge for anything expensive to reverse.