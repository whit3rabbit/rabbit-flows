---
name: document
description: Front door for creating documentation, whatever the starting point. Routes by source — an existing codebase, a written brief/idea with no code yet, or an existing docs site to migrate — to the right workflow (docs-from-code, docs-create, or docs-migrate). Use when the user says "document this", "write docs", "make a docs site", "create documentation", "/document", or is unsure which docs workflow they need. If you already KNOW the source (clearly a codebase, a brief, or a site migration), use the specific entry point directly (/document --from-code, --from-brief, --migrate, --scrape).
dependencies:
  - python>=3.9 (for the map_codebase.py help script and eatahorse board)
---

# Document (entry point for all docs workflows)

All docs workflows build a documentation site. They differ only by where the material comes
from. This skill is the single entry point for all four paths — use the right invocation:

| Invocation | Behavior |
|---|---|
| `/document --from-code <root>` | Generate docs from an existing codebase. Runs intake, then launches `docs-from-code`. |
| `/document --from-code --plan <root>` | Plan only (enumerate, detect, generate, plan, seed). Inspect the board before executing. |
| `/document --from-brief <brief>` | Author docs from a written description. Runs minimal intake, then launches `docs-create`. |
| `/document --migrate <from> <to> <source>` | Migrate an existing docs site to another framework. Runs minimal intake, then launches `docs-migrate`. |
| `/document --scrape <url>` | Save an external docs site as local markdown. Runs minimal intake, then launches `docs-scrape`. |
| `/document` (no flags) | Ask one question to determine the source type, then route. |

Artifacts: `docs-site/`, `.eatahorse-docs/`, and `.docs-plan.md` can be safely git ignored unless the user wants generated docs work tracked.

## Entry points

### `/document --from-code <root>` — docs from existing code

Generate a documentation site from an existing codebase. Runs the `docs-from-code` workflow.

1. **Get the target.** The repo root (default `.`) and what to focus on. Take it from the invocation
   if present; otherwise ask plainly in one question.

2. **Detect an existing run (fresh vs update).** Check for the board dir (`.eatahorse-docs`, or the
   `board` the user names) and `${outDir}/.docs-plan.md`. If EITHER exists, the codebase was already
   documented — offer an UPDATE instead of a rebuild. AskUserQuestion: **Re-document changed code**
   (diff) · **Refine specific pages** (refine) · **Fresh re-run** (ignore the board). The workflow
   can't ask mid-run, so gather the update inputs HERE:
   - **diff**: `since` (free-text git ref, default `HEAD~1`) and `planNewModules` (flag undocumented
     source). Call `Workflow({ name: "docs-from-code", args: { mode:"update", updateMode:"diff",
     since, planNewModules, root, outDir, framework, board } })`.
   - **refine**: read `${outDir}/.docs-plan.md` for the admitted page list, let the user pick page
     paths and state an ask for each, build `refine: [{page, ask}, …]`, then call
     `Workflow({ name: "docs-from-code", args: { mode:"update", updateMode:"refine", refine, root,
     outDir, framework, board } })`.
   An update reopens affected page cards and re-enters the author/grounding loop. If no board/plan
   exists, continue with the fresh path below.

3. **Run the discussion.** If the invocation already includes `--plan`, set `planOnly: true` and skip the
   planOnly question below. Use `AskUserQuestion` for the multiple-choice fields (batch them); ask the
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
   - **planOnly**: no (default — plan then author) · yes (plan only — enumerate, detect, generate
     reference pages, plan reader-facing pages, seed the board, then stop so you can inspect). If the
     invocation already included `--plan`, do not ask this question.
   - **tier**: automated workflow (launches Workflow({ name: "docs-from-code", ... })) · conversational
     here (drive the same Eatahorse board by hand when workflows are off or the repo is small).

   Plain asks (free-text, skippable): **brief** (focus/scope note), **include/exclude** globs.
   Advanced, ask only if the user raises them: **site** (prod URL), **basePath** (serve subpath),
   **i18n**, **versioning**, **verify** (Starlight-only build gate). Pass each through to the workflow
   verbatim.

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

4. **Preview the args**, then call the `Workflow` tool:

   ```
   // @generated-start arg-contract/skill-args
   // Knobs (args) — GENERATED from installer/arg-schemas/docs-from-code.mjs (build:arg-contract); edit the schema.
   // core:
   //   root — repo root to document (bare string also accepted)
   //   outDir (required) — directory to write the docs site into (required)
   //   framework — registry id; unknown ids fall back to work-from-current-docs
   //   scaffoldMode — content-only (default) | add-to-existing | full-project (Starlight only)
   //   brief — focus/scope note for the run
   //   includeTutorials — also author tutorials (default false; expect more gate churn)
   //   planOnly — plan only — enumerate, generate, plan, and seed the board without authoring
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
   ```
   Pass only what was gathered; omit the rest (the workflow defaults them).

   ```
   Workflow({ name: "docs-from-code", args: {
     root, outDir, framework, scaffoldMode, brief, includeTutorials, planOnly,
     // optional: board, workerModel, maxRounds, filesPerPage, include, exclude,
     //           pages, scriptPath, verify, site, basePath, i18n, versioning
   }})
   ```

   If `Workflow()` errors (workflows disabled), fall to the conversational fallback below.

5. **Hand back** the result: site location, pages admitted vs planned, deferred pages (need a human
   brief), board path, and the build check status (or "skipped: not a buildable project").

#### Conversational fallback (Tier 2)

When workflows are off or the repo is small, drive the same Eatahorse board by hand. The eatahorse
CLI is stdlib Python and needs no runtime.

- **Enumerate** the source: `git ls-files` (skip `.git`, `node_modules`, build dirs, lockfiles,
  binaries, and the `outDir`/board dirs).
- **Frame IA + plan**: group BY READER TASK (not module layout); one page per module; tag each page
  a Diataxis type and a file **scope**; keep scope <= ~12 files (split bigger modules). Default to
  reference + module overviews; DEFER tutorials unless the user asked for them.
- **Seed the board**, one card per page (title = page path), scope in the card description, TWO acceptance
  items (the author ticks the first, the grounding check ticks the second):
  `python3 <eatahorse.py> --board .eatahorse-docs add "<path>" --status backlog -d "path=... | scope=..." --bite "author it" --accept "page written from source" --accept "grounding verified by gate"`
- **Plan-only mode**: if planOnly is set, stop after seeding. Return the board path and card count without
  authoring or grounding. The user inspects the board and calls back to author.
- **Author pages** one module at a time (a couple of subagents): read the scope source, write the
  page under `outDir/src/content/docs/...` per the Starlight contract, then tick ONLY the FIRST acceptance
  item. Run `sync` after a batch (single writer -- do not sync concurrently).
- **Grounding check (full coverage)**: for every written-but-unverified page, re-read the scope source;
  if backed, tick the second acceptance item (`bite <id> 1 --group acceptance --done` -> done); else
  `reopen <id> --gap "..."`. The card reaches `done` (admitted) only after grounding is verified.
- **Assemble**: write `src/content.config.ts` + `astro.config.mjs` sidebar from the admitted pages,
  and `.docs-plan.md`. Run `npx astro check` only if `outDir` is already a buildable Astro project.
- **To update (Tier 2)**: don't replan. For changed code, `git diff --name-only <ref>` and `reopen <id>`
  each card whose scope (in its description) contains a changed file; for a request, `reopen <id> --gap "..."`
  the named page. Then re-author those pages from scope, `sync`, and only patch the sidebar if you added a
  new page. Flag new/deleted source for the human; do not auto-delete pages.

### `/document --from-brief <brief>` — docs from a description

Author a docs site from a written description. No codebase needed. Runs the `docs-create` workflow.

Minimal intake, then launch. Required: **brief** (what the docs cover; ask plainly if missing) and
**outDir** (default `./docs-site`). `AskUserQuestion` for **framework** (see the shared picker
below) and **scaffoldMode** (`content-only` default · `add-to-existing` · `full-project`). Plain,
skippable: **sources** (files authors should read as material).

Preview the `args`, STOP for an explicit "yes" (this writes files), then:

```
Workflow({ name: "docs-create", args: {
  brief, outDir, framework, scaffoldMode,
  // optional: sources (string[]), pages (explicit page plan, skips IA+Plan),
  // basePath, i18n, versioning
}})
```

### `/document --migrate <from> <to> <source>` — migrate a docs site

Move an existing docs site from one framework to another. Runs the `docs-migrate` workflow.

Required: **from** (source framework: mkdocs|starlight|docusaurus|vitepress|gitbook|sphinx|generic),
**to** (see framework picker below), **source** (URL or local dir), **outDir** (default `./docs-site`).
Plain, skippable: **title**, **maxPages** (default 50).

Preview the `args`, STOP for an explicit "yes" (this fetches + writes files), then:

```
Workflow({ name: "docs-migrate", args: {
  from, to, source, outDir,
  // optional: title, maxPages, repoUrl (force git acquisition)
}})
```

### `/document --scrape <url>` — save a docs site locally

Save an external documentation website as a local markdown corpus. Runs the `docs-scrape` workflow.

Required: **url** (the docs site to scrape). Check **strategy** option if the URL gives no clues
about the format. See the `docs-scraper` skill for details.

## Shared framework picker

`AskUserQuestion` caps at 4 options; the registry supports more. Offer the common ones and an
escape hatch, pass the chosen id **verbatim** as `framework`/`to`:

- `Starlight` (default), `Docusaurus`, `MkDocs`, **Other -- name any supported framework**.

Frameworks with a baked inline authoring contract (authors get distilled syntax, not a runtime
docs fetch): **starlight, docusaurus, mkdocs, vitepress, fumadocs, mdbook, docsify**. Other registry
ids (sphinx, nextra, mintlify, docsy, scalar, redocly) author from current official docs at runtime.
Any unknown id falls through to that same work-from-current-docs path.

## Defaults (when the user skips a field)

<!-- @generated-start arg-contract/skill-defaults -->
root=. · outDir=./docs-site · framework=starlight · scaffoldMode=content-only · includeTutorials=false · planOnly=false · board=.eatahorse-docs · workerModel=sonnet · maxRounds=3 (max 10) · filesPerPage=12 · verify=false.
<!-- @generated-end arg-contract/skill-defaults -->

## Notes

- **A doc page is not a source file.** The board's unit is one card per planned PAGE (≈ a module) with a
  file scope, NOT one card per file. Group by reader task; some source files document into no page.
- **Grounding is the real gate.** The failure mode of code->docs is hallucinated APIs. The gate (Tier 1)
  / spot-check (Tier 2) re-reads the actual source and reopens pages the code does not back.
- **Tutorials default off.** The source carries facts (reference, overviews) reliably but not intent
  (tutorials, getting-started). Those are deferred with a reason unless the user opts in.
- **Single-writer discipline (Tier 2 too).** Authors write only their own page file + own card; sync is
  serialized; never run two `sync`/state writes concurrently. `EATAHORSE_NO_AUTOSYNC=1` if a hook overlaps.
- If `Workflow()` errors (dynamic workflows disabled), `--from-code` falls back to the conversational
  fallback above; `--from-brief`, `--migrate`, and `--scrape` have no serial fallback -- tell the user
  to enable workflows, or drive the workflow's stages by hand from their scripts.
- NOT for scraping a docs site into local markdown without migrating it -- that is `--scrape`.
