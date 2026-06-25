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

## CMD-sync note

`eatahorse.js` `CMD.add` now advertises `[--external-id ns:val]` (the flag already existed in
`eatahorse.py`; only the inline doc surfaced it). The research/docs-from-code sibling `CMD` maps do NOT
use `--external-id` (they only read/reopen/sync), so no cross-workflow sync was required this round. See
`plugins/workflow-kit/skills/eatahorse/CLAUDE.md` for the three-copy hand-sync rule when a real
`eatahorse.py` subcommand/flag changes.
