# Editing the `docs-site-builder` skill

This skill is the **portable copy**. Its content is distilled INLINE into the workflows as
`@generated` blocks, so the workflows are the runtime truth and this skill is the source. Workflow
stages don't auto-load skills (`.claude/rules/workflow-design.md`), so the inline copy is required.

Three generated blocks, all written by `node scripts/build-docs-contracts.mjs` (which
`npm run check` verifies for drift) — **never hand-edit the blocks; edit the source, then build:**

| Block (`@generated docs-contracts/<name>`) | Source | Embedded in |
|---|---|---|
| `starlight-contract` (`CONTRACT`) | `references/{setup,configuration,frontmatter,content-authoring,components}.md` | docs-create, docs-from-code |
| `ia-contract` (`IA_CONTRACT`) | `references/information-architecture.md` | docs-create, docs-from-code |
| `frameworks` (CROSSWALK + FRAMEWORKS registry + resolveLinksAndAssets) | `frameworks/registry.js` | docs-create, docs-from-code |

The Starlight contract carries a version tag in the comment (v0.40.0); bump it when Starlight syntax
changes. The `frameworks/registry.js` splice fragment references `CONTRACT` and the per-framework
`<FW>_CONTRACT` consts from the host workflow's scope (it is not standalone-valid JS).

- `docs-migrate.js` is deliberately NOT wired into these blocks: it carries migration-specific
  consts (ADMONITION_CROSSWALK, DETECTION, SELECTORS) and a different-shaped resolver, and does not
  use the FRAMEWORKS registry. Forcing it into the shared substrate would be coupling for its own sake.
- Starlight is first-class. Other frameworks with a full `frameworks/<fw>/references/` set are
  distilled into `<FW>_CONTRACT` blocks the same way; frameworks without references author from
  current official docs (find-docs / context7) at runtime.
