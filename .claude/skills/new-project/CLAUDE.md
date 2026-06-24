# Editing the `new-project` skill

This is the **front-door** skill for the `scaffold` workflow: it runs the `AskUserQuestion`
discussion, then calls `Workflow({ name: 'scaffold', args })`. It is NOT the runtime — the work is
in `.claude/workflows/scaffold.js`.

- **Add / rename a scaffold arg → update BOTH** the intake + the `args` block here AND `scaffold.js`.
  The skill name and the workflow `meta.name` are independent registries; they need not match.
- A workflow `.js` can't ask the user anything mid-run — that's why the Q&A lives in this skill
  (`.claude/rules/workflow-design.md`, "Reuse & cost").
