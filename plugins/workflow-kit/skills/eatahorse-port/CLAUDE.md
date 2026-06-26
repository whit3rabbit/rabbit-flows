# Editing the `eatahorse-port` skill

This is the **front-door** skill for the `eatahorse-port-pipeline` workflow: it runs the
`AskUserQuestion` discussion, then calls `Workflow({ name: 'eatahorse-port-pipeline', args })`. It is
NOT the runtime — the work is in `.claude/workflows/eatahorse-port-pipeline.js`.

- **Add / rename a pipeline arg → update BOTH** the intake + the `args` block here AND the workflow's
  `Knobs (args)` header + the `_args?.X` reads in `eatahorse-port-pipeline.js`.
- Always pass `args` as a JSON OBJECT. The workflow normalizes a stringified object, but a
  comma/positional string can't map to three required fields and will bail.
- A workflow `.js` can't ask the user anything mid-run — that's why the Q&A lives in this skill
  (`.claude/rules/workflow-design.md`, "Reuse & cost").
