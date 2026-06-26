# Editing the `audit-codebase` skill

This is the **front-door** skill for the `security-audit` workflow: it runs the `AskUserQuestion`
discussion, then calls `Workflow({ name: 'security-audit', args })`. It is NOT the runtime - the work
is in `.claude/workflows/security-audit.js`, and the audit lanes/gate contract lives inline there.

- **Add / rename a security-audit arg → update BOTH** the intake + the `args` block here AND the arg
  parsing in `security-audit.js` (`scope`, `focus`, `gateRounds`, `mode`/`since`, `maxFindings`,
  `minConfidence`, `secretsScan`). The skill name and the workflow `meta.name` are independent
  registries; they need not match.
- A workflow `.js` can't ask the user anything mid-run - that's why the Q&A lives in this skill
  (`.claude/rules/workflow-design.md`, "Reuse & cost").
- Distinct from the `secure-review` skill, which is the inline **specialist worker** role the audit
  lanes/gate use - not a user front door. Both are bundled with the `security-audit` workflow in
  `installer/manifest.json`.
- Defensive only: never add intake that would steer the audit toward exploit code or payloads. That
  boundary is enforced in the workflow's lane/gate/report prompts.
