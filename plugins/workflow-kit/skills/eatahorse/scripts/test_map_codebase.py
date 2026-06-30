#!/usr/bin/env python3
"""Tests for map_codebase.py — stdlib only, no framework."""
import json
import os
import sys
import tempfile
from pathlib import Path

# Ensure the script dir is on path so we can import
_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))

import map_codebase  # noqa: E402  (our module)


def make_tree(base: Path, files: list[dict]):
    """Create a temporary directory tree. Each entry: {path: str, content: str}."""
    for entry in files:
        p = base / entry["path"]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(entry.get("content", ""))


def test_walks_simple_tree():
    """Should find .py and .js files in a flat tree."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "main.py", "content": "import os\n\ndef hello():\n    pass\n"},
            {"path": "utils.py", "content": "from pathlib import Path\n\nclass Helper:\n    pass\n"},
            {"path": "readme.md", "content": "# ignored\n"},
            {"path": "data.bin", "content": "\x00\x01\x02"},
        ])
        result = map_codebase.explore(base, max_files=100, include=None, exclude=None)
        assert result["stats"]["total"] == 3, f"expected 3 source files, got {result['stats']['total']} (main.py, utils.py, readme.md)"
        paths = {f["path"] for f in result["files"]}
        assert "main.py" in paths, f"main.py missing: {paths}"
        assert "utils.py" in paths
        assert "readme.md" in paths, "readme.md should be tracked (basic metadata)"
        assert "data.bin" not in paths, "binary shouldn't be tracked"


def test_skips_dot_git():
    """Should skip .git and node_modules."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "main.py", "content": "x = 1\n"},
            {"path": ".git/HEAD", "content": "ref: main\n"},
            {"path": "node_modules/lodash/index.js", "content": "module.exports = {}\n"},
            {"path": "src/app.py", "content": "def run(): pass\n"},
        ])
        result = map_codebase.explore(base, max_files=100, include=None, exclude=None)
        paths = {f["path"] for f in result["files"]}
        assert "main.py" in paths
        assert "src/app.py" in paths
        assert ".git/HEAD" not in paths
        assert "node_modules/lodash/index.js" not in paths
        assert result["stats"]["total"] == 2, f"expected 2, got {result['stats']['total']}"


def test_detects_python_imports():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "server.py", "content": "import os, sys\nfrom pathlib import Path\nfrom . import utils\n"},
        ])
        result = map_codebase.explore(base, max_files=100, include=None, exclude=None)
        f = result["files"][0]
        assert "os" in f["imports"], f"os missing: {f['imports']}"
        assert "sys" in f["imports"], f"sys missing (multi-import?): {f['imports']}"
        assert "pathlib" in f["imports"], f"pathlib missing: {f['imports']}"
        # Relative imports must not produce a bare "/" (normalization must skip them)
        assert "/" not in f["imports"], f"relative import normalized to '/' (bug): {f['imports']}"
        # The relative import should appear as-is (starts with '.')
        assert any(i.startswith(".") for i in f["imports"]), f"relative import missing: {f['imports']}"


def test_detects_python_exports():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "app.py", "content": "def run():\n    pass\n\nclass Handler:\n    pass\n\nasync def process():\n    pass\n"},
        ])
        result = map_codebase.explore(base, max_files=100, include=None, exclude=None)
        names = result["files"][0]["exports"]
        assert "run" in names, f"run missing: {names}"
        assert "Handler" in names
        assert "process" in names, f"process missing: {names}"


def test_detects_js_exports():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "index.js", "content": "export function greet() {}\nexport class App {}\nconst x = 1\nfunction helper() {}\n"},
        ])
        result = map_codebase.explore(base, max_files=100, include=None, exclude=None)
        names = result["files"][0]["exports"]
        assert "greet" in names, f"greet missing: {names}"
        assert "App" in names
        # non-exported functions are not captured (only export-prefixed)


def test_include_exclude_globs():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "src/main.py", "content": "x=1\n"},
            {"path": "tests/test_main.py", "content": "def test(): pass\n"},
            {"path": "src/styles.css", "content": "body {}\n"},
        ])
        result = map_codebase.explore(base, max_files=100, include=["src/*.py"], exclude=["tests/*"])
        paths = {f["path"] for f in result["files"]}
        assert "src/main.py" in paths
        assert "tests/test_main.py" not in paths
        assert "src/styles.css" not in paths
        assert result["stats"]["total"] == 1


def test_max_files_caps_output():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [{"path": f"file{i}.py", "content": "x=1\n"} for i in range(20)])
        result = map_codebase.explore(base, max_files=5, include=None, exclude=None)
        assert result["stats"]["total"] <= 5, f"expected <=5, got {result['stats']['total']}"


def test_detects_rust_exports():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "lib.rs", "content": "pub fn run() {}\npub struct Config {}\npub enum Status {}\npub trait Handler {}\nfn internal() {}\n"},
        ])
        result = map_codebase.explore(base, max_files=100, include=None, exclude=None)
        names = result["files"][0]["exports"]
        assert "run" in names
        assert "Config" in names
        assert "Status" in names
        assert "Handler" in names
        assert "internal" not in names, "non-pub should not be exported"


def test_cli_invocation():
    """Verify CLI works end to end (exit 0, valid JSON on stdout)."""
    import subprocess
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "hello.py", "content": "def greet(): pass\n"},
        ])
        r = subprocess.run(
            [sys.executable, str(_SCRIPT_DIR / "map_codebase.py"),
             "--root", str(base), "--max-files", "50"],
            capture_output=True, text=True, timeout=30,
        )
        assert r.returncode == 0, f"CLI failed:\nstdout:{r.stdout}\nstderr:{r.stderr}"
        data = json.loads(r.stdout)
        assert data["stats"]["total"] == 1
        assert data["files"][0]["path"] == "hello.py"


def test_detects_go_exports():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        make_tree(base, [
            {"path": "server.go", "content": "func main() {}\nfunc handle() {}\ntype Config struct {}\n"},
        ])
        result = map_codebase.explore(base, max_files=100, include=None, exclude=None)
        names = result["files"][0]["exports"]
        assert "main" in names
        assert "handle" in names
        assert "Config" in names


HARNESS = [
    test_walks_simple_tree,
    test_skips_dot_git,
    test_detects_python_imports,
    test_detects_python_exports,
    test_detects_js_exports,
    test_include_exclude_globs,
    test_max_files_caps_output,
    test_detects_rust_exports,
    test_cli_invocation,
    test_detects_go_exports,
]


def main():
    failed = 0
    for t in HARNESS:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"FAIL {t.__name__} (exception): {e}")
    print(f"\n{len(HARNESS) - failed}/{len(HARNESS)} pass")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
