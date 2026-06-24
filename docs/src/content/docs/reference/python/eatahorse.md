---
title: eatahorse — Kanban Board CLI
diataxisType: reference
---

<!-- generated: python lane, signal: 8x .py files (no pyproject.toml/setup.py) -->

# eatahorse

`plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py`

Lightweight one-bite-at-a-time Kanban boards. Creates and maintains a `.eatahorse` board with `state.json` as the canonical ledger, markdown task cards grouped by status folders, and `board.md` as a generated board view. No third-party dependencies.

---

## Module-level constants

| Name | Value | Description |
|---|---|---|
| `STATE_VERSION` | `1` | Schema version for `state.json`. |
| `DEFAULT_BOARD_DIR` | `".eatahorse"` | Default board directory name. |
| `STATUSES` | `["backlog","ready","doing","blocked","done","dropped"]` | Valid task statuses, in workflow order. |
| `DEFAULT_STATUS` | `"backlog"` | Status assigned to new tasks. |
| `DEFAULT_PRIORITY` | `"P2"` | Priority assigned to new tasks. |

---

## Exception

### `EatahorseError(RuntimeError)`

Expected user-facing error. Raised on invalid arguments, missing boards, and constraint violations. Caught by `main()` and printed to stderr with exit code 2.

---

## Board location

### `find_board(start=None)`

```python
find_board(start: Optional[Path] = None) -> Optional[Path]
```

Find the nearest `.eatahorse` board at or above `start`. Walks parent directories; returns the board `Path` or `None` if not found.

### `resolve_board(board_arg, require=True)`

```python
resolve_board(board_arg: Optional[str], require: bool = True) -> Path
```

Resolve a board path from a CLI argument or by searching from cwd. Raises `EatahorseError` when `require=True` and no board exists.

---

## State I/O

### `load_state(board)`

```python
load_state(board: Path) -> Dict[str, Any]
```

Load `state.json` from the board. Raises `EatahorseError` on missing or malformed files.

### `save_state(board, state)`

```python
save_state(board: Path, state: Dict[str, Any]) -> None
```

Write `state.json` atomically; updates `state["updated_at"]` to the current UTC timestamp.

### `new_state(project, goal="")`

```python
new_state(project: str, goal: str = "") -> Dict[str, Any]
```

Build a fresh state dict for a new board project.

---

## Board initialization

### `init_board(board, project, goal="", force=False)`

```python
init_board(board: Path, project: str, goal: str = "", force: bool = False) -> Dict[str, Any]
```

Create a new `.eatahorse` board at `board`. Creates status subdirectories, writes initial state and `board.md`. Raises `EatahorseError` if the board already exists and `force=False`.

---

## Task operations

### `create_task(...)`

```python
create_task(
    board: Path,
    title: str,
    description: str = "",
    bites: Optional[List[str]] = None,
    acceptance: Optional[List[str]] = None,
    status: str = DEFAULT_STATUS,
    priority: str = DEFAULT_PRIORITY,
    owner: str = "",
    tags: Optional[List[str]] = None,
    estimate: str = "",
    source: str = "manual",
    external_ids: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]
```

Create a new task card, allocate an `EH-NNNN` id, write the markdown file, update state, and regenerate `board.md`. Returns the task dict.

### `move_task(board, task_ref, status)`

```python
move_task(board: Path, task_ref: str, status: str) -> Dict[str, Any]
```

Move a task to another status. `task_ref` may be an id (`EH-0001`), bare number (`1`), or a unique title substring. Applies completion rules after the move. Returns the updated task.

### `complete_task(board, task_ref, note="")`

```python
complete_task(board: Path, task_ref: str, note: str = "") -> Dict[str, Any]
```

Mark all bites and acceptance checks done, set status to `done`, optionally append a completion note. Returns the updated task.

### `reopen_task(board, task_ref, gap="")`

```python
reopen_task(board: Path, task_ref: str, gap: str = "") -> Dict[str, Any]
```

Atomically uncheck all acceptance items (or bites if no acceptance), optionally append `gap` as a new bite, and set status to `doing`. Because doneness derives from acceptance, there is no ordering footgun.

### `remove_task(board, task_ref, purge=False)`

```python
remove_task(board: Path, task_ref: str, purge: bool = False) -> Dict[str, Any]
```

Drop a task (status `dropped`) or, with `purge=True`, remove it from state and delete its markdown file entirely.

### `set_checkbox(board, task_ref, index, done, group="bites")`

```python
set_checkbox(board: Path, task_ref: str, index: int, done: bool, group: str = "bites") -> Dict[str, Any]
```

Check or uncheck a bite or acceptance item by 1-based `index`. `group` must be `"bites"` or `"acceptance"`.

### `add_bite(board, task_ref, text, group="bites")`

```python
add_bite(board: Path, task_ref: str, text: str, group: str = "bites") -> Dict[str, Any]
```

Append a new bite or acceptance item to a task. `group` must be `"bites"` or `"acceptance"`.

---

## Board sync

### `sync_board(board, quiet=False)`

```python
sync_board(board: Path, quiet: bool = False) -> Dict[str, Any]
```

Reconcile all `tasks/*/*.md` markdown files back into `state.json`. Imports hand-authored cards, moves files to their canonical paths, applies completion rules, and drops tasks whose files were manually deleted (marks them `dropped`). Prints a JSON summary unless `quiet=True`. Returns the summary dict.

---

## Queries

### `list_tasks(board, status=None, as_json=False)`

```python
list_tasks(board: Path, status: Optional[str] = None, as_json: bool = False) -> None
```

Print all tasks, optionally filtered by `status`. Prints tab-separated summary lines or JSON.

### `next_task(board, as_json=False)`

```python
next_task(board: Path, as_json: bool = False) -> Optional[Dict[str, Any]]
```

Return (and print) the highest-priority active task from `doing` then `ready` then `backlog`. Blocked cards are never auto-picked. Returns `None` if no active tasks exist.

### `report(board, as_json=False)`

```python
report(board: Path, as_json: bool = False) -> None
```

Print a board report: project name, goal, counts per status.

---

## Completion logic

### `should_auto_complete(task)`

```python
should_auto_complete(task: Dict[str, Any]) -> bool
```

Return `True` when a task's doneness signals are all met. Acceptance items are the primary signal; bites are the fallback when no acceptance is defined.

### `apply_completion_rules(task)`

```python
apply_completion_rules(task: Dict[str, Any]) -> bool
```

Two-way derivation: auto-transition a task to `done` when all acceptance is checked; revert to `doing` when a `done` card has unmet acceptance. Also manages `completed_at` and `dropped_at` timestamps. Returns `True` if status changed.

---

## Markdown rendering

### `task_markdown(task, notes=None)`

```python
task_markdown(task: Dict[str, Any], notes: Optional[str] = None) -> str
```

Render a task dict to full markdown (frontmatter + sections). Terminal cards (`done`/`dropped`) suppress placeholder checklist items so they don't round-trip into unchecked bites.

### `render_board(board, state)`

```python
render_board(board: Path, state: Dict[str, Any]) -> str
```

Generate the `board.md` board view: counts table, per-status task tables with bite/acceptance progress.

### `frontmatter(task)`

```python
frontmatter(task: Dict[str, Any]) -> str
```

Render the YAML-style frontmatter block for a task card.

---

## Frontmatter parsing

### `parse_frontmatter(text)`

```python
parse_frontmatter(text: str) -> Tuple[Dict[str, Any], str]
```

Parse a `---` frontmatter block. Returns `(meta_dict, body_text)`.

### `parse_task_markdown(path, board)`

```python
parse_task_markdown(path: Path, board: Path) -> Optional[Dict[str, Any]]
```

Parse a task card file into a task dict. Returns `None` if no valid task id can be found.

### `parse_scalar(value)`

```python
parse_scalar(value: str) -> Any
```

Parse a scalar frontmatter value: JSON, Python literal, hand-edited YAML-ish lists like `[security, auth]`, booleans, or plain string.

---

## Hooks (Claude Code integration)

### `hook_task_created(board, task_subject, task_description="", task_id="")`

```python
hook_task_created(
    board: Path,
    task_subject: str,
    task_description: str = "",
    task_id: str = "",
) -> Optional[Dict[str, Any]]
```

Called by the `TaskCreated` Claude Code hook event. Links the event to an existing board task by external id or title match; creates a new task if none matches. Returns `None` if the task was already tracked.

### `hook_task_completed(board, task_subject, task_description="", task_id="")`

```python
hook_task_completed(
    board: Path,
    task_subject: str,
    task_description: str = "",
    task_id: str = "",
) -> Dict[str, Any]
```

Called by the `TaskCompleted` Claude Code hook event. Marks the matching task done, or creates a done task if none matches.

---

## CLI

### `build_parser()`

```python
build_parser() -> argparse.ArgumentParser
```

Build the `eatahorse` CLI parser. Subcommands: `init`, `add`, `list`, `show`, `next`, `move`, `done`, `reopen`, `bite`, `add-bite`, `remove`, `sync`, `report`.

### `main(argv=None)`

```python
main(argv: Optional[List[str]] = None) -> int
```

CLI entry point. Returns 0 on success, 2 on `EatahorseError`.

---

## Utilities

| Function | Signature | Description |
|---|---|---|
| `utc_now` | `() -> str` | Current UTC time as ISO-8601 string (no microseconds). |
| `slugify` | `(value, max_len=60) -> str` | Filesystem-safe slug for a title. |
| `normalize_title` | `(value) -> str` | Lowercase alphanum-normalized title for fuzzy matching. |
| `coerce_status` | `(value) -> str` | Validate and normalize a status string; raises on invalid. |
| `canonical_task_path` | `(board, task) -> Path` | The expected filesystem path for a task card. |
| `atomic_write` | `(path, text) -> None` | Write a file via a `.tmp` rename to avoid partial writes. |
| `read_json` | `(path, default=None) -> Any` | Read and parse a JSON file; raises `EatahorseError` on bad JSON. |
| `write_json` | `(path, data) -> None` | Write JSON atomically (sorted keys, Unicode preserved). |
| `allocate_id` | `(state) -> str` | Allocate the next `EH-NNNN` id from state. |
| `resolve_task_id` | `(state, value) -> str` | Resolve a task ref (id, number, or title) to an exact id; raises on ambiguity. |
| `all_items_done` | `(items) -> bool` | True iff the list is non-empty and every item has `done=True`. |
| `task_progress` | `(task) -> str` | One-line progress string: `"bites X/N, acceptance X/N"`. |
| `append_activity` | `(board, action, detail) -> None` | Append an event to `activity.jsonl`. |
| `remember` | `(state, action, detail) -> None` | Append a history entry to the in-memory state (capped at 100). |
| `split_lines` | `(values) -> List[str]` | Split CLI repeated values by newline or semicolon. |
| `external_ids_from_args` | `(values) -> Dict[str, str]` | Parse `namespace:value` external-id CLI arguments. |
| `find_task_by_external_id` | `(state, namespace, external_id) -> Optional[str]` | Find a task id by its external id in a given namespace. |
| `find_task_by_title` | `(state, title) -> Optional[str]` | Find a unique task id by exact normalized title match. |

---

# eatahorse_hook

`plugins/workflow-kit/skills/eatahorse/scripts/eatahorse_hook.py`

Claude Code hook bridge for Eatahorse. Reads Claude Code hook JSON from stdin and keeps the nearest `.eatahorse` board in sync. Intentionally quiet on success (empty stdout + exit 0).

---

## Functions

### `debug(message)`

```python
debug(message: str) -> None
```

Print a debug message to stderr when `EATAHORSE_HOOK_DEBUG` is set.

### `read_input()`

```python
read_input() -> Dict[str, Any]
```

Read and parse the hook JSON payload from stdin. Returns an empty dict on empty input or invalid JSON.

### `cwd_from_event(event)`

```python
cwd_from_event(event: Dict[str, Any]) -> Path
```

Extract the working directory from a hook event, falling back to `os.getcwd()`.

### `board_from_event(event)`

```python
board_from_event(event: Dict[str, Any]) -> Optional[Path]
```

Find the nearest `.eatahorse` board from the event's working directory.

### `autosync_disabled()`

```python
autosync_disabled() -> bool
```

Return `True` when `EATAHORSE_NO_AUTOSYNC` is set. Escape hatch for parallel workflows whose single-writer invariant a concurrent hook-triggered sync would violate. Only gates automatic sync paths; `TaskCreated`/`TaskCompleted` events remain active.

### `sync_if_board(event)`

```python
sync_if_board(event: Dict[str, Any]) -> None
```

Sync the board on `Stop`/`SubagentStop`/`SessionEnd` events, unless autosync is disabled.

### `handle_task_created(event)`

```python
handle_task_created(event: Dict[str, Any]) -> None
```

Handle a `TaskCreated` hook event: delegate to `eatahorse.hook_task_created`.

### `handle_task_completed(event)`

```python
handle_task_completed(event: Dict[str, Any]) -> None
```

Handle a `TaskCompleted` hook event: delegate to `eatahorse.hook_task_completed`.

### `main()`

```python
main() -> int
```

Hook entry point. Routes `TaskCreated`, `TaskCompleted`, `Stop`, `SubagentStop`, and `SessionEnd` events. Always returns 0 (fail-open: hooks should not interrupt work tracking).
