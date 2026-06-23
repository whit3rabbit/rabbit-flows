// security-audit — defensive code audit over the full spine: recon -> map -> lanes -> gate -> report -> write-back.
//
// Why a workflow (not a conversation): this is COVERAGE work. The codebase splits into independent
// audit lanes that fan out wider than one conversation can coordinate, and an audit is worth rerunning
// every release — so the orchestration is codified. (workflow-design.md: "Coverage -> independent
// lanes, share failures and constraints early.")
//
// Deterministic recon, not LLM-guessed recon: the first stage runs recon.py ONCE to build a JSON index
// (symbols, resolved constants, caller<->callee graph, entry points). Every later agent reads that
// artifact instead of each re-grepping the tree. This is the cheap, deterministic path
// (workflow-design.md): one tool pass replaces N lanes x M findings of redundant agent greps, AND it
// lets the gate trace reachability against ground truth. Because recon does the constant-resolution and
// caller-lookup that previously forced an Opus hand-trace, the per-finding gate now runs on Sonnet —
// Opus is reserved for Map (decompose) and the final Report only (model-routing.md, deviation noted).
// Rejected: ctags-only recon — it gives a symbol index but no call graph, no exact function spans, and
// no entry-point detection, so it can't power the reachability trace or the "follow the code" goal.
//
// Runtime split (the script has NO filesystem access — only agents run tools): the Recon agent WRITES
// recon.json; the Map agent READS it and returns structured lanes; lane/gate agents query recon.py
// subcommands. The script only passes paths as strings and consumes agents' schema output.
//
// Scope: audits COMMITTED code — a path, folder, or whole repo (mode:'paths', default) — complementing
// the built-in /security-review, which only sees the pending diff. mode:'diff' scopes the walk to files
// changed since a git ref (args.since), for auditing a committed range.
//
// Defensive only: every stage reports vulnerabilities and remediation guidance for the owner to fix.
// It never produces exploit code, payloads, or step-by-step exploitation. That boundary is stated in
// the lane, gate, report, and write-back prompts so the tool cannot be repurposed.
//
// The write-back loop closes: finalize records confirmed findings + accepted risks to a baseline file;
// the next run's map stage reads that baseline and passes accepted-risk fingerprints to the gate as
// constraints, so triaged items don't get re-flagged. (memory.md: write durable knowledge back.)
//
// Permissions: stages need repo READ + Bash (recon.py / git / venv); Recon writes recon.json and
// write-back writes the baseline. The recon index + baseline default OUTSIDE .claude/rules/ on purpose
// — that dir auto-loads into every session, so a vuln inventory there would leak into unrelated work.
//
// requires-skills: secure-review
//   (Bundling — the installer copies this skill (SKILL.md + scripts/recon.py + venv bootstrap) alongside
//    the workflow. Workflow stages do NOT auto-load skills; agent() has no skills option. The lane/gate
//    contracts and the recon.py command surface are carried inline; those inline prompts are the runtime
//    source of truth. recon.py itself is the portable, installed copy agents shell out to.)
// Run with /workflows, or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` reports "illegal return" on the trailing return — expected; the runtime wraps the
// script in an async function, so top-level return/await are legal there. Same as starter.js.)
export const meta = {
  name: 'security-audit',
  description: 'Defensive code audit: deterministic recon index, map attack surface, fan out audit lanes, gate findings to drop false positives, report with remediation.',
  phases: [
    { title: 'Recon' },
    { title: 'Map' },
    { title: 'Lanes' },
    { title: 'Gate' },
    { title: 'Report' },
    { title: 'Write-back' },
  ],
}

// Workers emit the canonical note schema. Severity/category are NOT set here on purpose — that
// judgment belongs to the gate, not the cheap lane (model-routing.md).
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

// Recon stage returns just enough for logging + the coverage decision; the rich data lives in recon.json.
const RECON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file_count', 'treesitter', 'summary'],
  properties: {
    file_count: { type: 'integer' },
    entrypoint_count: { type: 'integer' },
    treesitter: { type: 'boolean' },  // false = degraded heuristic backend (still valid, less precise)
    summary: { type: 'string' },      // the printed recon summary line
  },
}

// Map reads recon.json + the baseline, fixes shared constraints, and picks the coverage model:
// thematic lanes (small scope) or file-partition lanes (large scope — every file owned).
const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['constraints', 'coverage'],
  properties: {
    constraints: { type: 'array', items: { type: 'string' } },
    coverage: { enum: ['thematic', 'partition'] },
    partitionCount: { type: 'integer' }, // partition mode: how many file-partition lanes to create
    lanes: { // thematic mode: explicit theme lanes
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['focus', 'scope', 'rationale'],
        properties: {
          focus: { type: 'string' },     // vuln theme: injection, authz, secrets, path/file, deserialization/SSRF, ...
          scope: { type: 'string' },     // globs or paths this lane owns
          rationale: { type: 'string' }, // why this surface matters here
        },
      },
    },
  },
}

// The gate runs once PER finding (parallel) and returns a single verdict. Reachability-strict and
// default-INVALID, ported from reachability_filter.py: a finding survives only if the bug pattern is
// real AND attacker-reachable. Severity/category/remediation are filled in only for survivors.
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'entry_point', 'severity', 'category', 'remediation', 'why'],
  properties: {
    verdict: { enum: ['VALID', 'INVALID', 'UNCERTAIN'] },
    entry_point: { type: 'string' }, // the external entry point the attacker-controlled data enters from, or NONE
    severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] }, // meaningful only when verdict=VALID
    category: { type: 'string' },
    remediation: { type: 'string' }, // how to fix — guidance only, never exploit code
    why: { type: 'string' },         // one-to-two sentence justification for the verdict
  },
}

// Tolerate a bare string (mirrors deep-research) so `/security-audit <path>` works, not just `{scope}`.
const scope = typeof args === 'string' ? args : args?.scope ?? '.'
const focus = args?.focus // optional array of vuln classes to prioritize
const maxLanes = Math.min(args?.maxLanes ?? 8, 16) // respect the 16-concurrent cap
const partitionThreshold = args?.partitionThreshold ?? 40 // file count above which to file-partition
const mode = args?.mode === 'diff' ? 'diff' : 'paths'
const since = args?.since ?? 'HEAD~1' // diff mode: audit committed files changed since this ref
const workerModel = args?.workerModel ?? 'haiku' // breadth-first + cheap on purpose
const gateModel = args?.gateModel ?? 'sonnet'    // recon makes the trace deterministic, so no Opus here
const planModel = args?.planModel ?? 'opus'      // decompose: errors propagate
const reportModel = args?.reportModel ?? 'opus'  // final synthesis/judgment
const baselinePath = args?.baselinePath ?? '.security-audit/baseline.md' // NOT .claude/rules/ — auto-loads every session
const writeBaseline = args?.writeBaseline ?? true

// recon.py is bundled in the secure-review skill; agents shell out to it. Paths are strings the script
// passes through (it cannot read them). venvPy is the optional tree-sitter python the Recon stage builds.
const reconScript = args?.reconScript ?? 'plugins/workflow-kit/skills/secure-review/scripts/recon.py'
const reconDir = reconScript.replace(/recon\.py$/, '')
const reconSetup = `${reconDir}setup_venv.sh`
const venvPy = `${reconDir}.venv/bin/python`
const reconOut = args?.reconOut ?? '.security-audit/recon.json'
const reconFiles = '.security-audit/diff-files.txt'

// Recon command surface injected into lane + gate prompts (sliced: only the read subcommands they call).
const reconBlock =
  `Deterministic recon — PREFER these over ad-hoc grep. Use "${venvPy}" as PY if it exists, else python3:\n` +
  `  PY "${reconScript}" callers <symbol|file#fn[:line]> --index "${reconOut}"   -> callers; "NO callers" = dead code or an external entry point\n` +
  `  PY "${reconScript}" const <NAME> --index "${reconOut}"       -> resolved constant value (then DO THE ARITHMETIC)\n` +
  `  PY "${reconScript}" extract <file#fn[:line] | file:line> --index "${reconOut}"  -> the exact function body\n` +
  `If a query reports "ambiguous function <name>", the symbol has multiple definitions: re-run with ` +
  `the printed file#fn or file#fn:line form (applies to callers/extract; const lists every defining file).\n` +
  `Entry-point detection is heuristic — treat it as a signal, then confirm the path yourself.`

// 0. Recon — cheap. ONE agent builds the index artifact every later stage reads. Best-effort enables the
//    precise tree-sitter backend; degrades to stdlib heuristics. In diff mode, scopes to changed files.
phase('Recon')
const diffStep = mode === 'diff'
  ? `2. List committed files changed since "${since}": ` +
    `git diff --name-only ${since}...HEAD > "${reconFiles}" 2>/dev/null; ` +
    `git diff --name-only ${since} >> "${reconFiles}" 2>/dev/null; sort -u -o "${reconFiles}" "${reconFiles}". ` +
    `Then pass --files "${reconFiles}" to the index command below.\n`
  : ''
const recon = await agent(
  `Build the deterministic security recon index for "${scope}". Run these via Bash; do NOT analyze code — ` +
    `just produce the artifact and report its summary.\n` +
    `1. Best-effort enable the precise backend: PY=$(bash "${reconSetup}" 2>/dev/null | tail -1); ` +
    `[ -x "$PY" ] || PY=python3   (recon.py works either way; the venv only adds tree-sitter precision)\n` +
    diffStep +
    `${mode === 'diff' ? '3' : '2'}. Build the index: "$PY" "${reconScript}" index "${scope}" --out "${reconOut}"` +
    `${mode === 'diff' ? ` --files "${reconFiles}"` : ''}\n` +
    `${mode === 'diff' ? '4' : '3'}. Return file_count, entrypoint_count, whether tree-sitter was on, and the printed summary line.`,
  { label: 'recon', phase: 'Recon', model: workerModel, schema: RECON_SCHEMA },
)
const fileCount = recon?.file_count ?? 0
log(`recon: ${fileCount} files indexed, tree-sitter ${recon?.treesitter ? 'on' : 'off (degraded)'}`)
// Nothing indexed -> the index is missing/empty; Map would read a dead artifact and flail on Opus. Bail.
if (!fileCount) return { error: 'recon indexed 0 files (bad scope, or recon failed to write the index)', scope, reconPath: reconOut }

// 1. Map — Opus. Reads recon.json + the baseline, fixes shared constraints, and chooses the coverage
//    model. Small scope -> thematic lanes; large scope -> file-partition so no file is skipped.
phase('Map')
const focusLine = focus?.length ? `Prioritize these vulnerability classes: ${focus.join(', ')}.` : ''
const plan = await agent(
  `You are mapping the attack surface of the code under "${scope}" for a DEFENSIVE security audit.\n` +
    `Read the recon index at "${reconOut}" (JSON: files[], symbols, callees/callers graph, entrypoints, ` +
    `languages, exports, imports_external, filegraph, summary.file_count). Use it instead of re-walking ` +
    `the tree. For a compressed module map of where untrusted input can flow, run: ` +
    `python3 "${reconScript}" map --hops 2 --index "${reconOut}" (focus defaults to entry-point files; ` +
    `external libraries are listed but not traversed; reading a prebuilt index never needs the venv).\n` +
    `1. From the recon entrypoints, filegraph (internal cross-file edges), and languages, establish trust ` +
    `boundaries: where untrusted input enters, how it flows across files toward sinks, network/exec/file ` +
    `surface, and what is out of scope. Emit these as "constraints".\n` +
    `2. If "${baselinePath}" exists, read it and add each ACCEPTED-RISK or known item to "constraints" ` +
    `as "ACCEPTED: <fingerprint>" so the gate can drop re-discoveries.\n` +
    `3. Choose coverage: if summary.file_count <= ${partitionThreshold}, set coverage "thematic" and return ` +
    `up to ${maxLanes} INDEPENDENT non-overlapping lanes (each = a vuln theme + the files/globs it owns + ` +
    `why it matters). If larger, set coverage "partition" and return partitionCount = the number of ` +
    `file-partition lanes to use (<= ${maxLanes}); the workflow will create that many lanes that together ` +
    `own EVERY file, so nothing is skipped. ${focusLine}\n` +
    `Return constraints, coverage, and either lanes (thematic) or partitionCount (partition).`,
  { label: 'map', phase: 'Map', model: planModel, schema: MAP_SCHEMA },
)
const constraints = plan?.constraints ?? []
const coverage = plan?.coverage === 'partition' ? 'partition' : 'thematic'
let lanes
if (coverage === 'partition') {
  const n = Math.min(Math.max(plan?.partitionCount ?? maxLanes, 1), maxLanes)
  lanes = Array.from({ length: n }, (_, i) => ({
    focus: 'partition', shard: `${i}/${n}`, scope: `file shard ${i} of ${n}`,
    rationale: 'file-partition coverage lane — audit every file in the shard',
  }))
} else {
  lanes = (plan?.lanes ?? []).slice(0, maxLanes)
}
if (!lanes.length) return { error: 'map stage returned no audit lanes', scope }
log(`map: ${coverage} coverage, ${lanes.length} lane(s)`)

// 2. Lanes — Haiku, parallel, breadth-first. Each lane gets the shared constraints read-only + the recon
//    command surface, and owns a disjoint scope (or file shard), so lanes don't collide (workflow-design.md).
phase('Lanes')
const constraintBlock = constraints.length
  ? `Read-only constraints from the map stage (do NOT re-derive; respect ACCEPTED items):\n- ${constraints.join('\n- ')}`
  : 'No shared constraints were provided.'
const laneResults = await parallel(
  lanes.map((lane, i) => {
    const fileDirective = lane.shard
      ? (() => {
          const [si, sn] = lane.shard.split('/')
          return `Your files are shard ${si} of ${sn}. List them first (PY as defined below): ` +
            `PY "${reconScript}" shard --i ${si} --n ${sn} --index "${reconOut}". Audit EVERY file listed.`
        })()
      : `Scope you own: ${lane.scope}`
    return () =>
      agent(
        `Perform a defensive secure review of your lane and return compact notes only (no transcript).\n` +
          `Lane focus: ${lane.focus}\n${fileDirective}\nWhy it matters: ${lane.rationale}\n\n` +
          `${constraintBlock}\n\n${reconBlock}\n\n` +
          `Code may be in ANY language — adapt the sinks below to the language(s) in scope.\n\n` +
          `STEP 1 — brief yourself before flagging anything. For the files in scope establish: trust ` +
          `boundaries; where untrusted input enters (network / file / CLI args / API / IPC); which ` +
          `variables carry attacker-controlled data and how they flow to each sink; and any fixed-size ` +
          `buffers or named size constants. RESOLVE each named constant to its numeric value (recon ` +
          `\`const\`) and state the value, not just the name — "a bound exists" is not "the bound is ` +
          `sufficient".\n\n` +
          `STEP 2 — sweep for these bug classes (adapt to the language): injection (shell / SQL / eval / ` +
          `template / command), broken authz or IDOR, secrets and permissive config, path/file handling ` +
          `(traversal, zip-slip, symlink), deserialization / SSRF / XXE, supply-chain. For ` +
          `memory-unsafe languages also: buffer overflow, integer overflow or wrap used as a size/index, ` +
          `NULL/None deref on malformed input, use-after-free or double-free, type confusion on tagged ` +
          `unions/variants, and unchecked return from a fallible call.\n\n` +
          `STEP 3 — flag concrete, evidence-backed risks. For each: type "finding", "where" = file:line, ` +
          `"evidence" = the exact code/pattern, resolved constant values, and the reachability path from ` +
          `the entry point to the sink (use recon \`callers\` to confirm the function is reachable — ` +
          `"NO callers" means it is dead code, not a finding). A bare grep hit with no reachable path is ` +
          `a weak finding — say so. Use "constraint" for scope facts the gate should know (e.g. "no ` +
          `network surface — SSRF N/A here"), and "failure" for anything you could not access. Report ` +
          `risks to be FIXED — never write exploits or payloads.`,
        { label: `lane:${i}:${lane.focus}`, phase: 'Lanes', model: workerModel, schema: NOTE_SCHEMA },
      )
  }),
)
const notes = laneResults.filter(Boolean).flatMap((r) => r.notes ?? [])
const findings = notes.filter((n) => n.type === 'finding')
const carried = notes.filter((n) => n.type !== 'finding') // failures + constraints flow to the gate as context

// 3. Admission gate — Sonnet, fresh context, ONE call PER finding in parallel. Each verifier uses recon
//    (callers/extract/const) for deterministic facts, backward-traces to an external entry point, and
//    defaults INVALID under uncertainty (ported from reachability_filter.py, ~83% FP cut). Per-finding so
//    each gets full context and a noisy scan can't blow one batched call (16-concurrent cap queues the
//    overflow). Opus is NOT used here — recon does the recon, so Sonnet is the right tier (model-routing.md).
phase('Gate')
// Exact-key dedup before the gate so identical hits don't each cost a verifier.
// ponytail: exact where+evidence key; add a semantic dedup agent only if cross-file dups show up.
const seen = new Set()
const deduped = findings.filter((f) => {
  const key = `${f.where}::${(f.evidence ?? '').slice(0, 120)}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
const carriedBlock = carried.length
  ? `Constraints / failures from earlier stages (respect "ACCEPTED:" items):\n${JSON.stringify(carried, null, 2)}`
  : 'No constraints or failures were carried from earlier stages.'
const verdicts = await parallel(
  deduped.map((f, i) => () =>
    agent(
      `You are a PRECISION-FIRST reachability arbiter with repo read + Bash recon access. A breadth-first ` +
        `scan flagged the finding below. REJECT it unless it is a genuinely attacker-reachable bug. ` +
        `Default to INVALID under uncertainty. Code may be in ANY language.\n\n` +
        `${reconBlock}\n\n` +
        `Mark VALID only if ALL hold: (1) the bug pattern really exists in the cited code (read it with ` +
        `recon \`extract\`); (2) a concrete path runs from an EXTERNAL entry point (network packet, file, ` +
        `userspace syscall, CLI arg, or API request) carrying ATTACKER-CONTROLLED data to the sink ` +
        `(confirm reachability with recon \`callers\`); (3) the cited value/size/pointer is actually ` +
        `attacker-controlled — NOT trusted/kernel-set, NOT a fixed-size field, and NOT bounded by an ` +
        `upstream check UNLESS that bound still exceeds the destination size (resolve it with recon ` +
        `\`const\` and DO THE ARITHMETIC).\n` +
        `Mark INVALID if: recon \`callers\` shows no caller (dead code), the value is trusted or ` +
        `sufficiently bounded, the trigger needs a privileged/local-only actor, it matches an "ACCEPTED:" ` +
        `constraint, it duplicates a known item, or you cannot establish a concrete reachable path.\n\n` +
        `If VALID: set "verdict":"VALID", "entry_point" to the external source the data enters from, and ` +
        `assign severity, category, and remediation GUIDANCE only (no exploit code, no payloads). If not ` +
        `VALID: set verdict INVALID or UNCERTAIN, "entry_point":"NONE", and leave severity "info". Always ` +
        `fill "why" with a one-to-two sentence justification.\n\n` +
        `${carriedBlock}\n\n` +
        `Candidate finding:\n${JSON.stringify(f, null, 2)}`,
      { label: `gate:${i}:${f.where}`, phase: 'Gate', model: gateModel, schema: VERDICT_SCHEMA },
    ).then((v) => (v ? { ...f, ...v } : null)),
  ),
)
const confirmed = verdicts.filter((v) => v && v.verdict === 'VALID')
const droppedCount = deduped.length - confirmed.length
log(`gate: ${confirmed.length} confirmed, ${droppedCount} dropped of ${deduped.length} candidate findings`)

// 4. Report — Opus. Prioritized, defensive write-up from confirmed findings only.
phase('Report')
const report = await agent(
  `Write a prioritized DEFENSIVE security report for the audit of "${scope}". Use only the confirmed ` +
    `findings below; order by severity. For each: location, the external entry point the attacker ` +
    `reaches it from, why it is a risk, and how to remediate it. ` +
    `State the audited scope, the coverage model (${coverage}), and the constraints (what was and wasn't ` +
    `covered, incl. whether recon ran with tree-sitter precision) so the reader knows the limits. Do NOT ` +
    `include exploit code, payloads, or step-by-step exploitation — remediation only.\n\n` +
    `Recon: ${recon?.summary ?? 'n/a'}\n` +
    `Scope / constraints:\n- ${constraints.join('\n- ') || '(none recorded)'}\n\n` +
    `Confirmed findings:\n${JSON.stringify(confirmed, null, 2)}`,
  { label: 'report', phase: 'Report', model: reportModel },
)

// 5. Write-back — Sonnet (mechanical bookkeeping). An agent (the script can't touch the filesystem)
//    records a triage baseline so the next run's map stage can suppress accepted/known items.
//    Non-destructive: preserve human annotations. Skipped when writeBaseline is false or nothing confirmed.
phase('Write-back')
let baselineWritten = false
if (writeBaseline && confirmed.length) {
  await agent(
    `Update the security triage baseline at "${baselinePath}" (create it if missing). Read any existing ` +
      `file first and PRESERVE human annotations, especially "ACCEPTED:" lines. Record today's confirmed ` +
      `findings as a dated section: each with where, entry_point, severity, category, and remediation, plus ` +
      `the audited scope. Keep it lean and skimmable — a durable record a future run and a future session ` +
      `read, not a transcript. Remediation guidance only; no exploit detail.\n\n` +
      `Audited scope: ${scope}\nConfirmed findings:\n${JSON.stringify(confirmed, null, 2)}`,
    { label: 'write-back', phase: 'Write-back', model: gateModel },
  )
  baselineWritten = true
}

return {
  scope,
  mode,
  coverage,
  filesIndexed: fileCount,
  treesitter: !!recon?.treesitter,
  lanes: lanes.length,
  confirmed: confirmed.length,
  droppedByGate: droppedCount,
  report,
  baselineWritten,
  baselinePath: baselineWritten ? baselinePath : null,
  reconPath: reconOut,
}
