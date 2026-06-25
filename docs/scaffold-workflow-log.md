# scaffold workflow log

Run history, hardening rounds, and per-workflow constraints for `.claude/workflows/scaffold.js`
and its front-door skill `.claude/skills/new-project/`. Read before editing either.

## 2026-06-25 — anti-stink hardening (scale tier + persistent guardrails + honest tests)

Driver: a review observed the workflow installed a **passing health check, not an immune system** —
its maintainability rules (MAX_LINES, docstrings, a smoke test) were checked ONCE at scaffold time by
`wc -l`/grep, but AI "stink" accumulates over the implementation sessions that follow. We adopted the
high-leverage, low-cost parts of that critique and rejected the ceremony (repo prime directive: less).

### Adopted

1. **`scale` arg (`prototype | standard | production`, default `standard`).** The ambition knob.
   Right-sizes the foundation, because over-building a throwaway is itself stink. Derives the ceremony
   flags `wantLintConfig` / `wantCI` (standard+), `wantHooks` (production only), `wantResolveCheck`
   (standard+), and the default line ceiling (prototype 250, else 400; `maxFileLines` still overrides).
   Threaded into `discussionBlock` so Frame/Propose/Decide see the ambition, and recorded in the new
   project's CLAUDE.md by write-back.
2. **Honest tests (Build `tests` worker).** The old prompt asked for "at least one passing smoke test
   against the stubs" — a test that passes against a `NotImplementedError` body asserts nothing (the
   canonical "all green, nothing works" stink). Now: PENDING contract tests per public symbol
   (`xfail(strict=True)` / `test.todo` / `#[ignore]` / `t.Skip`) so the suite is honestly RED until real
   behavior lands, plus exactly ONE trivial genuinely-passing test proving the runner is wired.
3. **Anti-pattern list** folded into the `maintainabilityRule` const (which is already injected into
   frame/propose/review/tasklist/build): no speculative generality / single-caller abstractions, no
   dead exports, comments explain WHY, one error strategy per layer, no dependency cycles, no copy-paste.
   Gives the forward-review lanes and Once-over a checklist instead of vibes, for one edit.
4. **Persistent guardrail layer (scale-gated `guardrails` Build worker, standard+).** Emits a durable
   `scripts/check.sh` (format → lint → typecheck → test) + formatter/linter config with the line ceiling
   wired as a REAL lint rule (`max-lines` eslint / ruff / clippy / line-count in check.sh) + `.editorconfig`.
   `production` adds a pre-commit hook calling check.sh. The scale-gated CI worker calls `scripts/check.sh`
   so CI and the hook share one gate; `prototype` gets no guardrails and no CI.
5. **Resolve-only dependency check (Checks, 4th check, `wantResolveCheck`).** The #1 AI failure is a
   hallucinated pinned version breaking `install`. A resolve/dry-run (`npm install --package-lock-only
   --ignore-scripts`, `pip install --dry-run`, `cargo update --dry-run`, `go mod download`) confirms every
   pinned version exists/resolves without running build scripts. **This changes the Checks SAFETY
   CONTRACT** (previously "executes NO project code"): when `wantResolveCheck` is on, Checks contacts the
   registry but still runs no build/post-install scripts; when off, Checks stays strictly read-only/offline.
   Both the stage header comment and the prompt say this explicitly.
6. **LICENSE file (Write-back).** The project DOCUMENTED its license but never wrote the `LICENSE` text.
   Write-back now emits the standard license text for a recognized OSS license
   (`/^(mit|apache|bsd|gpl|lgpl|agpl|mpl|isc|unlicense|cc)/i`); proprietary/none/unspecified get no file.

### Rejected (do not re-litigate)

- **Walking skeleton** (one real end-to-end slice instead of uniform stubs). Conflicts with the scaffold's
  premise (stub everything, implement nothing) and breaks the "every Build worker is a mechanical Haiku
  stub" model. The cross-file signature index + Verify gate already backstop seam mismatches. If revisited,
  it should be an explicit `slice:true` knob, not the default.
- **ADR files / CONTRIBUTING.md / renovate.json.** Ceremony. CLAUDE.md already records `rejected[].why`
  (the anti-re-litigation motive). Kept CLAUDE.md as the lean default record. Even at `production`, ADRs
  would be optional, not automatic.

### Constraints / gotchas for the next editor

- The `guardrails`/`ci` workers are pushed onto `supportThunks` conditionally, so the
  `supportWritten` count in the return is now dynamic (tests + README always; guardrails/CI scale-gated).
- No installer-manifest change: `scale` is an arg and the guardrails are inline prompt content — no new
  skill/agent dep. `requires-skills` stays `architect, new-project`.
- The skill's AskUserQuestion batches now exceed 4 choice questions total; the skill instructs splitting
  across ~2-3 calls (max 4 per call). Keep that guidance if adding more choice fields.
- `validate.py --strict` is green; watch the unbalanced-paren / meta-paren gotchas when editing the
  conditional string concatenations in the guardrails/CI/Checks prompts.
