# Editing the `eatahorse` skill

This skill is the **portable copy**. Workflow stages do NOT auto-load skills
(`.claude/rules/workflow-design.md`), so the runtime source of the CLI surface is an
inline `CMD`/`cli()` slicer **duplicated in THREE workflows**:

- `.claude/workflows/eatahorse-plan.js` (the planner)
- `.claude/workflows/eatahorse-execute.js` (the executor)
- `.claude/workflows/docs-from-code.js` (doc generation; uses the same board substrate)

**Add / rename / change a subcommand or flag in `scripts/eatahorse.py` → hand-sync the `CMD`
maps** (especially the shared `reopen` verb). No runtime sharing — VM sandbox. Only the workflows
that USE a verb carry it: `eatahorse-execute.js` has the execute verbs (bite, move, next, reopen);
`eatahorse-plan.js` has only planning verbs (init, add, list, show, remove, addbite).
`docs-from-code.js` has its own surface (omit dep verbs, has done). `eatahorse.js` (the thin
orchestrator) has no CMD map — it delegates to the sub-workflows.

- Stdlib self-checks, no framework — run after touching a matching script:
  `python3 scripts/test_eatahorse.py` (CLI),
  `python3 scripts/test_map_codebase.py` (codebase mapping help script),
  `python3 scripts/test_cmd_drift.py` (guards the three-copy `CMD` hand-sync above: every verb a
  workflow advertises must exist in `eatahorse.py`; SKIPs when run outside the repo).
- **Single-writer invariant** the workflows rely on: in the execute loop, the per-iteration worker
  edits ONLY its own card markdown and runs NO CLI; the workflow's sync step is the sole
  `state.json`/`board.md` writer per iteration. The PostToolUse autosync was removed as that exact
  race — only Stop/SessionEnd sync remains, silenced by `EATAHORSE_NO_AUTOSYNC=1`. Don't reintroduce
  a per-tool sync.
- **Board lock.** `main()` holds a single `fcntl.flock` (`board_lock`, `.eatahorse/.lock`) around CLI
  dispatch so concurrent CLI PROCESSES can't clobber `state.json`. This serializes the commit, it does
  not add a sync. The single-writer convention above still holds. Lock is held at the dispatch boundary
  only — never nest it (a second `flock` on a fresh fd in the same process self-deadlocks). On Windows
  (`fcntl` absent) it no-ops.

## Architecture

```
/eatahorse (skill entry point, SKILL.md)
  │
  ├──--plan  → eatahorse-plan.js  (decompose → seed → plan-gate)
  ├──--execute → eatahorse-execute.js (probe → execute loop → verify → write-back)
  └──(default) → eatahorse.js (thin orchestrator calls plan then execute if flagged)
```

The `--map-codebase` flag runs `scripts/map_codebase.py` (stdlib Python, no deps) before the plan
workflow, producing a structured JSON inventory for grounding context.

## Removed (pre-simplification)

Removed in the 2026-06-30 simplification pass:
- `.claude/workflows/eatahorse-research.js` — per-file research workflow (replaced by map_codebase.py + planner)
- `.claude/workflows/eatahorse-port-pipeline.js` — concurrent comprehend + port scheduler (too complex)
- `plugins/workflow-kit/skills/eatahorse-port/` — front-door skill for the pipeline
- `scripts/build_inventory.py` + `test_build_inventory.py` — Kahn topo pass (port-only)
- `scripts/diff_test.py` + `test_diff_test.py` — differential equivalence harness (port-only)
- Port mode code from `eatahorse.js` (grounded execute, DAG edges, verify-equivalence phase)

See `docs/eatahorse-workflow-log.md` for the full history.
