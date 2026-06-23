---
name: document
description: Front door for creating documentation, whatever the starting point. Routes by source - an existing codebase, a written brief/idea with no code yet, or an existing docs site to migrate - to the right workflow (docs-from-code, docs-create, or docs-migrate). Use when the user says "document this", "write docs", "make a docs site", "create documentation", "/document", or is unsure which docs workflow they need. If you already KNOW the source (clearly a codebase, a brief, or a site migration), you may skip straight to the specific front door (document-codebase, docs-create, docs-scrape).
---

# Document (router → the right docs workflow)

All three docs workflows end in the same place: a built documentation site. They differ only by
where the material comes from. This skill asks that one question and routes; it does not duplicate
the per-branch interview (each branch defers to its own front door or runs the minimal intake the
target workflow needs). Workflows run in the background and cannot ask anything mid-run, so all
intake happens HERE and passes as `args`.

## Step 1 — find the source

Take it from the invocation if obvious. Otherwise ONE `AskUserQuestion`:

- **An existing codebase** (generate docs FROM source) → branch A.
- **A brief or idea, no code yet** (author docs from a description) → branch B.
- **An existing docs site** (move it to another framework) → branch C.

## Step 2 — route

### Branch A — codebase → `docs-from-code`

Use the **`document-codebase`** skill: it owns the full intake (outDir, framework, scaffoldMode,
tutorials, tier) and launches `docs-from-code` (with a conversational Tier-2 fallback). Do not
re-implement its interview here — invoke it.

### Branch B — brief → `docs-create`

Minimal intake, then launch. Required: **brief** (what the docs cover; ask plainly if missing) and
**outDir** (default `./docs-site`). `AskUserQuestion` for **framework** (see the shared picker
below) and **scaffoldMode** (`content-only` default · `add-to-existing` · `full-project`). Plain,
skippable: **sources** (files authors should read as material).

Preview the `args`, STOP for an explicit "yes" (this writes files), then:

```
Workflow({ name: "docs-create", args: {
  brief, outDir, framework, scaffoldMode,
  // optional: sources (string[]), pages (explicit page plan, skips IA+Plan),
  // basePath, i18n ({defaultLocale, locales[]}), versioning ({current, versions?[]})
}})
```

### Branch C — existing docs site → `docs-migrate`

Minimal intake, then launch. Required: **from** (source framework: mkdocs|starlight|docusaurus|
vitepress|gitbook|sphinx|generic), **to** (target: see picker), **source** (URL or local dir),
**outDir** (default `./docs-site`). Plain, skippable: **title**, **maxPages** (default 50).

Preview the `args`, STOP for an explicit "yes" (this fetches + writes files), then:

```
Workflow({ name: "docs-migrate", args: {
  from, to, source, outDir,
  // optional: title, maxPages (default 50), repoUrl (force git acquisition)
}})
```

## Shared framework picker

`AskUserQuestion` caps at 4 options; the registry supports more. Offer the common ones and an
escape hatch, pass the chosen id **verbatim** as `framework`/`to`:

- `Starlight` (default), `Docusaurus`, `MkDocs`, **Other — name any supported framework**.

Frameworks with a baked inline authoring contract (authors get distilled syntax, not a runtime
docs fetch): **starlight, docusaurus, mkdocs, vitepress, fumadocs, mdbook, docsify**. Other registry
ids (sphinx, nextra, mintlify, docsy, scalar, redocly) author from current official docs at runtime.
Any unknown id falls through to that same work-from-current-docs path.

## Notes

- If `Workflow()` errors (dynamic workflows disabled), branch A falls back to `document-codebase`'s
  Tier-2 conversational board; branches B and C have no serial fallback — tell the user to enable
  workflows, or drive `docs-create`/`docs-migrate`'s stages by hand from their scripts.
- This is a thin router. The detailed interview, defaults, and arg list live with each target
  (`document-codebase`, `.claude/workflows/docs-create.js`, `.claude/workflows/docs-migrate.js`);
  keep this file in sync if those args change.
- NOT for scraping a docs site into local markdown without migrating it — that is `docs-scrape`.
