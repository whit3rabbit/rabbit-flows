# Editing the `document-codebase` skill

This is the **front-door** skill for the `docs-from-code` workflow: it runs the `AskUserQuestion`
intake, then calls `Workflow({ name: 'docs-from-code', args })`, with a Tier-2 conversational
fallback that drives the SAME Eatahorse board by hand when workflows are off / the repo is small.

- **Add / rename / remove a docs-from-code arg → edit the SCHEMA, then regenerate.** The args list is a
  single source of truth at `installer/arg-schemas/docs-from-code.mjs`; `npm run build:arg-contract`
  generates this file's `args` block + Defaults line (between `@generated-start/@generated-end
  arg-contract/*`) AND the workflow's guard block/header. NEVER hand-edit between those markers; `npm run
  check` fails on drift and on any arg-name mismatch. The free-text Step 0 / intake prose (which args to
  ask about) is still hand-maintained here — keep it consistent with the schema.
- This skill is bundled by `docs-from-code` in `installer/manifest.json`, so it MUST stay in that
  workflow's `// requires-skills:` header too — the two must set-match or `npm run check` fails.
- Keep the Tier-2 steps aligned with the workflow's stages (one card per page with TWO acceptance items,
  scope-grounded authoring, single-writer sync, full-coverage grounding gate ticking the second
  acceptance) so both tiers produce the same board/output.
