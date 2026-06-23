#!/usr/bin/env python3
"""Self-checks for recon.py. Stdlib only, runs in DEGRADED mode (no tree-sitter needed):
`python3 test_recon.py`. Assertions hold under both the ast/regex fallback and the tree-sitter
backend, so the suite is valid with or without the cached venv."""
from __future__ import annotations

import io
import os
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
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


def _write_index(d, idx):
    ipath = Path(d) / "recon.json"
    ipath.write_text(__import__("json").dumps(idx))
    return ipath


def _ambiguous_tree():
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text('''\
def parse(x):
    return x

def caller_a(v):
    return parse(v)
''')
    (Path(d) / "b.py").write_text('''\
def parse(x):
    return x

def caller_b(v):
    return parse(v)
''')
    return d


def _overloaded_tree():
    d = tempfile.mkdtemp()
    (Path(d) / "S.java").write_text('''\
public class S {
  public String Get(String id) { return id; }
  public String Get(int id) { return String.valueOf(id); }
}
''')
    return d


def test_index_counts_and_languages():
    idx = recon.build_index(_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert idx["summary"]["file_count"] == 4, idx["summary"]
    assert set(idx["languages"]) == {"python", "javascript", "go"}, idx["languages"]
    assert idx["languages"]["python"] == 2
    for name in ("handle", "parse", "orphan", "route", "main", "serve", "clean"):
        assert name in idx["symbols"], f"missing symbol {name}"
        assert "id" in idx["symbols"][name][0], idx["symbols"][name][0]
    # per-language backend breakdown: python is always the precise ast backend
    assert idx["backends"]["python"] == {"ast": 2}, idx["backends"]


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


def test_same_named_functions_do_not_merge_callers():
    idx = recon.build_index(_ambiguous_tree(), recon.DEFAULT_MAX_BYTES, None)
    assert "parse" not in idx["callers"], idx["callers"]
    assert idx["callers"]["a.py#parse"] == ["caller_a"], idx["callers"]
    assert idx["callers"]["b.py#parse"] == ["caller_b"], idx["callers"]
    assert idx["callees"]["caller_a"] == ["a.py#parse"], idx["callees"]
    assert idx["callees"]["caller_b"] == ["b.py#parse"], idx["callees"]


def test_callers_command_rejects_ambiguous_name():
    d = _ambiguous_tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "symbol": "parse"})
    err = io.StringIO()
    with redirect_stderr(err):
        rc = recon.cmd_callers(ns)
    out = err.getvalue()
    assert rc == 1, out
    assert "ambiguous function" in out, out
    assert "a.py#parse" in out and "b.py#parse" in out, out


def test_callers_command_accepts_file_qualified_name():
    d = _ambiguous_tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "symbol": "a.py#parse"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_callers(ns)
    out = buf.getvalue()
    assert rc == 0, out
    assert "caller_a" in out, out
    assert "caller_b" not in out, out


def test_same_file_duplicate_functions_are_line_disambiguated():
    d = _overloaded_tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ids = sorted(loc["id"] for loc in idx["symbols"]["Get"])
    assert ids == ["S.java#Get:2", "S.java#Get:3"], ids
    assert idx["callers"]["S.java#Get:2"] == [], idx["callers"]
    assert idx["callers"]["S.java#Get:3"] == [], idx["callers"]

    ipath = _write_index(d, idx)
    ambiguous = type("A", (), {"index": str(ipath), "target": "S.java#Get"})
    err = io.StringIO()
    with redirect_stderr(err):
        rc = recon.cmd_extract(ambiguous)
    out = err.getvalue()
    assert rc == 1, out
    assert "S.java#Get:2" in out and "S.java#Get:3" in out, out

    exact = type("A", (), {"index": str(ipath), "target": "S.java#Get:2"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_extract(exact)
    out = buf.getvalue()
    assert rc == 0, out
    assert "String id" in out and "int id" not in out, out


def test_nested_python_calls_do_not_reach_from_outer_function():
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text('''\
def outer():
    def inner():
        sink()
    return 1

def sink():
    pass
''')
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert "sink" not in idx["callees"]["outer"], idx["callees"]["outer"]
    assert idx["callers"]["sink"] == [], idx["callers"]["sink"]


def test_entrypoint_function_is_flagged_reachable_not_dead():
    # A decorator-registered route handler has NO in-code caller and its name is not referenced as a
    # value — without the entrypoint flag the gate would call it dead code and drop reachable web vulns.
    d = tempfile.mkdtemp()
    (Path(d) / "app.py").write_text('''\
@app.route('/upload')
def handle_upload(req):
    return parse(req)
''')
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    loc = idx["symbols"]["handle_upload"][0]
    assert loc.get("entrypoint") == "route", loc
    assert idx["callers"][loc["key"]] == [], idx["callers"]  # genuinely no in-code caller
    assert "handle_upload" not in idx["referenced"], idx["referenced"]  # not value-referenced either
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "symbol": "handle_upload"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        recon.cmd_callers(ns)
    out = buf.getvalue()
    assert "entry point" in out and "REACHABLE" in out and "likely dead code" not in out, out


def test_self_recursion_is_not_a_caller_edge():
    # quicksort calls only itself; nothing else calls it -> it must read as dead (empty callers),
    # not kept alive by a phantom self-edge.
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text('''\
def quicksort(arr):
    return quicksort(arr)
''')
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert idx["callers"]["quicksort"] == [], idx["callers"]["quicksort"]
    assert "quicksort" not in idx["callees"]["quicksort"], idx["callees"]["quicksort"]


def test_python_decorator_and_default_arg_calls_not_attributed_to_body():
    # @deco(...) and a default-arg call run in the ENCLOSING scope at def time, not in f's body.
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text('''\
def helper():
    return 1

def logit(x):
    return x

def deco(fn):
    return fn

@deco
def f(y=helper()):
    return logit(y)
''')
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    callees = idx["callees"]["f"]
    assert "logit" in callees, callees          # real body call kept
    assert "helper" not in callees, callees      # default-arg call dropped
    assert "deco" not in callees, callees        # decorator call dropped


def test_shard_by_dir_keeps_a_directory_together():
    d = tempfile.mkdtemp()
    for sub, fn in (("x", "a.py"), ("x", "b.py"), ("y", "c.py"), ("y", "d.py")):
        (Path(d) / sub).mkdir(exist_ok=True)
        (Path(d) / sub / fn).write_text("def f():\n    pass\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    shards = []
    for i in range(2):
        ns = type("A", (), {"index": str(ipath), "i": i, "n": 2, "by": "dir"})
        buf = io.StringIO()
        with redirect_stdout(buf):
            recon.cmd_shard(ns)
        shards.append([ln for ln in buf.getvalue().splitlines() if ln.strip()])
    # every shard's files share one directory (contiguous-by-dir), and the union is complete
    for s in shards:
        assert len({os.path.dirname(p) for p in s}) == 1, s
    assert sorted(p for s in shards for p in s) == ["x/a.py", "x/b.py", "y/c.py", "y/d.py"], shards


def test_treesitter_nested_calls_not_attributed_to_outer():
    # venv-gated: the tree-sitter calls_in() must skip nested closures/arrows. Skips in the stdlib run
    # (the regex fallback can't scope nested calls — documented degraded-mode limitation).
    if recon._ts_parser("javascript") is None:
        print("   (skip: tree-sitter language pack not installed)")
        return
    d = tempfile.mkdtemp()
    (Path(d) / "a.js").write_text(
        "function outer() {\n  const helper = () => sink();\n  return 1;\n}\nfunction sink() {}\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert "sink" not in idx["callees"].get("outer", []), idx["callees"].get("outer")
    assert idx["callers"]["sink"] == ["helper"], idx["callers"]["sink"]


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
    ipath = _write_index(d, idx)
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
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "symbol": "orphan"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        recon.cmd_callers(ns)
    assert "NO callers" in buf.getvalue(), buf.getvalue()


def test_shard_partitions_all_files():
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    seen = []
    for i in range(2):
        ns = type("A", (), {"index": str(ipath), "i": i, "n": 2, "by": "dir"})
        buf = io.StringIO()
        with redirect_stdout(buf):
            recon.cmd_shard(ns)
        seen += [ln for ln in buf.getvalue().splitlines() if ln.strip()]
    assert sorted(seen) == ["a.py", "b.js", "c.go", "util.py"], seen


def test_shard_rejects_invalid_bounds():
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "i": 0, "n": 0, "by": "dir"})
    err = io.StringIO()
    with redirect_stderr(err):
        rc = recon.cmd_shard(ns)
    assert rc == 1, err.getvalue()
    assert "--n must be > 0" in err.getvalue(), err.getvalue()


def test_explicit_missing_index_does_not_fall_back_to_live_search():
    ns = type("A", (), {"index": "/tmp/definitely-missing-recon.json", "symbol": "build_index"})
    err = io.StringIO()
    with redirect_stderr(err):
        rc = recon.cmd_callers(ns)
    out = err.getvalue()
    assert rc == 1, out
    assert "index not found" in out, out


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
    ipath = _write_index(d, idx)
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


# --- multi-language coverage (Tier A entrypoints + Tier B import graph) ----------------------------
# Entrypoint detection and import resolution are backend-independent (regex/ast), so these assertions
# hold in degraded mode too — no venv needed.

def _polytree():
    d = tempfile.mkdtemp()
    (Path(d) / "app.rb").write_text(
        "require_relative 'helper'\ndef handle(req)\n  Helper.clean(req)\nend\n"
        "get '/u/:id' do\n  params[:id]\nend\n")
    (Path(d) / "helper.rb").write_text("module Helper\n  def self.clean(s)\n    s.strip\n  end\nend\n")
    (Path(d) / "index.php").write_text(
        "<?php\nrequire_once 'lib.php';\n$id = $_GET['id'];\nfunction handle($x) { return Lib::clean($x); }\n")
    (Path(d) / "lib.php").write_text(
        "<?php\nclass Lib { public static function clean($s) { return trim($s); } }\n")
    (Path(d) / "lib.rs").write_text(
        "mod util;\n#[get(\"/u\")]\nasync fn get_user() -> String { String::new() }\nfn main() {}\n")
    (Path(d) / "util.rs").write_text("pub fn clean(s: String) -> String { s }\n")
    (Path(d) / "Main.java").write_text(
        "package com.ex;\nimport com.ex.Util;\n@RestController\npublic class Main {\n"
        "  @GetMapping(\"/u\")\n  public String get(String id) { return Util.clean(id); }\n}\n")
    (Path(d) / "Util.java").write_text(
        "package com.ex;\npublic class Util { public static String clean(String s) { return s; } }\n")
    (Path(d) / "svc.cs").write_text(
        "using System;\n[ApiController]\npublic class Svc { [HttpGet] public string Get(string id) { return id; } }\n")
    return d


def test_multilang_entrypoints():
    idx = recon.build_index(_polytree(), recon.DEFAULT_MAX_BYTES, None)
    kinds = {e["kind"] for e in idx["entrypoints"]}
    for k in ("spring-route", "rails-sinatra", "php-superglobal", "rust-route", "aspnet-route"):
        assert k in kinds, (k, kinds)


def test_multilang_import_filegraph():
    idx = recon.build_index(_polytree(), recon.DEFAULT_MAX_BYTES, None)
    fg = idx["filegraph"]
    assert "helper.rb" in fg.get("app.rb", {}), fg.get("app.rb")      # ruby require_relative
    assert "lib.php" in fg.get("index.php", {}), fg.get("index.php")  # php require_once
    assert "util.rs" in fg.get("lib.rs", {}), fg.get("lib.rs")        # rust `mod util;`
    assert "Util.java" in fg.get("Main.java", {}), fg.get("Main.java")  # java import (basename match)
    # internal rust `use crate::...` must NOT leak into the external list
    assert not any("crate::" in x for x in idx["imports_external"].get("lib.rs", [])), idx["imports_external"]


def test_treesitter_functions_when_available():
    # venv-gated: exercises the tree-sitter backend only when the language pack is installed.
    # In the documented stdlib run (`python3 test_recon.py`) this skips and the suite stays green.
    if recon._ts_parser("ruby") is None:
        print("   (skip: tree-sitter language pack not installed)")
        return
    d = tempfile.mkdtemp()
    (Path(d) / "a.rb").write_text("def handle(r)\n  clean(r)\nend\n\ndef self.boot\n  handle(nil)\nend\n")
    (Path(d) / "s.cs").write_text(
        "public class S { [HttpGet] public string Get(string id) { return id; } }\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    # a bad/aux grammar must not poison the library-available flag for the whole run
    assert idx["treesitter"] is True, "tree-sitter must stay enabled across grammars"
    assert idx["backends"]["ruby"] == {"treesitter": 1}, idx["backends"]  # ruby went through tree-sitter
    assert idx["backends"]["c_sharp"] == {"treesitter": 1}, idx["backends"]  # c# grammar built (not poisoned)
    assert "handle" in idx["symbols"], idx["symbols"]      # ruby `method`
    assert "boot" in idx["symbols"], idx["symbols"]        # ruby `singleton_method` (def self.x)
    assert "Get" in idx["symbols"], idx["symbols"]         # c# method_declaration


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
