# Model routing — cheapest that fits

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