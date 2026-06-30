#!/usr/bin/env python3
"""Walk a directory and produce a structured JSON inventory of source files.

Stdlib only (no pip deps). Uses regex-based best-effort import/export detection
per extension. Output is grounding context for the eatahorse planner workflow.

Usage:
  python3 map_codebase.py --root src/ --out inventory.json
  python3 map_codebase.py --root . --max-files 100 --include "**/*.py"
  python3 map_codebase.py --root . | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'found {d[\"stats\"][\"total\"]} files')"
"""
import argparse
import fnmatch
import json
import os
import re
import sys
from pathlib import Path

# ---- import/export detectors per extension ----
# Each entry: (import_re, export_re) where both are compiled regex patterns.
# Import pattern captures the dependency path from a single import line.
# Export pattern captures the exported name.
IMPORT_PATTERNS = {
    ".py": re.compile(r'^\s*(?:from\s+([\w.]+)\s+import\s+(?:[\w*]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w*]+(?:\s+as\s+\w+)?)*)|import\s+([\w.]+(?:,\s*[\w.]+)*))'),
    ".js": re.compile(r"""^\s*(?:import\s+(?:\{[^}]*\}\s+from\s+['"]([^'"]+)['"]|['"]([^'"]+)['"])|const\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+))"""),
    ".jsx": re.compile(r"""^\s*(?:import\s+(?:\{[^}]*\}\s+from\s+['"]([^'"]+)['"]|['"]([^'"]+)['"])|const\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+))"""),
    ".ts": re.compile(r"""^\s*(?:import\s+(?:\{[^}]*\}\s+from\s+['"]([^'"]+)['"]|type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]|['"]([^'"]+)['"])|const\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+))"""),
    ".tsx": re.compile(r"""^\s*(?:import\s+(?:\{[^}]*\}\s+from\s+['"]([^'"]+)['"]|type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]|['"]([^'"]+)['"])|const\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+))"""),
    ".rs": re.compile(r'^\s*use\s+(?:pub\s+(?:crate\s+)?)?([\w:]+);'),
    ".go": re.compile(r'^\s*import\s+(?:\(?["\'](?:[\w./-]+)["\']|["\']([\w./-]+)["\'])'),
    ".java": re.compile(r'^\s*import\s+(?:static\s+)?([\w.*]+);'),
    ".rb": re.compile(r'^\s*(?:require\s+[\'"]([^\'"]+)|require_relative\s+[\'"]([^\'"]+)|include\s+(\w+(?:::\w+)*)|extend\s+(\w+(?:::\w+)*))'),
    ".swift": re.compile(r'^\s*import\s+(?:[\w]+\s+)?(Swift|Foundation|UIKit|AppKit|[\w]+)\b'),
}
EXPORT_PATTERNS = {
    ".py": re.compile(r'^\s*(?:def\s+(\w+)|class\s+(\w+)|async\s+def\s+(\w+))'),
    ".js": re.compile(r'^\s*(?:export\s+(?:(?:default\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)|let\s+(\w+)|var\s+(\w+)|interface\s+(\w+)|type\s+(\w+)))|function\s+(\w+)|const\s+(\w+)\s*=|async\s+function\s+(\w+))'),
    ".jsx": re.compile(r'^\s*(?:export\s+(?:(?:default\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)|let\s+(\w+)|var\s+(\w+)))|function\s+(\w+)|const\s+(\w+)\s*=|async\s+function\s+(\w+))'),
    ".ts": re.compile(r'^\s*(?:export\s+(?:(?:default\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)|let\s+(\w+)|var\s+(\w+)|interface\s+(\w+)|type\s+(\w+)|enum\s+(\w+)))|function\s+(\w+)|const\s+(\w+)\s*=|async\s+function\s+(\w+))'),
    ".tsx": re.compile(r'^\s*(?:export\s+(?:(?:default\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)|let\s+(\w+)|var\s+(\w+)|interface\s+(\w+)|type\s+(\w+)|enum\s+(\w+)))|function\s+(\w+)|const\s+(\w+)\s*=|async\s+function\s+(\w+))'),
    ".rs": re.compile(r'^\s*pub\s+(?:unsafe\s+)?(?:fn\s+(\w+)|struct\s+(\w+)|enum\s+(\w+)|trait\s+(\w+)|type\s+(\w+)|mod\s+(\w+)|use\s+(\w+)|const\s+(\w+)|macro_rules!\s*\(\s*(\w+)|macro\s+(\w+))'),
    ".go": re.compile(r'^\s*(?:func\s+(?:\([^)]*\)\s+)?(\w+)|type\s+(\w+)\s+(?:struct|interface|func))'),
    ".java": re.compile(r'^\s*(?:public\s+(?:static\s+)?(?:class\s+(\w+)|interface\s+(\w+)|enum\s+(\w+)|record\s+(\w+)|\w+\s+\w+\s+(\w+)\s*\()|private\s+(?:static\s+)?\w+\s+(\w+)\s*\()'),
    ".rb": re.compile(r'^\s*(?:def\s+(?:self\.)?(\w+)|class\s+(\w+)|module\s+(\w+)|attr_(?:accessor|reader|writer)\s+(?::(\w+)))'),
    ".swift": re.compile(r'^\s*(?:public\s+(?:static\s+)?(?:func\s+(\w+)|class\s+(\w+)|struct\s+(\w+)|enum\s+(\w+)|protocol\s+(\w+)|var\s+(\w+)|let\s+(\w+))|func\s+(\w+)|class\s+(\w+)|struct\s+(\w+)|enum\s+(\w+)|protocol\s+(\w+))'),
}
# All extensions we track
KNOWN_EXTS = set(IMPORT_PATTERNS.keys()) | set(EXPORT_PATTERNS.keys())

# Default skip dirs
SKIP_DIRS = frozenset({
    ".git", ".svn", ".hg", ".claude", "__pycache__", "node_modules",
    "target", ".venv", "venv", "env", ".env", "dist", "build", ".build",
    ".next", ".nuxt", ".output", ".turbo", ".cache",
    ".tox", ".eggs", "*.egg-info", ".mypy_cache", ".pytest_cache",
    ".terraform", "vendor", ".bundle", ".gradle", ".idea", ".vscode",
    ".serverless", "coverage", ".nyc_output", ".swc",
    ".docusaurus", ".vitepress_cache", ".parcel-cache",
})
SKIP_EXTS = frozenset({
    ".pyc", ".pyo", ".so", ".dll", ".dylib", ".class", ".o", ".obj",
    ".exe", ".bin", ".wasm",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".svg", ".webp",
    ".mp4", ".mp3", ".avi", ".mov", ".ogg", ".wav",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".pptx",
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    ".DS_Store", ".gitkeep",
})


def detect_imports(line: str, ext: str) -> list[str]:
    """Best-effort import detection. Returns list of dependency paths."""
    pat = IMPORT_PATTERNS.get(ext)
    if not pat:
        return []
    m = pat.search(line)
    if not m:
        return []
    # Collect the first non-None group
    dep = next((g for g in m.groups() if g), None)
    if dep:
        # Handle comma-separated imports (e.g. "import os, sys" -> ["os", "sys"])
        deps = [d.strip() for d in dep.split(',')]
        result = []
        for d in deps:
            # Normalize to a repo-relative path-like string, but only for absolute dotted
            # module paths (e.g. "os.path" -> "os/path"). Relative imports starting with "."
            # (e.g. ".models", "./foo", "../bar") are kept as-is — converting them to "/models"
            # or "//bar" would produce unresolvable paths that pollute the inventory.
            if not d.startswith('.'):
                d = d.replace(".", "/")
            result.append(d)
        return result
    return []


def detect_exports(line: str, ext: str) -> list[str]:
    """Best-effort export detection. Returns list of exported names."""
    pat = EXPORT_PATTERNS.get(ext)
    if not pat:
        return []
    m = pat.search(line)
    if not m:
        return []
    return [g for g in m.groups() if g]


def explore_file(path: Path, rel: str) -> dict | None:
    """Walk one file and return its metadata dict, or None for skip."""
    try:
        size = path.stat().st_size
    except OSError:
        return None
    ext = path.suffix.lower()
    if ext in SKIP_EXTS or size == 0:
        return None
    if ext not in KNOWN_EXTS:
        return {"path": rel, "ext": ext, "size": size, "imports": [], "exports": []}

    imports = []
    exports = []
    max_bytes = 262144  # 256 KiB; cap to avoid huge files
    try:
        with open(path, "rb") as f:
            # --max-files caps count, but a single huge file shouldn't dominate parsing
            raw = f.read(max_bytes)
        text = raw.decode("utf-8", errors="replace")
    except OSError:
        return None

    for line in text.splitlines():
        if len(line) > 2000:
            continue  # skip degenerate lines
        imports.extend(detect_imports(line, ext))
        exports.extend(detect_exports(line, ext))

    return {
        "path": rel,
        "ext": ext,
        "size": size,
        "imports": imports[:20],   # cap to avoid noise
        "exports": exports[:40],
    }


def should_skip_dir(name: str) -> bool:
    return name in SKIP_DIRS or name.startswith(".")


def explore(
    root: Path,
    max_files: int,
    include: list[str] | None,
    exclude: list[str] | None,
) -> dict:
    """Walk root and collect file metadata.

    Returns {files: [...], stats: {total, byExt}}.
    """
    files = []
    total = 0
    root = root.resolve()

    inc_pat = [re.compile(fnmatch.translate(p)) for p in (include or ["*"])]
    exc_pat = [re.compile(fnmatch.translate(p)) for p in (exclude or [])] if exclude else None

    def matches(path: str) -> bool:
        """Does path match include/exclude globs?"""
        ok = any(p.fullmatch(path) for p in inc_pat)
        if not ok:
            return False
        if exc_pat:
            ok = not any(p.fullmatch(path) for p in exc_pat)
        return ok

    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        # Prune skip dirs in-place
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]

        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == ".":
            rel_dir = ""

        for fn in filenames:
            if total >= max_files:
                break
            rel_path = os.path.join(rel_dir, fn) if rel_dir else fn
            if not matches(rel_path):
                continue

            fpath = Path(dirpath) / fn
            meta = explore_file(fpath, rel_path)
            if meta:
                total += 1
                files.append(meta)

    by_ext = {}
    for f in files:
        ext = f["ext"]
        by_ext[ext] = by_ext.get(ext, 0) + 1

    return {
        "files": files,
        "stats": {"total": total, "byExt": by_ext},
        "root": str(root),
    }


def main():
    p = argparse.ArgumentParser(description="Map a codebase to a structured JSON inventory.")
    p.add_argument("--root", default=".", help="Root directory to walk (default: cwd)")
    p.add_argument("--out", help="Output file (default: stdout)")
    p.add_argument("--max-files", type=int, default=500, help="Max files to inventory (default: 500)")
    p.add_argument("--include", nargs="*", help="Include globs (default: all files)")
    p.add_argument("--exclude", nargs="*", help="Exclude globs")
    args = p.parse_args()

    result = explore(Path(args.root), args.max_files, args.include, args.exclude)
    dumped = json.dumps(result, indent=2, ensure_ascii=False)

    if args.out:
        Path(args.out).write_text(dumped, encoding="utf-8")
    else:
        sys.stdout.write(dumped)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
