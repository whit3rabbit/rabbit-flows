# Eatahorse Claude Skill

Eatahorse is a small Claude skill for turning big work into a Kanban-style folder of markdown task cards: one bite at a time.

It is intentionally lighter than formal specification workflows. It creates a `.eatahorse/` folder in a project, with task cards grouped by status and a `state.json` ledger that can be synced from markdown edits.

## Contents

```text
eatahorse/
├── SKILL.md
├── README.md
├── CLAUDE.md
├── scripts/
│   ├── eatahorse.py
│   ├── eatahorse_hook.py
│   ├── build_inventory.py        # deterministic Kahn topo/layer/cycle pass (port inventory)
│   ├── diff_test.py              # differential-equivalence harness (source-oracle vs target)
│   ├── test_eatahorse.py
│   ├── test_build_inventory.py
│   ├── test_diff_test.py
│   └── test_cmd_drift.py         # workflow CMD maps vs eatahorse.py verbs (drift guard)
├── resources/
│   ├── BOARD_FORMAT.md
│   ├── EXAMPLES.md
│   └── claude-code-settings.example.json
└── templates/
    └── task.md
```

## Install

This skill ships inside the `workflow-kit` plugin at
`plugins/workflow-kit/skills/eatahorse/` (installed via the marketplace or the npx installer).

### Standalone upload (optional)

To upload as a standalone Claude skill, zip this folder so the folder itself is the root inside
the zip, then upload/enable it in Claude Skills:

```bash
zip -r eatahorse.zip eatahorse   # run from a dir containing an `eatahorse/` copy of this folder
```

This package already follows that structure.

## Direct CLI use

From a project root:

```bash
python /path/to/eatahorse/scripts/eatahorse.py init "My Project" --goal "Ship the first usable version"
python /path/to/eatahorse/scripts/eatahorse.py add "Create login page" \
  --status ready \
  --priority P1 \
  --bite "Sketch fields and validation" \
  --bite "Build page component" \
  --bite "Add route test" \
  --accept "Login form renders" \
  --accept "Invalid submit shows errors"
python /path/to/eatahorse/scripts/eatahorse.py move EH-0001 doing
python /path/to/eatahorse/scripts/eatahorse.py bite EH-0001 1 --done
python /path/to/eatahorse/scripts/eatahorse.py sync
python /path/to/eatahorse/scripts/eatahorse.py report
```

## Claude Code hook notes

`SKILL.md` contains hook frontmatter for Claude Code. If your environment does not run Python as `python3`, edit the hook command to `python`.

The hook is scoped to the active skill lifecycle. The example settings file in `resources/claude-code-settings.example.json` shows how to wire the hook at project level instead.

## Design choices

- `state.json` is the ledger.
- Markdown task cards are the human interface.
- `board.md` is generated and should not be manually edited.
- `activity.jsonl` is append-only history.
- Deleting a task markdown file marks the task `dropped` on sync instead of silently destroying history.
- Moving a markdown file between status folders changes the task status on sync.
- Doneness derives from acceptance checks (bites are progress); checking all acceptance moves the task to `done` on sync, and unchecking any reverts a `done` card to `doing`. Cards with no acceptance fall back to bites.

## Safety

The scripts use only the Python standard library. The hook fails open and does not block Claude Code actions.
