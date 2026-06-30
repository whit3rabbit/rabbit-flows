# eatahorse / eatahorse-research — workflow log

Run history, hardening rounds, and per-workflow constraints for the eatahorse board substrate and its two
workflows. Read before editing `eatahorse.js`, `eatahorse-research.js`, `eatahorse.py`, or the skill.

## Board conventions for grounded / port runs (EH-PORT-01)

The "port pipeline" (comprehend → grounded execute) rides the existing substrate with **no `eatahorse.py`
CLI change for v1**. The conventions the two workflows agree on:

- **Join key = source repo-relative path.** A port card links back to its source unit via
  `external_id source:<path>` (`add --external-id source:<path>`). `external_ids` is state-only (not card
  frontmatter) and survives sync via the state-merge `setdefault` at `eatahorse.py:819`. Test:
  `test_external_id_survives_sync`.
- **Structured extraction = a fenced ```json block in the freeform `## Notes`.** Shape:
  `{path, exports:[{name,signature,kind}], deps:[<repo-rel intra-repo paths>], externalDeps:[<pkg>],
  sideEffects, entryPoint, behavior}`. No schema/CLI change — it lives in the same Notes section the prose
  does, round-trips through sync verbatim. Test: `test_notes_json_block_roundtrips`.
- **Topo depth → priority band, ZERO-PADDED two digits (`P00`=leaf).** eatahorse sorts priority
  **lexically** (`eatahorse.py:492,792`), so unpadded bands break: `"P10" < "P2"` and `"P2" < "P3"` but a
  4-deep chain in plain `P0..P3` collapses depth > 3 into one band and the sequential loop could port a
  dependent before its dependency. Zero-padding (`P00..P0N`) keeps lexical = numeric = topo order. Test:
  `test_priority_bands_topo_order`. The port-mode decompose uses `PORT_CARDS_SCHEMA` (priority pattern
  `^P[0-9]{2}$`), bypassing the plain `CARDS_SCHEMA` enum `P0..P3`.

## Pipeline shape (v1: bridge + front door)

`eatahorse-research` (comprehend) → `inventory.json` → `eatahorse` (grounded execute). Two SEPARATE runs
sharing the board substrate; not one mega-workflow (keeps the single-writer invariant and the
incompatible cap regimes — research is read-only/lifetime-capped, execute writes/token-capped — apart, and
makes the convert stage independently resumable).

- **Comprehend** — `eatahorse-research` arg `extract:'port'`: per-file worker also emits the JSON block
  (`EXTRACT_BLOCK`); a new **Graph** phase (Opus, between Gather and Synthesize) reads the done cards' JSON
  blocks and WRITES `inventory.json` (`{units:[{path,layer,apiSurface,deps,externalDeps,entryPoint,
  behavior}], topoOrder, cycles, invariants, entryPoints}`). Default inventory path = `<out>` with a
  `.inventory.json` suffix.
- **Grounded execute** — `eatahorse` arg `grounding=<inventory.json>` (plus `targetLang/targetDir/
  preserveApi/testCmd`): decompose READS the inventory (agent reads the file; the script has no FS) and
  seeds one card per unit in `topoOrder`, priority = topo band, acceptance = compiles / API parity /
  behavior-parity-via-`testCmd`, `--external-id source:<path>`. `testCmd` + "project compiles" auto-append
  to `constraints`, so the completion gate enforces them as run invariants.

## Decisions (locked) — do not re-litigate

- **Dependency ordering = priority bands ALONE; no worker self-block.** `next` EXCLUDES `blocked` and only
  re-enters via manual `move ready` (`eatahorse.py:781-797`, `test_next_excludes_blocked`), so a
  self-blocked card would ORPHAN — nobody re-picks it. The execute loop is sequential and `next` already
  honors priority, so zero-padded topo bands port leaves first without any block. The tasklist's
  "worker self-block as dep-gating" was dropped for this reason.
- **No `eatahorse-port` workflow.** A port is one instance of *grounded execution over a corpus*
  (same shape as: add types to an untyped repo, write tests per module, migrate a framework). Generalize,
  don't special-case.
- **v1 scope = bridge + front door:** EH-PORT-01/02/03/05/06/07/09. Deferred at v1, NOW BUILT in v2
  (see "v2" section below): the cross-card DAG (EH-PORT-10..12), graded equivalence verification
  (EH-PORT-13..15, differential not proof), and concurrent comprehend+execute (EH-PORT-16..18). Still
  deferred: 08 characterization-test pre-port for test-less repos.

## Known v1 limits (honest)

- **Graph topo sort is agent-computed** (Opus, in the Graph phase), not a deterministic script-side Kahn
  pass — consistent with the repo's "agents do the work, the script has no FS" style and integration-
  verified by the comprehend slice (topoOrder valid, leaf in layer 0). Upgrade path for very large trees:
  agent extracts edges, a JS Kahn pass in the workflow computes layers. `ponytail:` noted at the Graph
  phase in `eatahorse-research.js`.
- **Behavior parity needs a real test suite.** Without `testCmd`, per-card acceptance only checks LOCAL
  parity, never whole-program. The front door warns loudly when `testCmd` is absent.
- **Cycles** are flagged in `inventory.cycles` (SCCs), not resolved; the loop ports them in their
  topoOrder slot.

## v2 — DAG + graded equivalence + concurrency (EH-PORT-10..18)

Built as one coordinated effort after v1 (user opted into the full block over the LESS-default pushback).
Composition: the DAG (A) enables safe early pulls for concurrency (C); the equivalence verifier (B) makes
C's gate trustworthy. Two design forks were resolved toward the LIGHTER option (see below).

### Group A — first-class dependency DAG (`eatahorse.py` + `eatahorse.js`)
- **`depends_on` is a real field, stored IN frontmatter** (unlike state-only `external_ids`) so a
  hand-edited `depends_on: [EH-0001]` round-trips through sync (`parse_scalar` splits the list).
  `create_task`/`frontmatter`/`parse_task_markdown` carry it; `normalize_dep_id` canonicalizes ids and
  tolerates FORWARD refs at seed time (do NOT `resolve_task_id` at create). Test: `test_depends_on_roundtrips`.
- **Edge verbs are FLAT: `dep-add` / `dep-rm` / `deps`** (matches the existing `add-bite` style), NOT the
  handoff's nested `dep add`. `would_cycle` (DFS: dep already reaches src) rejects a back-edge at write
  time; an absent/purged dep is treated SATISFIED so the board can't deadlock, and `sync` warns +
  reports `dangling_deps`. Tests: `test_would_cycle_and_dep_add`.
- **`deps_satisfied` gates PULLABILITY in `next_task`, not doneness** — `apply_completion_rules` is
  untouched, so the two-way acceptance derivation invariant holds. Test: `test_deps_gate_next`.
- **Retired proxy = topo-in-priority only.** There was NO worker self-block to retire (it was dropped
  before v1 shipped, see Decisions above). The port decompose now emits real `dependsOn` edges (the
  unit's intra-repo dep PATHS); Seed resolves each to its port card via the `source:` external_id and
  wires `dep-add`. **DEVIATION from the plan:** zero-padded priority bands (`P00..P0N`) are KEPT as a
  tiebreak (still lexical-sort-safe, still guarded by `test_priority_bands_topo_order`), not reverted to
  plain `P0..P3` — deps do the real gating now, so the bands are a free secondary sort, not the topo proxy.

### Group B — graded equivalence verifier
- **Equivalence is a graded RECORD, not a boolean** (EH-PORT-13). It rides the SAME freeform fenced
  ```json Notes channel as the extraction block — no schema/CLI change. Shape:
  `{method, cases, counterexamples, coverage, confidence, caveats}`; `confidence` ∈ `proof|high|medium|low`
  mirrors the research epistemic tiering so synthesis can't render a `low` port as proven. Test:
  `test_equivalence_block_roundtrips`.
- **`diff_test.py`** (new bundled stdlib script, `test_diff_test.py`) is the empirical `differential`
  method: drives a SOURCE oracle vs the TARGET over generated PRIMITIVE inputs (int/float/str/bool/list),
  diffs (error channel included), emits the record. **Scope cuts:** non-primitive signatures →
  `method:"manual"`/`confidence:"low"` (refuses to fabricate evidence); coverage is best-effort/passed-in,
  not instrumented; `smt`/`bounded-mc` are LABELED-ONLY, not implemented (no Z3/CBMC) — they remain the
  rare closed-numeric-fragment case the design reserves them for.
- **`verifyEquivalence:true`** adds an opt-in `Verify-equivalence` phase in `eatahorse.js` AFTER the loop
  (kept out of the per-card completion gate: it needs both toolchains + a source oracle live in the
  sandbox). Fans out over done port cards; on `counterexamples>0` calls `reopen <id> --gap "diverges…"`,
  so a divergent card is never admitted done. `srcRunner`/`tgtRunner` are per-unit oracle templates;
  `harnessPath` overrides the bundled `diff_test.py`.

### Group C — concurrency
- **Board lock (EH-PORT-16) — fork resolved to `fcntl` lock, NOT namespace shard.** `board_lock` holds one
  `fcntl.flock` on `.eatahorse/.lock` around `main()` dispatch so concurrent CLI processes serialize their
  commit. Held ONCE at the boundary (nesting self-deadlocks: flock is per-open-file-description). This is
  NOT the rejected autosync (it serializes a commit, adds no sync); the single-writer convention still
  holds. In-process API callers (the tests) aren't serialized — the real hazard is cross-process, which is
  the boundary the lock covers. Windows (`fcntl` absent) → no-op. Test:
  `test_board_lock_serializes_concurrent_writes` (subprocess stress).
- **Deterministic inventory (EH-PORT-17).** `build_inventory.py` (new stdlib, `test_build_inventory.py`) is
  a Kahn pass over `{path: deps}` → `{topoOrder, layers, cycles(SCCs via iterative Tarjan)}`. The Graph
  phase in `eatahorse-research.js` now has the agent EXTRACT edges and call the helper for ordering instead
  of topo-sorting by judgment — reproducible, and cheap to re-run as each comprehension lands (the
  "incremental updater"). Leaves are layer 0; cycles flagged, kept in topoOrder; external deps ignored.
- **Cross-run scheduler (EH-PORT-18) — fork resolved to KEEP the two workflows separate.** New
  `.claude/workflows/eatahorse-port-pipeline.js` runs the unmodified `eatahorse-research` (comprehend) and a
  thin port scheduler CONCURRENTLY via `parallel()`, sharing only a `comprehendDone` closure flag — never a
  writer (comprehend owns the research board, scheduler owns the port board; they meet by reading). Each
  scheduler round ports units whose intra-repo deps are comprehended AND ported; once comprehension
  finishes it relaxes the gate to drain stragglers. This HONORS the locked "two separate runs" decision and
  the incompatible cap regimes — it does NOT merge them. **Runtime-UNVERIFIED:** pure orchestration over
  live agents, no unit test possible; validate on a tiny slice. Equivalence is NOT folded in — run
  `eatahorse verifyEquivalence:true` as a separate pass.

### v2 known limits / deferrals
- `diff_test.py` is differential (empirical), not a proof; SMT/bounded-mc and a richer-than-primitive type
  generator are deferred. Coverage is not instrumented (caps confidence at `medium` without a passed-in value).
- `eatahorse-port-pipeline` is the heaviest, most speculative piece and has no automated verification; smoke
  it on a 3-file slice before trusting it. The cross-board edge (port card → comprehension card) stays an
  `external_ids` join, not a `depends_on` edge (`depends_on` orders cards within ONE `state.json`).

## v2 hardening round — EH-PORT-19..24 (2026-06-25)

Post-v2 review found two blocking bugs + four coherence/robustness gaps in the orchestration layer (the
`.js` workflows — no automated tests; verified by `validate.py` lint + reasoning). All fixes are
prompt/control-flow only: NO `eatahorse.py`/`build_inventory.py`/`diff_test.py` change, so the 38 Python
tests are untouched and still green.

- **EH-PORT-19 — equivalence completion deadlock (`eatahorse.js`).** Port decompose acceptance (c) under
  `verifyEquivalence` referenced a record written by the POST-loop Verify-equivalence phase, so a card could
  never reach `done` in-loop → that phase then found 0 done cards → loop stalled with ports stuck in `doing`.
  Fixed: (c) now always names a proof runnable DURING the loop (`testCmd` passes, else a concrete manual
  check). Verify-equivalence is purely an independent post-hoc reopener (same shape as the invariant gate).
- **EH-PORT-20 — standalone equivalence pass (`eatahorse.js` + pipeline text).** The pipeline's recommended
  follow-up (`eatahorse … verifyEquivalence:true`) died on the 0-active probe bail because a cleared port
  board has 0 active cards and Verify-equivalence lives after the loop. Added `verifyOnly:true` (PORT_MODE,
  implies `verifyEquivalence`): requires an existing board, relaxes the 0-active bail, skips
  decompose/seed/plan-gate AND the execute loop (`!verifyOnly &&` in the while head), runs Verify-equivalence
  on the done cards, `stopReason:'verify-only'`, `executed:false`. Pipeline header/write-back/return now
  recommend `verifyEquivalence:true verifyOnly:true`.
- **EH-PORT-21 — cycle-aware port planning (`eatahorse.js`, decompose prompt only).** SCC members can't compile
  standalone, so a plain "project builds" acceptance bounced the first member forever. Stub-then-fill via the
  decompose prompt: for units in `inventory.cycles`, all-but-one member is accepted as a syntactically-valid
  stub (cyclic peers may be stubbed/forward-declared); ONE cluster-entry member carries "the whole cycle
  compiles together". Kept one card per unit (NOT collapsed — collapse breaks the single-namespace `source:`
  external_id join; `ponytail:` ceiling noted in-file). `would_cycle` already drops the back-edge → defined
  stub-first order.
- **EH-PORT-22 — pipeline rides the DAG (`eatahorse-port-pipeline.js`).** The round agent recomputed
  "portable = deps comprehended AND ported" in prose and never used `next`. Rewritten: comprehension gates
  card CREATION (seed a card only when ALL its intra-repo deps are comprehended, so every dep-add edge can be
  wired), and the port-board DAG + `next` gates port ORDER (`next` refuses dep-blocked cards). One ordering
  surface (the port board), composing with EH-PORT-12. NOTE: inventory.json is written by the research Graph
  phase at the END of comprehension, so it is unavailable mid-overlap — the port board, not inventory.json,
  is necessarily the shared surface. Added `next` to the pipeline CMD map (one-way; `next` already in
  `eatahorse.js`).
- **EH-PORT-23 — comprehend gate validates the extraction block (`eatahorse-research.js`).** In
  `extract:'port'` the sampling gate now also reopens any sampled card whose `## Notes` lacks a parseable
  ```json extraction block, won't parse, or whose `path` != the card title (`PORT_GATE_RULE`, appended to the
  gate prompt; `GATE_SCHEMA.hollow` already carries the reopened titles).
- **EH-PORT-24 — guard Seed's dep wiring (`eatahorse.js`).** Seed now returns `{wired, skipped, dangling}`
  (`SEED_RESULT_SCHEMA`); a nonzero skipped/dangling is logged loudly (ordering for those cards silently
  reverts to the band tiebreak otherwise). The plan-gate spot-checks each PORT card's `deps <id>` edges and
  flags missing/dangling ones in `adjustments` (`deps` added to its CLI slice).

Deferred (not in this round): EH-PORT-25 (characterization-test pre-port for test-less repos) and the
EH-PORT-26 polish that 20 didn't already touch (pipeline `maxTokens`, README Contents tree refresh for
`build_inventory.py`/`diff_test.py`/tests). The port pipeline remains RUNTIME-UNVERIFIED — smoke EH-PORT-22's
DAG-pull + EH-PORT-20's `verifyOnly` on a tiny slice before trusting them.

## EH-PORT-26 polish + drift test (2026-06-25)

Closed the EH-PORT-26 leftovers and added the one statically-checkable test the system lacked. No
`eatahorse.py`/`build_inventory.py`/`diff_test.py` change → the 38 Python tests stay green; no manifest/
skill change → `npm run check`/`npm test` unaffected.

- **`test_cmd_drift.py` (NEW gap-closer).** The FOUR inline `CMD` maps (`eatahorse.js`,
  `eatahorse-research.js`, `eatahorse-port-pipeline.js`, `docs-from-code.js`) are hand-synced to
  `eatahorse.py`'s argparse verbs (no runtime sharing — VM sandbox). A renamed/removed verb broke a
  workflow SILENTLY at run time with no test. The new stdlib self-check parses the verb set from
  `add_parser("…")` and asserts the FIRST TOKEN of every `CMD` value (the verb, e.g. `dep-add`, `add-bite`)
  exists — it does NOT assert key-equality across copies (they intentionally slice different subsets).
  Walks up to the repo root; SKIPs cleanly in the installed/bundled skill copy (dev-only). Currently
  checks 42 entries × 4 workflows against 16 verbs. Wired into project + skill CLAUDE.md command lists.
- **EH-PORT-26(a) pipeline `maxTokens` clamp (`eatahorse-port-pipeline.js`).** `tokensLeft()` was bare
  `budget.remaining()`; now mirrors `eatahorse.js`:
  `Math.min(budget.remaining(), maxTokens ? Math.max(0, maxTokens - budget.spent()) : Infinity)`, with a
  `maxTokens` arg (default null) + header Knobs line.
- **EH-PORT-26(b) README Contents tree (`plugins/workflow-kit/skills/eatahorse/README.md`).** Added the 6
  omitted files (`build_inventory.py`, `diff_test.py`, three `test_*.py`, root `CLAUDE.md`) plus the new
  `test_cmd_drift.py`.
- **EH-PORT-25 stays DEFERRED by decision** (diff_test already does source-oracle differential testing;
  char-tests are mainly a pre-port golden net — not worth the scope this round).

## Smoke runbook (EH-PORT-20/21/22) — inline fixture, run on demand

The three runtime pieces have NO automated test (pure orchestration over live agents). Validate them on
this tiny fixture before trusting them on a real tree. Live runs spawn many agents — run when you intend
to spend the tokens. Recreate the fixture (do NOT commit it); covers a dep chain (leaf → SCC) AND a
mutual-recursion SCC.

Fixture `src/` (3 files):

```python
# src/leaf.py  — layer 0, no intra-repo deps
def base(n):
    return abs(int(n))

# src/even.py  — depends on leaf + odd (SCC with odd)
from odd import is_odd
from leaf import base
def is_even(n):
    n = base(n)
    return True if n == 0 else is_odd(n - 1)

# src/odd.py   — depends on leaf + even (SCC with even)
from even import is_even
from leaf import base
def is_odd(n):
    n = base(n)
    return False if n == 0 else is_even(n - 1)
```

Run (EH-PORT-22 pipeline, then EH-PORT-20 standalone verify):

```js
// EH-PORT-22 — overlap comprehend + port; the DAG must order leaf before the even/odd SCC.
Workflow({ name: 'eatahorse-port-pipeline', args: {
  root: 'src', targetLang: 'javascript', targetDir: 'out',
  board: '.eatahorse-port', researchBoard: '.eatahorse-comprehend',
  inventory: 'src.inventory.json', maxRounds: 8, maxTokens: 400000,
}})

// EH-PORT-20 — standalone equivalence pass against the now-CLEARED port board (must not 0-active bail).
Workflow({ name: 'eatahorse', args: {
  grounding: 'src.inventory.json', board: '.eatahorse-port',
  targetLang: 'javascript', targetDir: 'out',
  verifyEquivalence: true, verifyOnly: true,
}})
```

Expected observations:
- **EH-PORT-22:** `leaf.py` is ported (card moves to `done`) BEFORE either `even.py`/`odd.py` card is
  pulled; `next` never offers a card whose dep card isn't `done`. Check `port-round:*` notes + the port
  board: no card ported out of dependency order.
- **EH-PORT-21:** the `even`/`odd` SCC ports without a reopen loop — one cluster-entry member carries
  "the whole cycle compiles together", the other is accepted as a syntactically-valid stub first. Neither
  card ping-pongs `done`→`reopen` forever.
- **EH-PORT-20:** the verify pass runs against the cleared board (no `0 active` bail), writes equivalence
  records into the done cards' Notes, `stopReason:'verify-only'`, `executed:false`, and does NOT re-port.

## CMD-sync note

`eatahorse.js` `CMD.add` now advertises `[--external-id ns:val]` (the flag already existed in
`eatahorse.py`; only the inline doc surfaced it). The research/docs-from-code sibling `CMD` maps do NOT
use `--external-id` (they only read/reopen/sync), so no cross-workflow sync was required this round. See
`plugins/workflow-kit/skills/eatahorse/CLAUDE.md` for the three-copy hand-sync rule when a real
`eatahorse.py` subcommand/flag changes.

## EH-PORT-27 — code-review fixes (2026-06-25)

`/code-review xhigh` of the EH-PORT-19..26 round found real defects in the port pipeline's seed/loop
logic and one verifyOnly precedence bug. All fixes are prompt/control-flow except the one CLI guard
(create_task idempotency), which has a new test. `npm run check` + all Python suites stay green.

- **Transitive seed hole (`eatahorse-port-pipeline.js`).** The one-pass seed wired `dep-add <card> --on
  <depCard>` per unit, but `add_dep` ERRORS if the dep card doesn't exist (`resolve_task_id`, eatahorse.py)
  and "comprehended" does not imply "carded": in a chain A→B→C with C uncomprehended, A seeds (dep B
  comprehended) but B does not (dep C uncomprehended), so `dep-add A --on B` errored or dropped the edge
  and `next` offered A out of order. The "seeding only when all deps comprehended guarantees every edge
  can be wired" claim was false one level deep. Fixed: TWO-pass seed — 3a ADD-ALL cards, 3b WIRE (a card
  whose dep is uncomprehended is parked `blocked`, which `next` excludes, until 3c UNBLOCK in a later
  round wires + releases it). Out-of-order port is now structurally impossible.
- **Post-comprehension spin (`eatahorse-port-pipeline.js`).** The empty-streak cap only counted while
  `!comprehendDone`; once comprehension finished, a round that ported nothing with cards still unported
  fell to `else { emptyStreak = 0 }`, resetting the counter and spinning to maxRounds (60), one worker
  agent per round. Fixed: count any `!portedNow` round toward EMPTY_CAP regardless of comprehension state.
- **Pipeline SCC acceptance (`eatahorse-port-pipeline.js`).** Unlike `eatahorse.js` EH-PORT-21, the pipeline
  had no cycle-aware acceptance. Added a step-4 clause: when a `dep-add` was cycle-rejected (SCC pair),
  port both members with cyclic peer refs stubbed/forward-declared and accept the stub, don't block on a
  full build until both are ported.
- **Duplicate port cards (`eatahorse.py` create_task).** `add` had no external_id uniqueness check, so a
  worker re-reading the board across rounds could seed two cards for one source unit → ported twice. Made
  `create_task` idempotent on external_ids (returns the existing card via `find_task_by_external_id`).
  New test `test_create_task_idempotent_on_external_id`. Benefits both pipeline seed and eatahorse.js Seed.
- **verifyOnly vs resume (`eatahorse.js`).** verifyOnly on a board with active cards fell into the resume
  arm (logged "Resuming", but the `!verifyOnly`-gated loop did no work) and returned `resumed:true`.
  Fixed: `if (verifyOnly)` now precedes `else if (resume)`; warns when active cards remain (they are NOT
  ported in verify-only); `resumed: resume && !verifyOnly`.
- **maxTokens:0 falsy trap (`eatahorse-port-pipeline.js` + `eatahorse-research.js`).** `maxTokens ? ... :
  Infinity` treated 0 as "no ceiling"; changed to `maxTokens != null`.
- **Stringified-args → silent plan-only (2026-06-26, `eatahorse.js` + `eatahorse-research.js` +
  `docs-from-code.js`).** A named launch whose `args` arrived as ONE string blob (comma-form
  `"goal: X, execute: true, board: ..."` OR a JSON-stringified object) hit the `typeof args === 'string'`
  bare-string path: the whole blob became `goal`/`root`, `execute` read undefined → `false` → the Ralph
  loop never entered → SILENT plan-only, with the blob slugged into `.eatahorse-goal-...`. The recurring
  "named-workflow args didn't thread" failure (WORKFLOW_ANALYSIS.md "Documentation Gaps"; `args` must be a
  JSON value, not a string). Added an inline FAIL-LOUD guard at the top of each: if the resolved
  `goal`/`root` carries argument keys (regex with `["']?\s*[:=]` after each key, catching BOTH blob forms;
  trips on `^(goal|root)[:=]` or ≥2 distinct keys), return `{error, written:false}` instead of degrading.
  `eatahorse-port-pipeline.js` already had this (its `_args` JSON.parse + required-fields bail) — left as-is.
  Per-file regex (no runtime sharing — VM sandbox), keyed to that file's arg vocab + its bare-string var.
  Skill prose alone was insufficient (the docs were already thorough), so the guard is the durable fix;
  both `SKILL.md` copies also gained a WRONG/RIGHT object-vs-string note. **Ceiling:** false-positives on a
  real goal/path that itself enumerates ≥2 arg keys with a `:`/`=` after — actionable error, cost is one
  re-launch. Heuristic self-checked via a `node -e` assert run (both blob forms trip, real goals/paths pass).

## EH-EXEC-01 — residual acceptance, anti-thrash (2026-06-27, `eatahorse.js`)

- **Symptom.** A live `execute:true` run (Tauri vault wiring) STALLED. Several cards' acceptance demanded a
  LIVE runtime check — a `window.__TAURI__ invoke()` roundtrip through macOS WKWebView — physically
  impossible to verify in the headless sandbox. The worker prompt said "only check acceptance you can
  actually back up" but gave NO escape: the card never completed → the Ralph loop re-handed it → each pass
  re-attempted the impossible verification = thrash, until the harness killed the worker (~180s × 6 retries,
  ~346k tokens burned). The completion gate was correct to refuse; the worker was wrong to keep retrying.
  Operator workaround was a manual pre-pass: a separate agent rewrote every card's acceptance to
  "headless-verifiable portion + documented manual residual." That belonged IN the workflow.
- **Fix (prompt/control-flow only, no `eatahorse.py`/schema/manifest change — same posture as EH-PORT-19..24).**
  A **residual** = an acceptance item provable ONLY by a live runtime/GUI/device/network the headless sandbox
  cannot exercise; NOT a license to skip merely-hard or unfinished work.
  1. Worker step 4b: verify the headless-checkable portion, append a `residual: <manual check + concrete
     reason it's impossible here>` line under the card's `## Notes` (reusing the equiv-phase Notes-edit +
     `sync` pattern), then check the item so the card auto-completes. `show` added to the worker CLI slice.
  2. Completion gate: an item whose only gap is an environment-impossible check WITH a `residual:` note
     naming a concrete reason, headless portion confirmed, counts as supported — but REOPEN if the residual
     is actually runnable headless, names no concrete reason, or any invariant regressed. The `INVARIANTS`
     block (build clean / `testCmd` green) stays hard — residual never excuses a broken build/tests.
  3. Decompose (both modes): author runtime-only checks up front as "headless proxy + (manual residual: …)",
     so fresh runs don't generate the thrash in the first place.
  4. Write-back: scan all cards' Notes for `residual:` and emit a dated "Manual verification residuals"
     section in the project CLAUDE.md — the consolidated spot-check queue the operator otherwise rebuilds
     by hand each run. `show` added to the write-back CLI slice.
- **Rejected: a structured `[~]` item state in `eatahorse.py`** (queryable `list --residual`, `should_auto_complete`
  counts it). More code across the parser + completion logic + three test files for a distinction that
  free-text Notes + the gate's scrutiny already cover. Not worth it until residuals need to be queried
  board-wide as data rather than read in write-back.
- **Failure-B note (resume "0 active" bail) — NOT a code change.** The running session diagnosed it as "resume
  counts only ready/doing"; that is FALSE against the code — `report` "active" counts backlog (eatahorse.py:943)
  and `next` picks `doing>ready>backlog` (eatahorse.py:785). Promoting backlog→ready was a no-op for the active
  count; the real cause was elsewhere (most likely a relative-board-path resolving against the workflow cwd, or
  a transient probe-agent death). Diagnostic before any guard: `report --json` / `next --json` against the real
  board; only add a guard if a genuine 0-active-with-backlog reproduces.

## 2026-06-30 — Simplification: two-phase plan/execute, drop port mode/research/pipeline

**Summary:** Collapsed the eatahorse ecosystem from 4 workflows + 2 skills to 1 skill + 3 workflows
(one a thin orchestrator). Port mode, research workflow, and port pipeline removed. The clear winner
after extended use is a **two-phase pattern**: plan the board, then work it.

**Changes:**

1. **New `eatahorse-plan.js`** — extracted from the old `eatahorse.js`. Phases: Probe -> Decompose ->
   Seed -> Plan-gate. Single `CARDS_SCHEMA` (no port mode). Accepts an optional `inventory` arg (path
   to `map_codebase.py` output) for richer decomposition context, NOT the old grounded/port mode. No
   dep wiring, no DAG spot-checks, no cycle handling. CMD map: report, init, add, list, show, remove,
   addbite, sync (planning verbs only).

2. **New `eatahorse-execute.js`** — extracted from the old `eatahorse.js`. Phases: Probe -> Execute ->
   Verify -> Write-back. The Ralph loop unchanged: one bite per iteration, fresh-context workers,
   completion gate per done card, residual escape, write-back. CMD map: report, list, show, next, move,
   bite, reopen, sync (execute verbs only). No verifyEquivalence phase (port-only, removed).

3. **`eatahorse.js` simplified** — thin orchestrator that calls `workflow('eatahorse-plan')` then
   `workflow('eatahorse-execute')` when `execute:true`. No CMD map of its own.

4. **New `scripts/map_codebase.py`** — stdlib-only Python script that walks a directory and produces a
   structured JSON inventory: `{files: [{path, ext, size, imports, exports}], stats: {total, byExt}}`.
   Regex-based import/export detection for .py, .js, .ts, .rs, .go (extensible pattern map). Replaces
   the per-file research worker pattern that `eatahorse-research.js` used. 10 tests, all pass.

5. **`SKILL.md` rewritten** — single entry point with `--plan`, `--execute`, `--map-codebase` flags.
   Default `/eatahorse "goal"` runs planner then asks about execution. All port/research/pipeline docs
   removed. Operating rules added for the two-phase flow.

6. **Removed files:**
   - `.claude/workflows/eatahorse-research.js` — per-file research, replaced by map_codebase.py + planner
   - `.claude/workflows/eatahorse-port-pipeline.js` — concurrent comprehend+port, removed
   - `plugins/workflow-kit/skills/eatahorse-port/*` — front-door skill for pipeline, removed
   - `scripts/build_inventory.py` + `test_build_inventory.py` — Kahn topo pass (port-only), removed
   - `scripts/diff_test.py` + `test_diff_test.py` — differential equivalence (port-only), removed
   - Port mode code from old `eatahorse.js` (PORT_CARDS_SCHEMA, PORT_MODE, PORT_RULE, grounded
     decompose branch, dep-wiring in seed, DAG spot-check in plan-gate, Verify-equivalence phase,
     EQUIV_SCHEMA, SEED_RESULT_SCHEMA, all port args)

7. **CMD drift test updated** — from 4 tracked workflows to 3 (`eatahorse-plan.js`, `eatahorse-execute.js`,
   `docs-from-code.js`). The orchestrator `eatahorse.js` has no CMD map of its own.

**Backward compatibility:** Old boards with `depends_on` frontmatter or `externalId: source:...` still
work — the CLI still supports these fields. They're just not used by the simplified planner or executor.
No migration needed.

**Known gap:** `docs-from-code.js` still carries its own CMD map copy. Its refactor to use the planner is
deferred (follow-up).

**Verification:**
- `test_eatahorse.py` — 21 tests, unchanged, green
- `test_map_codebase.py` — 10 tests, all pass
- `test_cmd_drift.py` — updated, passes against 3 remaining workflow CMD maps
- `npm run check` — manifests, guardrails drift
- `validate.py --strict` — lints the new workflow scripts
