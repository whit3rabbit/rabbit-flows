#!/usr/bin/env python3
"""recon.py — deterministic security recon for the security-audit workflow.

Emits ONE JSON artifact that every audit agent reads instead of grepping the tree itself:
file/symbol index, resolved constants, a caller<->callee graph, and detected entry points. This
moves recon out of the LLM loop (cheaper, deterministic, computed once) and lets the admission
gate trace reachability against ground truth instead of guessing.

Backends, in order of accuracy (graceful degradation, never hard-fail):
  1. Python files       -> the stdlib `ast` module (precise).
  2. Other languages    -> tree-sitter via `tree_sitter_language_pack` IF installed (precise spans
                           + calls). Install it into a cached venv with setup_venv.sh; this script
                           never requires it.
  3. Fallback           -> regex/brace heuristics (the scan.py `window()` approach). Always available.

No third-party dependencies in the core. ripgrep (`rg`) is used for live `callers`/`const` lookups
when no index is given; it degrades to a stdlib walk when `rg` is absent.

Subcommands:
  index <scope> --out recon.json   walk the tree, build + write the artifact
  extract --index F <file#fn|file:line>   print the exact function body (replaces window())
  callers --index F <symbol>        deterministic caller list
  const   --index F <NAME>          resolved constant value(s)
  shard   --index F --i I --n N     deterministic file slice for file-partition lanes
  summary --index F                 counts + entry points (for the map stage)

Self-checks: `python3 test_recon.py` (stdlib only, runs in degraded mode — no venv needed).
"""
from __future__ import annotations

import argparse
import ast
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# --------------------------------------------------------------------------- config

# ext -> (language label, tree-sitter grammar name). Python is handled by `ast`, not tree-sitter.
LANGUAGES: Dict[str, Tuple[str, Optional[str]]] = {
    ".py": ("python", None),
    ".pyi": ("python", None),
    ".js": ("javascript", "javascript"),
    ".jsx": ("javascript", "javascript"),
    ".mjs": ("javascript", "javascript"),
    ".cjs": ("javascript", "javascript"),
    ".ts": ("typescript", "typescript"),
    ".tsx": ("tsx", "tsx"),
    ".go": ("go", "go"),
    ".rs": ("rust", "rust"),
    ".java": ("java", "java"),
    ".c": ("c", "c"),
    ".h": ("c", "c"),
    ".cc": ("cpp", "cpp"),
    ".cpp": ("cpp", "cpp"),
    ".cxx": ("cpp", "cpp"),
    ".hpp": ("cpp", "cpp"),
    ".hxx": ("cpp", "cpp"),
    ".cs": ("c_sharp", "csharp"),  # label c_sharp (internal), grammar csharp (the pack's name)
    ".rb": ("ruby", "ruby"),
    ".php": ("php", "php"),
    ".swift": ("swift", "swift"),
    ".kt": ("kotlin", "kotlin"),
    ".scala": ("scala", "scala"),
    ".sh": ("bash", "bash"),
    ".bash": ("bash", "bash"),
}

DEFAULT_MAX_BYTES = 1_000_000  # skip files larger than this (binary/generated blobs)
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
             ".next", "target", "vendor", ".idea", ".vscode", "coverage", ".mypy_cache",
             # .eatahorse / .security-audit are the workflows' OWN output dirs — never audit your own
             # recon.json / baseline / board state.
             ".pytest_cache", ".eatahorse", ".security-audit"}

# Dot-dirs that hold CI/IaC config worth indexing (supply-chain / unpinned-action coverage). Allowed
# back in past the dot-prefix skip, but SKIP_DIRS still wins (see walk_files).
CI_DOT_DIRS = {".github", ".circleci", ".gitlab", ".azure-pipelines", ".azuredevops"}

# Config/IaC: include for secret/permission scanning but do NOT parse for functions.
# These land in files[] with backend='config' and zero functions so audit lanes can grep them.
CONFIG_EXTENSIONS: set = {
    ".yml", ".yaml", ".json", ".toml", ".ini", ".env", ".tf", ".tfvars", ".hcl",
    ".xml", ".properties", ".conf", ".cfg", ".sql", ".graphql", ".proto",
}
# Extension-less filenames that are always config/IaC regardless of suffix.
SPECIAL_FILENAMES: set = {
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "Makefile", "CMakeLists.txt",
}

# Keywords that look like calls (`if(`, `for(`, ...) but are not — excluded from the call graph.
_NOT_CALLS = {"if", "for", "while", "switch", "catch", "return", "sizeof", "case", "do",
              "else", "func", "function", "def", "class", "new", "await", "yield", "typeof",
              "throw", "with", "in", "and", "or", "not", "print"}

# Entry-point signals: untrusted input typically enters here. (regex, language-tagged)
ENTRYPOINT_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("py-main", re.compile(r'if\s+__name__\s*==\s*[\'"]__main__[\'"]')),
    ("route", re.compile(r'@(?:app|router|bp|blueprint)\.(?:route|get|post|put|delete|patch|websocket)\b')),
    ("flask-add-url", re.compile(r'\.add_url_rule\s*\(')),
    # ArgumentParser construction + parse_args are the real entry signals; matching add_argument(
    # would fire once PER flag and inflate entrypoint_count for no added signal.
    ("argparse", re.compile(r'argparse\.ArgumentParser|\.parse_args\s*\(')),
    ("express", re.compile(r'\b(?:app|router)\.(?:get|post|put|delete|patch|use|all)\s*\(')),
    ("http-server", re.compile(r'\b(?:createServer|http\.HandleFunc|HandleFunc|ListenAndServe)\b')),
    ("go-main", re.compile(r'func\s+main\s*\(')),
    ("lambda-handler", re.compile(r'\b(?:exports\.handler|def\s+handler|func\s+Handler)\b')),
    ("event-listener", re.compile(r'addEventListener\s*\(')),
    ("cli-main", re.compile(r'\b(?:def|func|fn|function|public\s+static\s+void)\s+[mM]ain\b')),
    # Java: Spring MVC + JAX-RS route annotations.
    ("spring-route", re.compile(r'@(?:Rest)?Controller\b|@(?:Request|Get|Post|Put|Delete|Patch)Mapping\b')),
    ("jaxrs-route", re.compile(r'@(?:Path|GET|POST|PUT|DELETE|HEAD)\b')),
    # C#: ASP.NET attribute routing + minimal-API endpoint mapping.
    ("aspnet-route", re.compile(r'\[(?:ApiController|Http(?:Get|Post|Put|Delete|Patch)|Route)\b')),
    ("aspnet-minimal", re.compile(r'\.Map(?:Get|Post|Put|Delete|Patch|Methods)\s*\(')),
    # Rust: actix/rocket route macros + axum router.
    ("rust-route", re.compile(r'#\[(?:get|post|put|delete|patch|route)\s*\(')),
    ("rust-axum", re.compile(r'\bRouter::new\b|\.route\s*\(')),
    # Ruby: Rails/Sinatra route DSL (line-anchored verb + path literal).
    ("rails-sinatra", re.compile(r'^\s*(?:get|post|put|patch|delete)\s+[\'"]/')),
    # PHP: request superglobals + Laravel route facade.
    ("php-superglobal", re.compile(r'\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b')),
    ("laravel-route", re.compile(r'\bRoute::(?:get|post|put|patch|delete|any|match)\s*\(')),
]

# --------------------------------------------------------------------------- optional tree-sitter

_TS_PARSERS: Dict[str, Any] = {}     # grammar -> Parser, or None if THAT grammar failed (isolated)
_TS_AVAILABLE: Optional[bool] = None  # the tree_sitter LIBRARY importable at all (None = untried)


def _ts_parser(grammar: str):
    """Return a cached tree-sitter parser for a grammar, or None if unavailable.

    Per-grammar failures are ISOLATED: a single bad or unbuildable grammar (e.g. a wrong grammar
    name) caches None for itself and never disables tree-sitter for the other languages in the same
    run. Only a failed import of the tree_sitter library (it isn't installed) flips the global off —
    previously any one grammar exception poisoned `_TS_AVAILABLE` and silently degraded the whole index."""
    global _TS_AVAILABLE
    if grammar is None or _TS_AVAILABLE is False:
        return None
    if grammar in _TS_PARSERS:
        return _TS_PARSERS[grammar]
    try:
        # tree-sitter 0.25 + language-pack: build Parser(get_language(...)). The get_parser() wrapper's
        # .parse() rejects bytes in this version, so construct the Parser explicitly.
        from tree_sitter_language_pack import get_language  # type: ignore
        from tree_sitter import Parser  # type: ignore
    except Exception:
        _TS_AVAILABLE = False  # library absent -> no tree-sitter backend at all
        return None
    _TS_AVAILABLE = True
    try:
        p = Parser(get_language(grammar))
    except Exception:
        _TS_PARSERS[grammar] = None  # this grammar only; siblings stay available
        return None
    _TS_PARSERS[grammar] = p
    return p


# --------------------------------------------------------------------------- file model

class FileInfo:
    __slots__ = ("path", "language", "loc", "functions", "constants", "entrypoints", "idents",
                 "imports", "exports", "backend")

    def __init__(self, path: str, language: str):
        self.path = path
        self.language = language
        self.loc = 0
        self.backend = "regex"  # which parser ran: "ast" | "treesitter" | "regex" (per-file)
        self.functions: List[Dict[str, Any]] = []   # {name, start, end, calls:[]}
        self.constants: Dict[str, str] = {}
        self.entrypoints: List[Dict[str, Any]] = []  # {kind, line}
        self.idents: Dict[str, int] = {}             # identifier token -> count (for the "referenced" signal)
        self.imports: List[Dict[str, Any]] = []      # raw, pre-resolution: {spec, names, level, system}
        self.exports: List[str] = []                 # public symbol names this file exposes


# --------------------------------------------------------------------------- python (ast) backend

def parse_python(path: str, src: str) -> FileInfo:
    fi = FileInfo(path, "python")
    fi.backend = "ast"
    fi.loc = src.count("\n") + 1
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return parse_regex(path, src, "python")  # FileInfo.backend defaults to "regex"

    lines = src.splitlines()

    class V(ast.NodeVisitor):
        def _fn(self, node):
            params = _python_params(node)
            calls, taint = _python_calls_in_own_body(node, params)
            end = getattr(node, "end_lineno", node.lineno)
            fi.functions.append({
                "name": node.name, "start": node.lineno, "end": end,
                "calls": sorted(set(calls)), "params": params, "taint": taint,
            })
            # Descend for NESTED functions so a `def` inside a `def` is its own symbol with its own
            # call edges (the tree-sitter backend already captures these; without this the precise
            # ast backend is strictly worse). _descend_nested visits ONLY nested def/class nodes — never
            # bare statements — so a function-local `UPPER = ...` does NOT leak into module constants.
            for child in node.body:
                self._descend_nested(child)

        def _descend_nested(self, node):
            stack = [node]
            while stack:
                n = stack.pop()
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    self._fn(n)        # registers it and recurses into ITS body; stop here
                    continue
                if isinstance(n, ast.ClassDef):
                    self.visit(n)      # generic_visit picks up its methods (+ class-attr constants)
                    continue
                stack.extend(ast.iter_child_nodes(n))

        def visit_FunctionDef(self, node):
            self._fn(node)

        def visit_AsyncFunctionDef(self, node):
            self._fn(node)

        def visit_Assign(self, node):
            val = _literal(node.value)
            if val is not None:
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id.isupper():
                        fi.constants[t.id] = val

        def visit_AnnAssign(self, node):
            val = _literal(node.value) if node.value is not None else None
            if val is not None and isinstance(node.target, ast.Name) and node.target.id.isupper():
                fi.constants[node.target.id] = val

    V().visit(tree)
    _detect_entrypoints(fi, lines)
    return fi


def _python_params(node) -> List[str]:
    """Flat parameter-name list for a def/async def (positional, keyword-only, *args, **kwargs)."""
    a = node.args
    out: List[str] = []
    for grp in (getattr(a, "posonlyargs", []), a.args, a.kwonlyargs):
        out += [x.arg for x in grp]
    if a.vararg:
        out.append(a.vararg.arg)
    if a.kwarg:
        out.append(a.kwarg.arg)
    return out


def _dedup_taint(taint: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collapse duplicate taint entries (same call + same param set) so the taint list matches the
    deduped `calls` list — two call sites to sink(req) yield one calls entry, so one taint entry too."""
    seen = set()
    out = []
    for t in taint:
        k = (t["call"], tuple(t["params"]))
        if k not in seen:
            seen.add(k)
            out.append(t)
    return out


def _param_args_py(call, pset: set) -> set:
    """Which of `pset` (the enclosing function's params) appear as identifiers in this call's args.

    Direct intra-procedural flow only: a param used anywhere in an argument expression (including
    nested like `f(req.body)` or `f(g(x))`) counts as flowing into the call. No transitive local
    tracking and no sanitizer awareness — over-attribution errs toward 'tainted' (the safe direction
    for a defensive signal, same bias as the referenced/entrypoint heuristics)."""
    found: set = set()
    for arg in list(call.args) + [kw.value for kw in call.keywords]:
        for sub in ast.walk(arg):
            if isinstance(sub, ast.Name) and sub.id in pset:
                found.add(sub.id)
    return found


def _python_calls_in_own_body(root, params=None) -> Tuple[List[str], List[Dict[str, Any]]]:
    # Collect calls in this function's OWN body — stop descending at a nested def/class/lambda so an
    # inner helper's calls aren't attributed to the outer one. Stack walk mirrors tree-sitter calls_in().
    # ALSO computes DIRECT taint (which params reach each call's args) in the SAME walk, so taint
    # inherits the exact nested-scope skip — an inner helper's tainted call is not attributed to outer.
    pset = set(params or ())
    calls: List[str] = []
    taint: List[Dict[str, Any]] = []
    # Body statements only — NOT decorator_list / args.defaults / returns annotation, which are
    # children of the def node but execute in the ENCLOSING scope at def time (so `@cache(...)` and
    # `def f(x=bar())` are not calls made by f). FunctionDef/AsyncFunctionDef always have a stmt-list body.
    stack = list(root.body)
    while stack:
        n = stack.pop()
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue  # nested scope, not this function's body
        if isinstance(n, ast.Call):
            name = _call_name(n.func)
            if name and name not in _NOT_CALLS:
                calls.append(name)
                if pset:
                    flow = sorted(_param_args_py(n, pset))
                    if flow:
                        taint.append({"call": name, "params": flow})
        stack.extend(ast.iter_child_nodes(n))
    return calls, _dedup_taint(taint)


def _call_name(func) -> Optional[str]:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        # Emit "qualifier.attr" so the resolver can distinguish os.path.join from a bare join.
        # Walk up the attribute chain to get the full dotted head (e.g. os.path.join).
        parts = [func.attr]
        node = func.value
        while isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node = node.value
        if isinstance(node, ast.Name):
            parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _literal(node) -> Optional[str]:
    try:
        v = ast.literal_eval(node)
    except Exception:
        return None
    if isinstance(v, (int, float, str, bool)):
        return str(v)
    return None


# --------------------------------------------------------------------------- tree-sitter backend

def parse_treesitter(path: str, src: str, language: str, grammar: str) -> Optional[FileInfo]:
    parser = _ts_parser(grammar)
    if parser is None:
        return None
    try:
        tree = parser.parse(src.encode("utf-8", "replace"))
    except Exception:
        return None
    fi = FileInfo(path, language)
    fi.backend = "treesitter"
    fi.loc = src.count("\n") + 1
    data = src.encode("utf-8", "replace")

    def text(node) -> str:
        return data[node.start_byte:node.end_byte].decode("utf-8", "replace")

    def name_of(node) -> Optional[str]:
        # generic: first child field commonly named "name", else first identifier-ish child
        for field in ("name", "declarator"):
            ch = node.child_by_field_name(field)
            if ch is not None:
                t = text(ch)
                m = re.search(r"[A-Za-z_]\w*", t)
                if m:
                    return m.group(0)
        for ch in node.children:
            if "identifier" in ch.type:
                return text(ch)
        return None

    def anon_name(node) -> Optional[str]:
        # arrow/anonymous function: take the name from its binding context
        # (`const cli = () => ...`, `foo: () => ...`, `x = () => ...`) by walking a few parents up.
        p = node.parent
        for _ in range(3):
            if p is None:
                break
            for field in ("name", "key", "left"):
                ch = p.child_by_field_name(field)
                if ch is not None:
                    m = re.fullmatch(r"[A-Za-z_]\w*", text(ch).strip())
                    if m:
                        return m.group(0)
            p = p.parent
        return None

    # Note: bare "function" is the JS keyword token node, NOT a definition — excluded to avoid
    # double-counting. Anonymous function values are "function_expression" / "arrow_function".
    FN_TYPES = ("function_definition", "function_declaration", "method_definition",
                "method_declaration", "function_item", "constructor_declaration",
                "function_expression", "arrow_function",
                "method", "singleton_method",   # ruby (`def x`, `def self.x`) — else ruby yields 0 fns
                "local_function_statement")      # c# nested local function
    ANON = ("arrow_function", "function_expression")

    def params_of(node) -> List[str]:
        # Identifier tokens in the function's parameter list. Over-inclusive for typed grammars (a Java
        # `String id` yields both "String" and "id") — harmless: an extra name can only over-attribute
        # taint (the safe direction), never miss a real param flow.
        pnode = node.child_by_field_name("parameters")
        if pnode is None:
            for ch in node.children:
                if "parameter" in ch.type:
                    pnode = ch
                    break
        if pnode is None:
            return []
        out: List[str] = []
        st = list(pnode.children)
        while st:
            c = st.pop()
            if c.type == "identifier":
                out.append(text(c))
            st.extend(c.children)
        return out

    def _arg_params(argnode, pset: set) -> set:
        # Which params appear as identifiers anywhere in a call's argument list (direct flow; nested
        # arg expressions included — mirrors the Python _param_args_py bias).
        found: set = set()
        st = list(argnode.children)
        while st:
            c = st.pop()
            if c.type == "identifier" and text(c) in pset:
                found.add(text(c))
            st.extend(c.children)
        return found

    def calls_in(node, params=None) -> Tuple[List[str], List[Dict[str, Any]]]:
        # Calls in this function's OWN body only. Seed with children (not `node`) and stop descending
        # at a nested def/closure/arrow so an inner helper's calls aren't attributed to the outer one
        # (mirrors _python_calls_in_own_body). FN_TYPES must be defined above for this to see it.
        # ALSO computes DIRECT taint (params reaching each call's args) in the same walk.
        pset = set(params or ())
        out: List[str] = []
        taint: List[Dict[str, Any]] = []
        stack = list(node.children)
        while stack:
            n = stack.pop()
            if n.type in FN_TYPES:
                continue  # nested scope — its calls belong to it, not to `node`
            if "call" in n.type or "invocation" in n.type:
                fn = n.child_by_field_name("function") or (n.children[0] if n.children else None)
                if fn is not None:
                    raw = text(fn).strip()
                    # Keep the full dotted-qualifier head (e.g. "os.path.join", "fs.readFileSync")
                    # so _resolve_call_target can gate on the qualifier and avoid binding
                    # qualified-external calls to an unrelated in-repo symbol of the same bare name.
                    # Match a leading dotted-identifier chain; trailing parens/brackets are not part of
                    # the name. Strip any leading `await`/`new` keyword that the callee text may include.
                    raw = re.sub(r"^\s*(?:await|new)\s+", "", raw)
                    m = re.match(r"([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)", raw)
                    if m:
                        nm = m.group(1)
                        # tail of dotted name must not be a control-flow keyword
                        tail = nm.rsplit(".", 1)[-1]
                        if tail and tail not in _NOT_CALLS:
                            out.append(nm)
                            if pset:
                                argn = n.child_by_field_name("arguments")
                                flow = _arg_params(argn, pset) if argn is not None else set()
                                if flow:
                                    taint.append({"call": nm, "params": sorted(flow)})
            stack.extend(n.children)
        return sorted(set(out)), _dedup_taint(taint)
    stack = [tree.root_node]
    while stack:
        n = stack.pop()
        if n.type in FN_TYPES:
            nm = name_of(n)
            if not nm and n.type in ANON:
                nm = anon_name(n)  # `const cli = () => ...` etc.
            # drop keywords/control-flow and non-identifiers the generic walk can mis-grab; skip truly
            # anonymous functions (no useful name, no call-graph value).
            if nm and len(nm) > 1 and nm not in _NOT_CALLS and re.fullmatch(r"[A-Za-z_]\w*", nm):
                prms = params_of(n)
                fn_calls, fn_taint = calls_in(n, prms)
                fi.functions.append({
                    "name": nm, "start": n.start_point[0] + 1, "end": n.end_point[0] + 1,
                    "calls": fn_calls, "params": prms, "taint": fn_taint,
                })
        stack.extend(n.children)

    _detect_constants_regex(fi, src)
    _detect_entrypoints(fi, src.splitlines())

    # Derive imports from tree-sitter AST nodes: only real (non-commented) import/require nodes
    # are visited, so a commented-out `require("./foo")` never becomes a filegraph edge.
    # The regex fallback (_imports_exports) is used only when tree-sitter did NOT parse the file.
    ts_imports, ts_exports = _ts_imports_exports(tree, data, language, text)
    fi.imports = ts_imports
    fi.exports = ts_exports

    return fi


def _ts_imports_exports(tree, data: bytes, language: str, text_fn) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Extract imports and exports from a tree-sitter AST, visiting only live (non-comment) nodes.

    JS/TS only — every other language returns ([], []) and the caller falls back to the regex
    extractor (see parse_file). Walks the whole tree (skipping comment nodes), so both top-level
    import declarations and nested require()/import() calls become edges. Comments are never visited,
    so a commented-out require/import produces no edge."""
    imports: List[Dict[str, Any]] = []
    exports: List[str] = []

    def txt(node) -> str:
        return text_fn(node)

    def str_val(node) -> Optional[str]:
        """Extract the string value from a string node (strips quotes)."""
        raw = txt(node).strip()
        if len(raw) >= 2 and raw[0] in ('"', "'", "`") and raw[-1] in ('"', "'", "`"):
            return raw[1:-1]
        return None

    def clause_names(stmt) -> List[str]:
        """Default + namespace binding identifiers of a JS import_statement (`import D from`, `import * as N`).
        Named imports (`{a, b}`) are called unqualified, so they are deliberately skipped."""
        out: List[str] = []
        clause = next((c for c in stmt.children if c.type == "import_clause"), None)
        if clause is None:
            return out
        for ch in clause.children:
            if ch.type == "identifier":          # default import binding
                nm = txt(ch).strip()
                if re.fullmatch(r"[A-Za-z_]\w*", nm):
                    out.append(nm)
            elif ch.type == "namespace_import":  # `* as N`
                ident = next((g for g in ch.children if g.type == "identifier"), None)
                if ident is not None:
                    nm = txt(ident).strip()
                    if re.fullmatch(r"[A-Za-z_]\w*", nm):
                        out.append(nm)
        return out

    if language in ("javascript", "typescript", "tsx"):
        # Full-tree walk over non-comment nodes (tree-sitter never emits comment nodes as import/call
        # children, so this is inherently comment-safe). Captures top-level imports AND nested require()
        # calls in function bodies — both are real dependency edges. Binding names are captured so a
        # qualified internal call (`fs.foo()` for `const fs = require('./util')`) resolves later.
        root = tree.root_node
        stack = list(root.children)
        while stack:
            n = stack.pop()
            # skip comment nodes entirely
            if "comment" in n.type:
                continue
            t = n.type
            # `import ... from "spec"` / `export ... from "spec"` / `import "spec"`
            if t in ("import_statement", "export_statement"):
                src_node = n.child_by_field_name("source")
                if src_node is None:
                    # look for a string child directly
                    for ch in n.children:
                        if "string" in ch.type:
                            src_node = ch
                            break
                if src_node is not None:
                    spec = str_val(src_node)
                    if spec:
                        names = clause_names(n) if t == "import_statement" else []
                        imports.append({"spec": spec, "names": names, "level": 0, "system": False})
                # collect exported names from `export { a, b }`
                if t == "export_statement":
                    clause = n.child_by_field_name("declaration") or n.child_by_field_name("export_clause")
                    if clause is None:
                        for ch in n.children:
                            if ch.type == "export_clause":
                                clause = ch
                                break
                    if clause is not None:
                        for ch in clause.children:
                            if "identifier" in ch.type or ch.type == "export_specifier":
                                nm = txt(ch).split(" as ")[0].strip()
                                if nm and re.fullmatch(r"[A-Za-z_]\w*", nm):
                                    exports.append(nm)
                    # `export function/class/const/let/var name`
                    decl = n.child_by_field_name("declaration")
                    if decl is not None:
                        nm_node = decl.child_by_field_name("name")
                        if nm_node is not None:
                            nm = txt(nm_node).strip()
                            if nm and re.fullmatch(r"[A-Za-z_]\w*", nm):
                                exports.append(nm)
                        else:
                            # `export const foo = () => {}` / `export let a, b` -> lexical_declaration:
                            # no name field on the declaration; each binding is a variable_declarator.
                            for d in decl.children:
                                if d.type == "variable_declarator":
                                    dn = d.child_by_field_name("name")
                                    if dn is not None and dn.type == "identifier":
                                        nm = txt(dn).strip()
                                        if nm and re.fullmatch(r"[A-Za-z_]\w*", nm):
                                            exports.append(nm)
            # `require("spec")` or `import("spec")` as a call_expression
            elif t == "call_expression":
                fn_node = n.child_by_field_name("function")
                if fn_node is not None:
                    fn_name = txt(fn_node).strip()
                    if fn_name in ("require", "import"):
                        args = n.child_by_field_name("arguments")
                        if args is not None:
                            for ch in args.children:
                                if "string" in ch.type:
                                    spec = str_val(ch)
                                    if spec:
                                        # `const X = require(spec)` -> the binding X is the qualifier the
                                        # caller uses; capture it (object-pattern destructures are skipped:
                                        # those are called unqualified).
                                        bind: List[str] = []
                                        p = n.parent
                                        if p is not None and p.type == "variable_declarator":
                                            nm_node = p.child_by_field_name("name")
                                            if nm_node is not None and nm_node.type == "identifier":
                                                bnm = txt(nm_node).strip()
                                                if re.fullmatch(r"[A-Za-z_]\w*", bnm):
                                                    bind = [bnm]
                                        imports.append({"spec": spec, "names": bind, "level": 0, "system": False})
                                    break
            # `module.exports.X = ...` or `exports.X = ...`
            elif t == "expression_statement":
                # check for module.exports assignment
                for ch in n.children:
                    if ch.type == "assignment_expression":
                        left = ch.child_by_field_name("left")
                        if left is not None:
                            raw_left = txt(left)
                            m = re.match(r"(?:module\.exports|exports)\.([A-Za-z_]\w*)", raw_left)
                            if m:
                                exports.append(m.group(1))
                            # whole-object form: `module.exports = { foo, bar: baz }` / `exports = {...}`
                            elif re.fullmatch(r"module\.exports|exports", raw_left.strip()):
                                right = ch.child_by_field_name("right")
                                if right is not None and "object" in right.type:
                                    for prop in right.children:
                                        if "shorthand_property_identifier" in prop.type:
                                            nm = txt(prop).strip()
                                            if re.fullmatch(r"[A-Za-z_]\w*", nm):
                                                exports.append(nm)
                                        elif prop.type == "pair":
                                            key = prop.child_by_field_name("key")
                                            if key is not None:
                                                nm = txt(key).strip().strip("\"'")
                                                if re.fullmatch(r"[A-Za-z_]\w*", nm):
                                                    exports.append(nm)
                stack.extend(n.children)
                continue
            stack.extend(n.children)

    return imports, list(dict.fromkeys(exports))


# --------------------------------------------------------------------------- regex fallback backend

_FN_REGEXES: Dict[str, List[re.Pattern]] = {
    "javascript": [
        re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+(?P<name>\w+)\s*\('),
        re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name>\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)'),
        re.compile(r'^\s*(?P<name>\w+)\s*\([^)]*\)\s*\{'),
    ],
    "go": [
        re.compile(r'^\s*func\s+(?:\([^)]*\)\s*)?(?P<name>\w+)\s*\('),
    ],
    "rust": [
        re.compile(r'^\s*(?:pub\s+)?(?:async\s+)?fn\s+(?P<name>\w+)\s*[<(]'),
    ],
    "c": [
        re.compile(r'^\s*[A-Za-z_][\w \*]+\s+(?P<name>\w+)\s*\([^;]*\)\s*\{'),
    ],
    "_default": [
        re.compile(r'^\s*(?:public|private|protected|static|final|\s)*[\w<>\[\]]+\s+(?P<name>\w+)\s*\([^;]*\)\s*\{'),
        re.compile(r'^\s*(?:def|fn|func|function)\s+(?P<name>\w+)'),
    ],
}
_FN_REGEXES["typescript"] = _FN_REGEXES["javascript"]
_FN_REGEXES["tsx"] = _FN_REGEXES["javascript"]
_FN_REGEXES["cpp"] = _FN_REGEXES["c"]

# Capture the full dotted head (`os.path.join`, not bare `join`) so _resolve_call_target can drop
# qualified-external calls instead of binding them to an in-repo same-named helper. Mirrors the
# tree-sitter extractor (see calls_in); without it the no-venv regex fallback recreates that false edge.
_CALL_RE = re.compile(r'\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(')


def parse_regex(path: str, src: str, language: str) -> FileInfo:
    fi = FileInfo(path, language)
    lines = src.splitlines()
    fi.loc = len(lines)
    regexes = _FN_REGEXES.get(language, _FN_REGEXES["_default"])
    brace_lang = language not in ("python",)

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        matched = None
        for rx in regexes:
            m = rx.match(line)
            if m:
                matched = m
                break
        if matched:
            name = matched.group("name")
            # the generic `name(...) {` pattern also matches control-flow (`if (...) {`, `for (...) {`,
            # `switch (...) {`) and keyword-led blocks — drop those; they are not functions.
            if name in _NOT_CALLS:
                i += 1
                continue
            start = i + 1
            end = _span_end(lines, i, brace_lang)
            body = "\n".join(lines[i:end])
            # Degraded-mode limitation: this counts EVERY call token in the span, so calls inside a
            # nested closure/inner function leak into the outer function's call list (the tree-sitter and
            # ast backends scope this correctly; the regex fallback has no cheap way to track scope).
            # Dotted heads ARE now captured (os.path.join, not bare join); guard the keyword check on the
            # tail so `if(`/`for(` (bare) still drop while a dotted call survives for the resolver.
            calls = sorted({c for c in _CALL_RE.findall(body)
                            if c.rsplit(".", 1)[-1] not in _NOT_CALLS and c != name})
            # params/taint are precise-only (need an AST to scope args to params); the regex backend
            # leaves them empty. The parity harness asserts regex taint stays [] and ts taint is a superset.
            fi.functions.append({"name": name, "start": start, "end": end, "calls": calls,
                                 "params": [], "taint": []})
            i = end
            continue
        i += 1

    _detect_constants_regex(fi, src)
    _detect_entrypoints(fi, lines)
    return fi


def _span_end(lines: List[str], start_idx: int, brace_lang: bool) -> int:
    """Return the 1-based end line of the block beginning at start_idx (0-based)."""
    if brace_lang:
        depth = 0
        seen = False
        for j in range(start_idx, len(lines)):
            for ch in lines[j]:
                if ch == "{":
                    depth += 1
                    seen = True
                elif ch == "}":
                    depth -= 1
            if seen and depth <= 0:
                return j + 1
        return min(start_idx + 80, len(lines))
    # indent-based (python-ish fallback)
    base = len(lines[start_idx]) - len(lines[start_idx].lstrip())
    for j in range(start_idx + 1, len(lines)):
        s = lines[j]
        if s.strip() and (len(s) - len(s.lstrip())) <= base:
            return j
    return len(lines)


_CONST_REGEXES = [
    re.compile(r'^\s*#define\s+(?P<name>[A-Z_][A-Z0-9_]*)\s+(?P<val>[^\s/]+)'),
    re.compile(r'^\s*(?:export\s+)?const\s+(?P<name>[A-Z_][A-Z0-9_]*)\s*=\s*(?P<val>[^;\n]+)'),
    re.compile(r'^\s*(?:static\s+|final\s+|public\s+|private\s+)*[\w<>]+\s+(?P<name>[A-Z_][A-Z0-9_]{2,})\s*=\s*(?P<val>[^;\n]+);'),
    re.compile(r'^\s*(?P<name>[A-Z_][A-Z0-9_]{2,})\s*[:=]\s*(?P<val>[^;\n]+)'),
]


def _detect_constants_regex(fi: FileInfo, src: str) -> None:
    for line in src.splitlines():
        for rx in _CONST_REGEXES:
            m = rx.match(line)
            if m:
                name = m.group("name")
                if name not in fi.constants:
                    fi.constants[name] = m.group("val").strip().rstrip(",;")
                break


def _detect_entrypoints(fi: FileInfo, lines: List[str]) -> None:
    for idx, line in enumerate(lines, 1):
        for kind, rx in ENTRYPOINT_PATTERNS:
            if rx.search(line):
                fi.entrypoints.append({"kind": kind, "line": idx})
                break


# --------------------------------------------------------------------------- walk + index

def parse_file(path: str, max_bytes: int) -> Optional[FileInfo]:
    ext = Path(path).suffix.lower()
    basename = os.path.basename(path)
    # basename.lower() catches dotfiles like .env where Path('.env').suffix=='' (no stem).
    is_config = ext in CONFIG_EXTENSIONS or basename in SPECIAL_FILENAMES or basename.lower() in CONFIG_EXTENSIONS
    if not is_config and ext not in LANGUAGES:
        return None
    try:
        if os.path.getsize(path) > max_bytes:
            return None
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            src = f.read()
    except OSError:
        return None
    # Config/IaC files: include for secret/perm scanning but skip function parsing entirely.
    if is_config:
        fi = FileInfo(path, "config")
        fi.backend = "config"
        fi.loc = src.count("\n") + 1
        # No functions, constants, entrypoints, imports, exports — audit lanes grep the raw text.
        return fi
    language, grammar = LANGUAGES[ext]
    if language == "python":
        fi = parse_python(path, src)
    else:
        fi = parse_treesitter(path, src, language, grammar) if grammar else None
        if fi is None:
            fi = parse_regex(path, src, language)
    fi.idents = _tokenize(src)
    # Imports/exports: the tree-sitter backend extracts ONLY JS/TS imports from AST nodes (comment-safe);
    # _ts_imports_exports returns nothing for every other language. So even under tree-sitter we MUST fall
    # back to the regex extractor for non-JS/TS languages — otherwise Go/Rust/Java/C/PHP/Ruby/C# lose all
    # import + filegraph edges and the precise backend becomes strictly worse than the degraded one.
    # _imports_exports is itself comment-safe (it runs _strip_comments), so the fallback can't reintroduce
    # commented-out edges. JS/TS keep the AST path (skip the fallback) to preserve its comment-safety.
    ts_covers_imports = fi.backend == "treesitter" and language in ("javascript", "typescript", "tsx")
    if not fi.imports and not ts_covers_imports:
        fi.imports, fi.exports = _imports_exports(src, language)
    return fi


# --------------------------------------------------------------------------- imports / exports

# Internal module edges (file -> file) + the external libraries/headers each file pulls in. Imports are
# line-oriented, so a cheap regex pass (ast for Python) suffices regardless of the function backend.
_JS_IMPORT_RES = [
    re.compile(r"""\bimport\b[^'"]*\bfrom\s*['"]([^'"]+)['"]"""),
    re.compile(r"""\bimport\s*['"]([^'"]+)['"]"""),
    re.compile(r"""\bexport\b[^'"]*\bfrom\s*['"]([^'"]+)['"]"""),
    re.compile(r"""\brequire\(\s*['"]([^'"]+)['"]\s*\)"""),
    re.compile(r"""\bimport\(\s*['"]([^'"]+)['"]\s*\)"""),
]
_JS_EXPORT_RES = [
    re.compile(r"\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)"),
    re.compile(r"\bexports\.(\w+)\s*="),
    re.compile(r"\bmodule\.exports\.(\w+)\s*="),
]
_JS_EXPORT_BLOCK = re.compile(r"\bexport\s*\{([^}]*)\}")
# Binding-name capture: the qualifier a caller uses for an internal module is the BINDING name, not the
# module filename (`const fs = require('./util')` -> calls `fs.foo()`). Capture default/namespace/require
# bindings so file_internal_qualifiers can resolve those qualified internal calls. Named imports
# (`{a, b}`) are called unqualified, so they need no qualifier entry.
_JS_REQUIRE_BIND = re.compile(r"""\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]""")
_JS_IMPORT_DEFAULT = re.compile(r"""\bimport\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s+from\s*['"]([^'"]+)['"]""")
_JS_IMPORT_NS = re.compile(r"""\bimport\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]""")
_C_INCLUDE_LOCAL = re.compile(r'#\s*include\s*"([^"]+)"')
_C_INCLUDE_SYS = re.compile(r"#\s*include\s*<([^>]+)>")
_GO_IMPORT_SINGLE = re.compile(r'^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"')
_GO_IMPORT_LINE = re.compile(r'^\s*(?:[\w.]+\s+)?"([^"]+)"')
# Tier-B languages: relative-path requires are internal; package/namespace specs are external.
_RUBY_REQUIRE_REL = re.compile(r"""\brequire_relative\s+['"]([^'"]+)['"]""")
_RUBY_REQUIRE = re.compile(r"""\brequire\s+['"]([^'"]+)['"]""")
# NOTE: the `^`-anchored patterns scan whole files via findall, so they need re.M (per-line `^`).
_JAVA_IMPORT = re.compile(r'^\s*import\s+(?:static\s+)?([\w.]+)\s*;', re.M)
_CS_USING = re.compile(r'^\s*using\s+(?:static\s+)?([\w.]+)\s*;', re.M)
_PHP_REQUIRE = re.compile(r"""\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]""")
_PHP_USE = re.compile(r'^\s*use\s+([\w\\]+)', re.M)
_RUST_MOD = re.compile(r'^\s*(?:pub\s+)?mod\s+(\w+)\s*;', re.M)
_RUST_USE = re.compile(r'^\s*(?:pub\s+)?use\s+([\w:]+)', re.M)


_BLOCK_COMMENT_RE = re.compile(r'/\*.*?\*/', re.DOTALL)
# `#` line/inline comments, but NOT `#!` shebangs (negative lookahead keeps the interpreter line).
_HASH_COMMENT_RE = re.compile(r'(?m)#(?!!)[^\n]*')


def _strip_comments(src: str, language: str) -> str:
    """Return src with // line-comments and /* */ block-comments removed (for import regex scanning).

    Limitation: does NOT strip string literals first, so an import URL like
    "https://example.com/foo" will lose the `//` and may produce a truncated spec — rare in
    practice because full-URL require() calls are uncommon, and the edge would be harmless.
    Ruby # comments that appear inside strings are also not stripped, same rationale.
    This is intentional: full string stripping is expensive and the residual false-negative
    rate is negligible compared to the false-positives we are eliminating.
    """
    if language in ("javascript", "typescript", "tsx", "c", "cpp", "go", "java", "c_sharp", "rust"):
        # strip /* ... */ first, then // line comments
        src = _BLOCK_COMMENT_RE.sub('', src)
        src = re.sub(r'(?m)//[^\n]*', '', src)
    elif language == "php":
        # PHP allows //, #, and /* */ (shebang `#!` on line 1 is preserved by _HASH_COMMENT_RE)
        src = _BLOCK_COMMENT_RE.sub('', src)
        src = re.sub(r'(?m)//[^\n]*', '', src)
        src = _HASH_COMMENT_RE.sub('', src)
    elif language == "ruby":
        # Ruby uses # line comments; =begin/=end block comments are rare and left as-is. `#!` kept.
        src = _HASH_COMMENT_RE.sub('', src)
    return src


def _imports_exports(src: str, language: str):
    if language == "python":
        return _py_imports_exports(src)
    # Strip comments so that commented-out require/import lines don't become false filegraph edges.
    # String literals are NOT stripped (see _strip_comments docstring for the residual limitation).
    src = _strip_comments(src, language)
    imports: List[Dict[str, Any]] = []
    exports: List[str] = []
    if language in ("javascript", "typescript", "tsx"):
        binds: Dict[str, List[str]] = {}  # spec -> [binding names the caller qualifies with]
        for rx in (_JS_REQUIRE_BIND, _JS_IMPORT_DEFAULT, _JS_IMPORT_NS):
            for nm, spec in rx.findall(src):
                binds.setdefault(spec, []).append(nm)
        for rx in _JS_IMPORT_RES:
            for spec in rx.findall(src):
                imports.append({"spec": spec, "names": binds.get(spec, []), "level": 0, "system": False})
        for rx in _JS_EXPORT_RES:
            exports.extend(rx.findall(src))
        for blk in _JS_EXPORT_BLOCK.findall(src):
            exports.extend(n.strip().split(" as ")[0].strip() for n in blk.split(",") if n.strip())
    elif language in ("c", "cpp"):
        for spec in _C_INCLUDE_LOCAL.findall(src):
            imports.append({"spec": spec, "names": [], "level": 0, "system": False})
        for spec in _C_INCLUDE_SYS.findall(src):
            imports.append({"spec": spec, "names": [], "level": 0, "system": True})
    elif language == "go":
        in_block = False
        for line in src.splitlines():
            if re.match(r"^\s*import\s*\(", line):
                in_block = True
                continue
            if in_block:
                if ")" in line:
                    in_block = False
                m = _GO_IMPORT_LINE.search(line)
                if m:
                    imports.append({"spec": m.group(1), "names": [], "level": 0, "system": False})
            else:
                m = _GO_IMPORT_SINGLE.match(line)
                if m:
                    imports.append({"spec": m.group(1), "names": [], "level": 0, "system": False})
    elif language == "ruby":
        for spec in _RUBY_REQUIRE_REL.findall(src):
            imports.append({"spec": spec, "names": [], "level": 0, "system": False, "rel": True})
        for spec in _RUBY_REQUIRE.findall(src):
            imports.append({"spec": spec, "names": [], "level": 0, "system": True})
    elif language == "java":
        for spec in _JAVA_IMPORT.findall(src):
            imports.append({"spec": spec, "names": [spec.rsplit(".", 1)[-1]], "level": 0, "system": False})
    elif language == "c_sharp":
        for spec in _CS_USING.findall(src):  # `using` = namespace, not a file -> external only
            imports.append({"spec": spec, "names": [], "level": 0, "system": True})
    elif language == "php":
        for spec in _PHP_REQUIRE.findall(src):
            imports.append({"spec": spec, "names": [], "level": 0, "system": False, "rel": True})
        for spec in _PHP_USE.findall(src):
            imports.append({"spec": spec.replace("\\", "/"), "names": [], "level": 0, "system": True})
    elif language == "rust":
        for spec in _RUST_MOD.findall(src):  # `mod foo;` = the reliable file edge
            imports.append({"spec": spec, "names": [], "level": 0, "system": False, "kind": "mod"})
        for spec in _RUST_USE.findall(src):
            if spec.startswith(("crate::", "super::", "self::")):
                continue  # internal use: the cross-file call resolver supplies the edge, skip it here
            imports.append({"spec": spec, "names": [], "level": 0, "system": True})  # std/3rd-party
    return imports, [e for e in dict.fromkeys(exports) if e]


def _py_imports_exports(src: str):
    imports: List[Dict[str, Any]] = []
    exports: List[str] = []
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return imports, exports
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imports.append({"spec": a.name, "names": [a.name.split(".")[0]], "level": 0, "system": False})
        elif isinstance(node, ast.ImportFrom):
            imports.append({"spec": node.module or "", "names": [a.name for a in node.names],
                            "level": node.level or 0, "system": False})
    explicit_all = None
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.name.startswith("_"):
            exports.append(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "__all__":
                    v = _literal_list(node.value)
                    if v is not None:
                        explicit_all = v
    return imports, (explicit_all if explicit_all is not None else list(dict.fromkeys(exports)))


def _literal_list(node):
    try:
        v = ast.literal_eval(node)
    except Exception:
        return None
    return [str(x) for x in v] if isinstance(v, (list, tuple)) else None


_IDENT_RE = re.compile(r"[A-Za-z_]\w*")


def _tokenize(src: str) -> Dict[str, int]:
    """Identifier-token counts, used for the 'referenced as a value' signal. A function whose name
    appears more often than it is defined is referenced somewhere (called, or registered as a
    handler/callback/route value) — i.e. not dead, even when the call graph shows no direct caller.

    Known blind spots, both biased toward "not dead" (the safe FP direction): 1-2 char names are
    skipped (len>2) so `f`/`go` always look potentially dead, and tokens in comments/strings are
    counted so a name mentioned in prose inflates the count."""
    counts: Dict[str, int] = {}
    for tok in _IDENT_RE.findall(src):
        if len(tok) > 2 and tok not in _NOT_CALLS:
            counts[tok] = counts.get(tok, 0) + 1
    return counts


def _gitignored(root: str) -> set:
    """Best-effort: ask git which tracked-or-untracked files are ignored. Empty set if no git."""
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
            capture_output=True, text=True, timeout=20,
        )
        return {line.rstrip("/") for line in out.stdout.splitlines() if line.strip()}
    except Exception:
        return set()


def _is_supported(fn: str) -> bool:
    """True if a filename should be included: either a source language or a config/IaC file."""
    # Extension-less special filenames (Dockerfile, Makefile, …) match by basename.
    if os.path.basename(fn) in SPECIAL_FILENAMES:
        return True
    ext = Path(fn).suffix.lower()
    if ext in LANGUAGES or ext in CONFIG_EXTENSIONS:
        return True
    # Dotfiles whose entire name IS the "extension" (e.g. .env -> suffix=='', but basename=='.env').
    # Path('.env').suffix returns '' because there is no stem; check the basename directly.
    bn = os.path.basename(fn).lower()
    return bn in CONFIG_EXTENSIONS


def walk_files(scope: str, max_bytes: int, only: Optional[List[str]]
               ) -> Tuple[List[str], List[Dict[str, str]]]:
    """Return (included, skipped) where skipped is [{path, reason}] with reasons:
    symlink / unsupported / gitignored / too_large / unreadable."""
    scope = os.path.abspath(scope)
    skipped: List[Dict[str, str]] = []
    if only is not None:
        # explicit file list (diff mode): keep the ones that exist + are supported
        out = []
        for rel in only:
            p = rel if os.path.isabs(rel) else os.path.join(scope, rel)
            if not os.path.isfile(p):
                continue
            rel_path = os.path.relpath(p, scope)
            if os.path.islink(p):
                skipped.append({"path": rel_path, "reason": "symlink"})
                continue
            if not _is_supported(p):
                skipped.append({"path": rel_path, "reason": "unsupported"})
                continue
            try:
                if os.path.getsize(p) > max_bytes:
                    skipped.append({"path": rel_path, "reason": "too_large"})
                    continue
            except OSError:
                skipped.append({"path": rel_path, "reason": "unreadable"})
                continue
            out.append(rel_path)
        return sorted(out), skipped
    ignored = _gitignored(scope)
    out = []
    for dirpath, dirnames, filenames in os.walk(scope):
        # Allowlist the dot-dirs that hold CI/IaC config (supply-chain / unpinned-action coverage);
        # everything else dot-prefixed is skipped. .gitlab-ci.yml etc. at root are files, not dirs.
        # Parenthesized so SKIP_DIRS stays authoritative even for a CI_DOT_DIRS member (the old
        # `and ... or d in CI` precedence would have let a SKIP_DIRS entry slip back in).
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS and (not d.startswith(".") or d in CI_DOT_DIRS)]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, scope)
            if os.path.islink(full):
                skipped.append({"path": rel, "reason": "symlink"})
                continue
            # os.sep is correct on this macOS/Linux tool; on Windows git emits "/" so the dir-prefix
            # arm would miss (won't-fix — recon already shells git + bash setup_venv.sh, Unix-only).
            if any(fnmatch.fnmatch(rel, pat) or rel.startswith(pat.rstrip("/") + os.sep) for pat in ignored):
                skipped.append({"path": rel, "reason": "gitignored"})
                continue
            if not _is_supported(fn):
                skipped.append({"path": rel, "reason": "unsupported"})
                continue
            try:
                if os.path.getsize(full) > max_bytes:
                    skipped.append({"path": rel, "reason": "too_large"})
                    continue
            except OSError:
                skipped.append({"path": rel, "reason": "unreadable"})
                continue
            out.append(rel)
    return sorted(out), skipped


def _go_module_prefix(scope_abs: str) -> Optional[str]:
    gomod = os.path.join(scope_abs, "go.mod")
    try:
        with open(gomod, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                m = re.match(r"\s*module\s+(\S+)", line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None


def _resolve_import(imp, current_rel, language, fileset, bybase, module_prefix) -> Optional[str]:
    """Resolve an import to a file IN SCOPE, or None if it is external (a library/header/stdlib).
    External edges are deliberately not traversed — we map the internal graph only."""
    spec = imp["spec"]
    cur_dir = os.path.dirname(current_rel)
    if language in ("c", "cpp"):
        if imp.get("system"):
            return None  # <header> = system/library
        cand = os.path.normpath(os.path.join(cur_dir, spec))
        if cand in fileset:
            return cand
        hits = bybase.get(os.path.basename(spec))
        return hits[0] if hits else None
    if language == "python":
        return _resolve_py(imp, current_rel, fileset)
    if language in ("javascript", "typescript", "tsx"):
        if not (spec.startswith(".") or spec.startswith("/")):
            return None  # bare specifier = npm package
        base = os.path.normpath(os.path.join(cur_dir, spec))
        for ext in ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
            if base + ext in fileset:
                return base + ext
        for idx in ("/index.ts", "/index.js", "/index.tsx", "/index.jsx"):
            if base + idx in fileset:
                return base + idx
        return None
    if language == "go":
        if module_prefix and (spec == module_prefix or spec.startswith(module_prefix + "/")):
            sub = spec[len(module_prefix):].lstrip("/")
            for r in fileset:  # a Go package is a directory; pick any file in it
                if os.path.dirname(r) == sub:
                    return r
            return None
        return None  # stdlib (fmt, net/http) or third-party
    if language == "ruby":
        if imp.get("rel"):  # require_relative is path-relative; bare require = gem/stdlib (external)
            base = os.path.normpath(os.path.join(cur_dir, spec))
            for cand in (base + ".rb", base + "/index.rb"):
                if cand in fileset:
                    return cand
        return None
    if language == "php":
        if imp.get("rel"):  # require/include of a path literal; `use` namespaces stay external
            base = os.path.normpath(os.path.join(cur_dir, spec))
            if base in fileset:
                return base
            hits = bybase.get(os.path.basename(spec))
            return hits[0] if hits and len(hits) == 1 else None
        return None
    if language == "java":
        # well-formed repos mirror the package in the dir tree; fall back to a UNIQUE basename match
        cand = spec.replace(".", "/") + ".java"
        if cand in fileset:
            return cand
        hits = bybase.get(spec.rsplit(".", 1)[-1] + ".java")
        return hits[0] if hits and len(hits) == 1 else None
    if language == "rust":
        if imp.get("kind") == "mod":  # `mod foo;` -> foo.rs | foo/mod.rs (the reliable file edge)
            base = os.path.join(cur_dir, spec)
            for cand in (base + ".rs", base + "/mod.rs", spec + ".rs"):
                if cand in fileset:
                    return cand
        return None  # `use crate::...` edges come from the cross-file call resolver instead
    return None  # c_sharp + others: internal edges come from cross-file calls, not import specs


def _resolve_py(imp, current_rel, fileset) -> Optional[str]:
    module = imp.get("spec") or ""
    level = imp.get("level", 0)
    parts = module.split(".") if module else []
    if level > 0:
        base_dir = os.path.dirname(current_rel)
        for _ in range(level - 1):
            base_dir = os.path.dirname(base_dir)
        path_parts = ([base_dir] if base_dir else []) + parts
    else:
        path_parts = parts
    base = "/".join(p for p in path_parts if p)
    for cand in (base + ".py", base + "/__init__.py"):
        if cand and cand in fileset:
            return cand
    if level == 0 and parts:  # absolute import of an in-repo module: match by tail uniquely
        for suff in (parts[-1] + ".py", parts[-1] + "/__init__.py"):
            hits = [r for r in fileset if r == suff or r.endswith("/" + suff)]
            if len(hits) == 1:
                return hits[0]
    return None


def _function_id(file: str, name: str, line: Optional[int] = None) -> str:
    base = f"{file}#{name}"
    return f"{base}:{line}" if line is not None else base


def _graph_key(name: str, file: str, symbols: Dict[str, List[Dict[str, Any]]],
               line: Optional[int] = None) -> str:
    locs = symbols.get(name, [])
    if len(locs) == 1:
        return name
    if line is not None:
        for loc in locs:
            if loc.get("file") == file and loc.get("start") == line and loc.get("id"):
                return loc["id"]
    for loc in locs:
        if loc.get("file") == file and loc.get("id"):
            return loc["id"]
    return _function_id(file, name, line)


def _resolve_call_target(name: str, caller: Dict[str, Any],
                         symbols: Dict[str, List[Dict[str, Any]]],
                         known_internal_qualifiers: Optional[Dict[str, set]] = None) -> Optional[Dict[str, Any]]:
    """Resolve a call name to a symbol in the index.

    Resolution rules (conservative, avoids false cross-file edges):
      (a) Unqualified name -> same-file first; unique cross-file if no same-file match.
      (b) self.X / this.X -> same-file method only (strip qualifier, same-file lookup).
      (c) Qualified (qualifier.X) where qualifier head is proven internal (a key of known_internal_qualifiers)
          -> resolve bare method name ONLY to a symbol in the file(s) that qualifier actually imports.
      (d) All other qualified calls (os.path.join, fs.readFileSync, etc.) -> drop (return None).

    This prevents external-library qualifiers from binding to an unrelated in-repo function of the
    same bare name (the "false reachable edge" bug: os.path.join -> in-repo join)."""
    if "." in name:
        # Extract qualifier head and method tail
        head, _, tail = name.partition(".")
        if head in ("self", "this"):
            # (b) same-file method only
            same_file = [loc for loc in symbols.get(tail, [])
                         if loc.get("language") == caller.get("language")
                         and loc.get("file") == caller.get("file")]
            return same_file[0] if len(same_file) == 1 else None
        # (c) qualifier head is a proven internal module: resolve the bare tail, but ONLY to a symbol
        # that actually lives in the file(s) this qualifier imports. Without the file restriction a
        # `fs.foo()` (fs -> ./util) would bind to a unique `foo` defined in some unrelated in-repo file
        # — the same false cross-file edge the qualifier gating exists to kill.
        allowed_files = known_internal_qualifiers.get(head) if known_internal_qualifiers else None
        if allowed_files:
            bare = name.rsplit(".", 1)[-1]
            candidates = [loc for loc in symbols.get(bare, [])
                          if loc.get("language") == caller.get("language")
                          and loc.get("file") in allowed_files]
            return candidates[0] if len(candidates) == 1 else None
        # (d) qualified-external: drop without bare-name fallback
        return None
    # (a) Unqualified: same-file first, then unique cross-file
    candidates = [loc for loc in symbols.get(name, [])
                  if loc.get("language") == caller.get("language")]
    same_file = [loc for loc in candidates if loc.get("file") == caller.get("file")]
    if len(same_file) == 1:
        return same_file[0]
    if len(same_file) > 1:
        return None
    return candidates[0] if len(candidates) == 1 else None


def build_index(scope: str, max_bytes: int, only: Optional[List[str]]) -> Dict[str, Any]:
    scope_abs = os.path.abspath(scope)
    rels, skipped = walk_files(scope, max_bytes, only)
    files: List[Dict[str, Any]] = []
    symbols: Dict[str, List[Dict[str, Any]]] = {}
    constants: Dict[str, List[Dict[str, str]]] = {}
    entrypoints: List[Dict[str, Any]] = []
    languages: Dict[str, int] = {}
    backends: Dict[str, Dict[str, int]] = {}  # language -> {backend: file_count}
    all_funcs: List[Dict[str, Any]] = []  # {name, file, start, end, language, calls}
    tokens: Dict[str, int] = {}
    imports_map: Dict[str, List[Dict[str, Any]]] = {}
    exports_map: Dict[str, List[str]] = {}
    lang_of: Dict[str, str] = {}

    for rel in rels:
        fi = parse_file(os.path.join(scope_abs, rel), max_bytes)
        if fi is None:
            continue
        languages[fi.language] = languages.get(fi.language, 0) + 1
        backends.setdefault(fi.language, {})
        backends[fi.language][fi.backend] = backends[fi.language].get(fi.backend, 0) + 1
        lang_of[rel] = fi.language
        imports_map[rel] = fi.imports
        for t, n in (fi.idents or {}).items():
            tokens[t] = tokens.get(t, 0) + n
        files.append({"path": rel, "language": fi.language, "loc": fi.loc,
                      "functions": len(fi.functions), "entrypoints": len(fi.entrypoints)})
        exports = list(fi.exports)
        for fn in fi.functions:
            symbols.setdefault(fn["name"], []).append(
                {"file": rel, "start": fn["start"], "end": fn["end"], "language": fi.language,
                 # direct param->call-arg taint (precise backends only; [] under regex). Carried onto the
                 # loc so cmd_extract can surface it; additive — call-graph consumers ignore it.
                 "taint": fn.get("taint", [])})
            all_funcs.append({"name": fn["name"], "file": rel, "start": fn["start"],
                              "end": fn["end"], "language": fi.language, "calls": fn["calls"]})
            if fi.language == "go" and fn["name"][:1].isupper():
                exports.append(fn["name"])  # Go: capitalized identifiers are exported
        exports_map[rel] = sorted(dict.fromkeys(exports))
        for name, val in fi.constants.items():
            constants.setdefault(name, []).append({"file": rel, "value": val})
        for ep in fi.entrypoints:
            entrypoints.append({"file": rel, "line": ep["line"], "kind": ep["kind"]})

    # Link entry-point signals to enclosing functions: a framework-invoked handler (Flask/Express/
    # Spring/axum route, lambda handler, CLI main) has NO in-code caller, so without this flag the gate
    # collapses "no caller" -> "dead code" -> INVALID and drops reachable web-app vulns. A function is an
    # entry point if any detected entrypoint line falls on/just-above its def (decorators sit above the
    # `def`; Python's lineno points at `def`) or inside its body (argparse-in-main, in-body .get(...)).
    _EP_GAP = 3  # covers a few stacked decorators above the def line
    ep_by_file: Dict[str, List[Dict[str, Any]]] = {}
    for ep in entrypoints:
        ep_by_file.setdefault(ep["file"], []).append(ep)

    # Per-file sorted function-start lines. An entry-point line ABOVE a def (a decorator) belongs to the
    # NEAREST def below it, not to every sibling whose def happens to fall within _EP_GAP. Without this an
    # internal helper sitting just under a route handler inherits the handler's entry-point flag and the
    # gate then treats it as reachable, losing its strongest INVALID (dead-code) ground.
    starts_by_file: Dict[str, List[int]] = {}
    for fn in all_funcs:
        starts_by_file.setdefault(fn["file"], []).append(fn["start"])
    for _starts in starts_by_file.values():
        _starts.sort()

    def _ep_kind_for(loc: Dict[str, Any]) -> Optional[str]:
        starts = starts_by_file.get(loc["file"], [])
        for ep in ep_by_file.get(loc["file"], []):
            line = ep["line"]
            if loc["start"] <= line <= loc["end"]:
                return ep["kind"]  # on the def line or in the body: the enclosing fn owns it
            if loc["start"] - _EP_GAP <= line < loc["start"]:
                # decorator region above the def: own it only if no other def lies between line and here
                if not any(line < s < loc["start"] for s in starts):
                    return ep["kind"]
        return None

    function_keys: Dict[str, Dict[str, Any]] = {}
    key_by_span: Dict[Tuple[str, str, int, int], str] = {}
    for name, locs in symbols.items():
        base_counts: Dict[str, int] = {}
        for loc in locs:
            base = _function_id(loc["file"], name)
            base_counts[base] = base_counts.get(base, 0) + 1
        for loc in locs:
            base = _function_id(loc["file"], name)
            loc["id"] = base if base_counts[base] == 1 else _function_id(loc["file"], name, loc["start"])
            key = _graph_key(name, loc["file"], symbols, loc["start"])
            loc["key"] = key
            ep_kind = _ep_kind_for(loc)
            if ep_kind:
                loc["entrypoint"] = ep_kind  # over-flagging errs toward reachable (the safe direction)
            key_by_span[(loc["file"], name, loc["start"], loc["end"])] = key
            function_keys[key] = dict(loc, name=name)

    # Build file-set and import-resolver prerequisites before the call graph loop so that
    # _resolve_call_target can gate qualified calls by whether the qualifier head is a known
    # internal module (i.e. imports to an in-repo file). This avoids os.path.join / fs.readFileSync
    # binding to an unrelated in-repo `join`/`readFileSync`.
    fileset = {f["path"] for f in files}
    bybase: Dict[str, List[str]] = {}
    for r in fileset:
        bybase.setdefault(os.path.basename(r), []).append(r)
    module_prefix = _go_module_prefix(scope_abs) if languages.get("go") else None

    # Per-file set of qualifier heads that map to an in-repo file.  For Python `import mymod` or
    # `from mymod import x` where mymod.py is in scope, "mymod" is internal.  For non-Python the
    # import name list may be empty; use the spec's last path component as the module name.
    # rel -> {qualifier_head: {resolved files that head imports}}. Mapping (not a bare set) so the
    # call resolver can bind a qualified internal call ONLY to a symbol in the file that qualifier
    # actually pulls in, not to any unique same-named symbol elsewhere in the repo.
    file_internal_qualifiers: Dict[str, Dict[str, set]] = {}
    for rel, imps in imports_map.items():
        qual_map: Dict[str, set] = {}
        for imp in imps:
            if imp.get("system"):
                continue  # system/external import: not internal
            resolved = _resolve_import(imp, rel, lang_of.get(rel, ""), fileset, bybase, module_prefix)
            if resolved is None:
                continue  # not in scope -> external
            # The qualifier head is the first name the caller uses to reference this import.
            # For Python: imp["names"] = [alias or first component] from the import statement.
            # For JS/TS: imp["names"] now carries the binding (default/namespace import or
            # `const X = require(...)`) from both backends (clause_names / require-binding under
            # tree-sitter, _JS_REQUIRE_BIND et al. under regex); the spec-tail fallback below only
            # fires when no binding was captured.
            # For other languages: use first name in imp["names"] if present.
            names = imp.get("names") or []
            heads = [n.split(".")[0] for n in names if n] if names else []
            if not heads:
                # Fallback: last path component of the spec (e.g. "./util" -> "util")
                tail = imp["spec"].rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
                tail = tail.split(".")[0]  # strip extension if present
                if tail:
                    heads = [tail]
            for h in heads:
                qual_map.setdefault(h, set()).add(resolved)
        file_internal_qualifiers[rel] = qual_map

    # Call-graph edges are conservative: same-file definitions shadow other files, exactly one
    # same-language cross-file candidate is allowed, and ambiguous names are skipped. Resolve each
    # call ONCE here; cross-file hits are stashed in cross_calls so the filegraph below never re-resolves.
    callees: Dict[str, List[str]] = {}
    callers: Dict[str, List[str]] = {}
    cross_calls: List[Tuple[str, str, str]] = []  # (src_file, dst_file, via) for the filegraph
    for f in all_funcs:
        caller_key = key_by_span[(f["file"], f["name"], f["start"], f["end"])]
        callees.setdefault(caller_key, [])
        for c in f["calls"]:
            target = _resolve_call_target(c, f, symbols,
                                          file_internal_qualifiers.get(f["file"], {}))
            if target is None:
                continue
            callee_key = target["key"]
            if callee_key == caller_key:
                continue  # self-recursion is not a caller edge — else a self-only-called fn looks alive
            if callee_key not in callees[caller_key]:
                callees[caller_key].append(callee_key)
            callers.setdefault(callee_key, [])
            if caller_key not in callers[callee_key]:
                callers[callee_key].append(caller_key)
            if target["file"] != f["file"]:
                cross_calls.append((f["file"], target["file"], c))  # local def shadows -> not an edge
    # Every DEFINED function gets a callers entry (empty list = no DIRECT caller). Combined with
    # `referenced` below, an empty list + not-referenced = genuinely dead; empty + referenced = reached
    # indirectly (handler/callback/route table), which the static call graph cannot see as an edge.
    for loc in function_keys.values():
        callers.setdefault(loc["key"], [])
        callees.setdefault(loc["key"], [])
    referenced = sorted(n for n in symbols if tokens.get(n, 0) > len(symbols[n]))

    # File-level module map: edges file -> {dep_file: [via names]}, plus the external libs each file pulls
    # in (NOT traversed). Edges come from BOTH import statements AND cross-file calls, so the graph holds
    # even when reachability is implicit. External libraries are listed but never become graph nodes.
    # (fileset / bybase / module_prefix are already computed above for the qualifier resolver.)
    filegraph: Dict[str, Dict[str, List[str]]] = {}
    external: Dict[str, List[str]] = {}

    def _edge(src_file, dst_file, label):
        if dst_file and dst_file != src_file and dst_file in fileset:
            d = filegraph.setdefault(src_file, {}).setdefault(dst_file, [])
            if label and label not in d:
                d.append(label)

    for rel, imps in imports_map.items():
        for imp in imps:
            resolved = _resolve_import(imp, rel, lang_of.get(rel, ""), fileset, bybase, module_prefix)
            if resolved:
                for nm in (imp["names"] or [imp["spec"].rsplit("/", 1)[-1]]):
                    _edge(rel, resolved, nm)
            else:
                tag = f"<{imp['spec']}>" if imp.get("system") else imp["spec"]
                external.setdefault(rel, [])
                if tag not in external[rel]:
                    external[rel].append(tag)
    # Cross-file calls reuse the edges the call graph already resolved above (no second resolution pass).
    for src_file, dst_file, via in cross_calls:
        _edge(src_file, dst_file, via)

    skipped_count = len(skipped)
    unsupported_count = sum(1 for s in skipped if s["reason"] == "unsupported")
    too_large_count = sum(1 for s in skipped if s["reason"] == "too_large")
    unreadable_count = sum(1 for s in skipped if s["reason"] == "unreadable")

    return {
        "scope": scope_abs,
        "treesitter": bool(_TS_AVAILABLE),
        "files": files,
        "skipped": skipped,  # [{path, reason}] — symlink/unsupported/gitignored/too_large/unreadable
        "languages": languages,
        "backends": backends,  # per-language parser used: {lang: {ast|treesitter|regex: file_count}}
        "symbols": symbols,
        "constants": constants,
        "callees": {k: sorted(set(v)) for k, v in callees.items()},
        "callers": {k: sorted(set(v)) for k, v in callers.items()},
        "referenced": referenced,
        "function_keys": function_keys,
        "exports": exports_map,
        "imports_external": external,
        "filegraph": {k: {d: sorted(v) for d, v in deps.items()} for k, deps in filegraph.items()},
        "entrypoints": entrypoints,
        "summary": {
            "file_count": len(files),
            # Config/IaC files (.json fixtures, YAML, etc.) are indexed for grep but carry no analyzable
            # surface; the coverage-mode (thematic vs partition) decision uses source_file_count so a
            # fixture-heavy dir does not inflate the count and flip a small source tree into partition mode.
            "source_file_count": sum(1 for f in files if f["language"] != "config"),
            "function_count": sum(len(v) for v in symbols.values()),
            "entrypoint_count": len(entrypoints),
            "constant_count": len(constants),
            "edge_count": sum(len(d) for d in filegraph.values()),
            "skipped_count": skipped_count,
            "unsupported_count": unsupported_count,
            "too_large_count": too_large_count,
            "unreadable_count": unreadable_count,
        },
    }


# --------------------------------------------------------------------------- subcommands

def _load_index_arg(path: Optional[str]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if path is None:
        return None, None
    if not os.path.isfile(path):
        return None, f"recon: index not found: {path}"
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), None
    except Exception as e:
        return None, f"recon: invalid index {path}: {e}"


def cmd_index(args) -> int:
    idx = build_index(args.scope, args.max_bytes,
                      only=_read_list(args.files) if args.files else None)
    out = json.dumps(idx, indent=None if args.compact else 2)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(out)
        s = idx["summary"]
        # Non-python languages that fell ENTIRELY to regex while the library is on = a missing/broken
        # grammar — surface it so a precise audit isn't silently running degraded for that language.
        degraded = sorted(l for l, b in idx.get("backends", {}).items()
                          if l != "python" and "treesitter" not in b and "regex" in b)
        note = f"  [degraded (regex) for: {', '.join(degraded)}]" if idx["treesitter"] and degraded else ""
        skip_note = ""
        if s.get("skipped_count", 0):
            parts = []
            if s.get("unsupported_count", 0):
                parts.append(f"{s['unsupported_count']} unsupported")
            if s.get("too_large_count", 0):
                parts.append(f"{s['too_large_count']} too_large")
            if s.get("unreadable_count", 0):
                parts.append(f"{s['unreadable_count']} unreadable")
            symlink_count = s["skipped_count"] - s.get("unsupported_count", 0) - s.get("too_large_count", 0) - s.get("unreadable_count", 0)
            if symlink_count > 0:
                parts.append(f"{symlink_count} symlink/gitignored")
            skip_note = f"  skipped {s['skipped_count']} ({', '.join(parts)})"
        print(f"recon: {s['file_count']} files, {s['function_count']} functions, "
              f"{s['entrypoint_count']} entry points, {s['constant_count']} constants "
              f"(tree-sitter: {'on' if idx['treesitter'] else 'off — degraded'}){note}{skip_note} -> {args.out}")
    else:
        print(out)
    return 0


def _read_list(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip()]


def _target_name_file(target: str) -> Tuple[Optional[str], str, Optional[int]]:
    if "#" in target:
        file, name = target.split("#", 1)
        line = None
        if ":" in name and name.rsplit(":", 1)[1].isdigit():
            name, lstr = name.rsplit(":", 1)
            line = int(lstr)
        return file, name, line
    return None, target, None


def _strip_dot_slash(file: str) -> str:
    """Remove a single leading './' relative prefix (NOT str.lstrip('./'), which strips a whole
    character set: '../a/db.py'.lstrip('./') -> 'a/db.py', and 'imdb.py' would then suffix-match)."""
    return file[2:] if file.startswith("./") else file


def _file_suffix_match(loc_file: str, needle: str) -> bool:
    """Path-segment-anchored suffix match: needle 'auth/db.py' matches 'src/auth/db.py' but NOT
    'fakeauth/db.py' or 'imdb.py'. Mirrors the correct idiom already used in _resolve_import."""
    return loc_file == needle or loc_file.endswith("/" + needle)


def _loc_candidates(idx: Dict[str, Any], name: str, file: Optional[str],
                    line: Optional[int] = None) -> List[Dict[str, Any]]:
    locs = list(idx.get("symbols", {}).get(name, []))
    if file:
        needle = _strip_dot_slash(file)
        locs = [loc for loc in locs if _file_suffix_match(loc.get("file", ""), needle)]
    if line is not None:
        locs = [loc for loc in locs if loc.get("start") == line]
    return locs


def _candidate_lines(name: str, locs: List[Dict[str, Any]]) -> str:
    lines = []
    for loc in locs:
        target = loc.get("id") or _function_id(loc.get("file", "?"), name)
        lines.append(f"  - {target} ({loc.get('file', '?')}:{loc.get('start', '?')})")
    return "\n".join(lines)


def _resolve_index_target(idx: Dict[str, Any], target: str) -> Tuple[Optional[str], Optional[str],
                                                                     Optional[Dict[str, Any]],
                                                                     Optional[str]]:
    file, name, line = _target_name_file(target)
    locs = _loc_candidates(idx, name, file, line)
    if not locs:
        return None, None, None, f"recon: no function found for {target!r}"
    if len(locs) > 1:
        return None, None, None, (
            f"recon: ambiguous function {name!r}; use file#function or file#function:line:\n"
            f"{_candidate_lines(name, locs)}"
        )
    loc = locs[0]
    return (loc.get("key") or _graph_key(name, loc["file"], idx.get("symbols", {}), loc.get("start")),
            name, loc, None)


def _loc_for_key(idx: Dict[str, Any], key: str) -> Optional[Dict[str, Any]]:
    loc = idx.get("function_keys", {}).get(key)
    if loc:
        return loc
    if key in idx.get("symbols", {}) and idx["symbols"][key]:
        return dict(idx["symbols"][key][0], name=key)
    if "#" in key:
        file, name, line = _target_name_file(key)
        locs = _loc_candidates(idx, name, file, line)
        if len(locs) == 1:
            return dict(locs[0], name=name)
    return None


_EXTRACT_CONTEXT_DEFAULT = 60  # default lines above+below for the fallback window


def cmd_extract(args) -> int:
    idx, err = _load_index_arg(args.index)
    if err:
        print(err, file=sys.stderr)
        return 1
    context_lines = getattr(args, "context_lines", _EXTRACT_CONTEXT_DEFAULT)
    target = args.target
    file = fn = line = None
    if "#" not in target and ":" in target and target.rsplit(":", 1)[1].isdigit():
        file, lstr = target.rsplit(":", 1)
        line = int(lstr)
    else:
        file, fn, _ = _target_name_file(target)  # file#fn[:line] or bare fn

    scope = idx["scope"] if idx else os.path.abspath(".")
    resolved_loc = None  # the indexed symbol for this span, when one exists (carries key + taint)
    if idx and fn:
        _, _, loc, err = _resolve_index_target(idx, target)
        if err:
            print(err, file=sys.stderr)
            return 1
        resolved_loc = loc
        span = (loc["file"], loc["start"], loc["end"])
    else:
        span = _find_span(idx, file, fn, line, scope)
        if idx and span:
            resolved_loc = _loc_at(idx, span[0], span[1])  # file:line target -> recover its symbol

    # Resolve the target file path for the fallback window (used when span is None).
    target_file = file
    if target_file is None and fn is not None and idx:
        # Bare function name with no file: can't open a file without a path; bail normally.
        pass

    if not span:
        # No enclosing function found. If we have a file:line target, emit a line-centered
        # window of context_lines above and below so config/IaC files are still useful.
        if target_file and line is not None:
            full = target_file if os.path.isabs(target_file) else os.path.join(scope, target_file)
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    all_lines = f.read().splitlines()
            except OSError as e:
                print(f"recon: cannot read {full}: {e}", file=sys.stderr)
                return 1
            n_lines = len(all_lines)
            win_start = max(1, line - context_lines)
            win_end = min(n_lines, line + context_lines)
            snippet = "\n".join(all_lines[win_start - 1:win_end])
            rel = os.path.relpath(full, scope)
            print(f"# {rel}:{win_start}-{win_end}\n# fallback window, not exact function\n{snippet}")
            return 0
        print(f"recon: no function found for {target!r}", file=sys.stderr)
        return 1
    fpath, start, end = span
    full = fpath if os.path.isabs(fpath) else os.path.join(scope, fpath)
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError as e:
        print(f"recon: cannot read {full}: {e}", file=sys.stderr)
        return 1
    snippet = "\n".join(lines[start - 1:end])
    # Header carries the STABLE symbol key (file#name, line-suffixed only on duplicate names) for a
    # line-shift-resistant finding fingerprint, plus the direct param->call-arg taint summary for this
    # function (precise backends only — a `# taint: none` line under the regex backend is NOT proof of
    # safety, just that the degraded backend can't compute it).
    header = f"# {os.path.relpath(full, scope)}:{start}-{end}"
    key = (resolved_loc.get("id") or resolved_loc.get("key")) if resolved_loc else None
    if key:
        header += f"  key={key}"
    out_lines = [header]
    if resolved_loc is not None:
        tl = resolved_loc.get("taint") or []
        if tl:
            flows = ", ".join(f"{','.join(t['params'])}->{t['call']}(...)" for t in tl)
            out_lines.append(f"# taint: {flows}")
        else:
            out_lines.append("# taint: none detected (direct param->arg; precise backend only)")
    out_lines.append(snippet)
    print("\n".join(out_lines))
    return 0


def _loc_at(idx: Dict[str, Any], file: str, start: int) -> Optional[Dict[str, Any]]:
    """The symbol loc whose (file, start) match a resolved span — used to surface key=/taint for a
    file:line extract target (the fn-name path already has the loc from _resolve_index_target)."""
    needle = _strip_dot_slash(file)
    for name, locs in idx.get("symbols", {}).items():
        for loc in locs:
            if loc.get("start") == start and _file_suffix_match(loc.get("file", ""), needle):
                return dict(loc, name=name)
    return None


def _find_span(idx, file, fn, line, scope) -> Optional[Tuple[str, int, int]]:
    if idx and file and line is not None:
        cand = [l for name in idx.get("symbols", {}) for l in idx["symbols"][name]
                if _file_suffix_match(l["file"], _strip_dot_slash(file)) and l["start"] <= line <= l["end"]]
        if cand:
            cand.sort(key=lambda l: l["end"] - l["start"])
            return (cand[0]["file"], cand[0]["start"], cand[0]["end"])
    # live parse fallback (single file)
    if file:
        full = file if os.path.isabs(file) else os.path.join(scope, file)
        fi = parse_file(full, DEFAULT_MAX_BYTES)
        if fi:
            for f in fi.functions:
                if (fn and f["name"] == fn) or (line is not None and f["start"] <= line <= f["end"]):
                    return (file, f["start"], f["end"])
    return None


def cmd_callers(args) -> int:
    idx, err = _load_index_arg(args.index)
    if err:
        print(err, file=sys.stderr)
        return 1
    target = args.symbol
    file, name, _ = _target_name_file(target)
    if idx:
        key, name, loc, err = _resolve_index_target(idx, target)
        if err:
            print(err, file=sys.stderr)
            return 1
        callers = idx.get("callers", {}).get(key, [])
        referenced = name in idx.get("referenced", [])
        label = key or target
        if callers:
            print(f"{label}: {len(callers)} direct caller(s):")
            for c in callers:
                where = _loc_for_key(idx, c) or {}
                print(f"  - {c}  ({where.get('file','?')}:{where.get('start','?')})")
        elif loc and loc.get("entrypoint"):
            print(f"{label}: NO in-code callers, but it IS an entry point ({loc['entrypoint']}) — the "
                  f"framework/runtime invokes it with attacker-controlled input. REACHABLE, not dead code.")
        elif referenced:
            print(f"{label}: no DIRECT callers, but its name is referenced as a VALUE elsewhere "
                  f"(handler/callback/route table?) — treat as potentially reachable; verify the "
                  f"registration before discarding.")
        else:
            print(f"{label}: NO callers and not referenced anywhere — likely dead code or an external "
                  f"entry point.")
        return 0
    # live rg fallback, only when --index was omitted
    hits = _rg(rf"\b{re.escape(name)}\s*\(", idx["scope"] if idx else ".")
    if hits:
        print(f"{name}: rg call-site hits (no index — unverified):")
        print("\n".join(hits[:40]))
    else:
        print(f"{name}: no call sites found")
    return 0


def cmd_const(args) -> int:
    idx, err = _load_index_arg(args.index)
    if err:
        print(err, file=sys.stderr)
        return 1
    name = args.name
    if idx and name in idx.get("constants", {}):
        for d in idx["constants"][name]:
            print(f"{name} = {d['value']}   ({d['file']})")
        return 0
    if idx:
        print(f"{name}: not found in index")
        return 0
    hits = _rg(rf"\b{re.escape(name)}\b", idx["scope"] if idx else ".")
    defs = [h for h in hits if re.search(r"#define|const|=", h)]
    if defs:
        print(f"{name}: definition candidates (no index — verify):")
        print("\n".join(defs[:20]))
    elif hits:
        print(f"{name}: usages only, no definition found:")
        print("\n".join(hits[:20]))
    else:
        print(f"{name}: not found")
    return 0


def cmd_shard(args) -> int:
    if args.n <= 0:
        print("recon: shard --n must be > 0", file=sys.stderr)
        return 1
    if args.i < 0 or args.i >= args.n:
        print("recon: shard --i must satisfy 0 <= i < n", file=sys.stderr)
        return 1
    idx, err = _load_index_arg(args.index)
    if err:
        print(err, file=sys.stderr)
        return 1
    files = [f["path"] for f in idx["files"]]
    if args.by == "dir":
        files.sort(key=lambda p: (os.path.dirname(p), p))  # group same-dir files adjacently
    else:
        files.sort()
    # Contiguous chunks, not round-robin: keeps a directory's files together in one shard so a lane
    # gets related files for context. With n > file count the tail shards are empty (a no-file lane
    # just reports nothing) — same edge round-robin had.
    chunk = (len(files) + args.n - 1) // args.n
    shard = files[args.i * chunk:(args.i + 1) * chunk]
    print("\n".join(shard))
    return 0


def cmd_map(args) -> int:
    idx, err = _load_index_arg(args.index)
    if err:
        print(err, file=sys.stderr)
        return 1
    graph = idx.get("filegraph", {})
    exports = idx.get("exports", {})
    external = idx.get("imports_external", {})
    hops = max(1, args.hops)

    if args.focus:
        focus = [f.strip() for f in args.focus.split(",") if f.strip()]
        fileset = {f["path"] for f in idx["files"]}
        focus = [f for f in focus if f in fileset] or focus
    else:
        # default: files holding entry points (where untrusted input enters); else highest-degree files
        focus = sorted({e["file"] for e in idx.get("entrypoints", [])})
        if not focus:
            deg: Dict[str, int] = {}
            for s, deps in graph.items():
                deg[s] = deg.get(s, 0) + len(deps)
                for d in deps:
                    deg[d] = deg.get(d, 0) + 1
            focus = [f for f, _ in sorted(deg.items(), key=lambda kv: -kv[1])[:3]]
    if not focus:
        print("recon: no focus files (empty graph)")
        return 0

    # BFS over outgoing edges (the files each file references) up to `hops`.
    visited = set(focus)
    order: List[str] = []
    frontier = list(focus)
    depth = 0
    while frontier and depth <= hops and len(order) < args.max:
        nextf = []
        for n in frontier:
            if n not in order:
                order.append(n)
            if depth < hops:
                for dep in graph.get(n, {}):
                    if dep not in visited:
                        visited.add(dep)
                        nextf.append(dep)
        frontier = nextf
        depth += 1

    def _lbl(names):
        names = list(names)
        head = ", ".join(names[:6])
        return head + (f" +{len(names) - 6}" if len(names) > 6 else "")

    print(f"# module map  focus={focus}  hops<={hops}  internal-only (external libs collapsed)")
    for n in order[:args.max]:
        exp = exports.get(n, [])
        exp_s = f"  exp[{_lbl(exp)}]" if exp else ""
        deps = graph.get(n, {})
        if deps:
            dep_s = " -> " + "  ".join(f"{d}({_lbl(v)})" for d, v in sorted(deps.items()))
        else:
            dep_s = " -> (leaf)"
        print(f"{n}{exp_s}{dep_s}")
    ext_lines = [f"{n}: {', '.join(external[n])}" for n in order if external.get(n)]
    if ext_lines:
        print("# external libs (not traversed):")
        for line in ext_lines[:args.max]:
            print(f"  {line}")
    return 0


def cmd_summary(args) -> int:
    idx, err = _load_index_arg(args.index)
    if err:
        print(err, file=sys.stderr)
        return 1
    s = idx["summary"]
    # Group skipped by reason for the summary view; full list lives in idx["skipped"].
    skipped_by_reason: Dict[str, List[str]] = {}
    for item in idx.get("skipped", []):
        skipped_by_reason.setdefault(item["reason"], []).append(item["path"])
    print(json.dumps({
        "summary": s,
        "languages": idx["languages"],
        "treesitter": idx["treesitter"],
        "backends": idx.get("backends", {}),  # which parser ran per language (regex = degraded)
        "entrypoints": idx["entrypoints"][:50],
        "skipped_by_reason": {k: v[:20] for k, v in skipped_by_reason.items()},  # top 20 per reason
    }, indent=2))
    return 0


# Short, OS-agnostic pointer printed when the binary is absent. Full per-OS install
# instructions live in secure-review/SKILL.md; this is just a breadcrumb in the JSON.
_SCANNER_INSTALL_HINT = (
    "optional: install secrets-scanner (brew install --cask whit3rabbit/tap/secrets-scanner, "
    "or cargo install secrets_scanner, or a release binary from "
    "github.com/whit3rabbit/secrets-scanner); see secure-review/SKILL.md"
)


def cmd_scan(args) -> int:
    """Optional deterministic secret scan via the external secrets-scanner binary.

    Mirrors the _rg pattern: shutil.which gates the invocation. Absence is EXPECTED, not an
    error (exit 0, ran=false) so the audit degrades cleanly instead of failing closed. The
    binary is the deterministic engine; this is a thin detect -> run -> parse wrapper that
    normalizes output for the workflow. Fingerprints pass through verbatim (the baseline key)."""
    name = args.bin or os.environ.get("SECRETS_SCANNER_BIN") or "secrets-scanner"
    binpath = shutil.which(name) or (name if os.path.isfile(name) and os.access(name, os.X_OK) else None)
    if not binpath:
        print(json.dumps({
            "ran": False,
            "scanner": name,
            "reason": f"secrets-scanner not found on PATH (looked for '{name}')",
            "install": _SCANNER_INSTALL_HINT,
        }, indent=2))
        return 0

    cmd = [binpath, "scan", args.scope, "--format", getattr(args, "format", "json")]
    if getattr(args, "changed_files", False):
        cmd.append("--changed-files")
        if args.base:
            cmd += ["--base", args.base]
    if args.max_file_size:
        cmd += ["--max-file-size", str(args.max_file_size)]
    # Read the baseline only when it actually exists; passing a missing file would error the scanner.
    if args.baseline and os.path.isfile(args.baseline):
        cmd += ["--baseline", args.baseline]

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except Exception as e:  # binary present but unrunnable (perms, arch) -> treat as not-run, don't crash
        print(json.dumps({
            "ran": False, "scanner": binpath,
            "reason": f"secrets-scanner failed to execute: {e}", "install": _SCANNER_INSTALL_HINT,
        }, indent=2))
        return 0

    # Exit 0 = no findings, 1 = findings; both normal. 2 = incomplete coverage (scan errors). Other = real failure.
    if r.returncode not in (0, 1, 2):
        print(json.dumps({
            "ran": False, "scanner": binpath,
            "reason": f"secrets-scanner exited {r.returncode}: {(r.stderr or '').strip()[:300]}",
            "install": _SCANNER_INSTALL_HINT,
        }, indent=2))
        return 0

    try:
        parsed = json.loads(r.stdout or "[]")
    except json.JSONDecodeError as e:
        print(json.dumps({
            "ran": False, "scanner": binpath,
            "reason": f"could not parse secrets-scanner JSON output: {e}", "install": _SCANNER_INSTALL_HINT,
        }, indent=2))
        return 0

    # Tolerate both a bare array and an object wrapping {findings:[...]}.
    raw = parsed.get("findings", []) if isinstance(parsed, dict) else parsed
    findings = []
    for f in raw if isinstance(raw, list) else []:
        if not isinstance(f, dict):
            continue
        findings.append({
            "file": f.get("file"),
            "line": f.get("line"),
            "col": f.get("col"),
            "rule_id": f.get("rule_id"),
            "rule_description": f.get("rule_description"),
            "entropy": f.get("entropy"),
            "fingerprint": f.get("fingerprint"),  # baseline key — pass through verbatim
        })
    print(json.dumps({
        "ran": True,
        "scanner": binpath,
        "count": len(findings),
        "incomplete": r.returncode == 2,
        "findings": findings,
    }, indent=2))
    return 0


# Cap line length scanned in the stdlib _rg fallback. Every caller passes a re.escape()'d (literal)
# pattern, so catastrophic backtracking is not reachable today — but re.search over arbitrary file
# lines is still unbounded work on a pathological single line (a minified/vendored blob can be one
# multi-MB line). Skip those lines so the fallback can't be turned into a CPU/memory DoS by a hostile
# tree. ripgrep (the preferred path) is already bounded by its own timeout. Ceiling, not a guess:
# raise it only if a real source line legitimately exceeds it (none should).
_RG_MAX_LINE_BYTES = 100_000


def _rg(pattern: str, root: str, max_hits: int = 60) -> List[str]:
    rg = shutil.which("rg")
    if rg:
        try:
            r = subprocess.run([rg, "-n", "--no-heading", "-m", str(max_hits), pattern, root],
                               capture_output=True, text=True, timeout=30)
            return [ln for ln in r.stdout.splitlines() if ln.strip()]
        except Exception:
            pass
    # stdlib fallback walk. Callers MUST pass an escaped/literal pattern (see re.escape at the call
    # sites); a raw user-supplied regex here would reintroduce ReDoS the length cap can't fully fix.
    out = []
    rx = re.compile(pattern)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if Path(fn).suffix.lower() not in LANGUAGES:
                continue
            full = os.path.join(dirpath, fn)
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    for i, line in enumerate(f, 1):
                        if len(line) > _RG_MAX_LINE_BYTES:
                            continue  # pathologically long line (minified blob) — skip, don't scan
                        if rx.search(line):
                            out.append(f"{os.path.relpath(full, root)}:{i}:{line.rstrip()}")
                            if len(out) >= max_hits:
                                return out
            except OSError:
                continue
    return out


# --------------------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="recon.py", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("index", help="walk the tree and write the recon artifact")
    pi.add_argument("scope")
    pi.add_argument("--out", default=None, help="write JSON here (default: stdout)")
    pi.add_argument("--files", default=None, help="file of newline-separated paths to limit the walk (diff mode)")
    pi.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    pi.add_argument("--compact", action="store_true")
    pi.set_defaults(func=cmd_index)

    pe = sub.add_parser("extract", help="print the exact function body")
    pe.add_argument("target", help="file#fn | file:line | fn")
    pe.add_argument("--index", default=None)
    pe.add_argument("--context-lines", type=int, default=_EXTRACT_CONTEXT_DEFAULT,
                    dest="context_lines",
                    help="lines of context above+below for the fallback window when no enclosing "
                         "function is found (default: %(default)s)")
    pe.set_defaults(func=cmd_extract)

    pc = sub.add_parser("callers", help="deterministic caller list")
    pc.add_argument("symbol")
    pc.add_argument("--index", default=None)
    pc.set_defaults(func=cmd_callers)

    pk = sub.add_parser("const", help="resolved constant value")
    pk.add_argument("name")
    pk.add_argument("--index", default=None)
    pk.set_defaults(func=cmd_const)

    ps = sub.add_parser("shard", help="deterministic file slice")
    ps.add_argument("--index", required=True)
    ps.add_argument("--i", type=int, required=True)
    ps.add_argument("--n", type=int, required=True)
    ps.add_argument("--by", default="dir", choices=["dir", "name"])
    ps.set_defaults(func=cmd_shard)

    pm = sub.add_parser("summary", help="counts + entry points")
    pm.add_argument("--index", required=True)
    pm.set_defaults(func=cmd_summary)

    pp = sub.add_parser("map", help="compressed internal module map, bounded hops from focus files")
    pp.add_argument("--index", required=True)
    pp.add_argument("--focus", default=None, help="comma-separated focus files (default: entry-point files)")
    pp.add_argument("--hops", type=int, default=2, help="max hops from focus (default 2)")
    pp.add_argument("--max", type=int, default=80, help="max files to print (default 80)")
    pp.set_defaults(func=cmd_map)

    pscan = sub.add_parser("scan", help="optional deterministic secret scan via external secrets-scanner binary")
    pscan.add_argument("scope")
    pscan.add_argument("--bin", default=None, help="scanner binary (else $SECRETS_SCANNER_BIN, else 'secrets-scanner')")
    pscan.add_argument("--changed-files", dest="changed_files", action="store_true", help="scan only changed files (diff mode)")
    pscan.add_argument("--base", default=None, help="base git ref for --changed-files")
    pscan.add_argument("--baseline", default=None, help="fingerprint suppression file (read only if it exists)")
    pscan.add_argument("--max-file-size", dest="max_file_size", type=int, default=None, help="skip files larger than this many bytes")
    # --format is forwarded verbatim to the scanner binary (cmd_scan). recon.py's scan output is always
    # JSON; the flag exists so the documented `scan <scope> --format json` (reconBlock in security-audit.js)
    # actually parses instead of erroring "unrecognized arguments".
    pscan.add_argument("--format", default="json", help="output format forwarded to the scanner binary (default json)")
    pscan.set_defaults(func=cmd_scan)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
