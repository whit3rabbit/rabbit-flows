# Editing the `secure-review` skill

This skill is the **portable copy** of the defensive audit-lane contract. Its runtime source is the
inline secure-review contract in `.claude/workflows/security-audit.js` — refresh that inline prompt
when this skill changes (workflow stages don't auto-load skills; `.claude/rules/workflow-design.md`).

- Findings are gated before they flow on: a fresh-context verifier drops unsupported notes
  (false positives). Keep the note schema `{type, where, evidence}` so the gate can check each.

## `scripts/recon.py` — deterministic recon

`recon.py` is the recon engine the workflow runs ONCE so agents read a JSON artifact instead of each
re-grepping the tree (cheaper, deterministic, and the gate traces reachability against ground truth).
Stdlib core (`ast` for Python, regex/brace heuristics elsewhere); `setup_venv.sh` adds an OPTIONAL
tree-sitter backend (precise multi-language spans + call edges) into a cached `.venv` — NOT project
deps, and recon.py runs fine without it. Subcommands: `index/extract/callers/const/shard/summary/map` (`map` = compressed internal module graph
— imports + cross-file calls, external libs collapsed, bounded hops from focus files).
Entry-point detection is heuristic (a signal, not gospel). Edit it? Re-run
`python3 scripts/test_recon.py` (stdlib, degraded mode), AND under the venv
(`bash scripts/setup_venv.sh && scripts/.venv/bin/python scripts/test_recon.py`):
several tests are tree-sitter-gated and SKIP without the venv, so the precise-backend
call-graph/import path (where regressions hide) is only exercised there.
