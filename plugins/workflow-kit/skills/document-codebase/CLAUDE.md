# Editing the `document-codebase` skill

This is the **front-door** skill for the `docs-from-code` workflow: it runs the `AskUserQuestion`
intake, then calls `Workflow({ name: 'docs-from-code', args })`, with a Tier-2 conversational
fallback that drives the SAME Eatahorse board by hand when workflows are off / the repo is small.

- **Add / rename a docs-from-code arg → update BOTH** the intake + `args` block here AND
  `.claude/workflows/docs-from-code.js`.
- This skill is bundled by `docs-from-code` in `installer/manifest.json`, so it MUST stay in that
  workflow's `// requires-skills:` header too — the two must set-match or `npm run check` fails.
- Keep the Tier-2 steps aligned with the workflow's stages (one card per page, scope-grounded
  authoring, single-writer sync, grounding spot-check) so both tiers produce the same board/output.
