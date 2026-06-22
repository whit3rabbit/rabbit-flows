# Memory: write it back, keep it lean

## Write-back (required)

Durable knowledge a workflow produces MUST be written to `CLAUDE.md` / `.claude/rules/`
in a finalize stage — by an agent, since the script itself can't touch the filesystem.
Workflow script variables evaporate when the run ends; only the memory files persist.
This is the bridge the platform doesn't give you. Build it every time the run learns
something worth keeping.

Artifacts: workflow run outputs (`.eatahorse*`, `docs-site/`, `scaffold-out/`, `.security-audit/`, `.docs-plan.md`, `.claude/projects/`) can be safely git ignored unless the user wants them tracked.

## What goes in CLAUDE.md

- Commands (build / run / test) — the single highest-value thing for a future session.
- Hard constraints, and the WHY behind decisions.
- Rejected alternatives and why they were rejected — so they don't get re-litigated.

## What stays out

- Anything discoverable in one session: the file tree, obvious module names, the
  framework version. Don't document what reading the repo already reveals.
- Keep CLAUDE.md under ~200 lines. Push detail into `.claude/rules/`.
- Don't `@`-import everything inline — imports expand into context every session and
  defeat the point of a lean constitution.

## Auto-memory

Let auto-memory (`~/.claude/projects/`) capture what Claude observes on its own across
sessions. Don't pre-write those facts into CLAUDE.md; you'll only duplicate and drift.
