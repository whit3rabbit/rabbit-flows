---
name: eatahorse
description: Maintains lightweight one-bite-at-a-time Kanban boards using .eatahorse JSON state and markdown task cards. Use for planning, tracking, todos, and bite-sized work, or when the user says "break this into tasks", "plan this work", "track progress", or "/eatahorse <goal>". Front door for the eatahorse dynamic workflows. (1) Decompose a goal into a board and, opt-in, work it unattended (the eatahorse workflow). (2) Research a folder file by file into a cited report, say "research this folder", "understand this codebase file by file", or "what does each module do" (the eatahorse-research workflow). (3) Convert/port/migrate a codebase to another language or framework ("port this to Rust", "migrate X to Y") by chaining comprehend (extract:'port' -> inventory.json) into grounded execute. Gathers and validates the workflow args before launching.
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

**Global option ordering:** `--board PATH` is the one global flag and must come **before** the
subcommand, not after its arguments. Use it to target a non-default board (run several at once):

```bash
python scripts/eatahorse.py --board .eatahorse-secaudit init "Secaudit round 3" --goal "..."
```

`python scripts/eatahorse.py init ... --board PATH` fails with
`unrecognized arguments: --board` — argparse routes a trailing `--board` to the subcommand.
Default board is `.eatahorse/`; point `--board` at any other dir (e.g. `.eatahorse-<slug>`).

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

Front-door steps (this skill is the conversational entry AND validator; the workflow runs in the
background with no user IO, so gather and validate these here first):

1. Confirm the **goal** (one sentence: what success means). Reject an empty goal — the workflow has
   nothing to decompose without one.
2. Use `AskUserQuestion` to confirm the **execute** toggle — `false` (default) plans and organizes
   the board only; `true` makes **unattended edits** to the project. Default to `false` unless the
   user clearly opted into autonomous execution.
3. Gather any optional knobs the user raises (omit the rest — the workflow defaults them):

   | arg | default | meaning | valid range |
   |---|---|---|---|
   | `goal` | (required) | what to decompose; also accepts a bare string (`/eatahorse <goal>`) | non-empty |
   | `execute` | `false` | `true` runs the unattended Ralph loop (real edits); `false` plans + gates only | bool |
   | `board` | `.eatahorse-<slug of goal>` | board dir; point at an existing one to RESUME | path |
   | `maxIterations` | `40` | hard loop cap in bite-iterations (backstop, independent of tokens) | int 1..200 (clamped) |
   | `maxTokens` | none | per-run OUTPUT-token ceiling; stops the loop once spent crosses it. Independent of the platform "+500k" turn directive, which args cannot set | int, MUST be > `budgetFloor` |
   | `budgetFloor` | `50000` | stop opening new iterations below this many remaining tokens | int >= 0 |
   | `workerModel` | `sonnet` | model for the execute-loop workers | model id |
   | `constraints` | none | board invariants/boundaries that must NOT regress; the completion gate reopens a card that violates one | string or string[] |
   | `scriptPath` | bundled copy | path to `eatahorse.py` | path |

   **Elicit `constraints` proactively (cheap, high value on an `execute:true` run):** ask what must NOT
   regress and what is in/out of bounds — e.g. "keep `npm test` green", "only edit files under `src/`".
   Phrase each as a short imperative; name a runnable command where one exists so the gate can run it. Pass
   them as `args.constraints`. Empty answer → omit it (identical to today). Also nudge the user toward
   acceptance that names a concrete evidence surface (a command, a path, an observable), since the
   plan-gate now rejects acceptance that does not.

   **Validate before launching (real footguns):**
   - `maxIterations` / `budgetFloor` must be non-negative ints; `maxIterations` over 200 is silently clamped.
   - If BOTH `maxTokens` and `budgetFloor` are set, require `maxTokens > budgetFloor`. The loop guard is
     `tokensLeft() > budgetFloor`, so a `maxTokens` at or below `budgetFloor` makes it false on iteration 1
     and ZERO bites run (the execute run silently no-ops). With the default `budgetFloor` of 50000, warn if
     `maxTokens` is below ~60000.
   - `maxTokens` / `budgetFloor` only bound the EXECUTE loop. With `execute:false` they do nothing — say so
     rather than setting them on a plan-only run.
4. Preview + gate: show the user the exact `args` you will pass (at minimum `goal`, `board`, `execute`,
   and any token/iteration caps). If `execute:true`, STOP and wait for an explicit "yes" — it makes
   unattended edits to the project; do NOT call `Workflow` in the same turn as the preview. A plan-only
   `execute:false` run may launch directly.
5. Launch: `Workflow({ name: "eatahorse", args: { goal, execute, board, maxIterations, maxTokens, budgetFloor, workerModel, constraints } })`.
   Omit args you did not gather — the workflow defaults them.
   - **Resume:** point `board` at an existing board that still has active cards → the workflow skips
     decompose/seed/plan-gate and works the cards already there (use this to continue an interrupted run).
   - **Collision guard:** if `board` points at a board that exists but has 0 active cards (complete, or a
     different project), the run **bails loud** instead of silently re-seeding or no-opping. Pass a fresh
     `board` (convention: `.eatahorse-<topic>`) or remove the stale one.
6. Hand back the workflow's board summary (counts, what's blocked, the written CLAUDE.md note).

The skill name (`eatahorse`) and the workflow `meta.name` (`eatahorse`) live in separate
registries; reusing the name is fine.

## Research a folder: the `eatahorse-research` workflow

When the user wants to **understand a folder/codebase/corpus file by file** (not execute a goal) —
"research this folder", "understand this codebase file by file", "what does each module do",
"document what's in src" — launch the `eatahorse-research` dynamic workflow. It enumerates the
files, auto-picks scale by count, seeds one card per file/directory, and loops parallel research
rounds against the board until done. The board makes the run resumable and lets it scale past the
per-run agent cap; it synthesizes a cited report at the end.

This is **read-only** — it does not modify the researched source — so there is no execute footgun
and no stop-and-confirm gate. Gather the args here (the workflow runs in the background with no user
IO), preview them, then launch directly.

1. Confirm the **root** (folder to research; also accepts a bare path) and a **question** (what to
   find out, e.g. "what does each module do"). Default question is a general per-file summary.
2. Gather any optional knobs the user raises (omit the rest — the workflow defaults them):

   | arg | default | meaning |
   |---|---|---|
   | `root` | (required) | folder to research; also accepts a bare string |
   | `question` | general per-file summary | what each file's research should answer |
   | `include` / `exclude` | (all files) | glob filters on the file set |
   | `maxRounds` | `3` | loop cap in research rounds (the research equivalent of `maxIterations`) |
   | `maxTokens` | none | per-run OUTPUT-token ceiling; same as the execute loop, MUST be > `budgetFloor` |
   | `budgetFloor` | `50000` | stop opening new rounds below this many remaining tokens |
   | `workerModel` | `haiku` | model for the per-file research workers |
   | `out` | report path | where to write the synthesized report |
   | `board` | `.eatahorse-<slug>` | board dir; point at an existing one to RESUME |
   | `scriptPath` | bundled copy | path to `eatahorse.py` |

   **Validate before launching:** if BOTH `maxTokens` and `budgetFloor` are set, require
   `maxTokens > budgetFloor` (same guard as the execute loop — at or below it, zero rounds run).
3. Preview the exact `args` (at minimum `root`, `question`, `out`, any token caps), then launch:
   `Workflow({ name: "eatahorse-research", args: { root, question, include, exclude, maxRounds, maxTokens, budgetFloor, workerModel, out, board } })`.
   Omit args you did not gather. To **resume**, point `board` at an existing board with active cards.
4. Hand back the workflow's report path and board summary (files done, anything skipped).

## Port / convert / migrate a codebase: chaining the two workflows

When the user wants to **convert/port/migrate** a codebase from one language or framework to another
("port this Python to Rust", "migrate X to Y", "rewrite this in <lang>"), there is no separate
`eatahorse-port` workflow. A port is **comprehend → grounded execute**, chaining the two existing
workflows so the convert stage plans from a real cross-file inventory instead of blind:

1. **Comprehend** — `eatahorse-research` with **`extract:'port'`**. Each per-file worker emits a
   structured JSON block (exports/deps/externalDeps/sideEffects/entryPoint/behavior) in its card Notes,
   and a Graph phase folds those into **`inventory.json`** (API surface, intra-repo dependency edges, a
   dependency-ordered `topoOrder`, and any cycles).
2. **Grounded execute** — `eatahorse` with **`grounding`** = that `inventory.json`. Decompose reads the
   inventory and seeds **one port card per source unit in dependency order** (priority = topo band,
   `P00` = leaf, ported first), each linked back to its source via `--external-id source:<path>`.

Front-door steps (gather + validate here; both workflows run headless):

1. Confirm **source root**, **target language** (`targetLang`), **target dir** (`targetDir`), the
   **public API to preserve** (`preserveApi`), and — critically — the **proving command** (`testCmd`,
   e.g. `cargo test`). The plan-gate insists every acceptance name an evidence surface, and `testCmd`
   becomes the behavior-parity acceptance plus an auto-appended run constraint (`<testCmd>` stays green +
   project compiles). **Warn loudly if there is no `testCmd`:** without a test suite, behavior parity is
   only locally checkable per card, never whole-program (state this limit to the user).
2. **Stage 1 (comprehend), launch directly** (read-only):
   `Workflow({ name: "eatahorse-research", args: { root, extract: "port", out, inventory, board, workerModel } })`.
   Hand back the inventory path and unit/layer counts.
3. **Stage 2 (grounded execute)** — gather the `execute` toggle exactly like the unattended run above.
   `execute:true` makes **unattended edits**: STOP and wait for an explicit "yes" before launching; do
   NOT call `Workflow` in the same turn as the preview.
   `Workflow({ name: "eatahorse", args: { goal: "Port <root> to <targetLang>", grounding, targetLang, targetDir, preserveApi, testCmd, execute, board, maxIterations, maxTokens, budgetFloor, workerModel } })`.
4. **Resume:** re-point stage 2 at an existing `inventory.json` (skip stage 1) and/or an in-progress
   `board` with active cards — the workflow works the cards already there.

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
