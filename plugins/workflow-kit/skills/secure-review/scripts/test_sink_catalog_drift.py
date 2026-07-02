"""Drift guard: `SINK_CATALOG` in security-audit.js (runtime source, injected into every lane prompt)
is mirrored by hand as the "### Sink/source catalog" section in secure-review/SKILL.md (the portable
copy, .claude/rules/workflow-design.md — workflow stages don't auto-load skills). The two must name the
same category labels, in the same order, or the human-facing skill doc silently drifts from what lanes
actually see. Stdlib only: `python3 test_sink_catalog_drift.py`.

Dev-only: reaches up to the repo's .claude/workflows/. If that dir isn't found (the bundled/installed
skill copy), the test SKIPs cleanly rather than failing.
"""
import re
import sys
from pathlib import Path


def repo_root():
    """Walk up from this file until we find the dir holding .claude/workflows."""
    for p in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        if (p / ".claude" / "workflows").is_dir():
            return p
    return None


def workflow_categories(js_path):
    r"""Lowercase category labels inside `const SINK_CATALOG = \`...\` + \`...\`` (a template-literal
    string built by concatenation, one category per backtick-quoted segment: `  category: ...`)."""
    src = js_path.read_text(encoding="utf-8")
    m = re.search(r"const SINK_CATALOG =\n((?:\s*`[^\n]*`\s*\+?\n)+)", src)
    if not m:
        return None
    return re.findall(r"`\s\s([a-zA-Z/]+):\s", m.group(1))


def skill_categories(md_path):
    """Bold bullet-list category labels under the "### Sink/source catalog" section of SKILL.md
    (`- **Label** — ...`), lowercased for comparison against the workflow's inline labels. Stops at
    the next markdown heading of any level, not just a sibling `###`."""
    src = md_path.read_text(encoding="utf-8")
    m = re.search(r"### Sink/source catalog.*?\n(.*?)(?:\n#{1,6} |\Z)", src, re.DOTALL)
    if not m:
        return None
    return [label.lower() for label in re.findall(r"^- \*\*([^*]+)\*\*", m.group(1), re.MULTILINE)]


def test_categories_match():
    root = repo_root()
    if root is None:
        print("SKIP: no .claude/workflows (installed skill copy); drift test is dev-only.")
        return
    js_path = root / ".claude/workflows/security-audit.js"
    md_path = root / "plugins/workflow-kit/skills/secure-review/SKILL.md"
    assert js_path.is_file(), f"missing: {js_path}"
    assert md_path.is_file(), f"missing: {md_path}"

    js_cats = workflow_categories(js_path)
    md_cats = skill_categories(md_path)
    assert js_cats, "security-audit.js: expected a `const SINK_CATALOG = ...` block, found none"
    assert md_cats, "secure-review/SKILL.md: expected a '### Sink/source catalog' bullet list, found none"
    assert "injection" in js_cats and "injection" in md_cats, (
        f"category parse looks wrong: js={js_cats} md={md_cats}"
    )

    assert js_cats == md_cats, (
        f"security-audit.js SINK_CATALOG categories {js_cats} != secure-review/SKILL.md "
        f"Sink/source catalog categories {md_cats}. Edit SINK_CATALOG, then hand-sync the SKILL.md "
        f"bullet list (labels AND order) to match."
    )
    print(f"  {len(js_cats)} categories in sync: {js_cats}")


def main():
    tests = [test_categories_match]
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
