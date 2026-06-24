# bin notes

## 2026-06-23 — docs-from-code run

- **Codebase documented:** `bin` (entry point: `bin/cli.mjs`)
- **Docs site output:** `./docs3`
- **Eatahorse board:** `.eatahorse-docs`
- **Pages admitted:** 0 of 7 planned (run stopped at round cap, rounds=3)
- **Doc-coverage gaps:** 5 public symbols found without a doc comment; see `./docs3/src/content/docs/reference/documentation-gaps.md`

### CONSTRAINTS — do not re-walk on rerun

**Deferred pages (need human brief before a worker can ground them):**

- `Getting started / Quickstart` — a first-success tutorial (prerequisites, choosing a workflow, enabling Dynamic Workflows in /config, running /<workflow>) depends on the reader's environment and the Claude Code product onboarding journey. `bin/cli.mjs` only grounds argument parsing and the post-install "Next:" hint; the surrounding learning narrative would have to be guessed and would fail the grounding gate. Needs a human brief on the intended onboarding flow.

**Sources skipped:** none recorded this run.

**Build result:** skipped — no admitted pages reached synthesis.

## 2026-06-23 — docs-from-code run (docs4)

- **Codebase documented:** `bin` (entry point: `bin/cli.mjs`)
- **Docs site output:** `./docs4`
- **Eatahorse board:** `.eatahorse-docs4`
- **Pages admitted:** 5 of 6 planned
- **Doc-coverage gaps:** 0 public symbols found without a doc comment

### CONSTRAINTS — do not re-walk on rerun

**Deferred pages (need human brief before a worker can ground them):**

- `Getting started / Quickstart` — a first-success tutorial (prerequisites, choosing a workflow, enabling Dynamic Workflows in /config, running /\<workflow\>) depends on the reader's environment and the Claude Code product onboarding journey. `bin/cli.mjs` only grounds argument parsing and the post-install "Next:" hint; the surrounding learning narrative would have to be guessed and would fail the grounding gate. Needs a human brief on the intended onboarding flow. (Same constraint as 2026-06-23 prior run; confirmed not resolved.)

**Sources skipped:** none recorded this run.

**Admitted pages:** `explanation/install-model.md`, `reference/cli-api.md`, `reference/documentation-gaps.md`, `reference/cli.md`, `reference/workflows.md`

**Build result:** skipped — `docs4` has no `package.json`; not a buildable project.
