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
   ones (batch them — max 4 questions per call, so ~2 calls); ask the free-text ones plainly. Offer
   sensible defaults so the user can skip — a one-liner brief must still be runnable. Do NOT
   interrogate: if the user says "just pick sensible defaults", stop asking and use them.

   AskUserQuestion batch A:
   - **interface**: cli · tui · gui · library · service
   - **language**: (offer the obvious candidates for the brief; "you pick" is a valid answer)
   - **targetOS**: macOS · Linux · Windows · cross-platform (multi-select)
   - **frontend / backend**: does it involve a frontend, a backend, both, or neither

   AskUserQuestion batch B:
   - **license**: MIT · Apache-2.0 · GPL-3.0 · proprietary/none
   - **publish**: will this be published (npm/PyPI/crates/etc.) — yes/no
   - **apiSurface**: does it expose a public API/SDK — yes (brief description) / no
   - **execute**: after writing files, run the generated install/build/test (verify) — or only
     write files and leave commands for review? Maps to `verify`. The verify step EXECUTES freshly
     generated code with unreviewed dependencies, so DEFAULT to "write only" (`verify:false`) when the
     stack is unfamiliar, high-stakes, or security-sensitive; "run" (`verify:true`) otherwise.

   Plain asks (free-text, skippable):
   - **deps**: preferred or avoided dependencies
   - **priorArt**: any existing tool it is inspired by or should resemble
   - any apiSurface detail if the user answered "yes" above

3. **Preview, then launch.** First show the user a compact preview of the `args` you are about to
   pass (at least `brief`, `dir`, `language`, `interface`, `write`, `verify`) so an accidental write
   or a wrong `dir` is caught before a filesystem-writing run starts — `verify:true` will EXECUTE
   generated code. Then call the `Workflow` tool with `name: "scaffold"` and an `args` object built
   from the answers. Pass only what was gathered; omit the rest (the workflow defaults them).

   ```
   Workflow({ name: "scaffold", args: {
     brief, language, interface, targetOS,            // targetOS is an array
     frontend, backend, license, publish, apiSurface,
     priorArt, deps,
     // optional knobs the user may set:
     // attempts (blind architecture attempts, default 2 — bump for contested briefs),
     // debate (true = one blind rebuttal round before Decide, default off),
     // maxFileLines (per-file ceiling, default 400),
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

interface=unspecified · language="best fit" · targetOS=cross-platform · license=unspecified ·
publish=false · apiSurface=none · frontend/backend inferred from interface (gui→frontend,
service→backend) · attempts=2 · debate=false · maxFileLines=400 · write=true · verify=true ·
polish=false · dir=./scaffold-out.

## Notes

- The workflow enforces a maintainability contract: well-maintained libraries over reinvention, design
  for reuse, every source file under `maxFileLines` (default 400) — oversized modules get split.
- For a high-stakes or unfamiliar stack, suggest a **dry run first**: `write:false` returns the
  architecture decision (and dependency research) without writing anything, so the user can review the
  stack before files are created.
- This file is the portable, marketplace-shipped copy of the front-door role. It pairs with the
  `scaffold` workflow in `.claude/workflows/scaffold.js`.
