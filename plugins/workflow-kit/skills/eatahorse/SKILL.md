---
name: eatahorse
description: 'Maintains lightweight one-bite-at-a-time Kanban boards using .eatahorse JSON state and markdown task cards. Use for planning, tracking, todos, and bite-sized work, or when the user says "break this into tasks", "plan this work", "track progress", or "/eatahorse <goal>". Two-phase workflow: plan the board (decompose, seed, gate) then, opt-in, work it unattended (Ralph loop + completion gate + write-back). Run /eatahorse --plan for the planner only, /eatahorse --execute to work an existing board, or /eatahorse "goal" to plan first (with an optional execute step).'
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

Use this skill when a user wants to break work into small, trackable tasks: "How do you eat a horse? One bite at a time." Eatahorse creates a lightweight Kanban board backed by markdown task cards and a JSON ledger.

Eatahorse follows a **two-phase workflow**:

1. **Plan** — decompose a goal into outcome-oriented cards, seed them onto a board, and gate the plan for soundness. Writes only the board.
2. **Execute** (optional) — work the board one bite at a time via the Ralph loop (fresh-context worker per iteration, completion gate per done card, write-back). Makes real edits to the project.

## Entry points

| Invocation | Behavior |
|---|---|
| `/eatahorse "goal"` | Plan the goal. Suggests /eatahorse --plan to preview, then asks about --execute. Full auto: plans, then if you opt in, executes. |
| `/eatahorse --plan "goal"` | Plan only: decompose -> seed -> plan-gate. Writes the board, no execution. |
| `/eatahorse --plan --inventory <file> "goal"` | Plan with codebase context: reads a map_codebase.py JSON for richer decomposition. |
| `/eatahorse --execute` | Work an existing board. Runs the Ralph loop with completion gate and write-back. Requires a pre-existing board. |
| `/eatahorse --map-codebase <dir>` | Run map_codebase.py on a directory first, then plan from the resulting inventory. |
| `/eatahorse --help` | Show this usage summary. |

### `/eatahorse "goal"` — default flow

Runs the planner first (decompose -> seed -> plan-gate). After the plan is ready, tells the user how the board looks and asks: *"The board has N active cards. Ready to execute? (Set execute:true to run the Ralph loop, or run /eatahorse --execute later.)"* Defaults to plan-only unless the user explicitly opts into execution.

When the user opts in (execute:true), delegates to the `eatahorse` dynamic workflow with both phases:
`Workflow({ name: "eatahorse", args: { goal, execute: true, ... } })` which runs `eatahorse-plan` then `eatahorse-execute` in sequence.

### `/eatahorse --plan "goal"` — plan only

Decompose -> seed -> plan-gate. Returns the board summary. The board is on disk and ready for /eatahorse --execute.

Gather and validate args:

1. Confirm the **goal** (one sentence: what success means). Reject empty goals.
2. Use `AskUserQuestion` to confirm any optional knobs:

   | arg | default | meaning |
   |---|---|---|
   | `goal` | (required) | what to decompose |
   | `board` | `.eatahorse-<slug>` | board dir; point at an existing one to RESUME |
   | `constraints` | none | board invariants/boundaries that must NOT regress (string or string[]) |
   | `inventory` | none | path to map_codebase.py JSON output (optional grounding) |
   | `scriptPath` | bundled copy | path to eatahorse.py |

   **Elicit `constraints` proactively:** ask what must NOT regress and what is in/out of bounds — e.g. "keep `npm test` green", "only edit files under `src/`". Phrase each as a short imperative. Empty answer -> omit it.

3. Preview the exact args, then launch:
   `Workflow({ name: "eatahorse-plan", args: { goal, board, constraints, inventory } })`
   Omit args you did not gather.

   **Resume:** point `board` at an existing board that still has active cards -> the workflow skips decompose/seed/plan-gate and returns the probe state.

   **Collision guard:** if `board` points at a board that exists but has 0 active cards (complete, or a different goal), the workflow bails loudly. Pass a fresh board or remove the stale one.

4. Hand back the board summary: project name, card count, ready/gate status, active count.

### `/eatahorse --execute` — work an existing board

Execute only. The board must already exist with active cards (from eatahorse-plan or manual seeding).

Gather and validate:

1. Confirm the **board** dir (default: `.eatahorse-board`, but usually `.eatahorse-<slug>` from the plan).
2. Use `AskUserQuestion` to confirm **execute:true** — this makes **unattended edits** to the project. STOP and wait for explicit "yes" before launching.
3. Gather optional knobs:

   | arg | default | meaning | valid range |
   |---|---|---|---|
   | `board` | (required) | board dir to work | path |
   | `maxIterations` | `40` | hard loop cap in bite-iterations | int 1..200 (clamped) |
   | `maxTokens` | none | per-run OUTPUT-token ceiling; independent of platform budget | int, MUST be > `budgetFloor` |
   | `budgetFloor` | `50000` | stop opening new iterations below this many remaining tokens | int >= 0 |
   | `workerModel` | `sonnet` | model for the execute-loop workers | model id |
   | `constraints` | none | board invariants/boundaries that must NOT regress; the completion gate reopens a card that violates one | string or string[] |
   | `scriptPath` | bundled copy | path to eatahorse.py | path |

   **Validate:** if BOTH `maxTokens` and `budgetFloor` are set, require `maxTokens > budgetFloor`. The loop guard is `tokensLeft() > budgetFloor`, so a `maxTokens` at or below `budgetFloor` makes it false on iteration 1 and zero bites run.

4. Preview the exact args. Launch only after explicit confirmation:
   `Workflow({ name: "eatahorse-execute", args: { board, maxIterations, maxTokens, budgetFloor, workerModel, constraints } })`
5. Hand back the workflow's run summary: iterations, completed cards, blocked cards, stop reason.

### `/eatahorse --map-codebase <dir>` — codebase mapping

Runs the `map_codebase.py` help script on a directory, then runs the planner with the resulting inventory. Useful when you want the planner to understand the codebase structure before decomposing a goal.

1. Confirm the **root** directory to map.
2. Optionally gather `--include`/`--exclude` globs and `--max-files`.
3. Locate `map_codebase.py` IN PLACE next to `eatahorse.py` (same bundled-location caveat as above — never
   copy it into the target project) and run: `python3 <script_dir>/map_codebase.py --root <dir> --out <inventory.json> [--include <glob>] [--exclude <glob>] [--max-files 500]`
4. Use the inventory: `Workflow({ name: "eatahorse-plan", args: { goal, inventory: "<inventory.json>", constraints } })`

Help script output: `{files: [{path, ext, size, imports, exports}], stats: {total, byExt}}`. The planner reads this for file structure, dependencies, and exported interfaces. The plan is NOT limited to one card per file — the script provides context, not a template.

### Direct workflow launch

Advanced users can call the workflows directly (omit the skill's Q&A):

```javascript
// Plan only
Workflow({ name: "eatahorse-plan", args: { goal: "Add auth", board: ".eatahorse-auth" } })

// Execute only (board must exist)
Workflow({ name: "eatahorse-execute", args: { board: ".eatahorse-auth", maxIterations: 60 } })

// Plan then execute in one shot
Workflow({ name: "eatahorse", args: { goal: "Add auth", execute: true, board: ".eatahorse-auth" } })
```

Artifacts: `.eatahorse/`, `.eatahorse-*` boards can be safely git ignored unless the user wants the board tracked.

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

Statuses: `backlog`, `ready`, `doing`, `blocked`, `done`, `dropped`.

## Use the bundled Python tool

`scripts/eatahorse.py` is bundled tooling, not something to copy into a project. Its location depends
on how this skill was installed — the dev repo has it at `plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py`,
an npx project-scope install at `.claude/skills/eatahorse/scripts/eatahorse.py`, a user-scope install at
`~/.claude/skills/eatahorse/scripts/eatahorse.py`. Locate the one that exists and run it IN PLACE from
there (never copy, move, or recreate it in the target project); the commands below use `scripts/eatahorse.py`
as shorthand for whichever path resolved.

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

**Global option ordering:** `--board PATH` is the one global flag and must come **before** the subcommand:

```bash
python scripts/eatahorse.py --board .eatahorse-secaudit init "Secaudit round 3" --goal "..."
```

`--board` after the subcommand goes to argparse, not the global parser.

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
dep-add     add a dependency edge (rejects cycles)
dep-rm      remove a dependency edge
deps        show a task's dependencies
```

## Task card conventions

Each card should answer only three questions:

- What outcome is this task trying to produce?
- What are the next one-to-three bites?
- What proves the task is done?

Prefer small executable bites over detailed specifications. Add more bites only when the next action is unclear.

Doneness is derived from **acceptance checks only** (bites are progress). A card with acceptance is `done` iff every acceptance check is met; a card with no acceptance falls back to its bites. This derivation is two-way: a `done` card whose acceptance is no longer fully met reverts to `doing` on the next sync. So `move <id> done` only sticks when acceptance is met, and reopening a card is one atomic `reopen` call, not a checkbox-then-move sequence.

## Hook behavior in Claude Code

This skill includes a Claude Code hook bridge:

- On `TaskCreated`, the hook creates or links an Eatahorse card.
- On `TaskCompleted`, the hook marks the linked card done, or records a completed external task if no linked card exists.
- On `Stop`/`SessionEnd`, the hook quietly syncs the board if one exists.

The hook intentionally fails open and produces no output on success so task tracking does not block normal work.

There is deliberately **no `PostToolUse` auto-sync**. Manual edits reconcile on `Stop`/`SessionEnd` or an explicit `sync` instead. Disabling auto-sync: set `EATAHORSE_NO_AUTOSYNC=1` to skip the remaining `Stop`/`SessionEnd` sync (`TaskCreated`/`TaskCompleted` still run).

Path notes: the hook commands in this file's frontmatter use `${CLAUDE_PLUGIN_ROOT}` as the installed skill root. SKILL-frontmatter hooks are best-effort; the **supported, reliable wiring is project-level `settings.json`**. To enable auto-sync without depending on skill-frontmatter hooks, copy `scripts/eatahorse_hook.py` into the target project's `.claude/hooks/` and merge `resources/claude-code-settings.example.json` into the project's `.claude/settings.json`.

## Codebase mapping help script

`scripts/map_codebase.py` walks a directory and outputs a structured JSON inventory for the planner to use as grounding context:

```bash
python3 scripts/map_codebase.py --root src/ --out inventory.json
python3 scripts/map_codebase.py --root . --max-files 100 --include "**/*.py"
```

Output shape:

```json
{
  "files": [
    {"path": "src/main.py", "ext": ".py", "size": 1024,
     "imports": ["os", "pathlib"], "exports": ["run", "Handler"]}
  ],
  "stats": {"total": 42, "byExt": {".py": 20, ".js": 15, ".rs": 7}}
}
```

Invoke via `/eatahorse --map-codebase <dir>` or use the path as `--inventory <path>` with the planner.

## Operating rules for Claude

When using Eatahorse:

- Keep the system lightweight. Do not create requirements documents, proposal folders, or formal specs unless explicitly requested.
- Create cards for meaningful outcomes, not every trivial command.
- Keep at most one or two cards in `doing` unless the user asks for parallel tracking.
- Before saying work is complete, run `sync` and inspect `board.md` or `report`.
- If a task grows, split it into smaller cards rather than making a long checklist.
- If task markdown and `state.json` disagree, run `sync`; do not hand-edit JSON unless repairing corruption.
- For a big goal that should be broken down (and optionally worked) unattended, prefer the dynamic workflows over hand-driving the CLI. See "Entry points" above.
- By default, `/eatahorse` runs plan-only. To execute, use `/eatahorse --execute` or the `execute:true` flag.

See `resources/BOARD_FORMAT.md` and `resources/EXAMPLES.md` for details.
