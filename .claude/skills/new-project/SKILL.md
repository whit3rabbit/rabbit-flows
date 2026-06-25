---
name: new-project
description: Front door for starting a NEW project from scratch and stubbing+documenting its whole tree. Use when the user wants to scaffold, bootstrap, or start a new codebase/app/library/CLI/TUI/GUI/service from nothing, or says "new project", "scaffold a project", "start from scratch", "/new-project". Runs a short discussion (interface, language, OS, license, publish, API, deps, frontend/backend) then launches the `scaffold` workflow with the answers. NOT for adding to or refactoring an existing codebase.
---

# New project (discussion → scaffold workflow launch)

This skill is the conversational front door to the `scaffold` workflow. The workflow runs in the
background with no way to ask the user anything mid-run, so the discussion happens HERE first; the
answers are passed to the workflow as `args`.

Artifacts: `scaffold-out/` can be safely git ignored unless the user wants the generated project tracked.

## Steps

1. **Get the brief.** Take it from the invocation (`/scaffold <brief>`) if present. If missing or one
   word, ask the user what they are building in one plain question.

2. **Run the discussion.** Collect the fields below. Use `AskUserQuestion` for the multiple-choice
   ones (batch them — **max 4 questions per call**, so split the choice questions below across ~2-3
   calls; do NOT cram more than 4 into one call); ask the free-text ones plainly. Offer sensible
   defaults so the user can skip — a one-liner brief must still be runnable. Do NOT interrogate: if
   the user says "just pick sensible defaults", stop asking and use them.

   AskUserQuestion batch A (pick any 4; push the rest to a follow-up call):
   - **interface**: cli · tui · gui · library · service
   - **language**: (offer the obvious candidates for the brief; "you pick" is a valid answer)
   - **targetOS**: macOS · Linux · Windows · cross-platform (multi-select)
   - **scale**: the one question that dials the whole run — is this a throwaway (`prototype`), a tool
     you'll maintain (`standard`, the default), or a foundation others build on (`production`)? It
     right-sizes the scaffold: `prototype` skips CI/hooks/lint config and uses a tighter line ceiling;
     `standard` adds a durable `scripts/check.sh` + lint config + CI; `production` also adds a pre-commit
     hook. Over-building a throwaway is itself a kind of stink, so don't default high.
   - **frontend / backend**: does it involve a frontend, a backend, both, or neither. Map the answer
     to two real booleans in `args` (never pass the raw enum string): frontend →
     `frontend:true, backend:false`; backend → `frontend:false, backend:true`; both → both `true`;
     neither → both `false`.

   AskUserQuestion batch B:
   - **license**: MIT · Apache-2.0 · GPL-3.0 · proprietary/none
   - **publish**: will this be published (npm/PyPI/crates/etc.) — yes/no. Pass as a real boolean
     (`publish:true`/`publish:false`), not the string "yes"/"no".
   - **apiSurface**: does it expose a public API/SDK — yes (brief description) / no
   - **execute**: after writing files, only write them (default), or also run the generated
     install/build/test? Maps to `verify`. The verify step EXECUTES freshly generated code with
     unreviewed dependencies, so the DEFAULT is write-only (`verify:false`). Only pass `verify:true`
     if the user explicitly opts into running it, and never for an unfamiliar/high-stakes/security-
     sensitive stack.

   Plain asks (free-text, skippable):
   - **deps**: preferred or avoided dependencies
   - **priorArt**: any existing tool it is inspired by or should resemble
   - any apiSurface detail if the user answered "yes" above

3. **Preview, then STOP for confirmation, then launch.** Show the user a compact preview of the
   `args` you are about to pass (at least `brief`, `dir`, `language`, `interface`, `write`, `verify`)
   so an accidental write or a wrong `dir` is caught before a filesystem-writing run starts —
   `verify:true` will EXECUTE generated code. Then STOP and wait for an explicit "yes" from the user.
   Do NOT call `Workflow` in the same turn as the preview. Only after the user confirms, call the
   `Workflow` tool with `name: "scaffold"` and an `args` object built from the answers. Pass only what
   was gathered; omit the rest (the workflow defaults them).

   ```
   Workflow({ name: "scaffold", args: {
     brief, language, interface, targetOS,            // targetOS is an array
     scale,                                           // prototype | standard (default) | production
     frontend, backend, license, publish, apiSurface,
     priorArt, deps,
     // optional knobs the user may set:
     // attempts (blind architecture attempts, default 2 — bump for contested briefs),
     // debate (true = one blind rebuttal round before Decide, default off),
     // maxFileLines (per-file ceiling; default 250 for prototype, else 400),
     // write (false = dry run, decide-only, writes nothing),
     // verify (false = write but do not execute install/build/test),
     // polish (true = add a Sonnet once-over after build),
     // dir (target dir, default ./scaffold-out — must be empty/new)
   }})
   ```

4. **Hand back** the workflow's result (chosen stack, files built, verify status, the written
   `CLAUDE.md` location). If `write:false` was used, report the architecture decision and tell the
   user to re-run without `write:false` to build.

## Defaults (when the user skips a field)

interface=unspecified · language="best fit" · targetOS=cross-platform · scale=standard ·
license=unspecified · publish=false · apiSurface=none · frontend/backend inferred from interface
(gui→frontend, service→backend) · attempts=2 · debate=false · maxFileLines=250 (prototype) / 400
(standard, production) · write=true · verify=false · polish=false · dir=./scaffold-out.

## Notes

- The workflow enforces a maintainability contract: well-maintained libraries over reinvention, design
  for reuse, every source file under `maxFileLines` (default 400, or 250 for `scale:prototype`) —
  oversized modules get split. At `scale:standard`+ the contract is made durable as `scripts/check.sh`
  + lint config + CI, not just a one-time scaffold-time check; `production` adds a pre-commit hook.
- For a high-stakes or unfamiliar stack, suggest a **dry run first**: `write:false` returns the
  architecture decision (and dependency research) without writing anything, so the user can review the
  stack before files are created.
- This file is the portable, marketplace-shipped copy of the front-door role. It pairs with the
  `scaffold` workflow in `.claude/workflows/scaffold.js`.
