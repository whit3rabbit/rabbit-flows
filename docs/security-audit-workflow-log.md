# security-audit workflow — running log

Hardening history, reviewer-round fixes, and verified constraints for `.claude/workflows/security-audit.js`
+ `plugins/workflow-kit/skills/secure-review/` (recon.py, tests). **Read this before editing the
security-audit workflow or recon engine.** Kept out of `CLAUDE.md` so it loads only when relevant.

> Audit OUTPUT is sensitive: `.security-audit/` (report, baseline, confirmed findings) is a
> vulnerability inventory. It is gitignored in this repo and the workflow ensures gitignore in any
> target repo — do NOT commit or publicly post it.

## security-audit hardening: 2026-06-23

**Goal:** implement the 12-item hardening plan at `.claude/plans/i-reviewed-your-workflow-skill-witty-wand.md`
**Board:** `.eatahorse-secaudit` (12/12 cards done; board cleared; 25 iterations)
**Files changed:** `.claude/workflows/security-audit.js`, `plugins/workflow-kit/skills/secure-review/scripts/recon.py`, `plugins/workflow-kit/skills/secure-review/scripts/test_recon.py`

**Completed (all 12 cards, P0 -> P1 -> P2):**

- **EH-0001 (P0)** Fixed diff-mode shell bug: `auditDir` derived from `reconOut`, `mkdir -p` added, trailing `.` removed from redirect target in diffStep.
- **EH-0002 (P0)** Split diff-mode index into `reconReachOut` (full-repo, used for callers/reachability) and `reconAuditOut` (changed-files, used for lane sharding/fileCount). Paths mode: both equal `reconOut`.
- **EH-0003 (P0)** Gate INVALID rule softened: incomplete call graph alone is not a rejection ground; rejection requires a specific contradicting code fact. Lean-valid clause appended to gate prompt.
- **EH-0004 (P0)** Fixed `calls_in()` nested-function call attribution: seed stack with own-body children, skip nested `FN_TYPES` scopes. Test added.
- **EH-0005 (P0, was riskiest)** Qualifier-aware `_resolve_call_target`: captures qualifier at extraction for both Python AST and tree-sitter backends; gates resolution by qualifier (only unqualified cross-file, self./this. same-file, or proven-internal qualifiers resolve). Drops qualified-external without bare-name fallback. Test added.
- **EH-0006 (P0)** Import regexes now run against comment-stripped source when tree-sitter backend was not used; when tree-sitter ran, imports are taken from AST import nodes. Eliminates false filegraph edges from commented-out requires.
- **EH-0007 (P1)** `VERDICT_SCHEMA` extended with `crux`, `confidence`, `checks` (array of `{kind, command_or_file, result}`). Gate prompt requires concrete recon facts; report prompt cites crux/checks per finding.
- **EH-0008 (P1)** `walk_files` returns `(included, skipped:[{path,reason}])` with reasons: symlink/unsupported/gitignored/too_large. Counts threaded into `build_index` summary and surfaced via `cmd_index`/`cmd_summary`. Report prompt states skipped files by reason. Test added.
- **EH-0009 (P1)** Config/IaC include-but-don't-parse tier: `CONFIG_EXTENSIONS` (.yml, .yaml, .json, .toml, .ini, .env, .tf, .tfvars, .hcl, .xml, .properties, .conf, .cfg, .sql, .graphql, .proto) + `SPECIAL_FILENAMES` (Dockerfile, docker-compose.*, Makefile, CMakeLists.txt). `parse_file` gives them `backend='config'`, 0 functions; they land in `files[]` and get sharded for secrets/IaC review. Test added.
- **EH-0010 (P1)** `cmd_extract` fallback window: `--context-lines N` (default ~60) prints a line-centered window with `# fallback window, not exact function` marker when no enclosing span is found. Mirrored into `reconBlock` in security-audit.js. Test added.
- **EH-0011 (P2, was riskiest workflow change)** Multi-round deep gate, opt-in: args `gateRounds` (default 1, cap 5) and `deepGateSeverities` (default `['critical','high']`). After first gate, VALID findings at those severities get 2 blind independent reviewers; on disagreement, one Opus arbiter arbitrates using only structured inputs. Cheap-first deviation documented in workflow header comment.
- **EH-0012 (P2)** Per-run artifacts finalize agent (Haiku, `writeArtifacts` default true): writes `{auditDir}/runs/<ts>/` with recon.json-ref, lanes.json, candidates.json, verdicts.json, confirmed.json, coverage.md (skipped-by-reason), report.md.

CONSTRAINTS (verified, do not re-implement):
- `reconBlock` (security-audit.js) is the runtime source for recon command surface; every new flag must be mirrored there.
- Acceptance gate for any future edit: `test_recon.py` green under BOTH stdlib AND the tree-sitter venv (`.venv/bin/python test_recon.py`) — stdlib alone SKIPS the tree-sitter tests and is blind to call-graph/import regressions on the precise backend. Plus `validate.py --strict` on `.claude/workflows`, `npm run check`.
- recon.py call extraction DIFFERS by backend: tree-sitter emits dotted qualifier heads (`pkg.fn`), the regex fallback emits bare names (`fn`). A call-graph/import fix can pass one backend and regress the other, so always run both. `_ts_imports_exports` only covers JS/TS; every other language MUST fall back to the regex extractor even under tree-sitter.
- Live smoke (paths mode + diff mode) is empirical only; static gates passing does not substitute for a real run.
- EH-0005 qualifier representation ripples through all call-graph consumers; regression-test `calls_in` before and after any further recon.py edits near `_resolve_call_target`.

## security-audit review round 3: 2026-06-23

**Goal:** close 9 reviewer findings on the post-hardening `security-audit.js` + `recon.py`.
**Board:** `.eatahorse-secaudit-r3` (7 cards). **Files:** `security-audit.js`, `recon.py`, `test_recon.py`, `secure-review/SKILL.md`.

- **#1 (blocking) deep gate no longer silently drops serious findings.** It DROPS a deep candidate only when BOTH blind reviewers (or the arbiter) are firmly INVALID; any UNCERTAIN (incl. a dead reviewer, which now defaults UNCERTAIN not INVALID) routes to `residualUncertain` (`gateStage:'deep-demoted'`/`'deep-arbiter'`) and surfaces in the report's Unsettled section. Deep-gate + arbiter prompts now default UNCERTAIN-and-surface, INVALID only with a named contradicting fact (mirrors Escalate). `droppedCount` subtracts `residualUncertain` so surfaced ≠ dropped.
- **#2 regex call extractor emits dotted heads** (`_CALL_RE` + tail-keyword guard), so the no-venv fallback drops `os.path.join` instead of binding bare `join` — the qualified-external false edge is closed on ALL backends now, not just ast/tree-sitter.
- **#3** `_ts_imports_exports` captures `export const NAME` (lexical_declaration declarators) and `module.exports = { … }` (object form) under tree-sitter.
- **#4** recon `summary.source_file_count` (excludes `language=='config'`); the Map coverage decision uses it, not `file_count`, so `.json` fixtures don't flip thematic→partition. **#5** dot-dir walk allowlist widened to `.github,.circleci,.gitlab,.azure-pipelines,.azuredevops`.
- **#6** `maxFindings` arg (default 150, cap 1000): ranks `deduped` by bug-class keywords in evidence/where (NOTE_SCHEMA findings have NO severity at gate-entry — that's set downstream by the gate) then slices, with a loud `log()` (no silent cap). **#8** `minConfidence` arg (default 0=off): demotes low-confidence VALIDs to unsettled; the self-reported confidence is clamped to [0,1] before comparison so an out-of-range `95` can't defeat the floor. **#9** diff-mode 0-files bail message is now mode-specific.
- **Round 4 (follow-up):** `deepGateSeverities` is lowercase-normalized + enum-validated (a typo no longer silently no-ops the deep gate); `residualUncertain` is exact-key deduped before the report; `confidence` schema is bounded `[0,1]`.
- CONSTRAINT: lane findings are `NOTE_SCHEMA` (`{type,where,evidence}` only); `severity`/`confidence` are gate output (`VERDICT_SCHEMA`). A pre-gate stage (dedup/cap/sort) CANNOT key on severity/confidence — they're undefined there (round-4 #1 bug). Pre-gate ranking must use evidence/where text.

CONSTRAINTS (verified, do not re-litigate):
- No new recon CLI flags this round (`source_file_count` is summary output; dot-dirs internal), so `reconBlock` in `security-audit.js` was NOT touched — the EH-0001..0012 mirror rule still holds for future flags.
- New tests in `test_recon.py`: `test_regex_fallback_captures_dotted_call_head`, `test_regex_dotted_external_does_not_bind_to_in_repo_bare_name` (both backend-agnostic), `test_treesitter_captures_export_const_and_module_exports_object` (venv-gated), `test_source_file_count_excludes_config`, `test_walk_allows_ci_iac_dot_dirs`. Acceptance unchanged: green under BOTH stdlib AND venv, plus `validate.py --strict` + `npm run check`.
- Live smoke (paths + diff) still empirical-only; static gates passing does not substitute.

## security-audit review round 5: 2026-06-24

**Goal:** close a fresh reviewer pass on `recon.py` + `security-audit.js`, then act on the live smoke run's own findings.
**Files:** `recon.py`, `test_recon.py`, `security-audit.js`, `requirements.txt`, `secure-review/SKILL.md`.

Reviewer findings (all validated against source first, then fixed):
- **recon.py #1** `parse_python` now descends into NESTED `def`/`class` (`_fn` -> `_descend_nested`) so the precise ast backend stops dropping closures the tree-sitter backend already caught. Descent visits ONLY nested def/class nodes, never bare statements, so a function-local `UPPER=...` does not leak into module `constants`.
- **recon.py #2** `_resolve_call_target` rule (c): `file_internal_qualifiers` changed `{rel: set(head)}` -> `{rel: {head: set(files)}}`; a qualified internal call (`fs.foo()`) binds ONLY to a symbol in the file that qualifier imports, killing a false cross-file edge to a unique same-named symbol elsewhere. Signature `known_internal_qualifiers: Optional[Dict[str, set]]`.
- **recon.py** #6 argparse entrypoint regex `add_argument(` -> `.parse_args(` (was N entries/parser); #7 dot-dir filter parenthesized so `SKIP_DIRS` stays authoritative (`CI_DOT_DIRS` const); #8 `.eatahorse`/`.security-audit` skip confirmed intentional (own output dirs).
- **security-audit.js** #3 gate dedup keys on FULL evidence (both sites), no 120-char prefix collapse; #4 `maxFindings` overflow captured in `notGated` and SURFACED via `residualUncertain` (no silent cap); #5 dead first-gate agent fails to UNCERTAIN (routes to escalate) not `null`. Report/write-back prompts fall back to `why` when `crux` absent.
- Smoke-run follow-ups: the escalate stage was CLOBBERING the `notGated` seed (`residualUncertain = ...` -> `.push(...)`; `escInvalid` from `escResidual` directly). Finalize loud-check extended to `uncertain.json`/`deep-gate.json` (Haiku dropped `uncertain.json` silently; only `report.md` was checked).
- Audit's own real findings actioned: stdlib `_rg` fallback now skips lines > `_RG_MAX_LINE_BYTES` (100k) — unbounded-work DoS guard (pattern is always `re.escape`'d, so backtracking-ReDoS was not reachable; the line cap is the real residual). `requirements.txt` exact-pinned (`tree-sitter==0.25.2`, `tree-sitter-language-pack==1.10.3`) for reproducibility.
- Sensitive-output handling: write-back + finalize now ensure the target repo's `.gitignore` ignores the audit dir (the output is a vuln inventory); the workflow return carries a `sensitive`/`warning` flag. SKILL.md documents it.

CONSTRAINTS (verified, do not re-litigate):
- **EH-0005 qualifier representation is now a `Dict[head -> set(files)]`, not a set** — this ripples through `_resolve_call_target` + the build loop. Regression-test `calls_in` / cross-file edges on BOTH backends before any further edit near it.
- **Do NOT add an `--out` confinement check (`startswith(root)`) to `cmd_index`.** The audit flagged `--out` as an arbitrary-write, but `--out` is OPERATOR-supplied (not the hostile repo) and the workflow DELIBERATELY writes `recon.json` OUTSIDE the scanned scope (`.security-audit/` while auditing a subdir). A confinement check would break the tool's own usage. Tampered-index (#8) and size-check TOCTOU (#10) are operational/marginal, declined.
- New tests: `test_aliased_require_does_not_bind_to_unimported_same_named_symbol`, `test_argparse_entrypoint_not_inflated_per_flag`, `test_rg_stdlib_fallback_skips_pathologically_long_lines`; `test_nested_python_calls_...` flipped to assert `callers["sink"]==["inner"]`. Acceptance unchanged: green under stdlib AND venv (49/49), `validate.py --strict`, `npm run check`.
- The #4 clobber fix is verified by live run (skip-escalate path) + a deterministic micro-repro (escalate-runs path the live run could not reach); the JS gate/escalate logic has no Python harness, so it rests on lint + repro, not an end-to-end assertion.

## security-audit review round 6: 2026-06-24

**Goal:** act on the "honest opinion on tree-sitter" review. Five items (user opted into all):
CI test gate, backend parity harness, intra-procedural taint, stable fingerprinting, SARIF output.
**Files:** `.github/workflows/ci.yml`, `recon.py`, `test_recon.py`, `security-audit.js`, `secure-review/SKILL.md`, `secure-review/CLAUDE.md`.

Two review claims were STALE/wrong and dropped after verifying source: secrets is already deterministic
(`recon.py scan` -> external `secrets-scanner`, not "Haiku greps config"); and the venv-rot was WORSE than
claimed — CI ran `test_recon.py` in NEITHER backend, not just "stdlib-only".

- **Item 1 — CI gate.** New blocking `recon` job in `ci.yml` runs `test_recon.py` under stdlib AND the
  tree-sitter venv (`setup_venv.sh` then `.venv/bin/python`). The precise backend now has an automated gate.
- **Item 5 — parity harness.** `test_backend_parity_{imports_exports_fns,calls_subset,taint_*}` in
  `test_recon.py` parse the SAME fixture via `parse_file` twice (tree-sitter on; then `_TS_AVAILABLE=False`
  forces regex) and assert the anti-"precise<degraded" contract: **regex ⊆ ts** for imports/exports/fns
  (catches EH-0002/0006/nested), **ts ⊆ regex** for calls (regex over-attributes nested-closure calls by
  design, so it is the superset). Subset, NOT equality — precise legitimately catches more.
- **Item 4 — taint.** DIRECT intra-procedural param->call-arg flow only (no transitive, no sanitizer
  awareness; over-attribution errs toward 'tainted', the safe direction). `parse_python`/`parse_treesitter`
  extract `params` and compute `taint:[{call,params}]` in the SAME own-body walk as call extraction (so taint
  inherits the nested-scope skip). **Regex backend: `params`/`taint` always `[]` (precise-only).** Carried
  onto the index `symbols` loc; surfaced via `cmd_extract`'s `# taint:` line. Gate prompt + reconBlock cite
  it as positive evidence for criterion (3); its ABSENCE is explicitly NOT a defense.
- **Item 3 — stable fingerprinting.** `cmd_extract` header now prints `key=<file#name>` (line-free for a
  unique name; line-suffixed only on a duplicate) — a churn-resistant fingerprint. `VERDICT_SCHEMA` gains an
  OPTIONAL `fingerprint`; first-gate + escalate prompts fill it as `<key>::<category>`; the script back-fills
  `<where>::<category>` for any confirmed VALID lacking one. Write-back records it as the `ACCEPTED:`-able
  baseline key, so a triaged item survives line shifts. Pre-gate dedup still keys `where::evidence`
  (fingerprint is gate output, undefined pre-gate — the round-4 constraint).
- **Item 2 — SARIF.** `buildSarif()` (pure JS, no FS/recon) maps confirmed findings + deterministic secrets
  to SARIF v2.1.0; finalize writes `findings.sarif` (always, even empty) into `runs/<ts>/`, added to the
  self-verify list + a missing-file warning. severity->level: critical/high=error, medium=warning, else note.

DECISIONS (do not re-litigate):
- **Taint + stable-key fold into `cmd_extract`, NOT new subcommands.** The gate already runs `extract` on the
  finding; folding both signals into its output adds NO recon CLI flag, so the EH-0001..0012 `reconBlock`
  mirror rule needed only a description edit (the extract line), not a new flag mirror. Rejected: dedicated
  `taint`/`fingerprint` subcommands (more CLI surface + mirror burden for no extra reach).
- **`fingerprint` is OPTIONAL in `VERDICT_SCHEMA`** (shared by gate/escalate/deep-gate/arbiter). Making it
  required would force editing all four prompts or risk validation failures; instead two prompts fill it,
  deep-gate/arbiter inherit it via `...f`/`...original`, and the script back-fills the rest.
- **Taint is precise-backend-only by design.** The parity harness ENFORCES `regex_taint==[]`, so a future
  edit that leaks taint into the regex backend (or drops it from precise) fails CI.

CONSTRAINTS (verified):
- Acceptance: `test_recon.py` green under BOTH stdlib AND venv (60/60), `validate.py --strict`, `npm run check`.
  CI now exercises both backends, so the parity/taint/call-graph regressions are no longer manual-only.
- `cmd_extract` is now the runtime source for the `key=`/`# taint:` surface; reconBlock (`security-audit.js`)
  + SKILL.md document it. A future change to that header must update both.
- EH-0005 qualifier representation untouched; `calls_in`/`_python_calls_in_own_body` were EXTENDED (taint in
  the same walk), not forked — regression-test `calls_in` on both backends before further edits near them.
- Live smoke (paths + diff) still empirical-only: confirm `findings.sarif` lands, a confirmed finding carries
  a `fingerprint`, and a gate `checks` entry shows a `# taint:` extract line. Static gates do not substitute.

## security-audit review round 6: 2026-06-24

Closed a code-review pass on `security-audit.js` + `recon.py`. Files: `security-audit.js`, `recon.py`, `test_recon.py`.

- **(blocking) `recon.py scan` now accepts `--format`.** reconBlock has always advertised
  `scan <scope> --format json`, but the `pscan` subparser never defined `--format`, so the secrets stage
  (and any agent following the doc) hit `argparse` exit 2 (`unrecognized arguments`) and the deterministic
  secrets pass silently never ran. Added `--format` (default json), forwarded to the external binary in
  `cmd_scan`. Regression: `test_scan_subparser_accepts_format_flag` exercises the real `build_parser()` path
  (the existing scan tests call `cmd_scan` directly and could not catch this).
- **Deep-gate arbiter no longer drops a finding on agent death.** The arbiter `.then` returned `null` on a
  dead agent and the loop's `if (v)` skipped it, vanishing a finding one reviewer already called VALID. Now
  defaults to UNCERTAIN-and-surface, matching the first gate and the deep reviewers (round-3 #1 covered the
  reviewers but missed the arbiter).
- **Gate log no longer counts UNCERTAIN as dropped.** `droppedCount1` lumped UNCERTAINs (which route to
  Escalate) into "dropped"; now logs `confirmed / to escalate / rejected` separately.
- **`since` charset-validated** before interpolation into the diff git commands + `recon --base` (safe
  git-ref chars only).
- **recon `_loc_at`/`_loc_candidates`/`_find_span` path match fixed.** `file.lstrip('./')` stripped a CHAR
  SET (so `imdb.py` suffix-matched `db.py`, `../a` collapsed to `a`), wrong symbol -> wrong `key=`/`# taint:`
  fingerprint -> broken cross-run baseline. Now `_strip_dot_slash` + `_file_suffix_match` (segment-anchored,
  the `_resolve_import` idiom). **taint dedup:** `taint` was raw while `calls` was `sorted(set(...))`;
  `_dedup_taint` collapses duplicate flows. New tests: `test_file_suffix_match_is_segment_anchored`,
  `test_dedup_taint_collapses_duplicate_flows` (both backend-agnostic).
- **Parity tests no longer skip everything when Go is absent.** `test_backend_parity_imports_exports_fns`
  and `_calls_subset` gated the whole test on the go grammar; now skip only when no fixture grammar is present.
- CONSTRAINT (still holds): every new recon CLI flag must be mirrored in reconBlock — `--format` was already
  documented there, so no reconBlock edit this round. Green under BOTH stdlib AND venv (63/63) + `npm run check`.
