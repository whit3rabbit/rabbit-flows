# docs factory (docs-from-code / docs-create / docs-migrate) — running log

Run history, dead ends, and constraints for the docs-factory workflows + the `docs-site-builder` /
`document` skills. **Read this before editing a docs workflow or the FRAMEWORKS registry.**
Kept out of `CLAUDE.md` so it loads only when relevant.

## 2026-06-24: three structural hardenings (grounding-as-board-fact, blocked lane, arg-contract codegen)

Follow-up to the 12-finding review fixes (commit `ee2e9ff`). Three "convention -> mechanism" changes in
`docs-from-code.js` (+ a new build gate). All four `npm run check` gates + `validate.py --strict` +
`test_eatahorse.py` (11) green. NOT yet live-run.

1. **Grounding is now a DURABLE per-page board fact, full-coverage (not sampled).** Each page card carries
   TWO acceptance items — `[1]` "page written from source" (the author ticks) and `[2]` "grounding verified
   by gate" (ONLY the gate ticks). Eatahorse derives `done` from ALL acceptance, so a card reaches `done`
   (= the admitted set) only after the gate verifies it: **admitted ⇔ gate-verified**. The author loop now
   runs two queues off the board snapshot — `authorQueue` (not written) and `gateQueue` (written, awaiting
   grounding) — and the gate is fanned out over EVERY written-but-unverified card (chunks of 8), not a
   ≤12 sample. Reload (`SEED_SCHEMA`) gained per-card `written`/`verified` booleans.
   - **GOTCHA (cost me a bug):** eatahorse `set_checkbox`/`bite <id> <index>` is **1-BASED**
     (`items[index-1]`). The gate ticks the grounding item with `bite <id> 2` (NOT 1). Ticking 1 would
     re-tick "page written" and cards would NEVER complete. Guarded by
     `test_two_acceptance_gate_tick_completes` in `test_eatahorse.py`.
   - **Backward-compat:** the reload prompt reports `verified = written` for LEGACY single-acceptance cards
     (pre-existing boards), so an old board keeps working without a forced mass re-ground. New work gets the
     strict two-item gate.
   - No `eatahorse.py` change: `add --accept A --accept B`, `bite`, `reopen` already exist; added `bite` +
     `move` to the workflow's `CMD` slice.

2. **`blocked` lane for give-ups (was `dropped`).** A page the gate rejects `MAX_ATTEMPTS` (2) times moves
   to `blocked` (gap already on the card from `reopen --gap`), surfaced not silently dropped. `notDone` now
   excludes `blocked` (and `dropped`), so reruns skip it; `attempts` counts gate REJECTIONS (not author
   rounds). The blocked list is surfaced in the return object + write-back; `move <id> ready` to retry after
   fixing scope. `dropped` reserved for true purge.

3. **Single generated arg contract (4th `npm run check` gate).** `installer/arg-schemas/docs-from-code.mjs`
   is now the source of truth for the ~24 args; `scripts/build-arg-contract.mjs` generates the uniform guard
   block + header comment in the workflow AND the args block + Defaults line in `document/SKILL.md`
   (markers `@generated-start/@generated-end arg-contract/*`). Bespoke validators (`i18n`/`versioning`/
   `refine`) + derived consts (`root`/`fwEntry`/`mode`/`updateMode`/`normPagePath`) stay HAND-WRITTEN below
   the generated block (`kind:'custom'` in the schema) — bespoke object-shape validation is deliberately NOT
   codegenned. `--check` lints that every schema arg name set-matches the `args?.X` accesses in the guard
   region (start marker down to the `// --- end args / guards` sentinel), catching a hand-added guard or a
   dropped arg. This kills the drift class that produced review finding #8 (front door missing `site`/`i18n`/
   `versioning`). **Lint gotcha:** search the sentinel from `startIdx`, not 0 — the block's own explanatory
   comment contains the phrase "end args / guards".

NOT done (deferred, no demand): codegenning the bespoke guard validators; a live small-slice run to confirm
admitted⇔grounded and the blocked-on-rerun-skip behaviorally (the real gate per this log — token-heavy).

## 2026-06-24: archetype-aware doc strategy (advisory layer)

Added an "Archetypes: what docs a project needs" section to `references/information-architecture.md`
(archetype -> doc-set table, minimum-viable baseline, ADR/runbook skeletons, single-file/embedded/site
verdict). Rides the existing `IA_CONTRACT` build wiring — no new skill/stage/block. The Frame-IA
(docs-create) and Plan (docs-from-code) prompts now identify the archetype and scope to its
minimum-viable set; both schemas carry `archetype` + `siteRecommendation`; the verdict is written to
`.docs-plan.md` as a "Doc strategy" line. Advisory ONLY: the pipeline still builds a site even when the
recommendation is single-file/embedded. Deferred (no demand yet): an actual non-site output branch that
emits a bare README or docstrings and skips sidebar/config/build.

## docs-factory: dead ends (don't re-litigate)

Multi-framework docs factory work (FRAMEWORKS registry, per-framework adapters, validators,
component crosswalk, quality gate, docs-migrate). Live card status lives in the Eatahorse board
and git history, not here.

- EH-0017 (generated-docs lanes) / EH-0018 (`docs-migrate.js`) acceptance is **empirical**: static
  checks (`npm run check`, `validate.py --strict`) pass but do NOT substitute for a live run. Don't
  mark done until `outDir` artifacts (`MIGRATION.md`, `.source-corpus`, reference pages) exist on disk.
- `docs-migrate.js` exists and lints — gap is runtime verification only. Don't re-implement it.

## docs-from-code run: 2026-06-22

**Codebase documented:** `.` (rabbit-flows repo root)
**Docs site:** `./docs`
**Board:** `.eatahorse-docs`
**Pages:** 11 grounded pages written to `./docs/src/content/docs/`; site recovered to buildable (hand-wrote `astro.config.mjs`, `package.json`, `src/content.config.ts`, `tsconfig.json`; `npm run build` green). The run's `admitted:0`/`configWritten:false` was a bug (two path-convention mismatches in gather-admitted + the quality-gate filter), FIXED 2026-06-23 along with a loud-fail and an opt-in `verify` build gate; ignore the original "0 admitted" write-back.
**Doc-coverage gaps:** 125 public symbols without a doc comment; see `./docs/src/content/docs/reference/documentation-gaps.md`

CONSTRAINTS (do not re-walk these without a human brief):

- **Deferred, needs human brief, "Quickstart: install and run your first workflow":** a 5-minute getting-started tutorial requires a chosen demo workflow, the exact install/enable steps, and the expected on-screen result. Onboarding intent not present in source; a guessed tutorial fails the grounding gate.
- **Deferred, needs human brief, "Tutorial: author your own dynamic workflow":** the pedagogical path (what to build first, the worked example, the sample task) is editorial intent. `dynamic-workflow-authoring` skill and `starter.js` provide raw material, but the teaching sequence must be specified by a human.

## 2026-06-24: update-mode review fixes (docs-from-code)

Code-review pass on the new update mode. File: `docs-from-code.js` (+ `installer/arg-schemas/docs-from-code.mjs`).

- **Re-authored pages now pass the quality gate.** Update mode returned before the fresh Quality gate, so a
  re-authored page could ship a Diataxis mode-mix or a Starlight syntax leak (non-Starlight target) uncaught.
  Extracted the gate into a shared `runQualityGate(pages)` helper (removes the duplicated ~30-line prompt);
  fresh mode calls it before assemble, update mode calls it on `uChanged` and REOPENS failures (not drops —
  the page keeps its sidebar entry) for re-author on a later run, mirroring staleByDeletion.
- **`changedSet` is derived from `touched`, not the Reopen agent's `reopened[]`.** The agent could reopen a
  card on the board but omit it from its return; that page would then skip link/asset resolution. `touched`
  (titles the author loop actually re-authored) is the durable signal.
- **Dead Reopen agent distinguished from a missing board.** `if (!r || r.noBoard)` conflated a transient
  agent death with an absent board, telling the user to re-run a full fresh pass. Now `!r` -> retry message,
  `r.noBoard` -> run-fresh message.
- **Author-miss give-up.** `attempts` counted only gate REJECTIONS; a page whose author never wrote (scope
  unreadable, agent died) stayed at 0 and retried every rerun forever. Author misses now count toward the
  same MAX_ATTEMPTS budget, so the `blocked` parker catches them.
- **`since` charset-validated** (interpolated into a git command in the Reopen agent prompt). Moved from
  `kind:'stringTrim'` to `kind:'custom'` in the arg-schema; the validated const is hand-written below the
  generated guard block. **`plan-new-modules` agent** got the missing model-routing justification comment.
- All four `npm run check` gates + `validate.py --strict` green. NOT yet live-run (per this log's standing
  constraint, static gates do not substitute for a small-slice update run).
