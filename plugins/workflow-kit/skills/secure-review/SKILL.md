---
name: secure-review
description: Specialist role for defensive security code review. Use when a worker or gate stage audits source for vulnerabilities and must emit evidence-backed findings (injection, authz, secrets, path/file handling, deserialization/SSRF, supply-chain) without producing exploit code. Pairs with the security-audit workflow.
---

# Secure review

> Reference role, for humans and Skill-tool use. Workflow stages do NOT auto-load this skill —
> `agent()` has no `skills` option, and `agentType` only resolves session-registered agents. The
> security-audit workflow's lane stage carries this contract inline; that inline prompt is the runtime
> source of truth. This file is the portable, marketplace-shipped statement of the same role.

You review code to find vulnerabilities the owner should FIX. You never write exploits, payloads,
or step-by-step exploitation — only evidence-backed findings and remediation guidance.

Artifacts: `.security-audit/` baselines can be safely git ignored unless the user wants audit state tracked.

> SENSITIVE OUTPUT: everything under `.security-audit/` (recon index, report, baseline, confirmed
> findings) is a VULNERABILITY INVENTORY. Do NOT commit it or post it publicly. The `security-audit`
> workflow auto-ensures the target repo gitignores this dir; if you run recon.py by hand, add
> `.security-audit/` to `.gitignore` yourself before committing.

## Set up deterministic recon (do this first)

`scripts/recon.py` builds a JSON index (symbols, resolved constants, caller↔callee graph, entry points)
so every later step reads ground truth instead of re-grepping. Run it from the skill's `scripts/` dir:

```bash
# 1. One-time, idempotent: build the cached venv for the OPTIONAL tree-sitter backend INTO this skill
#    folder (scripts/.venv). recon.py also works without it (stdlib + heuristics), just less precise.
PY=$(bash setup_venv.sh) || PY=python3        # prints scripts/.venv/bin/python on success

# 2. Build the index for the target tree (any language).
"$PY" recon.py index <target-path> --out .security-audit/recon.json

# 3. Query it while reviewing (preferred over ad-hoc grep):
"$PY" recon.py const  <NAME>            --index .security-audit/recon.json   # resolved value
"$PY" recon.py callers <fn|file#fn[:line]> --index .security-audit/recon.json   # reachability
"$PY" recon.py extract <file#fn[:line]|file:line> --index .security-audit/recon.json   # exact body
"$PY" recon.py map --focus <file> --hops 2 --index .security-audit/recon.json  # module map (below)
```

`map` prints a compressed, cheap-to-read internal module graph: per file its exports and the in-scope
files it references (via imports AND cross-file calls, labelled by the symbols crossing the edge),
bounded to N hops from the focus files (default: entry-point files). External libraries/headers are
listed once and NOT traversed, so the graph stays internal and small. Use it to understand a codebase's
shape and to bound how far untrusted input can flow from an entry point. Import resolution is real for
Python, JS/TS, Go, C/C++, Ruby (`require_relative`), PHP (`require`/`include`), Java (package→path,
basename fallback), and Rust (`mod`); C# and remaining languages still get internal edges from
cross-file calls even without import resolution. (Imports embedded in string literals can inflate the
external list — they never affect internal edges.)

The venv lives in `scripts/.venv` (git-ignored) and is cached across runs. If `setup_venv.sh` can't
install (no network/pip), recon.py falls back to the stdlib backend automatically — never blocks.

### recon.py command reference

All subcommands except `index` read a prebuilt index via `--index <recon.json>` (without it, `callers`/
`const`/`extract` fall back to a live ripgrep/parse of the current dir).

| Command | Args / flags | What it returns |
|---|---|---|
| `index <scope>` | `--out <f>` (else stdout), `--files <list>` (newline paths, for diff mode), `--max-bytes <n>` (skip larger files, default 1_000_000), `--compact` | Builds + writes the JSON artifact |
| `extract <target>` | `target` = `file#fn[:line]` \| `file:line` \| `fn`; `--index`; `--context-lines <n>` (fallback window for config files) | Exact function body. Header carries `key=<file#name>` (a stable, line-shift-resistant fingerprint of the enclosing function) and a `# taint: <param>-><call>(...)` line listing which params flow DIRECTLY into each call's args (precise backends only — a `# taint: none` line is not proof of safety; recon tracks no transitive/cross-function flow) |
| `callers <symbol>` | `symbol` = `fn` \| `file#fn[:line]`; `--index` | Direct callers; `no DIRECT callers but referenced as a VALUE` = handler/callback; `NO callers and not referenced` = dead code |
| `const <NAME>` | `--index` | Resolved constant value(s) + defining file |
| `map` | `--index`; `--focus <a,b>` (default: entry-point files); `--hops <n>` (default 2); `--max <n>` (default 80) | Compressed internal module graph (imports + cross-file calls), external libs collapsed |
| `shard` | `--index`; `--i <i>` `--n <n>` (required); `--by dir\|name` (default dir) | Deterministic file slice i-of-n (drives file-partition lanes) |
| `summary` | `--index` | Counts, languages, tree-sitter on/off, per-language `backends`, first 50 entry points |
| `scan <scope>` | `--bin <path>` (else `$SECRETS_SCANNER_BIN`, else `secrets-scanner`); `--changed-files --base <ref>`; `--baseline <file>` (read only if it exists); `--max-file-size <n>` | OPTIONAL deterministic secret scan via the external `secrets-scanner` binary. Emits `{ran,count,findings[]}`; `ran:false` (with `reason`+`install`) when the binary is absent — expected, not an error. See "Optional: deterministic secrets scan" below |

A bare `<symbol>`/`<fn>` that is defined in more than one place is **ambiguous** for `callers`/`extract`:
they exit non-zero and print candidate ids instead of a result. Re-run with the printed `file#fn` form,
or `file#fn:line` when one file contains duplicate or overloaded function names. `const` is not
function-keyed; it lists every defining file's value.

### Index JSON shape (what each agent reads)

`files[]` (path, language, loc, function/entrypoint counts),
`symbols{name:[{id,file,start,end,language,key}]}` (`id` = `file#name`, or `file#name:line` for duplicate names in one file; `key` = bare name when unique, else that id),
`function_keys{key:{id,file,start,end,language,name}}` (every defined function, keyed by graph key),
`constants{NAME:[{file,value}]}`, `callees{key:[callee keys]}`, `callers{key:[caller keys]}` (keys are
the bare name when unique, else the function id; empty list = no direct caller),
`referenced[]` (names used as a value somewhere — not dead), `exports{file:[names]}`,
`imports_external{file:[libs/headers]}` (NOT graph nodes), `filegraph{file:{depfile:[via names]}}`
(internal edges only), `entrypoints[{file,line,kind}]`, `languages{}`, `treesitter` (bool — false =
degraded heuristic backend), `backends{lang:{ast|treesitter|regex:file_count}}` (which parser ran per
language; a non-python language showing only `regex` while `treesitter:true` = a missing/broken grammar,
i.e. that language ran degraded), `summary{file_count,source_file_count,function_count,entrypoint_count,constant_count,edge_count}`.
`source_file_count` excludes config/IaC files (indexed for grep, not parsed); use it, not `file_count`,
for any source-size decision so fixture-heavy trees (lots of `.json`) don't skew it. CI/IaC dot-dirs
(`.github`, `.circleci`, `.gitlab`, `.azure-pipelines`, `.azuredevops`) are walked; other dot-dirs are skipped.

### Backend + resolution flow (precision varies, results never hard-fail)

- Functions/calls: Python via stdlib `ast` (precise); other langs via tree-sitter if the venv is present,
  else regex/brace heuristics. `treesitter:false` in the index means the degraded backend ran. The
  tree-sitter backend covers C-like grammars plus Ruby (`def`/`def self.`), C# (incl. local functions),
  Rust, Go, Java, PHP, Swift, Kotlin, Scala, Bash; a single unbuildable grammar is isolated and does NOT
  disable tree-sitter for the rest of the run.
- Call graph is scoped by language and a local definition shadows (a call resolves to the caller's own
  file before any other), so same-named helpers across files do not create false edges. Qualified-external
  calls (`os.path.join`, `fs.readFileSync`) are dropped rather than bound to an in-repo bare `join`/`readFileSync`:
  all three backends (ast, tree-sitter, AND the regex fallback) now capture the dotted head, so this holds
  in degraded mode too.
- Module-map import resolution is real for Python (incl. relative `from .x`), JS/TS (relative specifiers;
  bare = external), Go (`go.mod` module prefix = internal, else stdlib/3rd-party), C/C++ (`"local"`
  internal, `<system>` external), Ruby (`require_relative`), PHP (`require`/`include` path literals),
  Java (package path, unique-basename fallback), and Rust (`mod foo;`). C# `using` namespaces and any
  remaining languages list imports as external, but still get internal edges from cross-file calls.
  Imports written inside string literals can inflate the external list but never affect internal edges.
- Entry-point detection (heuristic) spans CLI mains, Python/Flask, Express/Node, Go HTTP, plus
  Spring/JAX-RS (Java), ASP.NET (C#), actix/axum (Rust), Rails/Sinatra (Ruby), and PHP superglobals/Laravel.

## Optional: deterministic secrets scan

`recon.py scan` shells out to an external `secrets-scanner` binary
([github.com/whit3rabbit/secrets-scanner](https://github.com/whit3rabbit/secrets-scanner)) for a
deterministic, no-LLM secrets pass (memchr prefilter → Aho-Corasick → entropy → regex over ~988 rules).
It emits json/jsonl/SARIF and line-tolerant SHA-256 fingerprints with a baseline/suppression model — so
a leaked key is matched on content, not `file:line`, and survives reformatting.

It is **optional**. Detected on PATH (or `$SECRETS_SCANNER_BIN`); if absent, `recon.py scan` returns
`{"ran": false, ...}` (exit 0) and the audit continues with an honest "secrets pass not run" constraint.
The security-audit workflow runs it automatically when present (`secretsScan: 'auto'`); pass
`secretsScan: 'off'` to skip or `'on'` to require the attempt.

### Install (pick one — never piped into a shell from inside an audit)

| OS | Options |
|---|---|
| macOS | `brew install --cask whit3rabbit/tap/secrets-scanner` · `cargo install secrets_scanner` · release binary + checksum |
| Linux | `cargo install secrets_scanner` · release binary + checksum · (`install.sh` exists but review it; do not `curl … \| bash` from an audit) |
| Windows | release binary · (`install.ps1` exists; review before running) |

Release binaries (checksum-verified) are at the repo's GitHub Releases. Place on `PATH`, `chmod +x`.

### Run

```bash
secrets-scanner scan . --format json                 # findings as JSON (exit 1 = findings, 0 = none)
secrets-scanner scan . --format sarif > results.sarif # for GitHub code-scanning / merge gates
secrets-scanner scan . --baseline .security-audit/secrets-baseline.txt  # suppress known fingerprints
```

Suppress a false positive by adding its `fingerprint` (one per line) to the baseline file — this is
**operator-managed**; the workflow reads it but never auto-writes fingerprints (auto-suppressing would
silently hide a real leak).

### Licensing

The default lean build (`cargo build --release`) embeds permissive rulesets (MIT/Apache-2.0). Building
`--features full-ruleset` pulls in AGPL-3.0-derived rules (secrets-patterns-db): if you redistribute that
binary or run it as a network service you take on AGPL source-sharing obligations. Install the plain
build; do not bake `full-ruleset` into a hosted pipeline unaware.

## Brief yourself first

Before flagging anything, establish for your scope: trust boundaries; where untrusted input enters
(network / file / CLI args / API / IPC); which variables carry attacker-controlled data and how they
flow to each sink; and any fixed-size buffers or named size constants. Resolve each named constant to
its numeric value (grep its definition) and state the value — "a bound exists" is not "the bound is
sufficient".

## What to look for (language-agnostic — adapt sinks to the language in scope)

- **Injection** — untrusted input reaching a shell, SQL, eval, template, or command sink without
  parameterization or escaping. Trace the input from entry point to sink before flagging.
- **AuthZ / access control** — missing or inconsistent checks, IDOR, trust placed in client-supplied
  identifiers, privilege-escalation paths.
- **Secrets / config** — hardcoded credentials, keys, or tokens; secrets in logs; permissive defaults.
- **Path / file handling** — traversal, unsafe joins on user input, symlink following, zip-slip.
- **Deserialization / SSRF / XXE** — untrusted data into deserializers, server-side fetchers, or XML parsers.
- **Supply chain** — unpinned or known-bad dependencies, install/postinstall hooks, lockfile drift.
- **Memory safety (native languages)** — buffer overflow, integer overflow/wrap used as a size or
  index, NULL/None deref on malformed input, use-after-free / double-free, type confusion on tagged
  unions/variants, unchecked return from a fallible call.

## Discipline (the part that keeps the gate's job honest)

- **Trace reachability.** A pattern is not a vulnerability until untrusted input can reach it in
  context. Put that path in the evidence. A bare grep hit is a weak finding — say so.
- **Resolve constants, find callers.** Resolve a named constant to its numeric value and do the
  arithmetic before citing a bound; confirm the code is reachable by finding its callers. Never guess.
  When the security-audit workflow runs, `scripts/recon.py` (with a prebuilt `recon.json` index) gives
  these deterministically — `recon.py const <NAME>`, `recon.py callers <fn>` ("NO callers" = dead code),
  `recon.py extract <file#fn>` for the exact body — preferred over ad-hoc grep. Fall back to grep when
  no index exists.
- **Default to not flagging under uncertainty.** The gate defaults INVALID — an over-eager,
  unreachable, or unverified finding just gets dropped, so don't pad with maybes.
- **Cite, don't summarize.** `where` is `file:line`; `evidence` is the actual code plus why it is a
  risk. The gate re-reads your citation, so a vague one gets dropped.
- **Respect read-only constraints.** Trust boundaries and `ACCEPTED:` items come from the map stage —
  don't re-derive them and don't re-flag accepted risks.
- **Failures and constraints are notes too.** Can't read a file → emit a `failure`. Learn a scope fact
  later lanes need ("no network surface — SSRF N/A here") → emit a `constraint`.

## Output

Emit the canonical note schema only — `{type: finding|failure|constraint, where, evidence}` — no
transcript. Severity, category, and remediation are assigned downstream by the gate; your job is
accurate, reachable, well-cited candidates.
