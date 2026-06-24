---
title: recon — Security Recon Engine
diataxisType: reference
---

<!-- generated: python lane, signal: 8x .py files (no pyproject.toml/setup.py) -->

# recon

`plugins/workflow-kit/skills/secure-review/scripts/recon.py`

Deterministic security recon for the security-audit workflow. Emits one JSON artifact that every audit agent reads instead of grepping the tree itself: file/symbol index, resolved constants, a caller/callee graph, and detected entry points. This moves recon out of the LLM loop (cheaper, deterministic, computed once) and lets the admission gate trace reachability against ground truth.

**Backends, in order of accuracy (graceful degradation):**

1. Python files: stdlib `ast` module (precise).
2. Other languages: tree-sitter via `tree_sitter_language_pack` if installed (precise spans and calls).
3. Fallback: regex/brace heuristics. Always available; no third-party dependencies required.

**Subcommands:** `index`, `extract`, `callers`, `const`, `shard`, `summary`, `map`

**Self-checks:** `python3 test_recon.py` (stdlib only, runs in degraded mode).

---

## Module-level constants

| Name | Type | Description |
|---|---|---|
| `LANGUAGES` | `Dict[str, Tuple[str, Optional[str]]]` | Extension to `(language_label, grammar_name)` map. Covers Python, JS/TS, Go, Rust, Java, C/C++, C#, Ruby, PHP, Swift, Kotlin, Scala, Bash. |
| `DEFAULT_MAX_BYTES` | `int` | `1_000_000` — skip files larger than this (binary/generated blobs). |
| `SKIP_DIRS` | `set` | Directory names skipped during tree walk (`.git`, `node_modules`, `.venv`, etc.). |
| `ENTRYPOINT_PATTERNS` | `List[Tuple[str, re.Pattern]]` | Regex patterns that identify untrusted-input entry points across 17 patterns (argparse, Flask/Express routes, Go/Rust/Java/Spring/JAX-RS/ASP.NET entry points, etc.). |

---

## FileInfo

```python
class FileInfo:
    path: str
    language: str
    loc: int
    backend: str        # "ast" | "treesitter" | "regex"
    functions: List[Dict[str, Any]]    # {name, start, end, calls:[]}
    constants: Dict[str, str]
    entrypoints: List[Dict[str, Any]]  # {kind, line}
    idents: Dict[str, int]             # identifier token -> count
    imports: List[Dict[str, Any]]      # {spec, names, level, system}
    exports: List[str]
```

Per-file model. `functions` entries carry `calls` listing names called within the function's own body (nested scopes excluded). `backend` records which parser ran for this file.

---

## Parsers

### `parse_python(path, src)`

```python
parse_python(path: str, src: str) -> FileInfo
```

Parse a Python file using `ast`. Extracts functions (sync and async), upper-case module constants, and entrypoints. Falls back to `parse_regex` on `SyntaxError`.

### `parse_treesitter(path, src, language, grammar)`

```python
parse_treesitter(path: str, src: str, language: str, grammar: str) -> Optional[FileInfo]
```

Parse a source file using the tree-sitter language pack. Returns `None` if tree-sitter is unavailable or the grammar fails. Per-grammar failures are isolated; a single bad grammar does not disable tree-sitter for other languages in the same run.

### `parse_regex(path, src, language)`

```python
parse_regex(path: str, src: str, language: str) -> FileInfo
```

Regex/brace-heuristic fallback parser. Always available. Covers JS/TS, Go, Rust, C/C++, and a generic fallback for other languages.

### `parse_file(path, max_bytes)`

```python
parse_file(path: str, max_bytes: int) -> Optional[FileInfo]
```

Parse a single file: selects `parse_python`, `parse_treesitter`, or `parse_regex` based on extension. Returns `None` for unsupported extensions, files larger than `max_bytes`, or unreadable files. Also populates `idents`, `imports`, and `exports`.

---

## Index building

### `build_index(scope, max_bytes, only)`

```python
build_index(scope: str, max_bytes: int, only: Optional[List[str]]) -> Dict[str, Any]
```

Walk `scope`, parse every supported source file, and build the full recon artifact. `only` limits the walk to a specific list of relative paths (diff mode). Returns a dict with:

- `scope` — absolute path of the scoped root.
- `treesitter` — whether the tree-sitter backend was available.
- `files` — list of `{path, language, loc, functions, entrypoints}` per file.
- `languages` — file counts per language.
- `backends` — `{language: {backend: count}}` breakdown of which parser ran.
- `symbols` — `{name: [{file, start, end, language, id, key}]}` — all defined function symbols.
- `constants` — `{NAME: [{file, value}]}` — resolved upper-case constants.
- `callees` — `{key: [callee_key, ...]}` — outgoing call edges (same-language, unambiguous).
- `callers` — `{key: [caller_key, ...]}` — incoming call edges.
- `referenced` — names that appear as values more often than they are defined (handlers, callbacks, route tables).
- `function_keys` — `{key: loc_dict}` for key lookup.
- `exports` — `{file: [symbol, ...]}` public exports per file.
- `imports_external` — `{file: [spec, ...]}` external library specs (not traversed).
- `filegraph` — `{src_file: {dst_file: [via_names]}}` internal module graph from imports and cross-file calls.
- `entrypoints` — `[{file, line, kind}]` detected entry points.
- `summary` — counts: `file_count`, `function_count`, `entrypoint_count`, `constant_count`, `edge_count`.

### `walk_files(scope, max_bytes, only)`

```python
walk_files(scope: str, max_bytes: int, only: Optional[List[str]]) -> List[str]
```

Return sorted relative paths of all supported source files under `scope`. Skips `SKIP_DIRS`, symlinks, gitignored paths, and files exceeding `max_bytes`. When `only` is given, filters to that list.

---

## Subcommands

### `cmd_index(args)`

```python
cmd_index(args) -> int
```

Walk the tree and write the recon artifact. Writes to `args.out` (file) or stdout. Prints a summary line and a degradation warning if non-Python languages fell entirely to the regex backend while tree-sitter was available.

### `cmd_extract(args)`

```python
cmd_extract(args) -> int
```

Print the exact body of a function. Target format: `file#fn`, `file#fn:line`, `file:line`, or bare `fn`. Reads from `args.index` if provided; falls back to a live parse of a single file.

### `cmd_callers(args)`

```python
cmd_callers(args) -> int
```

Print the deterministic caller list for a symbol from the index. Distinguishes: direct callers, referenced-as-value (no direct caller but name appears as a value — potential handler/callback), and no callers/no reference (likely dead code or external entry point). Falls back to `rg` when no index is given.

### `cmd_const(args)`

```python
cmd_const(args) -> int
```

Look up a resolved constant value from the index. Falls back to `rg` when no index is given.

### `cmd_shard(args)`

```python
cmd_shard(args) -> int
```

Print shard `i` of `n` from the index's file list (deterministic file-partition for parallel audit lanes). `--by dir` groups by directory for contiguous coverage.

### `cmd_map(args)`

```python
cmd_map(args) -> int
```

Print a compressed internal module map bounded to `hops` from `focus` files. Focus defaults to entry-point files; falls back to the highest-degree files. External libraries are collapsed and listed separately, not traversed.

### `cmd_summary(args)`

```python
cmd_summary(args) -> int
```

Print the index summary: counts, languages, tree-sitter availability, backend breakdown, and first 50 entry points.

---

## CLI

### `build_parser()`

```python
build_parser() -> argparse.ArgumentParser
```

Build the `recon.py` argument parser with subcommands: `index`, `extract`, `callers`, `const`, `shard`, `summary`, `map`.

### `main(argv=None)`

```python
main(argv: Optional[List[str]] = None) -> int
```

CLI entry point. Dispatches to the appropriate `cmd_*` function.

---

## Import/export resolution

### `_imports_exports(src, language)`  *(internal)*

Extracts raw import and export lists from source text using language-specific regexes (or `ast` for Python). Called by `parse_file`. Not part of the public surface but produced data appears in `FileInfo.imports` and `FileInfo.exports`.

---

## Utilities

| Function | Description |
|---|---|
| `_ts_parser(grammar)` | Return a cached tree-sitter parser for a grammar, or `None`. Per-grammar failures are isolated. |
