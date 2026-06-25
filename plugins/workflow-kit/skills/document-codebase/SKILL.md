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

0. **Detect an existing run (fresh vs update).** Check for the board dir (`.eatahorse-docs`, or the `board`
   the user names) and `${outDir}/.docs-plan.md`. If EITHER exists, this repo was already documented — offer an
   UPDATE instead of a rebuild. AskUserQuestion: **Re-document changed code** (diff) · **Refine specific
   pages** (refine) · **Fresh re-run** (ignore the board). The workflow can't ask mid-run, so gather the
   update inputs HERE:
   - **diff**: `since` (free-text git ref, default `HEAD~1`) and `planNewModules` (no default — flag new
     undocumented source vs auto-plan pages for it). Call
     `Workflow({ name: "docs-from-code", args: { mode:"update", updateMode:"diff", since, planNewModules, root, outDir, framework, board } })`.
   - **refine**: read `${outDir}/.docs-plan.md` for the admitted page list, let the user pick page paths and
     state an ask for each, build `refine: [{page, ask}, …]`, then
     `Workflow({ name: "docs-from-code", args: { mode:"update", updateMode:"refine", refine, root, outDir, framework, board } })`.
   An update reopens the affected page cards and re-enters the author/grounding loop; new modules are flagged
   (or planned with `planNewModules:true`), deleted-source pages are flagged for human review. If no board/plan
   exists, continue with the fresh path below.

1. **Get the target.** The repo root (default `.`) and what to focus on, if anything. Take it from the
   invocation if present; otherwise ask plainly in one question.

2. **Run the discussion.** Use `AskUserQuestion` for the multiple-choice fields (batch them); ask the
   free-text ones plainly. Offer defaults so the user can skip.

   AskUserQuestion batch:
   - **outDir**: where to write the site (default `./docs-site`).
   - **framework**: AskUserQuestion allows only 2-4 options, but the registry supports 13 frameworks
     (table below). Offer the four most common as selectable options, with the last being an "Other"
     escape hatch that takes a free-text name:
       - `Starlight` (default — baked inline contract; the only one supporting full-project)
       - `Docusaurus`
       - `MkDocs`
       - `Other — name any supported framework` → then ask plainly which one and pass that name
         **verbatim** as `framework`. Valid names are the registry ids in the table below; any
         other string falls through to the work-from-current-docs path.
   - **scaffoldMode**: how much of the site to produce (3 options):
       - `content-only` (default — write content + config; build check only if already buildable)
       - `add-to-existing` (PATCH an existing config/sidebar instead of assembling from scratch)
       - `full-project` (scaffold a complete buildable project, install, then run the build check —
         Starlight only; ignored for unfilled frameworks)
   - **includeTutorials**: no (default — reference + module overviews only; tutorials need intent the
     source rarely states and would fail the grounding gate) · yes (also author tutorials, expect more
     gate churn).
   - **tier**: automated workflow (needs dynamic workflows enabled) · conversational here. A skill
     can't introspect `/config`, so just ASK, or attempt the workflow and fall back (step 3b).

   Plain asks (free-text, skippable): **brief** (focus/scope note), **include/exclude** globs. Advanced,
   ask only if the user raises them: **site** (prod URL), **basePath** (serve subpath), **i18n**,
   **versioning**, **verify** (Starlight-only build gate). Pass each through to the workflow verbatim.

   **Supported `framework` values (registry-backed).** Pass any of these ids verbatim. Seven
   frameworks ship a baked inline authoring contract (authors get distilled syntax, no runtime docs
   fetch); the rest author from current official docs at runtime. `full-project` scaffolding is
   Starlight-only:

   | framework id | support tier |
   |---|---|
   | `starlight` | baked inline contract (default; supports full-project) |
   | `docusaurus` | baked inline contract |
   | `mkdocs` | baked inline contract |
   | `vitepress` | baked inline contract |
   | `fumadocs` | baked inline contract |
   | `mdbook` | baked inline contract |
   | `docsify` | baked inline contract |
   | `sphinx` | work-from-current-docs |
   | `nextra` | work-from-current-docs |
   | `mintlify` | work-from-current-docs |
   | `docsy` | work-from-current-docs |
   | `scalar` | work-from-current-docs |
   | `redocly` | work-from-current-docs |

3a. **Tier 1 — automated.** Preview the `args` (at least `root`, `outDir`, `framework`,
   `scaffoldMode`, `includeTutorials`), then call the `Workflow` tool:

   ```
   Workflow({ name: "docs-from-code", args: {
   // @generated-start arg-contract/skill-args
   // Knobs (args) — GENERATED from installer/arg-schemas/docs-from-code.mjs (build:arg-contract); edit the schema.
   // core:
   //   root — repo root to document (bare string also accepted)
   //   outDir (required) — directory to write the docs site into (required)
   //   framework — registry id; unknown ids fall back to work-from-current-docs
   //   scaffoldMode — content-only (default) | add-to-existing | full-project (Starlight only)
   //   brief — focus/scope note for the run
   //   includeTutorials — also author tutorials (default false; expect more gate churn)
   // optional:
   //   board — Eatahorse board directory
   //   workerModel — model for page authors
   //   maxRounds — author/gate rounds per run (default 3, clamped to 10)
   //   filesPerPage — split modules bigger than this into sub-pages
   //   include — glob(s) to include
   //   exclude — glob(s) to exclude
   //   pages — explicit page plan; skips the Plan stage
   //   scriptPath — path to eatahorse.py
   //   verify — opt-in end-to-end build gate (Starlight only, needs pinned deps)
   //   site — full production URL (e.g. https://docs.example.com)
   //   basePath — subpath the site is served from (e.g. /docs)
   //   i18n — {defaultLocale, locales[]} — enable multi-locale output
   //   versioning — {current, versions?[]} — version label, mapped where supported
   // update mode (args.mode='update'):
   //   mode — 'fresh' (default) | 'update' (re-document an existing run)
   //   updateMode — 'diff' (default, changed source since `since`) | 'refine' (named pages)
   //   since — git ref for diff mode
   //   refine — [{page, ask}] for refine mode
   //   planNewModules — plan pages for new undocumented source (default false)
   // @generated-end arg-contract/skill-args
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
   - **Seed the board**, one card per page (title = page path), scope in the card description, TWO acceptance
     items (the author ticks the first, the grounding check ticks the second):
     `python3 <eatahorse.py> --board .eatahorse-docs add "<path>" --status backlog -d "path=… | scope=…" --bite "author it" --accept "page written from source" --accept "grounding verified by gate"`
   - **Author pages** one module at a time (a couple of subagents): read the scope source, write the
     page under `outDir/src/content/docs/…` per the Starlight contract, then tick ONLY the FIRST acceptance
     item. Run `sync` after a batch (single writer — don't sync concurrently).
   - **Grounding check (full coverage)**: for every written-but-unverified page, re-read the scope source;
     if backed, tick the second acceptance item (`bite <id> 1 --group acceptance --done` → done); else
     `reopen <id> --gap "…"`. The card reaches `done` (admitted) only after grounding is verified.
   - **Assemble**: write `src/content.config.ts` + `astro.config.mjs` sidebar from the admitted pages,
     and `.docs-plan.md`. Run `npx astro check` only if `outDir` is already a buildable Astro project.
   - **To update (Tier 2)**: don't replan. For changed code, `git diff --name-only <ref>` and `reopen <id>`
     each card whose scope (in its description) contains a changed file; for a request, `reopen <id> --gap "…"`
     the named page. Then re-author those pages from scope, `sync`, and only patch the sidebar if you added a
     new page. Flag new/deleted source for the human; don't auto-delete pages.

4. **Hand back** the result: site location, pages admitted vs planned, deferred pages (need a human
   brief), board path, and the `astro check` status (or "skipped: not a buildable project").

## Defaults (when the user skips a field)

<!-- @generated-start arg-contract/skill-defaults -->
root=. · outDir=./docs-site · framework=starlight · scaffoldMode=content-only · includeTutorials=false · board=.eatahorse-docs · workerModel=sonnet · maxRounds=3 (max 10) · filesPerPage=12 · verify=false.
<!-- @generated-end arg-contract/skill-defaults -->

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
