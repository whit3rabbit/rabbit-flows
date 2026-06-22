# Editing the `docs-site-builder` skill

This skill is the **portable copy**. Its `references/*.md` are distilled INLINE as the
`CONTRACT` (Starlight authoring) + `IA_CONTRACT` (information architecture) consts, **duplicated
in two workflows** (kept identical on purpose):

- `.claude/workflows/docs-create.js`
- `.claude/workflows/docs-from-code.js`

**Edit a reference → refresh BOTH inline blocks.** They carry a version tag in the comment
(v0.40.0); bump it when the Starlight syntax changes. Workflow stages don't auto-load skills
(`.claude/rules/workflow-design.md`), so the inline const is the runtime truth, this skill is the copy.

- Starlight is first-class (the only framework with an inline contract). Other frameworks author
  from current official docs (find-docs / context7) — do NOT add a distilled-but-stale contract for them.
