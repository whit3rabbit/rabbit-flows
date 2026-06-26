# Editing the `eatahorse` skill

This skill is the **portable copy**. Workflow stages do NOT auto-load skills
(`.claude/rules/workflow-design.md`), so the runtime source of the CLI surface is an
inline `CMD`/`cli()` slicer **duplicated in FOUR workflows**:

- `.claude/workflows/eatahorse.js`
- `.claude/workflows/eatahorse-research.js`
- `.claude/workflows/docs-from-code.js`
- `.claude/workflows/eatahorse-port-pipeline.js` (v2; carries the `dep-add`/`dep-rm`/`deps` verbs)

**Add / rename / change a subcommand or flag in `scripts/eatahorse.py` → hand-sync the `CMD`
maps** (especially the shared `reopen` verb). No runtime sharing — VM sandbox. Only the workflows
that USE a verb carry it: the dep verbs + `--depends-on` live in `eatahorse.js` and
`eatahorse-port-pipeline.js`; `eatahorse-research.js`/`docs-from-code.js` don't port, so they omit them.

- Stdlib self-checks, no framework — run after touching the matching script:
  `python3 scripts/test_eatahorse.py` (CLI), `python3 scripts/test_diff_test.py` (differential
  equivalence harness), `python3 scripts/test_build_inventory.py` (Kahn inventory pass),
  `python3 scripts/test_cmd_drift.py` (guards the four-copy `CMD` hand-sync above: every verb a
  workflow advertises must exist in `eatahorse.py`; SKIPs when run outside the repo).
- **Single-writer invariant** the workflows rely on: a round's workers edit ONLY their own card
  markdown and run NO CLI; exactly one sync agent writes `state.json`/`board.md`. The PostToolUse
  autosync was removed as that exact race — only Stop/SessionEnd sync remains, silenced by
  `EATAHORSE_NO_AUTOSYNC=1`. Don't reintroduce a per-tool sync.
- **Board lock vs autosync (v2/EH-PORT-16).** `main()` holds a single `fcntl.flock` (`board_lock`,
  `.eatahorse/.lock`) around CLI dispatch so concurrent CLI PROCESSES can't clobber `state.json`. This
  is NOT the rejected autosync: it serializes the commit, it does not add a sync. The single-writer
  convention above still holds; the lock just makes a deliberate concurrent run (e.g.
  `eatahorse-port-pipeline`) safe. Lock is held at the dispatch boundary only — never nest it (a second
  `flock` on a fresh fd in the same process self-deadlocks). On Windows (`fcntl` absent) it no-ops.
