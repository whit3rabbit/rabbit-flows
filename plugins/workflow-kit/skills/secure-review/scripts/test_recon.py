#!/usr/bin/env python3
"""Self-checks for recon.py. Stdlib only, runs in DEGRADED mode (no tree-sitter needed):
`python3 test_recon.py`. Assertions hold under both the ast/regex fallback and the tree-sitter
backend, so the suite is valid with or without the cached venv."""
from __future__ import annotations

import io
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import recon  # noqa: E402

PY = '''\
import os
from util import clean

MAX_LEN = 64

def handle(req):
    return clean(parse(req))

def parse(x):
    return x[:MAX_LEN]

def orphan(z):
    return z

def webhook(req):
    return parse(req)

def usefoo():
    return client.serve()

ROUTES = {"/hook": webhook}

if __name__ == "__main__":
    handle(None)
'''

JS = '''\
function route(req) {
  return handler(req);
}
function handler(req) {
  return req;
}
app.get('/x', route);
'''

GO = '''\
package main

func main() {
\tserve()
}

func serve() {
}
'''


UTIL = '''\
def clean(s):
    return s.strip()
'''


def _tree():
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text(PY)
    (Path(d) / "b.js").write_text(JS)
    (Path(d) / "c.go").write_text(GO)
    (Path(d) / "util.py").write_text(UTIL)
    return d


def test_index_counts_and_languages():
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert idx["summary"]["file_count"] == 4, idx["summary"]
    assert set(idx["languages"]) == {"python", "javascript", "go"}, idx["languages"]
    assert idx["languages"]["python"] == 2
    for name in ("handle", "parse", "orphan", "route", "main", "serve", "clean"):
        assert name in idx["symbols"], f"missing symbol {name}"


def test_callgraph_edges():
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert "handle" in idx["callers"]["parse"], idx["callers"]
    assert "parse" in idx["callees"]["handle"], idx["callees"]
    assert "main" in idx["callers"]["serve"], idx["callers"]
    assert "route" in idx["callers"]["handler"], idx["callers"]


def test_dead_code_signal():
    # orphan is defined but called by no in-scope function -> empty callers list.
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert idx["callers"]["orphan"] == [], idx["callers"]["orphan"]


def test_referenced_value_not_dead():
    # webhook is never CALLED, only registered in ROUTES as a value -> empty callers but referenced.
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert idx["callers"]["webhook"] == [], idx["callers"]["webhook"]
    assert "webhook" in idx["referenced"], idx["referenced"]
    assert "orphan" not in idx["referenced"], idx["referenced"]


def test_no_cross_language_edge():
    # usefoo (python) calls client.serve(); serve is defined in Go. The python attribute call must NOT
    # become a caller edge to the Go function. Only Go's main calls Go serve.
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert idx["callers"]["serve"] == ["main"], idx["callers"]["serve"]
    assert "usefoo" not in idx["callers"]["serve"]


def test_constant_resolution():
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert "MAX_LEN" in idx["constants"], idx["constants"]
    assert idx["constants"]["MAX_LEN"][0]["value"] == "64"


def test_entrypoints():
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    kinds = {e["kind"] for e in idx["entrypoints"]}
    assert "py-main" in kinds, kinds
    assert "express" in kinds, kinds
    assert "go-main" in kinds, kinds


def test_extract_function_body():
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = Path(d) / "recon.json"
    ipath.write_text(__import__("json").dumps(idx))
    ns = type("A", (), {"index": str(ipath), "target": "handle"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_extract(ns)
    out = buf.getvalue()
    assert rc == 0, out
    assert "parse(req)" in out, out


def test_callers_command_dead_code_message():
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = Path(d) / "recon.json"
    ipath.write_text(__import__("json").dumps(idx))
    ns = type("A", (), {"index": str(ipath), "symbol": "orphan"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        recon.cmd_callers(ns)
    assert "NO callers" in buf.getvalue(), buf.getvalue()


def test_shard_partitions_all_files():
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = Path(d) / "recon.json"
    ipath.write_text(__import__("json").dumps(idx))
    seen = []
    for i in range(2):
        ns = type("A", (), {"index": str(ipath), "i": i, "n": 2, "by": "dir"})
        buf = io.StringIO()
        with redirect_stdout(buf):
            recon.cmd_shard(ns)
        seen += [ln for ln in buf.getvalue().splitlines() if ln.strip()]
    assert sorted(seen) == ["a.py", "b.js", "c.go", "util.py"], seen


def test_imports_exports_and_filegraph():
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    # internal edge a.py -> util.py (from import AND/OR cross-file call to clean)
    assert "util.py" in idx["filegraph"].get("a.py", {}), idx["filegraph"].get("a.py")
    assert "clean" in idx["filegraph"]["a.py"]["util.py"]
    # exports surface
    assert "clean" in idx["exports"]["util.py"], idx["exports"]["util.py"]
    # external library recorded, NOT a graph node
    assert "os" in idx["imports_external"].get("a.py", []), idx["imports_external"].get("a.py")
    assert "os" not in idx["filegraph"], "external lib must not be a node"


def test_map_command_compressed():
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = Path(d) / "recon.json"
    ipath.write_text(__import__("json").dumps(idx))
    ns = type("A", (), {"index": str(ipath), "focus": "a.py", "hops": 2, "max": 80})
    buf = io.StringIO()
    with redirect_stdout(buf):
        recon.cmd_map(ns)
    out = buf.getvalue()
    assert "a.py" in out and "util.py" in out, out
    assert "os" in out, out  # external collapsed line


def test_diff_mode_file_list():
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, ["a.py"])
    assert idx["summary"]["file_count"] == 1, idx["summary"]
    assert idx["files"][0]["path"] == "a.py"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"ok   {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERR  {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
