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


def test_two_acceptance_gate_tick_completes():
    # docs-from-code #1 (grounding-as-board-fact): a page card carries TWO acceptance items —
    # [1] "page written" (author ticks), [2] "grounding verified by gate" (gate ticks). The card is
    # NOT done until BOTH are ticked, so admitted ⇔ gate-verified. Indexing is 1-BASED (the workflow
    # gate runs `bite <id> 2`); ticking item 1 alone must NOT complete the card.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(
            board, "page.md", bites=["author it"],
            acceptance=["page written from source", "grounding verified by gate"], status="backlog")
        tid = task["id"]
        # author ticks ONLY item 1 -> still awaiting grounding (not done).
        eh.set_checkbox(board, tid, 1, done=True, group="acceptance")
        assert eh.load_state(board)["tasks"][tid]["status"] != "done", \
            "author ticking 'page written' alone must NOT complete the card"
        # gate ticks item 2 (1-based) -> both met -> done.
        eh.set_checkbox(board, tid, 2, done=True, group="acceptance")
        assert eh.load_state(board)["tasks"][tid]["status"] == "done", \
            "ticking the grounding item (index 2) completes the card"


def test_notes_json_block_roundtrips():
    # Port mode (EH-PORT-02): the structured extraction record lives as a fenced ```json block in the
    # FREEFORM "## Notes" — no schema/CLI change. It must survive sync verbatim (same path the prose
    # roundtrip test exercises), so the Graph phase can parse it back off the board.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(board, "src/a.py", bites=["b"], acceptance=["a"], status="doing")
        path = eh.canonical_task_path(board, task)
        block = '```json\n{"path": "src/a.py", "exports": [], "deps": ["src/b.py"], "entryPoint": false}\n```'
        text = path.read_text(encoding="utf-8").replace("## Notes\n", f"## Notes\nprose here.\n{block}\n", 1)
        path.write_text(text, encoding="utf-8")
        eh.sync_board(board, quiet=True)
        eh.sync_board(board, quiet=True)  # twice: catch footer/section pollution that grows per sync
        notes = eh.load_state(board)["tasks"][task["id"]]["notes"]
        assert '"deps": ["src/b.py"]' in notes, f"json block lost in notes roundtrip: {notes!r}"
        assert notes.count("```json") == 1, f"fenced block fence dropped or duplicated: {notes!r}"


def test_external_id_survives_sync():
    # Port cards link back to their source unit via external_ids (EH-PORT-01 join key). external_ids
    # lives in state.json, NOT card frontmatter; sync preserves it from existing state (setdefault at
    # eatahorse.py:819). It must round-trip across syncs, and the CLI must parse namespace:value.
    assert eh.external_ids_from_args(["source:src/a.py"]) == {"source": "src/a.py"}, \
        "split(':', 1) keeps a path value with no namespace collision"
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(board, "Port src/a.py", bites=["b"], acceptance=["a"],
                              status="ready", external_ids={"source": "src/a.py"})
        eh.sync_board(board, quiet=True)
        eh.sync_board(board, quiet=True)
        assert eh.load_state(board)["tasks"][task["id"]]["external_ids"] == {"source": "src/a.py"}, \
            "external_ids must survive sync (state-merge setdefault, not frontmatter)"


def test_priority_bands_topo_order():
    # Port mode orders cards by a ZERO-PADDED priority band so eatahorse's LEXICAL priority sort equals
    # dependency (topo) order: P00=leaf is picked first. The zero-pad is the whole point — without it
    # "P10" sorts BEFORE "P2" under string comparison, which would port a deep unit before a shallow one.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        eh.create_task(board, "dependent", bites=["b"], status="ready", priority="P01")
        eh.create_task(board, "leaf", bites=["b"], status="ready", priority="P00")
        assert eh.next_task(board)["title"] == "leaf", "lowest band (P00=leaf) is picked first by next"
    assert "P10" < "P2", "lexical sort: P10 precedes P2 (the gotcha zero-padding avoids)"
    assert "P02" < "P10", "zero-padded bands sort numerically: P02 before P10"


def test_depends_on_roundtrips(): # EH-PORT-10
    # depends_on is a first-class edge stored IN frontmatter (unlike state-only external_ids), so a
    # hand-edited list survives sync. --depends-on normalizes ids (bare `2` -> EH-0002).
    assert eh.build_parser().parse_args(["add", "x", "--depends-on", "EH-0001"]).depends_on == ["EH-0001"]
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        a = eh.create_task(board, "leaf", bites=["b"], status="ready")
        b = eh.create_task(board, "dependent", bites=["b"], status="ready", depends_on=[a["id"], "2"])
        assert b["depends_on"] == [a["id"], "EH-0002"], f"normalized at create: {b['depends_on']}"
        eh.sync_board(board, quiet=True)
        eh.sync_board(board, quiet=True)  # twice: catch frontmatter pollution that grows per sync
        got = eh.load_state(board)["tasks"][b["id"]]["depends_on"]
        assert got == [a["id"], "EH-0002"], f"depends_on must survive sync via frontmatter: {got}"


def test_would_cycle_and_dep_add(): # EH-PORT-11
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        a = eh.create_task(board, "A", bites=["b"], status="ready")["id"]
        b = eh.create_task(board, "B", bites=["b"], status="ready")["id"]
        c = eh.create_task(board, "C", bites=["b"], status="ready")["id"]
        d_ = eh.create_task(board, "D", bites=["b"], status="ready")["id"]
        eh.add_dep(board, b, a)  # B depends on A
        eh.add_dep(board, c, b)  # C depends on B  -> chain A<-B<-C (C transitively depends on A)
        state = eh.load_state(board)
        assert not eh.would_cycle(state, a, d_), "A depending on independent D does not cycle"
        assert eh.would_cycle(state, a, c), "A depending on C cycles (C->B->A already reaches A)"
        assert eh.would_cycle(state, a, b), "A depending on B cycles (B already reaches A)"
        assert eh.would_cycle(state, a, a), "self-loop is a cycle"
        # the CLI rejects a back-edge nonzero
        rc = eh.main(["--board", str(board), "dep-add", a, "--on", c])
        assert rc != 0, "dep-add of a cycling back-edge must return nonzero"
        # downstream/upstream view
        deps = eh.show_deps(board, b)
        assert deps["depends_on"] == [a] and deps["blocks"] == [c], f"deps view: {deps}"


def test_deps_gate_next(): # EH-PORT-12
    # next must skip a card whose dep is not yet done, regardless of priority, then offer it once
    # the dep completes. Equal priority isolates the dep gate from the priority tiebreak.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        a = eh.create_task(board, "A", bites=["b"], acceptance=["a"], status="ready", priority="P1")["id"]
        b = eh.create_task(board, "B", bites=["b"], status="ready", priority="P0", depends_on=[a])["id"]
        # B has the better priority but depends on A (still ready) -> next picks A.
        assert eh.next_task(board)["id"] == a, "dep-blocked B is skipped; A offered first"
        eh.complete_task(board, a)  # A done
        assert eh.next_task(board)["id"] == b, "B offered once its dep A is done"
        # dangling edge: a dep pointing at a purged card is treated satisfied (no deadlock).
        c = eh.create_task(board, "C", bites=["b"], status="ready", depends_on=["EH-9999"])["id"]
        summary = eh.sync_board(board, quiet=True)
        assert summary["dangling_deps"] >= 1, "sync reports the dangling edge"


def test_equivalence_block_roundtrips(): # EH-PORT-13
    # The graded equivalence record rides the SAME freeform ```json Notes channel as the extraction block —
    # no schema/CLI change. It must survive sync verbatim so synthesis can read method/confidence/counterexamples.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        task = eh.create_task(board, "Port src/a.py", bites=["b"], acceptance=["a"], status="doing")
        path = eh.canonical_task_path(board, task)
        block = ('equivalence:\n```json\n'
                 '{"method": "differential", "cases": 1000, "counterexamples": 0, '
                 '"coverage": null, "confidence": "medium", "caveats": ["sampled, not a proof"]}\n```')
        text = path.read_text(encoding="utf-8").replace("## Notes\n", f"## Notes\n{block}\n", 1)
        path.write_text(text, encoding="utf-8")
        eh.sync_board(board, quiet=True)
        eh.sync_board(board, quiet=True)
        notes = eh.load_state(board)["tasks"][task["id"]]["notes"]
        assert '"confidence": "medium"' in notes, f"equivalence record lost in roundtrip: {notes!r}"
        assert notes.count("```json") == 1, f"fence dropped or duplicated: {notes!r}"


def test_board_lock_serializes_concurrent_writes(): # EH-PORT-16
    # Two concurrent `add` CLI processes against one board must both land. Without the dispatch lock
    # the load->mutate->save races and one write clobbers the other (next_id collision / lost card).
    import subprocess
    if eh.fcntl is None:
        print("ok  test_board_lock_serializes_concurrent_writes (skipped: no fcntl)")
        return
    script = str(Path(__file__).resolve().parent / "eatahorse.py")
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        procs = [
            subprocess.Popen([sys.executable, script, "--board", str(board), "add", f"card-{i}"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for i in range(6)
        ]
        for p in procs:
            assert p.wait() == 0
        titles = {t["title"] for t in eh.load_state(board)["tasks"].values()}
        assert titles == {f"card-{i}" for i in range(6)}, f"a concurrent write was clobbered: {sorted(titles)}"


def test_remove_dep_by_title_and_dangling(): # EH-PORT-11b
    # remove_dep must resolve --on the SAME way add_dep stored it: a dep added by TITLE is removable by
    # title (the resolver-divergence bug: dep-rm used normalize_dep_id and silently no-oped on a title ref).
    # A dangling edge (to a purged card) must still be unlinkable via the normalize fallback.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        leaf = eh.create_task(board, "leaf", bites=["b"], status="ready")["id"]
        dep = eh.create_task(board, "dependent", bites=["b"], status="ready")["id"]
        eh.add_dep(board, dep, "leaf")  # add BY TITLE -> stores resolved id
        assert eh.load_state(board)["tasks"][dep]["depends_on"] == [leaf]
        task, removed = eh.remove_dep(board, dep, "leaf")  # remove BY TITLE
        assert removed == leaf, f"dep-rm must resolve the title to {leaf}, got {removed}"
        assert eh.load_state(board)["tasks"][dep]["depends_on"] == [], "edge must actually be removed"
        # dangling edge to a purged card: still removable via the normalize fallback.
        dang = eh.create_task(board, "dang", bites=["b"], status="ready", depends_on=["EH-9999"])["id"]
        _, removed2 = eh.remove_dep(board, dang, "EH-9999")
        assert removed2 == "EH-9999" and eh.load_state(board)["tasks"][dang]["depends_on"] == []


def test_depends_on_dedups(): # EH-PORT-10b
    # Two aliases for the same card (canonical + bare number) must collapse to one stored edge on create
    # and survive sync without growing duplicates.
    with tempfile.TemporaryDirectory() as d:
        board = Path(d) / ".eatahorse"
        eh.init_board(board, "Test")
        eh.create_task(board, "leaf", bites=["b"], status="ready")  # EH-0001
        b = eh.create_task(board, "dependent", bites=["b"], status="ready", depends_on=["EH-0001", "1"])
        assert b["depends_on"] == ["EH-0001"], f"aliases must dedup at create: {b['depends_on']}"
        eh.sync_board(board, quiet=True)
        assert eh.load_state(board)["tasks"][b["id"]]["depends_on"] == ["EH-0001"]


def main():
    tests = [
        test_bite_done_open_flag,
        test_parse_scalar_lists,
        test_sync_reconciles_next_id,
        test_doneness_derived_from_acceptance,
        test_move_done_unmet_reverts,
        test_reopen_verb,
        test_next_excludes_blocked,
        test_two_acceptance_gate_tick_completes,
        test_notes_roundtrip_no_footer_pollution,
        test_notes_empty_roundtrips_blank,
        test_move_done_empty_card_sticks,
        test_notes_json_block_roundtrips,
        test_external_id_survives_sync,
        test_priority_bands_topo_order,
        test_depends_on_roundtrips,
        test_would_cycle_and_dep_add,
        test_deps_gate_next,
        test_equivalence_block_roundtrips,
        test_board_lock_serializes_concurrent_writes,
        test_remove_dep_by_title_and_dangling,
        test_depends_on_dedups,
    ]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    main()
