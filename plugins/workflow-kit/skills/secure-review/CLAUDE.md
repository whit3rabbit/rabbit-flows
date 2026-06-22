# Editing the `secure-review` skill

This skill is the **portable copy** of the defensive audit-lane contract. Its runtime source is the
inline secure-review contract in `.claude/workflows/security-audit.js` — refresh that inline prompt
when this skill changes (workflow stages don't auto-load skills; `.claude/rules/workflow-design.md`).

- Findings are gated before they flow on: a fresh-context verifier drops unsupported notes
  (false positives). Keep the note schema `{type, where, evidence}` so the gate can check each.
