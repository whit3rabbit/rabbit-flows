---
name: eatahorse
description: Maintains lightweight one-bite-at-a-time Kanban boards using .eatahorse JSON state and markdown task cards. Use for planning, tracking, todos, Kanban, and bite-sized work.
dependencies:
  - python>=3.9
hooks:
  TaskCreated:
    - hooks:
        - type: command
          command: "python3"
          args: ["${CLAUDE_PLUGIN_ROOT}/scripts/eatahorse_hook.py"]
          timeout: 10
  TaskCompleted:
    - hooks:
        - type: command
          command: "python3"
          args: ["${CLAUDE_PLUGIN_ROOT}/scripts/eatahorse_hook.py"]
          timeout: 10
  Stop:
    - hooks:
        - type: command
          command: "python3"
          args: ["${CLAUDE_PLUGIN_ROOT}/scripts/eatahorse_hook.py"]
          timeout: 10
---

# Eatahorse

Use this skill when a user wants to break work into small, trackable tasks: “How do you eat a horse? One bite at a time.” Eatahorse creates a lightweight Kanban board backed by markdown task cards and a JSON ledger. It is deliberately smaller than OpenSpec-style workflows: no formal proposals, no spec lifecycle, no approval gates unless the user asks for them.

Artifacts: `.eatahorse/`, `.eatahorse-*`, and `eatahorse-research.md` can be safely git ignored unless the user wants the board or research report tracked.

## Core behavior

1. Create or use a `.eatahorse/` board in the current project.
2. Split large work into outcome-oriented task cards.
3. Put the current work in `doing`; keep other executable work in `ready` or `backlog`.
4. Store every task as a markdown file under `.eatahorse/tasks/<status>/`.
5. Store canonical board state in `.eatahorse/state.json`.
6. Run sync after editing task markdown so checkbox changes, moved cards, additions, and removals update the JSON ledger and generated `board.md`.

## Board layout

```text
.eatahorse/
├── state.json
├── board.md
├── activity.jsonl
└── tasks/
    ├── backlog/
    ├── ready/
    ├── doing/
    ├── blocked/
    ├── done/
    └── dropped/
```

Statuses are: `backlog`, `ready`, `doing`, `blocked`, `done`, `dropped`.

## Use the bundled Python tool

Run these from the project root, adjusting the script path if the skill is installed elsewhere:

```bash
python scripts/eatahorse.py init "Project name" --goal "What success means"
python scripts/eatahorse.py add "Implement auth middleware" \
  --status ready \
  --priority P1 \
  --bite "Map current request flow" \
  --bite "Add middleware skeleton" \
  --bite "Add tests" \
  --accept "Unauthenticated requests fail closed" \
  --accept "Happy path still passes"
python scripts/eatahorse.py list
python scripts/eatahorse.py move EH-0001 doing
python scripts/eatahorse.py bite EH-0001 1 --done
python scripts/eatahorse.py sync
python scripts/eatahorse.py report
```

Useful commands:

```text
init        create a board
add         create a markdown task card and state entry
list        list task cards
show        show one task
next        show the next active bite
move        move a card across statuses
done        mark all bites/checks done and move card to done
reopen      uncheck acceptance, append --gap as a bite, move to doing (atomic)
bite        check/uncheck a bite or acceptance item
add-bite    append another bite or acceptance item
remove      drop or purge a task
sync        reconcile markdown task files with state.json and board.md
report      summarize board counts
```

## Task card conventions

Each card should answer only three questions:

- What outcome is this task trying to produce?
- What are the next one-to-three bites?
- What proves the task is done?

Prefer small executable bites over detailed specifications. Add more bites only when the next action is unclear.

Doneness is derived from **acceptance checks only** (bites are progress). A card with acceptance is `done` iff every acceptance check is met; a card with no acceptance falls back to its bites. This derivation is two-way: a `done` card whose acceptance is no longer fully met (a check unticked, a new acceptance item added) reverts to `doing` on the next sync. So `move <id> done` only sticks when acceptance is met, and reopening a card is one atomic `reopen` call, not a checkbox-then-move sequence.

## Hook behavior in Claude Code

This skill includes a Claude Code hook bridge:

- On `TaskCreated`, the hook creates or links an Eatahorse card.
- On `TaskCompleted`, the hook marks the linked card done, or records a completed external task if no linked card exists.
- On `Stop`/`SessionEnd`, the hook quietly syncs the board if one exists.

The hook intentionally fails open and produces no output on success so task tracking does not block normal work.

There is deliberately **no `PostToolUse` auto-sync**. It used to run `sync` after any edit under
`.eatahorse/`, but that wrote `state.json` on every board edit, which violates the single-writer
invariant the workflows rely on (`eatahorse-research`: "only the single per-round sync agent writes
`state.json`"). The cost was a concurrent-write hazard; the benefit (reflecting *manual* board-markdown
edits into the ledger promptly) was small. Manual edits now reconcile on `Stop`/`SessionEnd` or an
explicit `sync` instead — fine for the unattended workflows, which call `sync` deliberately.

Disabling auto-sync: set `EATAHORSE_NO_AUTOSYNC=1` to skip the remaining `Stop`/`SessionEnd` sync
(`TaskCreated`/`TaskCompleted` still run). Use this if a long unattended run might overlap a session-end
sync.

Path notes: the hook commands in this file's frontmatter use `${CLAUDE_PLUGIN_ROOT}` as the
installed skill root. SKILL-frontmatter hooks are
best-effort; the **supported, reliable wiring is project-level `settings.json`**. To enable
auto-sync without depending on skill-frontmatter hooks, copy `scripts/eatahorse_hook.py` into the
target project's `.claude/hooks/` and merge `resources/claude-code-settings.example.json` into the
project's `.claude/settings.json` (it points at `${CLAUDE_PROJECT_DIR}/.claude/hooks/eatahorse_hook.py`).

## Unattended runs: the `eatahorse` workflow

For a large goal that should be decomposed and (optionally) worked through unattended, launch the
`eatahorse` dynamic workflow instead of driving the CLI by hand. It runs the spine
decompose → seed cards → plan-gate, and — only when `execute: true` — a Ralph-style loop that
takes one bite at a time with a fresh-context worker each iteration, gating completions and
syncing the board, until the board is clear or the budget/iteration cap is hit. "Gating
completions" means each card a worker marks done is re-checked by an independent fresh-context
verifier against real evidence (it runs the proving command or inspects the file), and if the
acceptance is not genuinely met the verifier `reopen`s the card to `doing` with the gap noted, so a
"done" card can bounce back.

Front-door steps (this skill is the conversational entry; the workflow runs in the background with
no user IO, so gather these here first):

1. Confirm the **goal** (one sentence: what success means).
2. Use `AskUserQuestion` to confirm the **execute** toggle — `false` (default) plans and organizes
   the board only; `true` makes **unattended edits** to the project. Default to `false` unless the
   user clearly opted into autonomous execution.
3. Launch: `Workflow({ name: "eatahorse", args: { goal, execute, board } })` (`board` defaults to
   `.eatahorse`; omit args you did not gather — the workflow defaults them).
4. Hand back the workflow's board summary (counts, what's blocked, the written CLAUDE.md note).

The skill name (`eatahorse`) and the workflow `meta.name` (`eatahorse`) live in separate
registries; reusing the name is fine.

To research a whole folder/corpus file by file (not a goal to execute), use the
`eatahorse-research` workflow instead: it enumerates the files, auto-picks scale by count, seeds one
card per file/directory, and loops parallel research rounds against the board until done — the board
makes the run resumable and lets it scale past the per-run agent cap.

## Operating rules for Claude

When using Eatahorse:

- Keep the system lightweight. Do not create requirements documents, proposal folders, or formal specs unless explicitly requested.
- Create cards for meaningful outcomes, not every trivial command.
- Keep at most one or two cards in `doing` unless the user asks for parallel tracking.
- Before saying work is complete, run `sync` and inspect `board.md` or `report`.
- If a task grows, split it into smaller cards rather than making a long checklist.
- If task markdown and `state.json` disagree, run `sync`; do not hand-edit JSON unless repairing corruption.
- For a big goal that should be broken down (and optionally worked) unattended, prefer the `eatahorse` workflow over hand-driving the CLI. See "Unattended runs" above.

See `resources/BOARD_FORMAT.md` and `resources/EXAMPLES.md` for details.
