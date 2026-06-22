# Editing the `eatahorse` skill

This skill is the **portable copy**. Workflow stages do NOT auto-load skills
(`.claude/rules/workflow-design.md`), so the runtime source of the CLI surface is an
inline `CMD`/`cli()` slicer **duplicated in three workflows**:

- `.claude/workflows/eatahorse.js`
- `.claude/workflows/eatahorse-research.js`
- `.claude/workflows/docs-from-code.js`

**Add / rename / change a subcommand or flag in `scripts/eatahorse.py` → hand-sync all three
`CMD` maps** (especially the shared `reopen` verb). No runtime sharing — VM sandbox.

- After editing `scripts/eatahorse.py`, run `python3 scripts/test_eatahorse.py` (stdlib, no framework).
- **Single-writer invariant** the workflows rely on: a round's workers edit ONLY their own card
  markdown and run NO CLI; exactly one sync agent writes `state.json`/`board.md`. The PostToolUse
  autosync was removed as that exact race — only Stop/SessionEnd sync remains, silenced by
  `EATAHORSE_NO_AUTOSYNC=1`. Don't reintroduce a per-tool sync.
