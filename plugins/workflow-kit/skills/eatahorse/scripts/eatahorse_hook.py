#!/usr/bin/env python3
"""Claude Code hook bridge for Eatahorse.

Reads Claude Code hook JSON from stdin and keeps the nearest .eatahorse board in sync.
This script is intentionally quiet on success: Claude Code treats empty stdout + exit 0
as "no decision; continue normally".
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

try:
    import eatahorse  # type: ignore
except Exception as exc:  # pragma: no cover - hook must fail open
    if os.environ.get("EATAHORSE_HOOK_DEBUG"):
        print(f"Eatahorse hook import failed: {exc}", file=sys.stderr)
    raise SystemExit(0)


def debug(message: str) -> None:
    if os.environ.get("EATAHORSE_HOOK_DEBUG"):
        print(f"[eatahorse-hook] {message}", file=sys.stderr)


def read_input() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        debug("invalid hook JSON")
        return {}


def cwd_from_event(event: Dict[str, Any]) -> Path:
    cwd = event.get("cwd") or os.getcwd()
    try:
        return Path(str(cwd)).expanduser().resolve()
    except Exception:
        return Path.cwd()


def board_from_event(event: Dict[str, Any]) -> Optional[Path]:
    return eatahorse.find_board(cwd_from_event(event))


def autosync_disabled() -> bool:
    # Escape hatch for parallel workflows (e.g. eatahorse-research) whose single-writer invariant a
    # concurrent hook-triggered sync_board would violate. Only gates the AUTOMATIC sync paths;
    # TaskCreated/TaskCompleted stay active.
    return bool(os.environ.get("EATAHORSE_NO_AUTOSYNC"))


def sync_if_board(event: Dict[str, Any]) -> None:
    if autosync_disabled():
        return
    board = board_from_event(event)
    if not board:
        return
    eatahorse.sync_board(board, quiet=True)


def handle_task_created(event: Dict[str, Any]) -> None:
    board = board_from_event(event)
    if not board:
        return
    subject = str(event.get("task_subject") or "").strip()
    if not subject:
        return
    eatahorse.hook_task_created(
        board,
        task_subject=subject,
        task_description=str(event.get("task_description") or ""),
        task_id=str(event.get("task_id") or ""),
    )


def handle_task_completed(event: Dict[str, Any]) -> None:
    board = board_from_event(event)
    if not board:
        return
    subject = str(event.get("task_subject") or "").strip()
    if not subject:
        return
    eatahorse.hook_task_completed(
        board,
        task_subject=subject,
        task_description=str(event.get("task_description") or ""),
        task_id=str(event.get("task_id") or ""),
    )


def main() -> int:
    event = read_input()
    name = str(event.get("hook_event_name") or "")
    try:
        # PostToolUse auto-sync was removed: it wrote the board on every edit, violating the
        # single-writer invariant the workflows rely on. Board markdown reconciles into state.json
        # on Stop/SessionEnd or an explicit `sync` instead.
        if name == "TaskCreated":
            handle_task_created(event)
        elif name == "TaskCompleted":
            handle_task_completed(event)
        elif name in {"Stop", "SubagentStop", "SessionEnd"}:
            sync_if_board(event)
        return 0
    except Exception as exc:  # fail open; hooks should not interrupt work tracking
        debug(f"hook failed open: {exc}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
