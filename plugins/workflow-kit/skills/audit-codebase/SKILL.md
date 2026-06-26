---
name: audit-codebase
description: Front door for a defensive security audit of committed code. Use when the user wants to find security vulnerabilities in a codebase, says "audit my code/codebase for security", "security audit", "find security bugs", "check this repo for injection/authz/ssrf/secrets", "scan for vulnerabilities", or "/audit-codebase". Runs a short discussion (scope, focus areas, depth) then launches the `security-audit` workflow with the answers. NOT for the pending diff only - that is the built-in `/security-review`. Does NOT produce exploit code.
---

# Audit codebase (discussion → security-audit workflow launch)

This skill is the conversational front door to the `security-audit` workflow. The workflow runs in
the background with no way to ask the user anything mid-run, so the discussion happens HERE first;
the answers are passed to the workflow as `args`.

Defensive only: the audit reports vulnerabilities and remediation for the owner to fix. It never
produces exploit code, payloads, or step-by-step exploitation. Do not gather intent that conflicts
with that boundary.

Artifacts: the run writes a vulnerability inventory under `.security-audit/` (recon index +
baseline). The workflow ensures that dir is gitignored in the target repo. Never commit or publish it.

Scope note: this audits **committed** code (a path, folder, or whole repo). For the **pending diff
only**, point the user at the built-in `/security-review` instead.

## Steps

1. **Get the scope.** Take it from the invocation (`/audit-codebase <path>`) if present. If missing,
   ask what to audit in one plain question. Default is the whole repo (`.`).

2. **Run the discussion.** Use `AskUserQuestion` for the multiple-choice fields (batch them, max 4
   per call). Offer sensible defaults so a one-line ask ("audit src") still runs.

   AskUserQuestion batch:
   - **focus**: which vulnerability classes to prioritize (multi-select). Offer: injection ·
     authz/access-control · secrets/credentials · path/file handling · deserialization/ssrf ·
     supply-chain · all (default). Map the picks to a `focus` array of plain strings; omit `focus`
     entirely if the user picks "all" (the workflow then audits every class).
   - **depth**: standard (default) or deep. Maps to `gateRounds`: standard → omit (default 1, the
     single-pass gate); deep → `gateRounds:2` (extra blind reviewers per serious finding, more
     tokens; use for high-stakes audits where a missed critical/high costs more than the gate tokens).
   - **mode**: whole committed tree (default) or a committed range. Default → omit (`mode:'paths'`).
     Range → `mode:'diff'` plus `since:"<git ref>"` (default `HEAD~1`); use to audit a committed
     range, NOT the uncommitted diff.

   Optional knobs (mention only if the user raises them; otherwise omit and let the workflow default):
   - **maxFindings** (default 150) - ceiling on the per-finding gate fan-out, severity-sorted.
   - **minConfidence** (default 0 = off) - demote confirmed findings below this confidence to
     "unsettled for review" instead of reporting them as confirmed.
   - **secretsScan** (`auto` default / `on` / `off`) - the deterministic secret scan; `auto` runs it
     when a scanner is present.

   After the focus pick, do ONE `Read` of the bundled `secure-review` skill's `SKILL.md` and skim only
   the "What to look for" rows for the chosen classes (and its sink/source catalog) so your hand-back
   summary speaks the right sinks. One read, gated behind the focus selection - never a library scan,
   and never the workflow runtime (lanes carry that contract inline). Skip it when focus = all.

3. **Preview, then launch.** Show the user a compact preview of the `args` (at least `scope`,
   `focus`, `gateRounds`, `mode`). The audit only READS source and writes its inventory under
   `.security-audit/` - it does not modify the audited code - so a standard run may launch directly
   after the preview. Call the `Workflow` tool with `name: "security-audit"` and an `args` object
   built from the answers. Pass only what was gathered; omit the rest.

   ```
   Workflow({ name: "security-audit", args: {
     scope,                              // path/folder/repo; default "." (whole repo)
     focus,                              // optional array of vuln classes; omit for "all"
     // optional knobs the user may set:
     // gateRounds (1 = single-pass gate default; 2+ = deep blind-reviewer pass for serious findings),
     // mode ("paths" default | "diff"), since (diff mode: git ref, default HEAD~1),
     // maxFindings (default 150), minConfidence (default 0 = off),
     // secretsScan ("auto" default | "on" | "off")
   }})
   ```

4. **Hand back** the workflow's result: the confirmed-findings inventory (with remediation), any
   unsettled findings surfaced for review, and the baseline location. On a re-run, triaged
   accepted-risk items from the prior baseline are not re-flagged.

## Defaults (when the user skips a field)

scope=`.` (whole repo) · focus=all classes · gateRounds=1 (single-pass gate) · mode=`paths` ·
since=`HEAD~1` · maxFindings=150 · minConfidence=0 · secretsScan=`auto`.

## Notes

- The workflow complements the built-in `/security-review` (which only sees the pending diff): this
  audits committed code across a path, folder, or whole repo, and is worth rerunning each release.
- For a large repo, the first run builds a deterministic recon index (`recon.py`) so later stages
  trace reachability against ground truth instead of re-grepping. That index lives under
  `.security-audit/`, outside `.claude/rules/`, so a vuln inventory never auto-loads into unrelated
  sessions.
- This file is the portable, marketplace-shipped copy of the front-door role. It pairs with the
  `security-audit` workflow in `.claude/workflows/security-audit.js`.
