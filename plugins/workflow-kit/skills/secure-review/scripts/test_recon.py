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
