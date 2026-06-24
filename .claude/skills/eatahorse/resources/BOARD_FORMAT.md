# Eatahorse board format

Eatahorse keeps one project board in `.eatahorse/`.

## Files

- `.eatahorse/state.json`: canonical JSON ledger.
- `.eatahorse/board.md`: generated Kanban summary.
- `.eatahorse/activity.jsonl`: append-only activity log.
- `.eatahorse/tasks/<status>/<task-id>-<slug>.md`: human-editable task cards.

## Statuses

Use exactly these statuses:

```text
backlog -> ready -> doing -> done
                    └-> blocked
any status -> dropped
```

Recommended meanings:

- `backlog`: Known work, not ready to pull.
- `ready`: Clear enough to start.
- `doing`: Current active work.
- `blocked`: Cannot move without external input or dependency.
- `done`: Verified complete.
- `dropped`: Removed or intentionally abandoned.

## Task markdown

Each task card has a simple frontmatter block plus sections:

```markdown
---
id: "EH-0001"
title: "Implement auth middleware"
status: "ready"
priority: "P1"
owner: ""
tags: []
estimate: ""
source: "manual"
path: "tasks/ready/EH-0001-implement-auth-middleware.md"
created_at: "2026-06-21T00:00:00Z"
updated_at: "2026-06-21T00:00:00Z"
completed_at: null
dropped_at: null
---

# EH-0001: Implement auth middleware

## Description
What outcome this task produces.

## One-bite-at-a-time plan
- [ ] First small action
- [ ] Second small action

## Acceptance checks
- [ ] What proves done

## Notes
Freeform notes.
```

## Sync rules

`sync` reconciles markdown and JSON:

1. Imports task markdown cards missing from `state.json`.
2. Updates title, status, priority, owner, tags, estimate, description, bites, acceptance checks, and notes from markdown.
3. Moves task files into the correct status folder.
4. Rewrites frontmatter paths after moves or title changes.
5. Moves a task to `done` when all bites and acceptance checks are checked.
6. Marks missing task files as `dropped` rather than purging them.
7. Regenerates `board.md`.

If a task file is manually moved between status folders, folder location wins over stale frontmatter. If only frontmatter status changes, frontmatter wins and sync moves the file.
