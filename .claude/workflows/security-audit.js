// security-audit — defensive code audit over the full spine: map -> parallel lanes -> gate -> report -> write-back.
//
// Why a workflow (not a conversation): this is COVERAGE work. The codebase splits into independent
// audit lanes that fan out wider than one conversation can coordinate, and an audit is worth rerunning
// every release — so the orchestration is codified. (workflow-design.md: "Coverage -> independent
// lanes, share failures and constraints early.")
//
// Where the gate earns its keep: automated security scanning's hard problem is FALSE POSITIVES. A cheap
// breadth-first scan (Haiku lanes) is deliberately noisy; the strong admission gate re-reads each
// finding's cited code and drops the ones the evidence doesn't actually support. This is the canonical
// "never under-spend the gate" case (model-routing.md), so workers stay cheap and the gate stays strong
// on purpose — a deliberate, documented routing choice, not the default.
//
// Defensive only: every stage reports vulnerabilities and remediation guidance for the owner to fix.
// It never produces exploit code, payloads, or step-by-step exploitation. That boundary is stated in
// the lane, report, and write-back prompts so the tool cannot be repurposed.
//
// The write-back loop closes: finalize records confirmed findings + accepted risks to a baseline file;
// the next run's map stage reads that baseline and passes accepted-risk fingerprints to the gate as
// constraints, so triaged items don't get re-flagged. (memory.md: write durable knowledge back.)
//
// Permissions: every stage needs repo READ access (map/lanes/gate open files); write-back WRITES the
// baseline file. No code execution. The baseline default is OUTSIDE .claude/rules/ on purpose — that
// dir auto-loads into every session, so a growing vuln inventory there would leak into unrelated work
// and cost tokens every turn. It is a data record the workflow reads, not an authoring rule.
//
// requires-skills: secure-review
//   (Bundling only — the installer copies this skill alongside the workflow as a portable role doc.
//    Workflow stages do NOT auto-load skills; agent() has no skills option. The lane stage carries the
//    secure-review contract inline, and that inline prompt is the runtime source of truth.)
// Run with /workflows, or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` reports "illegal return" on the trailing return — expected; the runtime wraps the
// script in an async function, so top-level return/await are legal there. Same as starter.js.)
export const meta = {
  name: 'security-audit',
  description: 'Defensive code audit: map attack surface, fan out audit lanes, gate findings to drop false positives, report with remediation.',
  phases: [
    { title: 'Map' },
    { title: 'Lanes' },
    { title: 'Gate' },
    { title: 'Report' },
    { title: 'Write-back' },
  ],
}

// Workers emit the canonical note schema. Severity/category are NOT set here on purpose — that
// judgment belongs to the strong gate, not the cheap lane (model-routing.md).
const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'where', 'evidence'],
        properties: {
          type: { enum: ['finding', 'failure', 'constraint'] },
          where: { type: 'string' },    // file:line, file, or area
          evidence: { type: 'string' }, // the exact code/pattern seen + why it may be a risk
        },
      },
    },
  },
}

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['constraints', 'lanes'],
  properties: {
    // Trust boundaries, network/exec/file surface, languages, and accepted-risk fingerprints read
    // from the existing baseline. Passed read-only to every lane so they don't re-derive them.
    constraints: { type: 'array', items: { type: 'string' } },
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['focus', 'scope', 'rationale'],
        properties: {
          focus: { type: 'string' },     // vuln theme: injection, authz, secrets, path/file, deserialization/SSRF, supply-chain, ...
          scope: { type: 'string' },     // globs or paths this lane owns
          rationale: { type: 'string' }, // why this surface matters here
        },
      },
    },
  },
}

// The gate enriches survivors with the judgment workers were kept away from.
const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed', 'dropped'],
  properties: {
    confirmed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['where', 'evidence', 'severity', 'category', 'remediation'],
        properties: {
          where: { type: 'string' },
          evidence: { type: 'string' },
          severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] },
          category: { type: 'string' },
          remediation: { type: 'string' }, // how to fix — guidance only, never exploit code
        },
      },
    },
    dropped: { type: 'integer' }, // notes rejected: unsupported / unreachable / duplicate / already-accepted
  },
}

const scope = args?.scope ?? '.'
const focus = args?.focus // optional array of vuln classes to prioritize
const maxLanes = Math.min(args?.maxLanes ?? 8, 16) // respect the 16-concurrent cap
const workerModel = args?.workerModel ?? 'haiku'   // breadth-first + cheap on purpose; the gate is the quality bar
const baselinePath = args?.baselinePath ?? '.security-audit/baseline.md' // NOT .claude/rules/ — that auto-loads every session
const writeBaseline = args?.writeBaseline ?? true

// 1. Map — strong model (inherits the session model). Reads the repo AND any existing baseline,
//    fixes trust boundaries as shared constraints, and splits the audit into independent lanes.
phase('Map')
const focusLine = focus?.length ? `Prioritize these vulnerability classes: ${focus.join(', ')}.` : ''
const plan = await agent(
  `You are mapping the attack surface of the code under "${scope}" for a DEFENSIVE security audit.\n` +
    `1. Read enough of the tree to establish trust boundaries: entry points, network/exec/file surface, ` +
    `languages, how untrusted input enters, and what is out of scope. Emit these as "constraints".\n` +
    `2. If "${baselinePath}" exists, read it and add each ACCEPTED-RISK or known item to "constraints" ` +
    `as "ACCEPTED: <fingerprint>" so the gate can drop re-discoveries.\n` +
    `3. Split the audit into ${maxLanes} or fewer INDEPENDENT lanes whose scopes do not overlap. Each ` +
    `lane = a vuln theme + the files/globs it owns + why it matters here. ${focusLine}\n` +
    `Return constraints and lanes.`,
  { label: 'map', schema: MAP_SCHEMA },
)
const constraints = plan.constraints ?? []
const lanes = (plan.lanes ?? []).slice(0, maxLanes)

// 2. Lanes — cheap, parallel, breadth-first. Each lane gets the shared constraints read-only and owns
//    a disjoint scope, so lanes don't collide on the same dead ends (workflow-design.md).
phase('Lanes')
const constraintBlock = constraints.length
  ? `Read-only constraints from the map stage (do NOT re-derive; respect ACCEPTED items):\n- ${constraints.join('\n- ')}`
  : 'No shared constraints were provided.'
const laneResults = await parallel(
  lanes.map((lane, i) => () =>
    agent(
      `Perform a defensive secure review of your lane and return compact notes only (no transcript).\n` +
        `Lane focus: ${lane.focus}\nScope you own: ${lane.scope}\nWhy it matters: ${lane.rationale}\n\n` +
        `${constraintBlock}\n\n` +
        `Read the files in scope and flag concrete, evidence-backed risks. For each: type "finding", ` +
        `"where" = file:line, "evidence" = the exact code/pattern and why it is a risk (include the ` +
        `reachability path). Use "constraint" for scope facts the gate should know, and "failure" for ` +
        `anything you could not access. Report risks to be FIXED — never write exploits or payloads.`,
      { label: `lane:${i}:${lane.focus}`, phase: 'Lanes', model: workerModel, schema: NOTE_SCHEMA },
    ),
  ),
)
const notes = laneResults.filter(Boolean).flatMap((r) => r.notes ?? [])
const findings = notes.filter((n) => n.type === 'finding')
const carried = notes.filter((n) => n.type !== 'finding') // failures + constraints flow to the gate as context

// 3. Admission gate — strong model, fresh context. Re-reads each finding's cited code, drops the
//    unsupported / unreachable / duplicate / already-accepted ones, and only THEN assigns severity.
//    This is the stage the whole spine exists to protect; it is never routed to the cheap model.
//    Ceiling: all findings go through ONE gate call — fine at modest counts, but a large noisy scan can
//    blow its context. If that happens, batch findings and gate per-batch (lose only cross-finding dedup).
phase('Gate')
const gated = await agent(
  `You are a security admission gate with repo access. For EACH candidate finding below, open the ` +
    `cited location and verify the evidence actually shows a real, in-context-reachable issue. DROP a ` +
    `finding if: the evidence does not support the claim, the code path is not reachable by untrusted ` +
    `input, it duplicates another, or it matches an "ACCEPTED:" constraint. For survivors, assign ` +
    `severity and category and write remediation GUIDANCE only (no exploit code, no payloads). Set ` +
    `"dropped" to the number you rejected.\n\n` +
    `Constraints / failures from earlier stages:\n${JSON.stringify(carried, null, 2)}\n\n` +
    `Candidate findings:\n${JSON.stringify(findings, null, 2)}`,
  { label: 'gate', schema: GATE_SCHEMA },
)
const confirmed = gated?.confirmed ?? []
const droppedCount = gated?.dropped ?? findings.length - confirmed.length

// 4. Report — strong model. Prioritized, defensive write-up from confirmed findings only.
phase('Report')
const report = await agent(
  `Write a prioritized DEFENSIVE security report for the audit of "${scope}". Use only the confirmed ` +
    `findings below; order by severity. For each: location, why it is a risk, and how to remediate it. ` +
    `State the audited scope and the constraints (what was and wasn't covered) so the reader knows the ` +
    `limits. Do NOT include exploit code, payloads, or step-by-step exploitation — remediation only.\n\n` +
    `Scope / constraints:\n- ${constraints.join('\n- ') || '(none recorded)'}\n\n` +
    `Confirmed findings:\n${JSON.stringify(confirmed, null, 2)}`,
  { label: 'report' },
)

// 5. Write-back — an agent (the script can't touch the filesystem) records a triage baseline so the
//    next run's map stage can suppress accepted/known items. Non-destructive: preserve human
//    annotations. Skipped when writeBaseline is false or nothing was confirmed. (memory.md)
phase('Write-back')
let baselineWritten = false
if (writeBaseline && confirmed.length) {
  await agent(
    `Update the security triage baseline at "${baselinePath}" (create it if missing). Read any existing ` +
      `file first and PRESERVE human annotations, especially "ACCEPTED:" lines. Record today's confirmed ` +
      `findings as a dated section: each with where, severity, category, and remediation, plus the audited ` +
      `scope. Keep it lean and skimmable — a durable record a future run and a future session read, not a ` +
      `transcript. Remediation guidance only; no exploit detail.\n\n` +
      `Audited scope: ${scope}\nConfirmed findings:\n${JSON.stringify(confirmed, null, 2)}`,
    { label: 'write-back' },
  )
  baselineWritten = true
}

return {
  scope,
  lanes: lanes.length,
  confirmed: confirmed.length,
  droppedByGate: droppedCount,
  report,
  baselineWritten,
  baselinePath: baselineWritten ? baselinePath : null,
}
