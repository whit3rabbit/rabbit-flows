#!/usr/bin/env python3
"""Validate Claude Code dynamic-workflow scripts against the dynamic-workflows skill rules.

Static linter, stdlib only. Checks the gotchas that are checkable from source text:
runtime API misuse, the throws-at-runtime calls, meta-literal rules, and phase/meta drift.
It can NOT check things only known at runtime (item counts vs caps, whether a note schema is
"compact"). Those stay human judgment.

Usage:
  validate.py <file.js | dir> ...     # files, or dirs scanned for *.js
  validate.py --strict ...            # warnings also fail (exit 1)
  validate.py --selftest              # check the validator itself

Exit 0 = clean (no errors; warnings allowed unless --strict). Exit 1 = problems. Exit 2 = bad usage.
"""
import re
import sys
import subprocess
from pathlib import Path

ERROR, WARN = "error", "warn"


def find_meta_block(src):
    """Return (text, start_index) of the `export const meta = { ... }` object, or (None, -1)."""
    m = re.search(r"export\s+const\s+meta\s*=\s*\{", src)
    if not m:
        return None, -1
    i = src.index("{", m.start())
    depth, j = 0, i
    while j < len(src):
        c = src[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[i : j + 1], m.start()
        j += 1
    return None, -1  # unbalanced


def strip_comments(src):
    """Crude // and /* */ stripper so pattern checks don't fire inside prose comments."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)//.*$", "", src)
    return src


def line_of(src, idx):
    return src.count("\n", 0, idx) + 1


def node_syntax_check(src):
    """Run `node --check` on the script with `export` stripped and wrapped in an async fn — so the
    real-runtime shape (top-level export + top-level await/return) parses as plain JS. Returns an
    error string or None. Skips silently if node is absent."""
    # Strip every `export const meta` (the real one + any decoy inside a header comment) so the
    # script parses as plain JS. A comment-bound match stays inside its comment either way.
    src = re.sub(r"\bexport\s+const\s+meta", "const meta", src)
    wrapped = "(async () => {\n" + src + "\n})()\n"
    try:
        p = subprocess.run(
            ["node", "--check", "-"],
            input=wrapped,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None  # node not available — skip, not a failure
    if p.returncode != 0:
        lines = [l for l in p.stderr.splitlines() if l.strip() and not l.startswith("(node:")]
        err_line = next((l.strip() for l in lines if "Error" in l), lines[0].strip() if lines else "syntax error")
        return f"JS syntax error: {err_line}"
    return None


def check(path):
    """Return list of (severity, line, message) for one workflow file."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    code = strip_comments(raw)
    out = []

    def err(line, msg):
        out.append((ERROR, line, msg))

    def warn(line, msg):
        out.append((WARN, line, msg))

    # --- meta block: required, pure literal ---
    meta, meta_at = find_meta_block(code)
    if meta is None:
        err(1, "no `export const meta = { ... }` block (required, must be first thing).")
    else:
        if not re.search(r"\bname\s*:", meta):
            err(line_of(code, meta_at), "meta is missing required `name`.")
        if not re.search(r"\bdescription\s*:", meta):
            err(line_of(code, meta_at), "meta is missing required `description`.")
        # pure-literal rule: no interpolation, spreads, or calls inside meta
        if "${" in meta:
            err(line_of(code, meta_at), "meta must be a pure literal: contains `${...}` interpolation.")
        if "..." in meta:
            err(line_of(code, meta_at), "meta must be a pure literal: contains a `...` spread.")
        if re.search(r"[A-Za-z_$][\w$]*\s*\(", meta):
            err(line_of(code, meta_at), "meta must be a pure literal: contains a function call.")

    # --- runtime-throwing calls (would crash the run; break resume) ---
    for pat, label in [
        (r"\bDate\.now\s*\(", "Date.now()"),
        (r"\bMath\.random\s*\(", "Math.random()"),
        (r"\bnew\s+Date\s*\(\s*\)", "argless new Date()"),
    ]:
        for m in re.finditer(pat, code):
            err(line_of(code, m.start()), f"{label} throws in a workflow script (breaks resume). Pass time via args; vary randomness by index.")

    # --- no filesystem / shell from the script itself ---
    for m in re.finditer(r"""(?:require\(|from\s+|import\s*\()\s*['"](fs|node:fs|child_process|node:child_process|path|node:path)['"]""", code):
        err(line_of(code, m.start()), "scripts can't touch the filesystem/shell directly — only agents can. Do it in a finalize-stage agent.")

    # --- agent() option misuse ---
    if re.search(r"\bskills\s*:", code):
        warn(1, "`skills:` found — agent() has NO skills option. Put the worker's contract inline in its prompt.")
    for m in re.finditer(r"\bagentType\s*:", code):
        warn(line_of(code, m.start()), "agentType resolves only session-registered agents; a freshly-copied file won't resolve. Prefer an inline contract.")

    # --- null-safety: parallel/pipeline results can contain null ---
    if re.search(r"\b(parallel|pipeline)\s*\(", code) and "filter(Boolean)" not in code:
        warn(1, "parallel()/pipeline() used but no `.filter(Boolean)` anywhere — agents return null on skip/error.")

    # --- phase() <-> meta.phases drift ---
    if meta is not None:
        declared = set(re.findall(r"title\s*:\s*['\"]([^'\"]+)['\"]", meta))
        # A phase is "used" by a phase() call OR by a `phase:` option on an agent() call.
        called = set(re.findall(r"\bphase\s*\(\s*['\"]([^'\"]+)['\"]", code))
        called |= set(re.findall(r"\bphase\s*:\s*['\"]([^'\"]+)['\"]", code))
        for t in sorted(called - declared):
            warn(1, f"phase('{t}') has no matching title in meta.phases (it gets its own group; declare it for the progress view).")
        for t in sorted(declared - called):
            warn(1, f"meta.phases declares '{t}' but no phase('{t}') call uses it.")

    # --- JS syntax (best effort) ---
    syn = node_syntax_check(raw)
    if syn:
        err(1, syn)

    return out


def iter_files(args):
    for a in args:
        p = Path(a)
        if p.is_dir():
            yield from sorted(p.glob("*.js"))
        elif p.is_file():
            yield p
        else:
            print(f"skip (not found): {a}", file=sys.stderr)


def run(paths, strict):
    files = list(iter_files(paths))
    if not files:
        print("no .js files to validate", file=sys.stderr)
        return 2
    total_err = total_warn = 0
    for f in files:
        findings = check(f)
        errs = [x for x in findings if x[0] == ERROR]
        warns = [x for x in findings if x[0] == WARN]
        total_err += len(errs)
        total_warn += len(warns)
        if not findings:
            print(f"OK   {f}")
            continue
        print(f"---  {f}")
        for sev, ln, msg in sorted(findings, key=lambda x: (x[0] != ERROR, x[1])):
            print(f"  {sev:5} {f}:{ln}: {msg}")
    print(f"\n{len(files)} file(s): {total_err} error(s), {total_warn} warning(s)")
    return 1 if total_err or (strict and total_warn) else 0


def selftest():
    bad = """
export const meta = { name: 'x', phases: [{title: 'A'}, {title: build()}] }
const t = Date.now()
const r = Math.random()
import fs from 'fs'
const a = await agent('hi', { skills: ['z'], agentType: 'q' })
const b = await parallel([])
phase('B')
return a
"""
    p = Path("/tmp/_wf_selftest.js")
    p.write_text(bad)
    f = check(p)
    msgs = " | ".join(m for _, _, m in f)
    expect = ["Date.now", "Math.random", "filesystem", "skills:", "agentType",
              "filter(Boolean)", "pure literal", "no matching title", "no phase"]
    missing = [e for e in expect if e not in msgs]
    assert not missing, f"selftest missed: {missing}\n got: {msgs}"
    # a clean snippet should yield no errors
    good = "export const meta = { name: 'x', description: 'd', phases: [{title:'A'}] }\n" \
           "phase('A')\nconst r = (await parallel([])).filter(Boolean)\nreturn r\n"
    p.write_text(good)
    assert not [x for x in check(p) if x[0] == ERROR], "clean snippet flagged an error"
    p.unlink()
    print("selftest passed")
    return 0


def main(argv):
    strict = "--strict" in argv
    rest = [a for a in argv if a != "--strict"]
    if "--selftest" in rest:
        return selftest()
    if not rest:
        print(__doc__)
        return 2
    return run(rest, strict)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
