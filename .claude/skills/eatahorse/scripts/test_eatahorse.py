#!/usr/bin/env python3
"""Self-checks for the eatahorse review fixes. Stdlib only: `python3 test_eatahorse.py`."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eatahorse as eh  # noqa: E402


def test_bite_done_open_flag():
    # #1: --done and --open both drive args.open; `done = not args.open` stays correct.
    p = eh.build_parser()
    assert p.parse_args(["bite", "EH-0001", "1"]).open is False, "default must be --done (open False)"
    assert p.parse_args(["bite", "EH-0001", "1", "--open"]).open is True
    assert p.parse_args(["bite", "EH-0001", "1", "--done"]).open is False


def test_parse_scalar_lists():
    # #5: hand-edited YAML-ish list splits; valid JSON still wins.
    assert eh.parse_scalar("[security, auth]") == ["security", "auth"]
    assert eh.parse_scalar('["a", "b"]') == ["a", "b"]
    assert eh.parse_scalar('"plain"') == "plain"


def test_sync_reconciles_next_id():
    # #4: a hand-created higher id bumps next_id on sync.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        card = board / "tasks" / "ready" / "EH-0050-manual.md"
        card.parent.mkdir(parents=True, exist_ok=True)
        card.write_text(
            '---\nid: "EH-0050"\ntitle: "Manual card"\nstatus: "ready"\n---\n'
            "# EH-0050: Manual card\n\n## One-bite-at-a-time plan\n- [ ] do it\n"
            "\n## Acceptance checks\n- [ ] proven\n",
            encoding="utf-8",
        )
        eh.sync_board(board, quiet=True)
        state = eh.load_state(board)
        assert state["next_id"] == 51, f"next_id should reconcile to 51, got {state['next_id']}"


def _make_done_card(board):
    task = eh.create_task(board, "Card", bites=["b"], acceptance=["a"], status="doing")
    eh.set_checkbox(board, task["id"], 1, done=True, group="bites")
    eh.set_checkbox(board, task["id"], 1, done=True, group="acceptance")
    assert eh.load_state(board)["tasks"][task["id"]]["status"] == "done"
    return task["id"]


def test_doneness_derived_from_acceptance():
    # G: acceptance is the only doneness signal; status is derived two-way. Adding an unmet
    # acceptance item reverts a done card; bites are progress and do not gate doneness.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        tid = _make_done_card(board)  # done
        eh.add_bite(board, tid, "also prove X", group="acceptance")  # unchecked acceptance item
        assert eh.load_state(board)["tasks"][tid]["status"] == "doing", \
            "unmet acceptance on a done card must revert to doing"
        eh.add_bite(board, tid, "extra work", group="bites")  # open bite must not block doneness
        eh.set_checkbox(board, tid, 2, done=True, group="acceptance")
        assert eh.load_state(board)["tasks"][tid]["status"] == "done", \
            "all acceptance met -> done even with an open bite"


def test_move_done_unmet_reverts():
    # G: `move <id> done` with unmet acceptance does not stick (status derived from acceptance).
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(board, "Card", bites=["b"], acceptance=["a"], status="doing")
        moved = eh.move_task(board, task["id"], "done")
        assert moved["status"] == "doing", "move done with unmet acceptance must revert to doing"


def test_reopen_verb():
    # A: reopen unchecks all acceptance, appends the gap as a bite, moves to doing — atomically.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        tid = _make_done_card(board)
        n_bites = len(eh.load_state(board)["tasks"][tid]["bites"])
        task = eh.reopen_task(board, tid, gap="missing the thing")
        assert task["status"] == "doing", "reopen -> doing"
        assert all(not it["done"] for it in task["acceptance"]), "reopen unchecks all acceptance"
        assert len(task["bites"]) == n_bites + 1, "gap appended as a bite"
        assert any("missing the thing" in it["text"] for it in task["bites"]), "gap text present"
        assert eh.build_parser().parse_args(["reopen", "EH-0001", "--gap", "x"]).gap == "x", \
            "reopen is in the CLI surface"


def test_next_excludes_blocked():
    # B: a blocked card is never auto-picked by next.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(board, "Parked", bites=["b"], status="ready")
        eh.move_task(board, task["id"], "blocked")
        assert eh.next_task(board) is None, "blocked-only board has no next task"


def test_notes_roundtrip_no_footer_pollution():
    # Footer bug: extract_section's lookahead ran to EOF on the last section (## Notes) and
    # swallowed the trailing <!-- Eatahorse --> footer into notes; task_markdown then re-emitted
    # that AND appended a fresh footer, so notes + footer grew on every sync.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(board, "Card", bites=["b"], acceptance=["a"], status="doing")
        path = eh.canonical_task_path(board, task)
        # simulate an agent/human writing a real note under ## Notes
        text = path.read_text(encoding="utf-8").replace(
            "## Notes\n", "## Notes\nauth.py: validates token\n", 1)
        path.write_text(text, encoding="utf-8")
        eh.sync_board(board, quiet=True)
        eh.sync_board(board, quiet=True)
        t = eh.load_state(board)["tasks"][task["id"]]
        assert t["notes"] == "auth.py: validates token", f"notes polluted: {t['notes']!r}"
        assert "<!-- Eatahorse" not in t["notes"], "footer leaked into notes"
        rendered = eh.canonical_task_path(board, t).read_text(encoding="utf-8")
        assert rendered.count("<!-- Eatahorse:") == 1, "footer duplicated in rendered card"


def test_notes_empty_roundtrips_blank():
    # The footer strip must not turn a genuinely empty Notes section into footer text.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(board, "Card", bites=["b"], status="doing")
        eh.sync_board(board, quiet=True)
        eh.sync_board(board, quiet=True)
        assert eh.load_state(board)["tasks"][task["id"]]["notes"] == "", "empty notes must stay empty"


def test_move_done_empty_card_sticks():
    # An all-empty card (no bites, no acceptance) is reachable by syncing a hand-authored card.
    # `move done` must stick and survive a re-sync: terminal cards render no placeholder bite,
    # so the empty checklist round-trips to [] instead of re-gaining a bite that reverts it.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        card = board / "tasks" / "ready" / "EH-0050-empty.md"
        card.parent.mkdir(parents=True, exist_ok=True)
        card.write_text(
            '---\nid: "EH-0050"\ntitle: "Empty card"\nstatus: "ready"\n---\n'
            "# EH-0050: Empty card\n\n## One-bite-at-a-time plan\n\n## Acceptance checks\n\n## Notes\n\n",
            encoding="utf-8",
        )
        eh.sync_board(board, quiet=True)
        assert eh.move_task(board, "EH-0050", "done")["status"] == "done", \
            "move done on an empty card must stick"
        eh.sync_board(board, quiet=True)
        assert eh.load_state(board)["tasks"]["EH-0050"]["status"] == "done", \
            "empty done card must stay done across re-sync"


def main():
    tests = [
        test_bite_done_open_flag,
        test_parse_scalar_lists,
        test_sync_reconciles_next_id,
        test_doneness_derived_from_acceptance,
        test_move_done_unmet_reverts,
        test_reopen_verb,
        test_next_excludes_blocked,
        test_notes_roundtrip_no_footer_pollution,
        test_notes_empty_roundtrips_blank,
        test_move_done_empty_card_sticks,
    ]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    main()
