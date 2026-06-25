#!/usr/bin/env python3
"""Self-checks for recon.py. Stdlib run (DEGRADED mode, no tree-sitter): `python3 test_recon.py`.
Assertions hold under both the ast/regex fallback and the tree-sitter backend. BUT several tests are
tree-sitter-gated and SKIP without the venv — the precise-backend import/call-graph path (where the
EH-0006 regression lived) is only exercised when you also run `bash setup_venv.sh` then
`.venv/bin/python test_recon.py`. The acceptance gate must run BOTH (a green stdlib run alone is blind
to tree-sitter regressions)."""
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
    # outer's OWN body makes no call to sink (the call lives in the nested inner) ...
    assert "sink" not in idx["callees"]["outer"], idx["callees"]["outer"]
    # ... but inner IS now its own symbol (ast backend used to drop nested defs entirely), and its
    # call edge to sink is captured: sink's only caller is inner, not outer.
    assert "inner" in idx["symbols"], list(idx["symbols"])
    assert idx["callers"]["sink"] == ["inner"], idx["callers"]["sink"]


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


def test_treesitter_named_inner_function_calls_not_attributed_to_outer():
    # venv-gated: calls_in() must skip named inner function declarations too, not only
    # arrow functions. Outer calls `safe`; inner (a separate function_declaration) calls
    # `dangerous`. Without the FN_TYPES skip, `dangerous` bleeds into outer's call list.
    if recon._ts_parser("javascript") is None:
        print("   (skip: tree-sitter language pack not installed)")
        return
    d = tempfile.mkdtemp()
    (Path(d) / "b.js").write_text(
        "function outer(req) { function inner() { dangerous(req); } return safe(req); }\n"
        "function safe(r) { return r; }\n"
        "function dangerous(r) { return r; }\n"
    )
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    outer_calls = idx["callees"].get("outer", [])
    assert "safe" in outer_calls, outer_calls
    assert "dangerous" not in outer_calls, outer_calls
    inner_calls = idx["callees"].get("inner", [])
    assert "dangerous" in inner_calls, inner_calls


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


def test_commented_require_produces_no_filegraph_edge():
    # A require/import inside a comment must NOT become a filegraph edge (EH-0006).
    # Tests the regex-fallback path (_imports_exports + _strip_comments); tree-sitter
    # already strips comments via AST node filtering.
    d = tempfile.mkdtemp()
    # JS: live require + line-commented require + block-commented require
    (Path(d) / "main.js").write_text(
        "const real = require('./live');\n"
        "// const dead = require('./line-commented');\n"
        "/* const also = require('./block-commented'); */\n"
    )
    (Path(d) / "live.js").write_text("module.exports = 1;\n")
    # PHP: live require + commented require
    (Path(d) / "app.php").write_text(
        "<?php\nrequire_once 'active.php';\n// require_once 'ghost.php';\n"
    )
    (Path(d) / "active.php").write_text("<?php\n")
    # Ruby: live require_relative + hash-commented require
    (Path(d) / "svc.rb").write_text(
        "require_relative 'real_helper'\n# require_relative 'phantom'\n"
    )
    (Path(d) / "real_helper.rb").write_text("module RealHelper; end\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    fg = idx["filegraph"]
    # live edges must exist
    assert "live.js" in fg.get("main.js", {}), fg.get("main.js")
    assert "active.php" in fg.get("app.php", {}), fg.get("app.php")
    assert "real_helper.rb" in fg.get("svc.rb", {}), fg.get("svc.rb")
    # commented-out edges must NOT exist
    assert "line-commented.js" not in fg.get("main.js", {}), (
        "line-commented require must not produce a filegraph edge"
    )
    assert "block-commented.js" not in fg.get("main.js", {}), (
        "block-commented require must not produce a filegraph edge"
    )
    assert "ghost.php" not in fg.get("app.php", {}), (
        "PHP line-commented require_once must not produce a filegraph edge"
    )
    assert "phantom.rb" not in fg.get("svc.rb", {}), (
        "Ruby hash-commented require_relative must not produce a filegraph edge"
    )


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


def test_qualified_external_call_does_not_bind_to_in_repo_bare_name():
    # os.path.join(x, y) must NOT create a caller edge to an unrelated in-repo `join` function,
    # even when `join` is a unique symbol in scope. The qualifier "os" is not an internal module
    # (not imported from an in-repo file), so rule (d) drops it without a bare-name fallback.
    # Meanwhile an unqualified cross-file call to a unique in-repo symbol still resolves normally.
    d = tempfile.mkdtemp()
    (Path(d) / "caller.py").write_text(
        "import os\n\n"
        "def my_func(x, y):\n"
        "    return os.path.join(x, y)\n\n"
        "def also_calls_helper():\n"
        "    return helper()\n"
    )
    (Path(d) / "utils.py").write_text(
        "def join(a, b):\n"
        "    return a + b\n\n"
        "def helper():\n"
        "    pass\n"
    )
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    # os.path.join must NOT create an edge to in-repo `join`
    assert idx["callers"].get("join", []) == [], (
        f"join should have no callers, got: {idx['callers'].get('join', [])}"
    )
    assert "join" not in idx["callees"].get("my_func", []), (
        f"my_func must not list join as a callee; got: {idx['callees'].get('my_func', [])}"
    )
    # unqualified cross-file call to a unique in-repo symbol still resolves
    assert "helper" in idx["callees"].get("also_calls_helper", []), (
        f"also_calls_helper must call helper; got: {idx['callees'].get('also_calls_helper', [])}"
    )
    assert "also_calls_helper" in idx["callers"].get("helper", []), (
        f"helper must have also_calls_helper as caller; got: {idx['callers'].get('helper', [])}"
    )


def test_regex_fallback_captures_dotted_call_head():
    # Degraded (no-venv) backend: the regex call extractor must emit the full dotted head
    # (os.path.join), NOT the bare tail (join). Otherwise pkg.Join(...) collapses to bare `Join`
    # and binds to an in-repo same-named helper via _resolve_call_target rule (a) — the exact
    # false reachable edge the qualifier-aware resolver was built to prevent, reintroduced in
    # degraded mode. parse_regex IS the regex backend, so this is deterministic on stdlib AND venv.
    fi = recon.parse_regex(
        "caller.js",
        "function my_func(x, y) {\n"
        "  if (x) { return os.path.join(x, y); }\n"
        "  return y;\n"
        "}\n",
        "javascript",
    )
    calls = fi.functions[0]["calls"]
    assert "os.path.join" in calls, calls          # dotted head captured
    assert "join" not in calls, calls              # bare tail must NOT leak
    assert "if" not in calls, calls                # bare keyword still dropped (tail guard)


def test_regex_dotted_external_does_not_bind_to_in_repo_bare_name():
    # End-to-end via the resolver: an unqualified-external dotted call must not resolve to an
    # in-repo bare-named helper. _resolve_call_target sees the dot, finds the qualifier is not a
    # proven-internal module, and drops it (rule d) rather than falling back to the bare name.
    caller = recon.parse_regex(
        "caller.js",
        "function my_func(x, y) {\n  return pkg.Join(x, y);\n}\n",
        "javascript",
    )
    call = caller.functions[0]["calls"][0]
    assert call == "pkg.Join", caller.functions[0]["calls"]
    # symbols table has an in-repo `Join`; the dotted external call must NOT resolve to it.
    symbols = {"Join": [{"name": "Join", "file": "utils.js", "language": "javascript"}]}
    caller_fn = {"name": "my_func", "file": "caller.js", "language": "javascript"}
    target = recon._resolve_call_target(call, caller_fn, symbols, known_internal_qualifiers={})
    assert target is None, f"qualified-external pkg.Join must not bind to in-repo Join, got {target}"


def test_source_file_count_excludes_config():
    # EH-0003 / #4: config files (.json fixtures here) are indexed for grep but must NOT count toward
    # source_file_count, which drives the thematic-vs-partition decision. file_count stays total.
    d = tempfile.mkdtemp()
    (Path(d) / "app.py").write_text("def f():\n    pass\n")
    (Path(d) / "fixture1.json").write_text('{"a": 1}\n')
    (Path(d) / "fixture2.json").write_text('{"b": 2}\n')
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert idx["summary"]["file_count"] == 3, idx["summary"]          # all three indexed
    assert idx["summary"]["source_file_count"] == 1, idx["summary"]   # only app.py is source


def test_walk_allows_ci_iac_dot_dirs():
    # EH-0003 / #5: CI/IaC dot-dirs (.circleci etc.) must be walked so supply-chain config is covered;
    # other dot-dirs stay skipped.
    d = tempfile.mkdtemp()
    os.makedirs(Path(d) / ".circleci")
    (Path(d) / ".circleci" / "config.yml").write_text("version: 2.1\n")
    os.makedirs(Path(d) / ".secretstuff")
    (Path(d) / ".secretstuff" / "ignore.yml").write_text("x: 1\n")
    included, _ = recon.walk_files(d, recon.DEFAULT_MAX_BYTES, None)
    assert any(p.replace(os.sep, "/") == ".circleci/config.yml" for p in included), included
    assert not any(".secretstuff" in p for p in included), included


def test_walk_skipped_file_accounting():
    """walk_files returns (included, skipped) with symlink, unsupported, and too_large entries."""
    d = tempfile.mkdtemp()
    # A normal supported file — must be in included.
    (Path(d) / "app.py").write_text("def f():\n    pass\n")
    # An unsupported extension — must appear in skipped with reason "unsupported".
    (Path(d) / "data.bin").write_bytes(b"\x00\x01\x02")
    # A too-large file — must appear in skipped with reason "too_large".
    (Path(d) / "big.py").write_bytes(b"x = 1\n" * 200_000)  # ~1.2 MB, well over DEFAULT_MAX_BYTES
    # A symlink — must appear in skipped with reason "symlink".
    link_target = Path(d) / "app.py"
    link_path = Path(d) / "link.py"
    os.symlink(str(link_target), str(link_path))

    max_bytes = recon.DEFAULT_MAX_BYTES  # 1_000_000
    included, skipped = recon.walk_files(d, max_bytes, None)

    # included: only app.py (big.py is too large, link.py is a symlink)
    assert included == ["app.py"], f"included should be ['app.py'], got {included}"

    skipped_map = {s["path"]: s["reason"] for s in skipped}
    assert skipped_map.get("data.bin") == "unsupported", f"data.bin: {skipped_map}"
    assert skipped_map.get("big.py") == "too_large", f"big.py: {skipped_map}"
    assert skipped_map.get("link.py") == "symlink", f"link.py: {skipped_map}"

    # build_index must thread these counts into summary
    idx = recon.build_index(d, max_bytes, None)
    s = idx["summary"]
    assert s["file_count"] == 1, f"file_count: {s}"
    assert s["skipped_count"] >= 3, f"skipped_count: {s}"  # at least our 3 known skipped files
    assert s["unsupported_count"] >= 1, f"unsupported_count: {s}"
    assert s["too_large_count"] >= 1, f"too_large_count: {s}"
    # skipped list in artifact matches summary
    assert len(idx["skipped"]) == s["skipped_count"], f"skipped list len mismatch: {s}"
    skipped_reasons = {item["reason"] for item in idx["skipped"]}
    assert "unsupported" in skipped_reasons, f"unsupported reason missing: {skipped_reasons}"
    assert "too_large" in skipped_reasons, f"too_large reason missing: {skipped_reasons}"
    assert "symlink" in skipped_reasons, f"symlink reason missing: {skipped_reasons}"


def test_walk_skipped_diff_mode():
    """walk_files in diff (only) mode also records symlink/unsupported/too_large in skipped."""
    d = tempfile.mkdtemp()
    (Path(d) / "good.py").write_text("def g():\n    pass\n")
    (Path(d) / "nope.bin").write_bytes(b"\xff")
    (Path(d) / "fat.py").write_bytes(b"x = 1\n" * 200_000)
    link_path = Path(d) / "linked.py"
    os.symlink(str(Path(d) / "good.py"), str(link_path))

    max_bytes = recon.DEFAULT_MAX_BYTES
    included, skipped = recon.walk_files(d, max_bytes, ["good.py", "nope.bin", "fat.py", "linked.py"])

    assert included == ["good.py"], f"included: {included}"
    reasons = {s["path"]: s["reason"] for s in skipped}
    assert reasons.get("nope.bin") == "unsupported", f"nope.bin: {reasons}"
    assert reasons.get("fat.py") == "too_large", f"fat.py: {reasons}"
    assert reasons.get("linked.py") == "symlink", f"linked.py: {reasons}"


def test_config_iac_files_appear_in_files_with_config_backend():
    # .env and Dockerfile in scope must land in files[] with backend='config' and 0 functions
    # (include-but-don't-parse tier: audit lanes grep the raw text; no call-graph noise).
    d = tempfile.mkdtemp()
    (Path(d) / "app.py").write_text("def f():\n    pass\n")
    (Path(d) / ".env").write_text("SECRET_KEY=abc123\nDB_URL=postgres://user:pass@host/db\n")
    (Path(d) / "Dockerfile").write_text("FROM python:3.11\nCOPY . /app\nRUN pip install -r requirements.txt\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    paths = {f["path"] for f in idx["files"]}
    assert ".env" in paths, f".env missing from files[]: {paths}"
    assert "Dockerfile" in paths, f"Dockerfile missing from files[]: {paths}"
    env_entry = next(f for f in idx["files"] if f["path"] == ".env")
    dockerfile_entry = next(f for f in idx["files"] if f["path"] == "Dockerfile")
    assert env_entry["language"] == "config", f".env language: {env_entry}"
    assert dockerfile_entry["language"] == "config", f"Dockerfile language: {dockerfile_entry}"
    assert env_entry["functions"] == 0, f".env must have 0 functions: {env_entry}"
    assert dockerfile_entry["functions"] == 0, f"Dockerfile must have 0 functions: {dockerfile_entry}"
    # backends breakdown: 'config' backend should be recorded
    assert "config" in idx["backends"], f"config backend missing from backends: {idx['backends']}"
    assert idx["backends"]["config"]["config"] == 2, f"expected 2 config-backend files: {idx['backends']}"


def test_extract_config_file_fallback_window():
    # extract on a config/IaC file:NN target with --context-lines 20 must produce a line-centered
    # window output containing '# fallback window' (no function span exists for config files).
    d = tempfile.mkdtemp()
    cfg_lines = [f"KEY_{i}=value_{i}" for i in range(50)]
    (Path(d) / ".env").write_text("\n".join(cfg_lines) + "\n")
    (Path(d) / "app.py").write_text("def f():\n    pass\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    # target line 25 in .env with context_lines=20 -> window [5, 45]
    ns = type("A", (), {"index": str(ipath), "target": ".env:25", "context_lines": 20})
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_extract(ns)
    out = buf.getvalue()
    assert rc == 0, f"expected rc=0, got {rc}; output: {out}"
    assert "# fallback window" in out, f"expected '# fallback window' marker in output: {out!r}"
    # the window should include lines near line 25 (KEY_24 is 1-based line 25)
    assert "KEY_24" in out, f"expected line 25 content in window: {out!r}"


def test_entrypoint_not_attributed_to_adjacent_sibling():
    # A non-route helper whose def sits within _EP_GAP lines BELOW a route handler must NOT inherit the
    # handler's entry-point flag: the decorator belongs to the NEAREST def below it (the handler). Without
    # this the gate treats the helper as reachable and loses its strongest INVALID (dead-code) ground.
    d = tempfile.mkdtemp()
    (Path(d) / "app.py").write_text(
        '@app.route("/x")\n'
        'def view():\n'
        '    return 1\n'
        'def internal_only():\n'
        '    return 2\n'
    )
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert idx["symbols"]["view"][0].get("entrypoint") == "route", idx["symbols"]["view"]
    assert idx["symbols"]["internal_only"][0].get("entrypoint") is None, idx["symbols"]["internal_only"]


def test_aliased_js_require_resolves_internal_call():
    # `const fs = require('./util'); fs.foo()` — the BINDING `fs`, not the module filename, is the
    # qualifier. Both backends must capture the binding so the internal qualified call resolves to
    # ./util#foo (under tree-sitter the call is dotted "fs.foo" and needs the internal-qualifier set).
    d = tempfile.mkdtemp()
    (Path(d) / "main.js").write_text("const fs = require('./util');\nfunction go(){ return fs.foo(); }\n")
    (Path(d) / "util.js").write_text("function foo(){ return 1; }\nmodule.exports = { foo };\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert "foo" in idx["callees"].get("go", []), idx["callees"].get("go")
    assert "go" in idx["callers"].get("foo", []), idx["callers"].get("foo")


def test_aliased_require_does_not_bind_to_unimported_same_named_symbol():
    # #2: `const fs = require('./util'); fs.foo()` — `foo` is NOT defined in util.js; a same-named `foo`
    # exists UNIQUELY in an unrelated other.js. Rule (c) must bind ONLY to the imported file, so the
    # call resolves to nothing (no false cross-file edge), NOT to other.js#foo. Backend-agnostic.
    d = tempfile.mkdtemp()
    (Path(d) / "main.js").write_text("const fs = require('./util');\nfunction go(){ return fs.foo(); }\n")
    (Path(d) / "util.js").write_text("function bar(){ return 1; }\nmodule.exports = { bar };\n")
    (Path(d) / "other.js").write_text("function foo(){ return 2; }\nmodule.exports = { foo };\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert "foo" not in idx["callees"].get("go", []), idx["callees"].get("go")
    assert "go" not in idx["callers"].get("foo", []), idx["callers"].get("foo")


def test_argparse_entrypoint_not_inflated_per_flag():
    # #6: an N-flag ArgumentParser must yield ONE argparse entrypoint, not one per add_argument(.
    d = tempfile.mkdtemp()
    (Path(d) / "cli.py").write_text(
        "import argparse\n"
        "def main():\n"
        "    p = argparse.ArgumentParser()\n"
        "    p.add_argument('--a')\n"
        "    p.add_argument('--b')\n"
        "    p.add_argument('--c')\n"
        "    return p.parse_args()\n"
    )
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    argparse_eps = [e for e in idx["entrypoints"] if e["kind"] == "argparse"]
    # ArgumentParser() + parse_args() = 2 signal lines; the 3 add_argument lines must NOT each fire.
    assert len(argparse_eps) <= 2, argparse_eps


def test_treesitter_nonjs_imports_still_populated():
    # EH-0006 regression guard: under tree-sitter, non-JS/TS files (Go here) must STILL get imports via
    # the regex fallback — _ts_imports_exports only covers JS/TS, so without the fallback Go/Rust/Java/etc.
    # lose all import + filegraph edges and the precise backend becomes strictly worse than the degraded
    # one. venv-gated: only meaningful when the tree-sitter Go pack is installed.
    if recon._ts_parser("go") is None:
        print("   (skip: tree-sitter go pack not installed)")
        return
    d = tempfile.mkdtemp()
    (Path(d) / "main.go").write_text('package main\nimport "myrepo/util"\nfunc main(){ util.Do() }\n')
    (Path(d) / "util.go").write_text('package util\nfunc Do(){}\n')
    fi = recon.parse_file(str(Path(d) / "main.go"), recon.DEFAULT_MAX_BYTES)
    assert fi.backend == "treesitter", fi.backend
    assert any(i["spec"] == "myrepo/util" for i in fi.imports), fi.imports


def test_treesitter_captures_export_const_and_module_exports_object():
    # EH-0002 regression guard: under tree-sitter, `export const foo = () => {}` and the whole-object
    # `module.exports = { bar }` form must land in exports[]. The regex backend caught these via
    # _JS_EXPORT_RES, but JS under tree-sitter skips the regex fallback (ts_covers_imports), so a miss
    # here made the precise backend strictly worse for very common export patterns. venv-gated.
    if recon._ts_parser("javascript") is None:
        print("   (skip: tree-sitter language pack not installed)")
        return
    d = tempfile.mkdtemp()
    (Path(d) / "esm.js").write_text(
        "export const foo = () => {};\n"
        "export let alpha = 1, beta = 2;\n"
        "export function named() {}\n"
    )
    (Path(d) / "cjs.js").write_text(
        "function bar() {}\nfunction baz() {}\n"
        "module.exports = { bar, qux: baz };\n"
    )
    esm = recon.parse_file(str(Path(d) / "esm.js"), recon.DEFAULT_MAX_BYTES)
    cjs = recon.parse_file(str(Path(d) / "cjs.js"), recon.DEFAULT_MAX_BYTES)
    assert esm.backend == "treesitter", esm.backend
    for name in ("foo", "alpha", "beta", "named"):
        assert name in esm.exports, (name, esm.exports)
    for name in ("bar", "qux"):
        assert name in cjs.exports, (name, cjs.exports)


def test_strip_comments_preserves_shebang():
    # Ruby/PHP # comment stripping must remove inline + whole-line comments but KEEP the #! shebang.
    rb = "#!/usr/bin/env ruby\nx = 1 # trailing comment\n# whole-line comment\n"
    out = recon._strip_comments(rb, "ruby")
    assert "#!/usr/bin/env ruby" in out, out
    assert "trailing comment" not in out, out
    assert "whole-line comment" not in out, out
    php = "#!/usr/bin/php\n$x = 1; # hash comment\n// slash comment\n"
    out_php = recon._strip_comments(php, "php")
    assert "#!/usr/bin/php" in out_php, out_php
    assert "hash comment" not in out_php and "slash comment" not in out_php, out_php


# --- taint (direct param->call-arg) + stable-key extract header ---------------------------------

def test_python_taint_direct_param_to_call_arg():
    # ast backend: a param flowing into a call's args is recorded; a call with only constant args isn't.
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text(
        "def handle(req):\n    return sink(req)\n"
        "def safe():\n    return sink(42)\n"
        "def sink(x):\n    return x\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert idx["symbols"]["handle"][0].get("taint") == [{"call": "sink", "params": ["req"]}], \
        idx["symbols"]["handle"][0].get("taint")
    assert idx["symbols"]["safe"][0].get("taint") == [], idx["symbols"]["safe"][0].get("taint")


def test_python_taint_nested_arg_expression():
    # Direct flow includes a param used inside a nested arg expression (req.body) or wrapping call.
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text(
        "def handle(req):\n    return run(parse(req.body))\n"
        "def run(x):\n    return x\n"
        "def parse(y):\n    return y\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    taint = idx["symbols"]["handle"][0].get("taint")
    flows = {t["call"]: t["params"] for t in taint}
    assert flows.get("parse") == ["req"], taint     # req.body -> parse arg
    assert flows.get("run") == ["req"], taint        # req reaches the outer run(...) expression too


def test_regex_backend_has_no_taint_or_params():
    # Precise-only: the regex fallback can't scope args to params, so both stay empty.
    fi = recon.parse_regex("a.js", "function handle(req){ return sink(req); }\n", "javascript")
    assert fi.functions[0].get("taint") == [], fi.functions[0]
    assert fi.functions[0].get("params") == [], fi.functions[0]


def test_extract_emits_stable_key_header():
    # cmd_extract header carries key=<file#name> (stable, line-free for a unique name) for fingerprinting.
    d = _tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "target": "handle"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_extract(ns)
    out = buf.getvalue()
    assert rc == 0, out
    assert "key=a.py#handle" in out, out


def test_extract_duplicate_name_key_is_line_disambiguated():
    # For a duplicate name in one file the key must carry the line suffix (stable per-definition id).
    d = _overloaded_tree()
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "target": "S.java#Get:2"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_extract(ns)
    out = buf.getvalue()
    assert rc == 0, out
    assert "key=S.java#Get:2" in out, out


def test_extract_emits_taint_line():
    # cmd_extract surfaces the function's direct taint when the target resolves to an indexed fn.
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text("def handle(req):\n    return sink(req)\ndef sink(x):\n    return x\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "target": "a.py#handle"})
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_extract(ns)
    out = buf.getvalue()
    assert rc == 0, out
    assert "# taint:" in out and "req->sink" in out, out


def test_extract_file_line_target_surfaces_key_and_taint():
    # A file:line target (the shape lanes often emit) recovers the enclosing symbol so key=/taint still show.
    d = tempfile.mkdtemp()
    (Path(d) / "a.py").write_text("def handle(req):\n    return sink(req)\ndef sink(x):\n    return x\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    ipath = _write_index(d, idx)
    ns = type("A", (), {"index": str(ipath), "target": "a.py:2"})  # the sink-call line inside handle
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_extract(ns)
    out = buf.getvalue()
    assert rc == 0, out
    assert "key=a.py#handle" in out, out
    assert "req->sink" in out, out


def test_treesitter_taint_param_to_call_arg():
    # venv-gated: tree-sitter backend computes the same direct param->arg taint as the ast backend.
    if recon._ts_parser("javascript") is None:
        print("   (skip: tree-sitter language pack not installed)")
        return
    d = tempfile.mkdtemp()
    (Path(d) / "a.js").write_text(
        "function handle(req){ return sink(req); }\n"
        "function safe(){ return sink(1); }\n"
        "function sink(x){ return x; }\n")
    idx = recon.build_index(d, recon.DEFAULT_MAX_BYTES, None)
    assert idx["symbols"]["handle"][0].get("taint") == [{"call": "sink", "params": ["req"]}], \
        idx["symbols"]["handle"][0].get("taint")
    assert idx["symbols"]["safe"][0].get("taint") == [], idx["symbols"]["safe"][0].get("taint")


# --- backend parity harness --------------------------------------------------------------------
# The recurring-bug class (EH-0002 export-const, EH-0006 non-JS imports, nested-fn drop) was always the
# same shape: the PRECISE (tree-sitter) path forgot something the DEGRADED (regex) path already did,
# making precise STRICTLY WORSE than degraded. These tests make that structurally catchable: parse the
# SAME fixture through parse_file twice (tree-sitter on, then forced off -> regex) and assert the
# anti-"precise<degraded" contract. venv-gated — needs both backends to compare, so SKIP in stdlib.
#
# Contract (subset, NOT equality — precise legitimately catches MORE: nested fns, module.exports object):
#   imports / exports / function names:  regex (degraded) MUST be a subset of tree-sitter (precise).
#     If precise misses an import/export/fn the degraded path found, regex ⊄ ts and the test fails —
#     exactly the precise<degraded regression. Precise catching extra is allowed (superset is fine).
#   call edges:  ts MUST be a subset of regex. Here the relationship is reversed by design: the regex
#     fallback OVER-attributes calls inside nested closures to the outer fn (documented degraded
#     limitation, recon.py calls scoping), so regex is the superset. ts ⊆ regex documents that.

_PARITY_FIXTURES = {
    # filename: (grammar, source). One import, an export where the language has them, two functions,
    # one cross/dotted call — clean enough that the regex backend does not false-positive a function.
    "p.js": ("javascript",
             "import helper from './helper';\n"
             "export function run(req) { return helper(req); }\n"
             "export const go = () => run(1);\n"),
    "p.go": ("go",
             'package main\nimport "myrepo/util"\n'
             "func main() { util.Do() }\nfunc helper() {}\n"),
    "p.rb": ("ruby",
             "require_relative 'helper'\ndef handle(req)\n  parse(req)\nend\ndef parse(x)\n  x\nend\n"),
    "p.rs": ("rust",
             "mod util;\npub fn run() { helper() }\nfn helper() {}\n"),
    "p.java": ("java",
               "package com.ex;\nimport com.ex.Util;\n"
               "public class Main { public String get(String id) { return clean(id); }\n"
               "  public String clean(String s) { return s; } }\n"),
}


def _parse_both(path):
    """Return (ts_on, ts_off) FileInfo for `path`: once with tree-sitter, once with it forced off
    (regex fallback). Forcing off via the module global exercises the REAL parse_file path, including
    the non-JS import fallback that EH-0006 broke. Restores the global + parser cache afterward."""
    ts_on = recon.parse_file(path, recon.DEFAULT_MAX_BYTES)
    saved_avail = recon._TS_AVAILABLE
    saved_parsers = dict(recon._TS_PARSERS)
    recon._TS_AVAILABLE = False           # make _ts_parser return None for every grammar
    recon._TS_PARSERS.clear()
    try:
        ts_off = recon.parse_file(path, recon.DEFAULT_MAX_BYTES)
    finally:
        recon._TS_AVAILABLE = saved_avail
        recon._TS_PARSERS.clear()
        recon._TS_PARSERS.update(saved_parsers)
    return ts_on, ts_off


def test_backend_parity_imports_exports_fns():
    # venv-gated: degraded (regex) must be a SUBSET of precise (tree-sitter) for imports, exports, and
    # function names. Catches the EH-0002 / EH-0006 / nested-drop class where precise lost ground.
    # Skip ONLY if NO fixture grammar is installed — gating on one grammar (go) would silently skip the
    # js/ruby/rust/java fixtures whenever a pack ships without go, hiding their parity regressions.
    if all(recon._ts_parser(g) is None for g in {g for g, _ in _PARITY_FIXTURES.values()}):
        print("   (skip: no tree-sitter grammars from the language pack installed)")
        return
    d = tempfile.mkdtemp()
    for fn, (grammar, src) in _PARITY_FIXTURES.items():
        if recon._ts_parser(grammar) is None:
            continue  # this grammar absent from the pack — skip just this fixture
        p = Path(d) / fn
        p.write_text(src)
        ts_on, ts_off = _parse_both(str(p))
        assert ts_on.backend == "treesitter", (fn, ts_on.backend)  # the "on" pass really used tree-sitter
        assert ts_off.backend == "regex", (fn, ts_off.backend)     # the "off" pass really fell to regex
        on_imp = {i["spec"] for i in ts_on.imports}
        off_imp = {i["spec"] for i in ts_off.imports}
        assert off_imp <= on_imp, f"{fn}: precise<degraded on imports — regex {off_imp} not subset of ts {on_imp}"
        assert set(ts_off.exports) <= set(ts_on.exports), (
            f"{fn}: precise<degraded on exports — regex {ts_off.exports} not subset of ts {ts_on.exports}")
        on_fns = {f["name"] for f in ts_on.functions}
        off_fns = {f["name"] for f in ts_off.functions}
        assert off_fns <= on_fns, f"{fn}: precise<degraded on functions — regex {off_fns} not subset of ts {on_fns}"


def test_backend_parity_calls_subset():
    # venv-gated: for call edges the relationship is REVERSED — the regex fallback over-attributes
    # nested-closure calls to the outer function (documented), so ts ⊆ regex. Assert that for the
    # dotted/qualifier-clean languages (go, js) where both backends parse call heads the same way.
    if recon._ts_parser("go") is None and recon._ts_parser("javascript") is None:
        print("   (skip: neither go nor javascript grammar installed)")
        return
    d = tempfile.mkdtemp()
    for fn in ("p.go", "p.js"):
        grammar, src = _PARITY_FIXTURES[fn]
        if recon._ts_parser(grammar) is None:
            continue
        p = Path(d) / fn
        p.write_text(src)
        ts_on, ts_off = _parse_both(str(p))
        on_by_name = {f["name"]: set(f["calls"]) for f in ts_on.functions}
        off_by_name = {f["name"]: set(f["calls"]) for f in ts_off.functions}
        for name, on_calls in on_by_name.items():
            off_calls = off_by_name.get(name, set())
            assert on_calls <= off_calls, (
                f"{fn}:{name}: ts calls {on_calls} not subset of regex calls {off_calls}")


def test_backend_parity_taint_is_precise_only_superset():
    # venv-gated: taint is a documented precise-only enrichment. The degraded (regex) backend must
    # carry NO taint, and the precise backend's taint is a superset (here: the handle->sink flow).
    # This keeps "precise >= degraded" true for taint — precise adds it, degraded never has a WRONG one.
    if recon._ts_parser("javascript") is None:
        print("   (skip: tree-sitter language pack not installed)")
        return
    d = tempfile.mkdtemp()
    p = Path(d) / "t.js"
    p.write_text("function handle(req){ return sink(req); }\nfunction sink(x){ return x; }\n")
    ts_on, ts_off = _parse_both(str(p))
    off_taint = {f["name"]: f.get("taint", []) for f in ts_off.functions}
    on_taint = {f["name"]: f.get("taint", []) for f in ts_on.functions}
    assert all(t == [] for t in off_taint.values()), f"regex must carry no taint, got {off_taint}"
    assert on_taint.get("handle") == [{"call": "sink", "params": ["req"]}], on_taint


import json as _json


def _scan_ns(**kw):
    base = {"scope": ".", "bin": None, "changed_files": False, "base": None,
            "baseline": None, "max_file_size": None, "format": "json"}
    base.update(kw)
    return type("A", (), base)


def test_scan_subparser_accepts_format_flag():
    # Regression for the secrets stage: security-audit.js's reconBlock documents and invokes
    # `recon.py scan <scope> --format json`. The other scan tests call cmd_scan() directly and bypass
    # argparse, so they cannot catch a missing --format. Exercise the real parse path.
    args = recon.build_parser().parse_args(["scan", ".", "--format", "json"])
    assert args.scope == "." and args.format == "json", vars(args)
    # And it must parse WITHOUT --format too (default json).
    args2 = recon.build_parser().parse_args(["scan", "."])
    assert args2.format == "json", vars(args2)


def _run_scan(ns):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = recon.cmd_scan(ns)
    return rc, _json.loads(buf.getvalue())


def test_scan_absent_binary_returns_not_run():
    # Absence is EXPECTED: exit 0, ran=false, with a reason + install breadcrumb so the
    # workflow can surface a constraint instead of failing the audit.
    rc, out = _run_scan(_scan_ns(bin="/nonexistent-secrets-scanner-xyz"))
    assert rc == 0, rc
    assert out["ran"] is False, out
    assert out["reason"] and out["install"], out


def test_scan_present_parses_json():
    # Stub binary on disk (passed via --bin) emits canned secrets-scanner JSON and exits 1
    # (findings). cmd_scan must parse it and pass the fingerprint through verbatim.
    d = tempfile.mkdtemp()
    stub = Path(d) / "fake-scanner"
    payload = _json.dumps([
        {"file": "config/.env", "line": 3, "col": 1, "rule_id": "aws-access-key",
         "rule_description": "AWS access key", "matched": "***REDACTED***",
         "entropy": 4.2, "fingerprint": "sha256-deadbeef"},
    ])
    # cat the payload, exit 1 to mimic "findings detected" (a normal, non-error outcome).
    stub.write_text("#!/bin/sh\ncat <<'EOF'\n" + payload + "\nEOF\nexit 1\n")
    stub.chmod(0o755)
    rc, out = _run_scan(_scan_ns(bin=str(stub)))
    assert rc == 0, rc
    assert out["ran"] is True, out
    assert out["count"] == 1, out
    f = out["findings"][0]
    assert f["fingerprint"] == "sha256-deadbeef", f  # baseline key preserved verbatim
    assert f["rule_id"] == "aws-access-key" and f["file"] == "config/.env", f


def test_rg_stdlib_fallback_skips_pathologically_long_lines():
    # The stdlib _rg fallback (used when ripgrep is absent) must not scan a multi-MB single line —
    # a hostile tree could otherwise turn the regex pass into a CPU/memory DoS. Force the fallback by
    # stubbing shutil.which to None, then confirm a normal short hit is returned and the over-long
    # line (which also contains the pattern) is skipped, not matched.
    d = tempfile.mkdtemp()
    long_line = "NEEDLE" + ("A" * (recon._RG_MAX_LINE_BYTES + 10))
    (Path(d) / "a.py").write_text(f"x = 1  # NEEDLE here\n{long_line}\nz = 2\n")
    orig_which = recon.shutil.which
    recon.shutil.which = lambda *a, **k: None  # force the stdlib walk (no ripgrep)
    try:
        hits = recon._rg("NEEDLE", d)
    finally:
        recon.shutil.which = orig_which
    assert any(":1:" in h for h in hits), hits          # the short line on line 1 matched
    assert not any("AAAA" in h for h in hits), "over-long line must be skipped, not scanned"


def test_file_suffix_match_is_segment_anchored():
    # Regression: file.lstrip('./') + endswith over-matched. lstrip strips a CHAR SET, so '../a/db.py'
    # collapsed to 'a/db.py' and bare 'db.py' suffix-matched 'imdb.py' -> wrong key=/taint fingerprint.
    assert recon._strip_dot_slash("./a/db.py") == "a/db.py"
    assert recon._strip_dot_slash("../a/db.py") == "../a/db.py"  # the bug turned this into 'a/db.py'
    assert recon._file_suffix_match("src/auth/db.py", "auth/db.py")
    assert recon._file_suffix_match("db.py", "db.py")
    assert not recon._file_suffix_match("imdb.py", "db.py")
    assert not recon._file_suffix_match("src/fakeauth/db.py", "auth/db.py")


def test_dedup_taint_collapses_duplicate_flows():
    # Regression: taint was appended raw while `calls` was sorted(set(...)), so two call sites to the
    # same sink inflated the `# taint:` header. Dedup by (call, params); distinct param sets are kept.
    t = [{"call": "sink", "params": ["req"]}, {"call": "sink", "params": ["req"]},
         {"call": "sink", "params": ["x"]}]
    assert recon._dedup_taint(t) == [{"call": "sink", "params": ["req"]}, {"call": "sink", "params": ["x"]}]


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    if recon._ts_parser("javascript") is None:
        print("NOTE: tree-sitter not installed — tree-sitter-gated tests are SKIPPED, not run. "
              "Run `bash setup_venv.sh` then `.venv/bin/python test_recon.py` to exercise the precise "
              "backend (the import/call-graph regression path lives there).\n")
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
