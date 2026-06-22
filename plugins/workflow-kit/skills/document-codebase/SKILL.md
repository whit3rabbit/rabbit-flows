---
name: document-codebase
description: Front door for documenting an EXISTING codebase into a docs site. Use when the user wants to generate documentation from source, "document this codebase", "docs from code", "make a docs site for this repo", "/document-codebase". Runs a short discussion (output dir, framework, tutorials, tier) then launches the `docs-from-code` workflow with the answers, or drives the same Eatahorse board conversationally when workflows are off or the repo is small. NOT for authoring docs from a brief with no codebase (use docs-create) and NOT for scraping an external docs site (use docs-scrape).
---

# Document codebase (discussion → docs-from-code workflow, with conversational fallback)

This skill is the conversational front door to the `docs-from-code` workflow. That workflow runs in
the background with no way to ask the user anything mid-run, so the discussion happens HERE first; the
answers pass to the workflow as `args`. When dynamic workflows are off (or the repo is small enough
that the board's resumability isn't worth it), this skill drives the **same** Eatahorse board by hand —
same ledger, same output, just serial.

Artifacts: `docs-site/`, `.eatahorse-docs/`, and `.docs-plan.md` can be safely git ignored unless the user wants generated docs work tracked.

## Steps

1. **Get the target.** The repo root (default `.`) and what to focus on, if anything. Take it from the
   invocation if present; otherwise ask plainly in one question.

2. **Run the discussion.** Use `AskUserQuestion` for the multiple-choice fields (batch them); ask the
   free-text ones plainly. Offer defaults so the user can skip.

   AskUserQuestion batch:
   - **outDir**: where to write the site (default `./docs-site`).
   - **framework**: starlight (default, first-class) · other (authored from current official docs).
   - **includeTutorials**: no (default — reference + module overviews only; tutorials need intent the
     source rarely states and would fail the grounding gate) · yes (also author tutorials, expect more
     gate churn).
   - **tier**: automated workflow (needs dynamic workflows enabled) · conversational here. A skill
     can't introspect `/config`, so just ASK, or attempt the workflow and fall back (step 3b).

   Plain asks (free-text, skippable): **brief** (focus/scope note), **include/exclude** globs.

3a. **Tier 1 — automated.** Preview the `args` (at least `root`, `outDir`, `framework`,
   `includeTutorials`), then call the `Workflow` tool:

   ```
   Workflow({ name: "docs-from-code", args: {
     root, outDir, framework, brief, includeTutorials,
     // optional knobs the user may set:
     // include, exclude (globs), board (default .eatahorse-docs),
     // workerModel (default sonnet), maxRounds (default 3),
     // filesPerPage (split modules bigger than this, default 12),
     // pages (explicit page plan, skips the Plan stage)
   }})
   ```
   Pass only what was gathered; omit the rest (the workflow defaults them). If `Workflow()` errors
   (workflows disabled), fall to 3b.

3b. **Tier 2 — conversational fallback (same board, no workflow runtime).** The eatahorse CLI is plain
   stdlib Python and needs no runtime. Drive it by hand:
   - **Enumerate** the source: `git ls-files` (skip `.git`, `node_modules`, build dirs, lockfiles,
     binaries, and the `outDir`/board dirs).
   - **Frame IA + plan**: group BY READER TASK (not module layout); one page per module; tag each page
     a Diátaxis type and a file **scope**; keep scope ≤ ~12 files (split bigger modules). Default to
     reference + module overviews; DEFER tutorials unless the user asked for them.
   - **Seed the board**, one card per page (title = page path), scope in the card description:
     `python3 <eatahorse.py> --board .eatahorse-docs add "<path>" --status backlog -d "path=… | scope=…" --bite "author it" --accept "page written and grounded in source"`
   - **Author pages** one module at a time (a couple of subagents): read the scope source, write the
     page under `outDir/src/content/docs/…` per the Starlight contract, then tick the card's acceptance.
     Run `sync` after a batch (single writer — don't sync concurrently).
   - **Spot-check (grounding)**: re-read the scope source for a few done pages; `reopen <id> --gap "…"`
     any whose claims aren't in the code.
   - **Assemble**: write `src/content.config.ts` + `astro.config.mjs` sidebar from the admitted pages,
     and `.docs-plan.md`. Run `npx astro check` only if `outDir` is already a buildable Astro project.

4. **Hand back** the result: site location, pages admitted vs planned, deferred pages (need a human
   brief), board path, and the `astro check` status (or "skipped: not a buildable project").

## Defaults (when the user skips a field)

root=`.` · outDir=`./docs-site` · framework=starlight · includeTutorials=false · board=`.eatahorse-docs` ·
workerModel=sonnet · maxRounds=3 · filesPerPage=12.

## Notes

- **A doc page is not a source file.** The board's unit is one card per planned PAGE (≈ a module) with a
  file scope, NOT one card per file. Group by reader task; some source files document into no page.
- **Grounding is the real gate.** The failure mode of code→docs is hallucinated APIs. The gate (Tier 1)
  / spot-check (Tier 2) re-reads the actual source and reopens pages the code doesn't back. `astro check`
  is a secondary check, not the primary one.
- **Tutorials default off.** The source carries facts (reference, overviews) reliably but not intent
  (tutorials, getting-started). Those are deferred with a reason unless the user opts in.
- **Single-writer discipline (Tier 2 too).** Authors write only their own page file + own card; sync is
  serialized; never run two `sync`/state writes concurrently. `EATAHORSE_NO_AUTOSYNC=1` if a hook overlaps.
- This file is the portable, marketplace-shipped copy of the front-door role. It pairs with the
  `docs-from-code` workflow in `.claude/workflows/docs-from-code.js`.
