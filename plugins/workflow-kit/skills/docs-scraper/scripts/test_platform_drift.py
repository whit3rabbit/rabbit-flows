"""Drift guard: docs-migrate.js hand-copies a subset of docs-scrape.js's `SELECTORS` map (source-platform
CSS selectors). A platform added to docs-scrape.js's SELECTORS should also land in docs-migrate.js's
copy (or be explicitly excluded here with a reason) so migration sources stay in sync with scrape
sources. Stdlib only: `python3 test_platform_drift.py`.

Dev-only: reaches up to the repo's .claude/workflows/. If that dir isn't found (the bundled/installed
skill copy), the test SKIPs cleanly rather than failing.
"""
import re
import sys
from pathlib import Path

# fumadocs is deliberately absent from docs-migrate.js: its `from:` arg never offered fumadocs as a
# migration SOURCE (see docs-migrate.js's args header comment), so there is no card class needing it.
KNOWN_EXCLUDED = {"fumadocs"}


def repo_root():
    """Walk up from this file until we find the dir holding .claude/workflows."""
    for p in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        if (p / ".claude" / "workflows").is_dir():
            return p
    return None


def selectors_keys(js_path):
    """Top-level keys of the `const SELECTORS = { ... }` object literal in a workflow file.

    Each value is a same-line `{ ... }` object, so a non-greedy match up to the first `\\n}` correctly
    finds SELECTORS's own closing brace (no nested multi-line braces to trip on)."""
    src = js_path.read_text(encoding="utf-8")
    m = re.search(r"const SELECTORS = \{(.*?)\n\}", src, re.DOTALL)
    if not m:
        return None
    return set(re.findall(r"^\s*([a-zA-Z_]\w*):\s*\{", m.group(1), re.MULTILINE))


def test_migrate_selectors_subset_of_scrape():
    root = repo_root()
    if root is None:
        print("SKIP: no .claude/workflows (installed skill copy); drift test is dev-only.")
        return
    scrape_js = root / ".claude/workflows/docs-scrape.js"
    migrate_js = root / ".claude/workflows/docs-migrate.js"
    assert scrape_js.is_file(), f"missing: {scrape_js}"
    assert migrate_js.is_file(), f"missing: {migrate_js}"

    scrape_keys = selectors_keys(scrape_js)
    migrate_keys = selectors_keys(migrate_js)
    assert scrape_keys, f"docs-scrape.js: expected a `const SELECTORS = {{...}}` map, found none"
    assert migrate_keys, f"docs-migrate.js: expected a `const SELECTORS = {{...}}` map, found none"
    assert "starlight" in scrape_keys and "starlight" in migrate_keys, (
        f"key parse looks wrong: scrape={sorted(scrape_keys)} migrate={sorted(migrate_keys)}"
    )

    expected_migrate = scrape_keys - KNOWN_EXCLUDED
    missing = expected_migrate - migrate_keys
    assert not missing, (
        f"docs-migrate.js's SELECTORS is missing platform(s) {sorted(missing)} that docs-scrape.js has "
        f"and are not in KNOWN_EXCLUDED={sorted(KNOWN_EXCLUDED)}. Refresh docs-migrate.js's SELECTORS "
        f"(and its `from:` header comment) or add the platform to KNOWN_EXCLUDED with a reason."
    )
    extra = migrate_keys - scrape_keys
    assert not extra, (
        f"docs-migrate.js's SELECTORS has platform(s) {sorted(extra)} that docs-scrape.js does NOT have "
        f"— migrate should stay a subset of scrape's platform coverage."
    )
    print(f"  scrape SELECTORS: {len(scrape_keys)} platforms; migrate SELECTORS: {len(migrate_keys)} "
          f"platforms; excluded: {sorted(KNOWN_EXCLUDED)}")


def test_migrate_from_comment_matches_selectors_keys():
    root = repo_root()
    if root is None:
        print("SKIP: no .claude/workflows (installed skill copy); drift test is dev-only.")
        return
    migrate_js = root / ".claude/workflows/docs-migrate.js"
    src = migrate_js.read_text(encoding="utf-8")
    m = re.search(r"//\s*from:\s*string\s*\(required\)\s*source framework:\s*([\w|]+)", src)
    assert m, "docs-migrate.js: could not find the `from:` header comment line"
    comment_keys = set(m.group(1).split("|"))
    selector_keys = selectors_keys(migrate_js)
    assert selector_keys, "docs-migrate.js: expected a `const SELECTORS = {...}` map, found none"
    assert comment_keys == selector_keys, (
        f"docs-migrate.js's `from:` header comment lists {sorted(comment_keys)} but SELECTORS keys are "
        f"{sorted(selector_keys)} — keep the prose comment in sync with the actual supported platforms."
    )


def main():
    tests = [test_migrate_selectors_subset_of_scrape, test_migrate_from_comment_matches_selectors_keys]
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
