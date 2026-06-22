# Editing the `architect` skill

This skill is the **portable copy** of the blind-proposal architecture role. Its runtime source
is the inline propose-stage prompt + `PROPOSAL_SCHEMA` in `.claude/workflows/scaffold.js` — refresh
that inline copy when the role changes (workflow stages don't auto-load skills; `.claude/rules/workflow-design.md`).

- Keep proposals **blind**: attempts must not see each other until merge. Diversity is the whole
  point of running multiple — coupling them early kills it (`.claude/rules/workflow-design.md`).
