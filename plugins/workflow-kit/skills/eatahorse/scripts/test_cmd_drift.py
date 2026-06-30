"""Drift guard: the hand-synced inline `CMD` maps in the workflow .js files must only advertise verbs
that actually exist in eatahorse.py's argparse. Three copies are kept by hand (eatahorse-plan.js,
eatahorse-execute.js, docs-from-code.js); a renamed/removed CLI verb would otherwise break a workflow
SILENTLY at run time. Stdlib only: `python3 test_cmd_drift.py`.

Dev-only: reaches up to the repo's .claude/workflows/. If that dir isn't found (the bundled/installed
skill copy), the test SKIPs cleanly rather than failing.

NOTE: eatahorse.js (the thin orchestrator) has no CMD map — it delegates to plan/execute via
workflow(). docs-from-code.js still carries its own CMD map until its planned refactor.
"""
import re
import sys
from pathlib import Path

# Each CMD value's FIRST token is the verb (e.g. `dep-add <id> ...`, `report --json`). We assert the
# value tokens, NOT the map keys (keys like `depadd`/`addbite` deliberately differ from `dep-add`/`add-bite`).
WORKFLOWS = ["eatahorse-plan.js", "eatahorse-execute.js", "docs-from-code.js"]


def repo_root():
    """Walk up from this file until we find the dir holding .claude/workflows."""
    for p in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        if (p / ".claude" / "workflows").is_dir():
            return p
    return None


def eatahorse_verbs(py_path):
    """The authoritative verb set: every sub.add_parser("<verb>", ...) in eatahorse.py."""
    src = py_path.read_text(encoding="utf-8")
    return set(re.findall(r'add_parser\(\s*"([a-z][a-z-]*)"', src))


def cmd_verbs(js_path):
    """First token of every backtick value inside the `const CMD = { ... }` block of a workflow file.

    Returns [(key, verb), ...]. Empty list if the file has no CMD map (then it's not a sync copy)."""
    src = js_path.read_text(encoding="utf-8")
    m = re.search(r"const CMD = \{(.*?)\n\}", src, re.DOTALL)
    if not m:
        return []
    out = []
    # key: `verb rest...`  -> capture key and the leading verb token inside the backtick.
    for key, verb in re.findall(r"^\s*([A-Za-z]\w*):\s*`([a-z][a-z-]*)", m.group(1), re.MULTILINE):
        out.append((key, verb))
    return out


def test_every_advertised_verb_exists():
    root = repo_root()
    if root is None:
        print("SKIP: no .claude/workflows (installed skill copy); drift test is dev-only.")
        return
    verbs = eatahorse_verbs(root / "plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py")
    assert "add" in verbs and "dep-add" in verbs, f"verb parse looks wrong: {sorted(verbs)}"
    checked = 0
    for name in WORKFLOWS:
        js = root / ".claude/workflows" / name
        assert js.is_file(), f"workflow missing: {js}"
        pairs = cmd_verbs(js)
        assert pairs, f"{name}: expected a `const CMD = {{...}}` map, found none (sync copy moved?)"
        for key, verb in pairs:
            assert verb in verbs, (
                f"{name}: CMD.{key} advertises verb '{verb}' which is NOT an eatahorse.py subcommand. "
                f"Known verbs: {sorted(verbs)}"
            )
            checked += 1
    print(f"  checked {checked} CMD entries across {len(WORKFLOWS)} workflows against {len(verbs)} verbs")


def main():
    tests = [test_every_advertised_verb_exists]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} pass")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
