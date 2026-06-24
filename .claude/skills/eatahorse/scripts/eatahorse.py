#!/usr/bin/env python3
"""Eatahorse: lightweight one-bite-at-a-time Kanban boards.

Creates and maintains a .eatahorse board with:
- state.json as the canonical ledger
- markdown task cards grouped by status folders
- board.md as a generated board view

No third-party dependencies.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import sys
import textwrap
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

STATE_VERSION = 1
DEFAULT_BOARD_DIR = ".eatahorse"
STATUSES = ["backlog", "ready", "doing", "blocked", "done", "dropped"]
DEFAULT_STATUS = "backlog"
DEFAULT_PRIORITY = "P2"
CHECKBOX_RE = re.compile(r"^\s*-\s+\[(?P<mark>[ xX])\]\s+(?P<text>.*)\s*$")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(?P<meta>.*?)\n---\s*\n?", re.S)
SAFE_ID_RE = re.compile(r"^(?:EH-)?(?P<num>\d+)$", re.I)


class EatahorseError(RuntimeError):
    """Expected user-facing error."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str, max_len: int = 60) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return (value or "task")[:max_len].strip("-") or "task"


def normalize_title(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def coerce_status(value: Optional[str]) -> str:
    if not value:
        return DEFAULT_STATUS
    value = value.lower().strip()
    if value not in STATUSES:
        raise EatahorseError(f"Invalid status '{value}'. Use one of: {', '.join(STATUSES)}")
    return value


def find_board(start: Optional[Path] = None) -> Optional[Path]:
    """Find the nearest .eatahorse board at or above start."""
    current = (start or Path.cwd()).resolve()
    if current.is_file():
        current = current.parent
    for parent in [current, *current.parents]:
        candidate = parent / DEFAULT_BOARD_DIR
        if (candidate / "state.json").exists():
            return candidate
    return None


def resolve_board(board_arg: Optional[str], require: bool = True) -> Path:
    if board_arg:
        board = Path(board_arg).expanduser()
        if not board.is_absolute():
            board = (Path.cwd() / board).resolve()
        if board.name != DEFAULT_BOARD_DIR and (board / DEFAULT_BOARD_DIR / "state.json").exists():
            board = board / DEFAULT_BOARD_DIR
    else:
        board = find_board()
        if board is None:
            board = Path.cwd() / DEFAULT_BOARD_DIR
    if require and not (board / "state.json").exists():
        raise EatahorseError(
            f"No Eatahorse board found at {board}. Run: eatahorse init \"Project name\""
        )
    return board


def board_rel(board: Path, path: Path) -> str:
    return path.resolve().relative_to(board.resolve()).as_posix()


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return deepcopy(default)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EatahorseError(f"Invalid JSON in {path}: {exc}") from exc


def write_json(path: Path, data: Any) -> None:
    atomic_write(path, json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n")


def new_state(project: str, goal: str = "") -> Dict[str, Any]:
    now = utc_now()
    return {
        "schema": "eatahorse.state.v1",
        "version": STATE_VERSION,
        "project": project,
        "goal": goal,
        "created_at": now,
        "updated_at": now,
        "statuses": STATUSES,
        "next_id": 1,
        "tasks": {},
        "history": [],
    }


def load_state(board: Path) -> Dict[str, Any]:
    state = read_json(board / "state.json", default=None)
    if state is None:
        raise EatahorseError(f"Missing {board / 'state.json'}")
    if "tasks" not in state or not isinstance(state["tasks"], dict):
        raise EatahorseError("state.json is missing a valid 'tasks' object")
    state.setdefault("statuses", STATUSES)
    state.setdefault("next_id", 1)
    state.setdefault("history", [])
    return state


def save_state(board: Path, state: Dict[str, Any]) -> None:
    state["updated_at"] = utc_now()
    write_json(board / "state.json", state)


def append_activity(board: Path, action: str, detail: Dict[str, Any]) -> None:
    event = {"at": utc_now(), "action": action, "detail": detail}
    with (board / "activity.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def remember(state: Dict[str, Any], action: str, detail: Dict[str, Any]) -> None:
    state.setdefault("history", []).append({"at": utc_now(), "action": action, "detail": detail})
    # Keep state small; full history lives in activity.jsonl.
    state["history"] = state["history"][-100:]


def allocate_id(state: Dict[str, Any]) -> str:
    next_id = int(state.get("next_id", 1))
    while f"EH-{next_id:04d}" in state.get("tasks", {}):
        next_id += 1
    state["next_id"] = next_id + 1
    return f"EH-{next_id:04d}"


def canonical_task_path(board: Path, task: Dict[str, Any]) -> Path:
    status = coerce_status(task.get("status"))
    title = str(task.get("title") or task.get("id") or "task")
    filename = f"{task['id']}-{slugify(title)}.md"
    return board / "tasks" / status / filename


def parse_scalar(value: str) -> Any:
    value = value.strip()
    if value == "":
        return ""
    if value in {"null", "None", "~"}:
        return None
    if value in {"true", "false"}:
        return value == "true"
    if value.startswith("[") or value.startswith("{") or value.startswith('"') or value.startswith("'"):
        try:
            return json.loads(value)
        except Exception:
            try:
                return ast.literal_eval(value)
            except Exception:
                # Hand-edited YAML-ish list (e.g. `[security, auth]`): split into items rather
                # than returning a bracketed raw string. JSON/ast paths above win for valid input.
                if value.startswith("["):
                    inner = value[1:-1] if value.endswith("]") else value[1:]
                    return [v.strip().strip('"\'') for v in inner.split(",") if v.strip()]
                return value.strip('"\'')
    return value


def parse_frontmatter(text: str) -> Tuple[Dict[str, Any], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta: Dict[str, Any] = {}
    for raw_line in match.group("meta").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = parse_scalar(value)
    return meta, text[match.end():]


def frontmatter(task: Dict[str, Any]) -> str:
    fields = {
        "id": task.get("id"),
        "title": task.get("title", ""),
        "status": task.get("status", DEFAULT_STATUS),
        "priority": task.get("priority", DEFAULT_PRIORITY),
        "owner": task.get("owner", ""),
        "tags": task.get("tags", []),
        "estimate": task.get("estimate", ""),
        "source": task.get("source", "manual"),
        "path": task.get("path", ""),
        "created_at": task.get("created_at", ""),
        "updated_at": task.get("updated_at", ""),
        "completed_at": task.get("completed_at"),
        "dropped_at": task.get("dropped_at"),
    }
    lines = ["---"]
    for key, value in fields.items():
        if value is None:
            encoded = "null"
        elif isinstance(value, (list, dict, bool, int, float)):
            encoded = json.dumps(value, ensure_ascii=False)
        else:
            encoded = json.dumps(str(value), ensure_ascii=False)
        lines.append(f"{key}: {encoded}")
    lines.append("---")
    return "\n".join(lines)


def extract_section(body: str, heading_prefix: str) -> str:
    pattern = re.compile(
        rf"^##\s+{re.escape(heading_prefix)}.*?$\n(?P<section>.*?)(?=^##\s+|\Z)",
        re.M | re.S,
    )
    match = pattern.search(body)
    if not match:
        return ""
    return match.group("section").strip("\n")


def parse_checkboxes(section: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for line in section.splitlines():
        match = CHECKBOX_RE.match(line)
        if match:
            text = match.group("text").strip()
            if text:
                items.append({"text": text, "done": match.group("mark").lower() == "x"})
    return items


def extract_text_section(body: str, heading_prefix: str) -> str:
    section = extract_section(body, heading_prefix)
    if section.strip().lower() in {"_none._", "none", ""}:
        return ""
    return section.strip()


def parse_task_markdown(path: Path, board: Path) -> Optional[Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    # The tool's own trailing footer sits below the last section (## Notes). extract_section's
    # lookahead runs to EOF, so without this it gets captured as note text and re-duplicated
    # on every sync. Strip only our known footer; leave any user comment mid-notes intact.
    body = re.sub(r"\n*<!--\s*Eatahorse:.*?-->\s*$", "", body, flags=re.S)
    task_id = str(meta.get("id") or "").strip()
    if not task_id:
        match = re.match(r"(?P<id>EH-\d{4,})", path.name, re.I)
        if match:
            task_id = match.group("id").upper()
    if not task_id:
        return None

    folder_status = path.parent.name if path.parent.name in STATUSES else None
    saved_path = str(meta.get("path") or "")
    current_rel = board_rel(board, path)
    meta_status = str(meta.get("status") or "").lower().strip()
    if saved_path and saved_path != current_rel and folder_status:
        status = folder_status
    elif meta_status in STATUSES:
        status = meta_status
    elif folder_status:
        status = folder_status
    else:
        status = DEFAULT_STATUS

    title = str(meta.get("title") or "").strip()
    if not title:
        h1 = re.search(r"^#\s+(?:EH-\d{4,}:\s*)?(?P<title>.+)$", body, re.M)
        title = h1.group("title").strip() if h1 else task_id

    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [tag.strip() for tag in tags.split(",") if tag.strip()]

    return {
        "id": task_id,
        "title": title,
        "status": status,
        "priority": str(meta.get("priority") or DEFAULT_PRIORITY),
        "owner": str(meta.get("owner") or ""),
        "tags": tags,
        "estimate": str(meta.get("estimate") or ""),
        "source": str(meta.get("source") or "manual"),
        "path": current_rel,
        "created_at": str(meta.get("created_at") or utc_now()),
        "updated_at": str(meta.get("updated_at") or utc_now()),
        "completed_at": meta.get("completed_at"),
        "dropped_at": meta.get("dropped_at"),
        "description": extract_text_section(body, "Description"),
        "bites": parse_checkboxes(extract_section(body, "One-bite-at-a-time plan")),
        "acceptance": parse_checkboxes(extract_section(body, "Acceptance checks")),
        "notes": extract_text_section(body, "Notes"),
    }


def checkbox_lines(items: Iterable[Dict[str, Any]], fallback: str) -> str:
    items = list(items or [])
    if not items:
        # Empty fallback => render nothing, so a terminal-status card with no checklist
        # round-trips back to an empty list on sync instead of re-gaining a placeholder bite
        # that would revert it out of done. See task_markdown for the terminal-status gate.
        return f"- [ ] {fallback}" if fallback else ""
    lines = []
    for item in items:
        mark = "x" if item.get("done") else " "
        text = str(item.get("text") or "").strip() or fallback
        lines.append(f"- [{mark}] {text}")
    return "\n".join(lines)


def task_markdown(task: Dict[str, Any], notes: Optional[str] = None) -> str:
    notes = task.get("notes", "") if notes is None else notes
    tags = task.get("tags") or []
    tag_text = ", ".join(tags) if tags else "none"
    owner = task.get("owner") or "unassigned"
    estimate = task.get("estimate") or "unsized"
    description = (task.get("description") or "").strip() or "_None._"
    completed = task.get("completed_at") or ""
    # Terminal cards (done/dropped) suppress the "define a bite/acceptance" placeholder: it is
    # wrong advice for a finished card, and a placeholder would round-trip into a real unchecked
    # bite on the next sync and revert the card out of done. Empty fallback => empty section.
    terminal = task.get("status") in {"done", "dropped"}
    bite_fallback = "" if terminal else "Define the next small bite"
    acceptance_fallback = "" if terminal else "Define done for this task"

    parts = [
        frontmatter(task),
        "",
        f"# {task['id']}: {task.get('title', '').strip() or 'Untitled task'}",
        "",
        f"Status: `{task.get('status', DEFAULT_STATUS)}` · Priority: `{task.get('priority', DEFAULT_PRIORITY)}` · Owner: `{owner}` · Estimate: `{estimate}`",
        f"Tags: {tag_text}",
    ]
    if completed:
        parts.append(f"Completed: `{completed}`")
    parts.extend(
        [
            "",
            "## Description",
            description,
            "",
            "## One-bite-at-a-time plan",
            checkbox_lines(task.get("bites", []), bite_fallback),
            "",
            "## Acceptance checks",
            checkbox_lines(task.get("acceptance", []), acceptance_fallback),
            "",
            "## Notes",
            notes.strip() if notes and notes.strip() else "",
            "",
            "<!-- Eatahorse: edit checkboxes/status/title, then run `python scripts/eatahorse.py sync` or let the Claude Code hook sync it. -->",
            "",
        ]
    )
    return "\n".join(parts)


def write_task_file(board: Path, task: Dict[str, Any], old_path: Optional[Path] = None, notes: Optional[str] = None) -> Path:
    task["status"] = coerce_status(task.get("status"))
    now = utc_now()
    task["updated_at"] = now
    target = canonical_task_path(board, task)
    task["path"] = board_rel(board, target)

    # Update metadata once path is known.
    text = task_markdown(task, notes=notes)
    atomic_write(target, text)

    # Remove the old file if the canonical path changed.
    candidates: List[Path] = []
    if old_path:
        candidates.append(old_path)
    elif task.get("_old_path"):
        candidates.append(board / str(task["_old_path"]))
    for candidate in candidates:
        try:
            if candidate.resolve() != target.resolve() and candidate.exists():
                candidate.unlink()
        except FileNotFoundError:
            pass
    task.pop("_old_path", None)
    return target


def all_items_done(items: List[Dict[str, Any]]) -> bool:
    return bool(items) and all(bool(item.get("done")) for item in items)


def should_auto_complete(task: Dict[str, Any]) -> bool:
    # Doneness is derived from ACCEPTANCE alone (bites are progress, not doneness). A card with
    # acceptance is done iff every acceptance check is met; a card with no acceptance falls back
    # to bites. This is the single source of truth that apply_completion_rules derives status from.
    bites = task.get("bites") or []
    acceptance = task.get("acceptance") or []
    if acceptance:
        return all_items_done(acceptance)
    return all_items_done(bites)


def apply_completion_rules(task: Dict[str, Any]) -> bool:
    changed = False
    status = coerce_status(task.get("status"))
    if status not in {"done", "dropped"} and should_auto_complete(task):
        task["status"] = "done"
        task["completed_at"] = task.get("completed_at") or utc_now()
        changed = True
    elif status == "done" and (task.get("acceptance") or task.get("bites")) and not should_auto_complete(task):
        # Two-way derivation: a done card whose acceptance is no longer fully met reverts to doing.
        # Status is a function of acceptance, so manual `move done` or an added/unchecked acceptance
        # item cannot leave a card "done" that isn't. completed_at is nulled by the cleanup below.
        # A card with no acceptance AND no bites has nothing to derive from, so an explicit
        # `move done` / `complete` is honored rather than reverted.
        task["status"] = "doing"
        changed = True
    if task.get("status") == "done" and not task.get("completed_at"):
        task["completed_at"] = utc_now()
        changed = True
    if task.get("status") != "done" and task.get("completed_at"):
        task["completed_at"] = None
        changed = True
    if task.get("status") == "dropped" and not task.get("dropped_at"):
        task["dropped_at"] = utc_now()
        changed = True
    if task.get("status") != "dropped" and task.get("dropped_at"):
        task["dropped_at"] = None
        changed = True
    return changed


def render_board(board: Path, state: Dict[str, Any]) -> str:
    counts = {status: 0 for status in STATUSES}
    for task in state.get("tasks", {}).values():
        counts[coerce_status(task.get("status"))] = counts.get(coerce_status(task.get("status")), 0) + 1

    lines = [
        f"# Eatahorse Board: {state.get('project', 'Unnamed project')}",
        "",
        f"Goal: {state.get('goal') or '_No goal recorded._'}",
        "",
        f"Updated: `{state.get('updated_at', utc_now())}`",
        "",
        "## Counts",
        "",
        "| Status | Count |",
        "|---|---:|",
    ]
    for status in STATUSES:
        lines.append(f"| {status} | {counts.get(status, 0)} |")
    lines.append("")

    for status in STATUSES:
        lines.extend([f"## {status}", ""])
        tasks = [task for task in state.get("tasks", {}).values() if coerce_status(task.get("status")) == status]
        tasks.sort(key=lambda t: (str(t.get("priority", "P9")), str(t.get("id", ""))))
        if not tasks:
            lines.extend(["_No tasks._", ""])
            continue
        lines.extend(["| ID | Task | Bites | Acceptance | Priority | Owner |", "|---|---|---:|---:|---|---|"])
        for task in tasks:
            bites = task.get("bites") or []
            acc = task.get("acceptance") or []
            bdone = sum(1 for item in bites if item.get("done"))
            adone = sum(1 for item in acc if item.get("done"))
            title = str(task.get("title") or "Untitled").replace("|", "\\|")
            path = str(task.get("path") or "")
            link = f"[{task['id']}]({path})" if path else task["id"]
            lines.append(
                f"| {link} | {title} | {bdone}/{len(bites)} | {adone}/{len(acc)} | {task.get('priority', DEFAULT_PRIORITY)} | {task.get('owner') or ''} |"
            )
        lines.append("")

    lines.extend(
        [
            "## Workflow",
            "",
            "Move one task into `doing`, finish one bite, sync, then take the next bite.",
            "",
            "Generated by Eatahorse. Edit task markdown files or use `scripts/eatahorse.py`.",
            "",
        ]
    )
    return "\n".join(lines)


def write_board_file(board: Path, state: Dict[str, Any]) -> None:
    atomic_write(board / "board.md", render_board(board, state))


def init_board(board: Path, project: str, goal: str = "", force: bool = False) -> Dict[str, Any]:
    if (board / "state.json").exists() and not force:
        raise EatahorseError(f"Board already exists at {board}. Use --force to reinitialize.")
    if force and board.exists():
        shutil.rmtree(board)
    for status in STATUSES:
        (board / "tasks" / status).mkdir(parents=True, exist_ok=True)
    state = new_state(project=project, goal=goal)
    save_state(board, state)
    write_board_file(board, state)
    append_activity(board, "init", {"project": project, "goal": goal})
    return state


def split_lines(values: Optional[List[str]]) -> List[str]:
    output: List[str] = []
    for value in values or []:
        for part in re.split(r"\n|;", value):
            part = part.strip()
            if part:
                output.append(part)
    return output


def create_task(
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
) -> Dict[str, Any]:
    state = load_state(board)
    title = title.strip()
    if not title:
        raise EatahorseError("Task title cannot be empty")
    task_id = allocate_id(state)
    now = utc_now()
    task = {
        "id": task_id,
        "title": title,
        "status": coerce_status(status),
        "priority": priority or DEFAULT_PRIORITY,
        "owner": owner or "",
        "tags": tags or [],
        "estimate": estimate or "",
        "source": source,
        "external_ids": external_ids or {},
        "description": description.strip(),
        "bites": [{"text": bite, "done": False} for bite in (bites or [])],
        "acceptance": [{"text": item, "done": False} for item in (acceptance or [])],
        "notes": "",
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
        "dropped_at": None,
    }
    if not task["bites"]:
        task["bites"] = [{"text": "Take the first small bite", "done": False}]
    write_task_file(board, task)
    state["tasks"][task_id] = task
    remember(state, "add", {"id": task_id, "title": title})
    save_state(board, state)
    write_board_file(board, state)
    append_activity(board, "add", {"id": task_id, "title": title})
    return task


def resolve_task_id(state: Dict[str, Any], value: str) -> str:
    value = value.strip()
    if not value:
        raise EatahorseError("Task id/title cannot be empty")
    if value in state["tasks"]:
        return value
    match = SAFE_ID_RE.match(value)
    if match:
        candidate = f"EH-{int(match.group('num')):04d}"
        if candidate in state["tasks"]:
            return candidate
    normalized = normalize_title(value)
    matches = [task["id"] for task in state["tasks"].values() if normalize_title(task.get("title", "")) == normalized]
    if len(matches) == 1:
        return matches[0]
    contains = [task["id"] for task in state["tasks"].values() if normalized and normalized in normalize_title(task.get("title", ""))]
    if len(contains) == 1:
        return contains[0]
    if not matches and not contains:
        raise EatahorseError(f"No task found for '{value}'")
    raise EatahorseError(f"Ambiguous task '{value}'. Use an exact task id.")


def update_and_write_task(board: Path, state: Dict[str, Any], task: Dict[str, Any], old_path: Optional[Path] = None) -> None:
    apply_completion_rules(task)
    write_task_file(board, task, old_path=old_path)
    state["tasks"][task["id"]] = task
    save_state(board, state)
    write_board_file(board, state)


def move_task(board: Path, task_ref: str, status: str) -> Dict[str, Any]:
    state = load_state(board)
    task_id = resolve_task_id(state, task_ref)
    task = state["tasks"][task_id]
    old_path = board / task.get("path", "") if task.get("path") else None
    task["status"] = coerce_status(status)
    if task["status"] == "done":
        task["completed_at"] = task.get("completed_at") or utc_now()
    elif task["status"] == "dropped":
        task["dropped_at"] = task.get("dropped_at") or utc_now()
    remember(state, "move", {"id": task_id, "status": task["status"]})
    update_and_write_task(board, state, task, old_path=old_path)
    append_activity(board, "move", {"id": task_id, "status": task["status"]})
    return task


def complete_task(board: Path, task_ref: str, note: str = "") -> Dict[str, Any]:
    state = load_state(board)
    task_id = resolve_task_id(state, task_ref)
    task = state["tasks"][task_id]
    for group in ("bites", "acceptance"):
        for item in task.get(group, []):
            item["done"] = True
    if note:
        task["notes"] = (task.get("notes") or "").rstrip() + f"\n\nCompleted note ({utc_now()}): {note}\n"
    task["status"] = "done"
    task["completed_at"] = task.get("completed_at") or utc_now()
    old_path = board / task.get("path", "") if task.get("path") else None
    remember(state, "done", {"id": task_id})
    update_and_write_task(board, state, task, old_path=old_path)
    append_activity(board, "done", {"id": task_id})
    return task


def set_checkbox(board: Path, task_ref: str, index: int, done: bool, group: str = "bites") -> Dict[str, Any]:
    state = load_state(board)
    task_id = resolve_task_id(state, task_ref)
    task = state["tasks"][task_id]
    if group not in {"bites", "acceptance"}:
        raise EatahorseError("group must be 'bites' or 'acceptance'")
    items = task.get(group) or []
    if index < 1 or index > len(items):
        raise EatahorseError(f"{group} index out of range: {index}")
    items[index - 1]["done"] = done
    old_path = board / task.get("path", "") if task.get("path") else None
    remember(state, "check" if done else "uncheck", {"id": task_id, "group": group, "index": index})
    update_and_write_task(board, state, task, old_path=old_path)
    append_activity(board, "check" if done else "uncheck", {"id": task_id, "group": group, "index": index})
    return task


def add_bite(board: Path, task_ref: str, text: str, group: str = "bites") -> Dict[str, Any]:
    state = load_state(board)
    task_id = resolve_task_id(state, task_ref)
    task = state["tasks"][task_id]
    if group not in {"bites", "acceptance"}:
        raise EatahorseError("group must be 'bites' or 'acceptance'")
    task.setdefault(group, []).append({"text": text.strip(), "done": False})
    if not text.strip():
        raise EatahorseError("Bite text cannot be empty")
    old_path = board / task.get("path", "") if task.get("path") else None
    remember(state, "add-bite", {"id": task_id, "group": group, "text": text.strip()})
    update_and_write_task(board, state, task, old_path=old_path)
    append_activity(board, "add-bite", {"id": task_id, "group": group})
    return task


def reopen_task(board: Path, task_ref: str, gap: str = "") -> Dict[str, Any]:
    # Atomic reopen: uncheck every acceptance item (so doneness derives to not-done), append the
    # gap as a bite if given, and set status doing. Because doneness is derived from acceptance,
    # there is no checkbox-vs-status ordering footgun — one call, can't half-apply.
    state = load_state(board)
    task_id = resolve_task_id(state, task_ref)
    task = state["tasks"][task_id]
    acceptance = task.get("acceptance") or []
    for item in acceptance:
        item["done"] = False
    if not acceptance:
        # No acceptance to gate on; fall back to unchecking bites.
        for item in task.get("bites") or []:
            item["done"] = False
    if gap.strip():
        task.setdefault("bites", []).append({"text": gap.strip(), "done": False})
    task["status"] = "doing"
    old_path = board / task.get("path", "") if task.get("path") else None
    remember(state, "reopen", {"id": task_id, "gap": gap.strip()})
    update_and_write_task(board, state, task, old_path=old_path)
    append_activity(board, "reopen", {"id": task_id, "gap": bool(gap.strip())})
    return task


def remove_task(board: Path, task_ref: str, purge: bool = False) -> Dict[str, Any]:
    state = load_state(board)
    task_id = resolve_task_id(state, task_ref)
    task = state["tasks"][task_id]
    old_path = board / task.get("path", "") if task.get("path") else None
    if purge:
        if old_path and old_path.exists():
            old_path.unlink()
        state["tasks"].pop(task_id, None)
        remember(state, "purge", {"id": task_id})
        append_activity(board, "purge", {"id": task_id})
    else:
        task["status"] = "dropped"
        task["dropped_at"] = task.get("dropped_at") or utc_now()
        remember(state, "drop", {"id": task_id})
        update_and_write_task(board, state, task, old_path=old_path)
        append_activity(board, "drop", {"id": task_id})
        return task
    save_state(board, state)
    write_board_file(board, state)
    return task


def task_progress(task: Dict[str, Any]) -> str:
    bites = task.get("bites") or []
    acc = task.get("acceptance") or []
    bdone = sum(1 for item in bites if item.get("done"))
    adone = sum(1 for item in acc if item.get("done"))
    return f"bites {bdone}/{len(bites)}, acceptance {adone}/{len(acc)}"


def print_task(task: Dict[str, Any], board: Optional[Path] = None) -> None:
    path = task.get("path") or ""
    print(f"{task['id']} [{task.get('status')}] {task.get('title')}")
    print(f"  priority={task.get('priority', DEFAULT_PRIORITY)} owner={task.get('owner') or '-'} progress={task_progress(task)}")
    if path:
        print(f"  file={path}")
    if task.get("description"):
        print(textwrap.indent(task["description"].strip(), "  "))
    for i, bite in enumerate(task.get("bites") or [], start=1):
        mark = "x" if bite.get("done") else " "
        print(f"  bite {i}: [{mark}] {bite.get('text')}")


def list_tasks(board: Path, status: Optional[str] = None, as_json: bool = False) -> None:
    state = load_state(board)
    tasks = list(state.get("tasks", {}).values())
    if status:
        status = coerce_status(status)
        tasks = [task for task in tasks if coerce_status(task.get("status")) == status]
    tasks.sort(key=lambda t: (STATUSES.index(coerce_status(t.get("status"))), str(t.get("priority", "P9")), str(t.get("id"))))
    if as_json:
        print(json.dumps(tasks, indent=2, ensure_ascii=False, sort_keys=True))
        return
    for task in tasks:
        print(f"{task['id']}\t{task.get('status')}\t{task.get('priority', DEFAULT_PRIORITY)}\t{task_progress(task)}\t{task.get('title')}")


def next_task(board: Path, as_json: bool = False) -> Optional[Dict[str, Any]]:
    state = load_state(board)
    # blocked is excluded: a deliberately-parked card must be unblocked with `move <id> ready`,
    # never auto-picked as last resort.
    for status in ["doing", "ready", "backlog"]:
        candidates = [task for task in state["tasks"].values() if coerce_status(task.get("status")) == status]
        candidates.sort(key=lambda t: (str(t.get("priority", "P9")), str(t.get("id"))))
        if candidates:
            task = candidates[0]
            if as_json:
                print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True))
            else:
                print_task(task, board)
            return task
    if not as_json:
        print("No active tasks.")
    return None


def sync_board(board: Path, quiet: bool = False) -> Dict[str, Any]:
    state = load_state(board)
    tasks_dir = board / "tasks"
    for status in STATUSES:
        (tasks_dir / status).mkdir(parents=True, exist_ok=True)

    files = sorted(tasks_dir.glob("*/*.md"))
    seen: set[str] = set()
    imported = updated = moved = completed = dropped_missing = 0

    for path in files:
        parsed = parse_task_markdown(path, board)
        if not parsed:
            continue
        task_id = parsed["id"]
        seen.add(task_id)
        existing = deepcopy(state["tasks"].get(task_id, {}))
        notes = parsed.pop("notes", existing.get("notes", ""))
        task = {**existing, **parsed}
        task.setdefault("external_ids", existing.get("external_ids", {}))
        old_status = existing.get("status")
        old_path = path
        if old_status is None:
            imported += 1
            remember(state, "import", {"id": task_id, "path": board_rel(board, path)})
        task["notes"] = notes
        before_status = task.get("status")
        if apply_completion_rules(task) and task.get("status") == "done" and before_status != "done":
            completed += 1
        canonical = canonical_task_path(board, task)
        if canonical.resolve() != path.resolve():
            moved += 1
        write_task_file(board, task, old_path=old_path, notes=notes)
        if existing and existing != task:
            updated += 1
        state["tasks"][task_id] = task

    for task_id, task in list(state["tasks"].items()):
        if task_id in seen:
            continue
        # If a task file was manually deleted, mark dropped rather than losing ledger history.
        path = board / str(task.get("path") or "")
        if task.get("status") != "dropped" and not path.exists():
            task["status"] = "dropped"
            task["dropped_at"] = task.get("dropped_at") or utc_now()
            task["path"] = ""
            dropped_missing += 1
            remember(state, "drop-missing", {"id": task_id})

    # Reconcile next_id past any hand-created higher id so allocate_id never drifts below the real max.
    nums = [int(m.group("num")) for tid in state["tasks"] if (m := SAFE_ID_RE.match(tid))]
    if nums:
        state["next_id"] = max(int(state.get("next_id", 1)), max(nums) + 1)

    save_state(board, state)
    write_board_file(board, state)
    summary = {
        "board": str(board),
        "imported": imported,
        "updated": updated,
        "moved": moved,
        "completed": completed,
        "dropped_missing": dropped_missing,
        "tasks": len(state["tasks"]),
    }
    append_activity(board, "sync", summary)
    if not quiet:
        print(json.dumps(summary, indent=2, sort_keys=True))
    return summary


def find_task_by_external_id(state: Dict[str, Any], namespace: str, external_id: str) -> Optional[str]:
    for task in state.get("tasks", {}).values():
        if (task.get("external_ids") or {}).get(namespace) == external_id:
            return task["id"]
    return None


def find_task_by_title(state: Dict[str, Any], title: str) -> Optional[str]:
    target = normalize_title(title)
    if not target:
        return None
    exact = [task["id"] for task in state.get("tasks", {}).values() if normalize_title(task.get("title", "")) == target]
    if len(exact) == 1:
        return exact[0]
    return None


def hook_task_created(board: Path, task_subject: str, task_description: str = "", task_id: str = "") -> Optional[Dict[str, Any]]:
    state = load_state(board)
    namespace = "claude_task_id"
    if task_id and find_task_by_external_id(state, namespace, task_id):
        return None
    existing_id = find_task_by_title(state, task_subject)
    if existing_id:
        task = state["tasks"][existing_id]
        if task_id:
            task.setdefault("external_ids", {})[namespace] = task_id
        if task_description and not task.get("description"):
            task["description"] = task_description
        old_path = board / task.get("path", "") if task.get("path") else None
        update_and_write_task(board, state, task, old_path=old_path)
        append_activity(board, "hook-link", {"id": existing_id, "claude_task_id": task_id})
        return task
    return create_task(
        board,
        title=task_subject,
        description=task_description,
        bites=["Clarify the next concrete bite", "Do the smallest useful change", "Sync and review progress"],
        acceptance=["Task outcome is verified"],
        status="ready",
        priority=DEFAULT_PRIORITY,
        source="claude-code-hook",
        external_ids={namespace: task_id} if task_id else {},
    )


def hook_task_completed(board: Path, task_subject: str, task_description: str = "", task_id: str = "") -> Dict[str, Any]:
    state = load_state(board)
    namespace = "claude_task_id"
    local_id = find_task_by_external_id(state, namespace, task_id) if task_id else None
    if not local_id:
        local_id = find_task_by_title(state, task_subject)
    if local_id:
        return complete_task(board, local_id, note="Completed by Claude Code TaskCompleted hook")
    return create_task(
        board,
        title=task_subject,
        description=task_description,
        bites=["Completed externally"],
        acceptance=["Completion recorded by hook"],
        status="done",
        priority=DEFAULT_PRIORITY,
        source="claude-code-hook",
        external_ids={namespace: task_id} if task_id else {},
    )


def report(board: Path, as_json: bool = False) -> None:
    state = load_state(board)
    counts = {status: 0 for status in STATUSES}
    for task in state.get("tasks", {}).values():
        counts[coerce_status(task.get("status"))] += 1
    active = [task for task in state.get("tasks", {}).values() if task.get("status") not in {"done", "dropped"}]
    done = [task for task in state.get("tasks", {}).values() if task.get("status") == "done"]
    payload = {
        "project": state.get("project"),
        "goal": state.get("goal"),
        "updated_at": state.get("updated_at"),
        "counts": counts,
        "active": len(active),
        "done": len(done),
        "board": str(board),
    }
    if as_json:
        print(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True))
        return
    print(f"Eatahorse Board: {payload['project']}")
    print(f"Goal: {payload['goal'] or '-'}")
    print(f"Board: {board}")
    for status in STATUSES:
        print(f"  {status:8} {counts[status]}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="eatahorse",
        description="Create and maintain one-bite-at-a-time Kanban boards.",
    )
    parser.add_argument("--board", help="Path to .eatahorse board or project directory")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="Create a new .eatahorse board")
    p.add_argument("project", nargs="?", default="Eatahorse Project")
    p.add_argument("--goal", default="")
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("add", help="Add a task card")
    p.add_argument("title")
    p.add_argument("--description", "-d", default="")
    p.add_argument("--bite", action="append", help="Add a bite-sized step. Repeat or separate with semicolons.")
    p.add_argument("--accept", action="append", help="Add an acceptance check. Repeat or separate with semicolons.")
    p.add_argument("--status", default=DEFAULT_STATUS, choices=STATUSES)
    p.add_argument("--priority", default=DEFAULT_PRIORITY)
    p.add_argument("--owner", default="")
    p.add_argument("--tag", action="append", default=[])
    p.add_argument("--estimate", default="")
    p.add_argument("--external-id", action="append", default=[], help="External id as namespace:value")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("list", help="List tasks")
    p.add_argument("--status", choices=STATUSES)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("show", help="Show a task")
    p.add_argument("task")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("next", help="Show the next active task")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("move", help="Move a task to another status")
    p.add_argument("task")
    p.add_argument("status", choices=STATUSES)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("done", help="Mark a task done and check all bites")
    p.add_argument("task")
    p.add_argument("--note", default="")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("reopen", help="Reopen a card: uncheck acceptance, add the gap, move to doing")
    p.add_argument("task")
    p.add_argument("--gap", default="", help="What's missing (appended as a bite)")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("bite", help="Check or uncheck a bite/acceptance item")
    p.add_argument("task")
    p.add_argument("index", type=int)
    p.add_argument("--group", choices=["bites", "acceptance"], default="bites")
    mode = p.add_mutually_exclusive_group()
    # Both write to args.open so `done = not args.open` (in main) stays correct; --done is the
    # explicit default. (A store_true --done with default=True is a dead no-op: always truthy.)
    mode.add_argument("--done", dest="open", action="store_false")
    mode.add_argument("--open", dest="open", action="store_true")
    p.set_defaults(open=False)
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("add-bite", help="Append a bite or acceptance item")
    p.add_argument("task")
    p.add_argument("text")
    p.add_argument("--group", choices=["bites", "acceptance"], default="bites")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("remove", help="Drop or purge a task")
    p.add_argument("task")
    p.add_argument("--purge", action="store_true", help="Remove from state and delete markdown file")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("sync", help="Sync markdown task cards and state.json")
    p.add_argument("--quiet", action="store_true")

    p = sub.add_parser("report", help="Print a board report")
    p.add_argument("--json", action="store_true")

    return parser


def external_ids_from_args(values: List[str]) -> Dict[str, str]:
    ids: Dict[str, str] = {}
    for value in values:
        if ":" not in value:
            raise EatahorseError("--external-id must be namespace:value")
        namespace, ext = value.split(":", 1)
        namespace = namespace.strip()
        ext = ext.strip()
        if namespace and ext:
            ids[namespace] = ext
    return ids


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            board = resolve_board(args.board, require=False)
            state = init_board(board, args.project, goal=args.goal, force=args.force)
            print(f"Created Eatahorse board at {board}")
            print(f"Project: {state['project']}")
            return 0

        board = resolve_board(args.board, require=True)

        if args.command == "add":
            task = create_task(
                board,
                title=args.title,
                description=args.description,
                bites=split_lines(args.bite),
                acceptance=split_lines(args.accept),
                status=args.status,
                priority=args.priority,
                owner=args.owner,
                tags=args.tag,
                estimate=args.estimate,
                external_ids=external_ids_from_args(args.external_id),
            )
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else f"Added {task['id']}: {task['title']}")
        elif args.command == "list":
            list_tasks(board, status=args.status, as_json=args.json)
        elif args.command == "show":
            state = load_state(board)
            task_id = resolve_task_id(state, args.task)
            task = state["tasks"][task_id]
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else "", end="")
            if not args.json:
                print_task(task, board)
        elif args.command == "next":
            next_task(board, as_json=args.json)
        elif args.command == "move":
            task = move_task(board, args.task, args.status)
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else f"Moved {task['id']} to {task['status']}")
        elif args.command == "done":
            task = complete_task(board, args.task, note=args.note)
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else f"Done {task['id']}: {task['title']}")
        elif args.command == "reopen":
            task = reopen_task(board, args.task, gap=args.gap)
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else f"Reopened {task['id']} -> {task['status']}")
        elif args.command == "bite":
            task = set_checkbox(board, args.task, args.index, done=not args.open, group=args.group)
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else f"Updated {args.group} {args.index} on {task['id']}")
        elif args.command == "add-bite":
            task = add_bite(board, args.task, args.text, group=args.group)
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else f"Added {args.group[:-1]} to {task['id']}")
        elif args.command == "remove":
            task = remove_task(board, args.task, purge=args.purge)
            action = "Purged" if args.purge else "Dropped"
            print(json.dumps(task, indent=2, ensure_ascii=False, sort_keys=True) if args.json else f"{action} {task['id']}: {task.get('title')}")
        elif args.command == "sync":
            sync_board(board, quiet=args.quiet)
        elif args.command == "report":
            report(board, as_json=args.json)
        else:
            parser.error(f"Unknown command: {args.command}")
        return 0
    except EatahorseError as exc:
        print(f"eatahorse: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
