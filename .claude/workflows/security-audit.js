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
// Cheap-first deviation (deep gate): model-routing.md says strong model only for decompose, gate, and
// synthesis. The deep-gate path (gateRounds >= 2) adds two extra blind reviewer calls per serious
// survivor and, on disagreement, one Opus arbiter — more tokens per finding than the single-pass gate.
// Justified ONLY when the caller opts in (gateRounds default is 1, i.e. off): the use case is
// high-stakes audits where a missed critical/high finding costs more than the extra gate tokens. The
// arbiter is intentionally Opus (not Sonnet) because it is the TIE-BREAKING judgment call — the one
// place where under-spending the gate lets a real finding slip through. Shallow-severity findings
// (medium/low/info) never enter the deep path regardless of gateRounds.
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
  // reach_file_count is REQUIRED so the diff-mode bail (only 0 = a genuine failed reach index) can't be
  // tripped by an agent that merely omitted the field. In paths mode the agent reports it == file_count.
  required: ['file_count', 'reach_file_count', 'treesitter', 'summary'],
  properties: {
    file_count: { type: 'integer' },
    reach_file_count: { type: 'integer' }, // diff mode: file count in the FULL-REPO reach index (0 = it failed to build)
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
// crux/confidence/checks make every verdict auditable: crux is the single fact the verdict hinges on
// (the resolved const value, the caller, the code pattern), confidence is a 0-1 score, and checks
// records which recon commands were run (kind: extract|callers|const|map|manual-read|other) so a
// reviewer can replay each lookup and verify the conclusion.
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'entry_point', 'severity', 'category', 'remediation', 'why', 'crux', 'confidence', 'checks'],
  properties: {
    verdict: { enum: ['VALID', 'INVALID', 'UNCERTAIN'] },
    entry_point: { type: 'string' }, // the external entry point the attacker-controlled data enters from, or NONE
    severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] }, // meaningful only when verdict=VALID
    category: { type: 'string' },
    remediation: { type: 'string' }, // how to fix — guidance only, never exploit code
    why: { type: 'string' },         // one-to-two sentence justification for the verdict
    crux: { type: 'string' },        // the ONE concrete fact the verdict turns on (e.g. "const LIMIT=4096 < dest 8192", "callers: direct HTTP handler")
    confidence: { type: 'number' },  // 0.0 – 1.0; reflects how much of the path was confirmed vs inferred
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'command_or_file', 'result'],
        properties: {
          kind: { enum: ['extract', 'callers', 'const', 'map', 'manual-read', 'other'] },
          command_or_file: { type: 'string' }, // the recon command run or file read
          result: { type: 'string' },          // key output that informed the verdict (one line)
        },
      },
    },
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
const gateRounds = Math.min(Math.max(args?.gateRounds ?? 1, 1), 5)          // deep-gate opt-in: 1 = off (default), 2-5 = run extra blind reviewers for serious survivors
const deepGateSeverities = args?.deepGateSeverities ?? ['critical', 'high'] // which severities trigger the extra rounds
const baselinePath = args?.baselinePath ?? '.security-audit/baseline.md' // NOT .claude/rules/ — auto-loads every session
const writeBaseline = args?.writeBaseline ?? true
const writeArtifacts = args?.writeArtifacts ?? true

// recon.py is bundled in the secure-review skill; agents shell out to it. Paths are strings the script
// passes through (it cannot read them). venvPy is the optional tree-sitter python the Recon stage builds.
const reconScript = args?.reconScript ?? 'plugins/workflow-kit/skills/secure-review/scripts/recon.py'
const reconDir = reconScript.replace(/recon\.py$/, '')
const reconSetup = `${reconDir}setup_venv.sh`
const venvPy = `${reconDir}.venv/bin/python`
const reconOut = args?.reconOut ?? '.security-audit/recon.json'
// Slash-less reconOut (e.g. "recon.json") has no directory part; the regex replace would no-op and leave
// a FILENAME as auditDir. Test for the slash first so a bare filename correctly yields '.'.
const auditDir = reconOut.includes('/') ? reconOut.replace(/\/[^/]*$/, '') : '.'
const reconFiles = `${auditDir}/diff-files.txt`
// Two-index split for diff-mode reachability: reconReachOut is the full-repo index used by callers/map
// (so the call graph is complete); reconAuditOut is the --files-scoped index used for lane sharding and
// file count. In paths mode both equal reconOut (no extra index built).
const reconReachOut = reconOut  // full-repo reach index (always = reconOut; diff mode keeps same path)
// In diff mode reconAuditOut MUST differ from reconReachOut, else the changed-files index overwrites the
// full-repo reach index and the reachability trace silently dies. The `.json` swap only differs when
// reconOut ends in `.json`; append a distinct suffix otherwise so the two paths never collide.
const reconAuditOut = mode === 'diff'
  ? (reconOut.endsWith('.json') ? reconOut.replace(/\.json$/, '-audit.json') : reconOut + '.audit.json')
  : reconOut

// Recon command surface injected into lane + gate prompts (sliced: only the read subcommands they call).
// Uses reconReachOut (full-repo index) so callers/const/extract always have the complete call graph,
// even in diff mode where reconAuditOut is scoped to changed files only.
const reconBlock =
  `Deterministic recon — PREFER these over ad-hoc grep. Use "${venvPy}" as PY if it exists, else python3:\n` +
  `  PY "${reconScript}" callers <symbol|file#fn[:line]> --index "${reconReachOut}"   -> callers; it states when a function with no in-code caller is an ENTRY POINT or referenced-as-a-value (reachable) vs genuinely dead\n` +
  `  PY "${reconScript}" const <NAME> --index "${reconReachOut}"       -> resolved constant value (then DO THE ARITHMETIC)\n` +
  `  PY "${reconScript}" extract <file#fn[:line] | file:line> --index "${reconReachOut}"  -> the exact function body; add --context-lines N (default 60) for config/IaC files where no function span exists — emits a line-centred window marked "# fallback window, not exact function"\n` +
  `If a query reports "ambiguous function <name>", the symbol has multiple definitions: re-run with ` +
  `the printed file#fn or file#fn:line form (applies to callers/extract; const lists every defining file).\n` +
  `Entry-point detection is heuristic — treat it as a signal, then confirm the path yourself.`

// 0. Recon — cheap. ONE agent builds the index artifact every later stage reads. Best-effort enables the
//    precise tree-sitter backend; degrades to stdlib heuristics.
//    In diff mode, builds TWO indexes: full-repo (reconReachOut) for callers/reachability, and
//    --files-scoped (reconAuditOut) for lane sharding and file count. In paths mode only one index is built.
phase('Recon')
const diffStep = mode === 'diff'
  ? `2. List committed files changed since "${since}" (create the output dir first — nothing else has yet): ` +
    `mkdir -p "${auditDir}"; ` +
    `{ git diff --name-only ${since}...HEAD 2>/dev/null; ` +
    `git diff --name-only ${since} 2>/dev/null; } | sort -u > "${reconFiles}"\n` +
    `3. Build the full-repo reach index (used by callers/map for complete call graph): ` +
    `"$PY" "${reconScript}" index "${scope}" --out "${reconReachOut}"\n` +
    `4. Build the changed-files audit index (used for lane sharding and file count): ` +
    `"$PY" "${reconScript}" index "${scope}" --files "${reconFiles}" --out "${reconAuditOut}"\n`
  : ''
const recon = await agent(
  `Build the deterministic security recon index for "${scope}". Run these via Bash; do NOT analyze code — ` +
    `just produce the artifact and report its summary.\n` +
    `1. Best-effort enable the precise backend: PY=$(bash "${reconSetup}" 2>/dev/null | tail -1); ` +
    `[ -x "$PY" ] || PY=python3   (recon.py works either way; the venv only adds tree-sitter precision)\n` +
    diffStep +
    (mode === 'diff'
      ? `5. Return file_count (from the audit index "${reconAuditOut}"), reach_file_count (the file count ` +
        `reported when building the full-repo reach index "${reconReachOut}" — 0 if that build failed), ` +
        `entrypoint_count, whether tree-sitter was on, and the printed summary line.`
      : `2. Build the index: "$PY" "${reconScript}" index "${scope}" --out "${reconOut}"\n` +
        `3. Return file_count, reach_file_count (same value as file_count in paths mode), entrypoint_count, ` +
        `whether tree-sitter was on, and the printed summary line.`),
  { label: 'recon', phase: 'Recon', model: workerModel, schema: RECON_SCHEMA },
)
const fileCount = recon?.file_count ?? 0
log(`recon: ${fileCount} files indexed, ${recon?.entrypoint_count ?? '?'} entry points, tree-sitter ${recon?.treesitter ? 'on' : 'off (degraded)'}`)
// Nothing indexed -> the index is missing/empty; Map would read a dead artifact and flail on Opus. Bail.
if (!fileCount) return { error: 'recon indexed 0 files (bad scope, or recon failed to write the index)', scope, reconPath: reconOut }
// Diff mode builds a SECOND, full-repo reach index that every lane/gate reads for callers/extract/const and
// that Map reads for the call graph. The fileCount guard above only validates the audit index — if the reach
// index silently failed to build, the reachability trace is dead but downstream wouldn't know. Bail loud.
if (mode === 'diff' && !(recon?.reach_file_count ?? 0))
  return { error: 'diff mode: full-repo reach index empty or failed to build; reachability trace would be dead', scope, reconPath: reconReachOut }

// 1. Map — Opus. Reads recon.json + the baseline, fixes shared constraints, and chooses the coverage
//    model. Small scope -> thematic lanes; large scope -> file-partition so no file is skipped.
phase('Map')
const focusLine = focus?.length ? `Prioritize these vulnerability classes: ${focus.join(', ')}.` : ''
const plan = await agent(
  `You are mapping the attack surface of the code under "${scope}" for a DEFENSIVE security audit.\n` +
    `Read the reach index at "${reconReachOut}" (JSON: files[], symbols, callees/callers graph, entrypoints, ` +
    `languages, exports, imports_external, filegraph, summary.file_count). Use it instead of re-walking ` +
    `the tree. For a compressed module map of where untrusted input can flow, run: ` +
    `python3 "${reconScript}" map --hops 2 --index "${reconReachOut}" (focus defaults to entry-point files; ` +
    `external libraries are listed but not traversed; reading a prebuilt index never needs the venv).\n` +
    (reconAuditOut !== reconReachOut
      ? `For the coverage size decision (thematic vs partition) read the audit index at "${reconAuditOut}" ` +
        `and use ITS summary.file_count (the changed-files count), not the reach index file count.\n`
      : '') +
    `1. From the recon entrypoints, filegraph (internal cross-file edges), and languages, establish trust ` +
    `boundaries: where untrusted input enters, how it flows across files toward sinks, network/exec/file ` +
    `surface, and what is out of scope. Emit these as "constraints". Recon indexes SOURCE files only — ` +
    `config/CI/IaC (YAML, Dockerfile, Terraform, GitHub Actions) are NOT in the index, so emit a ` +
    `constraint that supply-chain / permissive-config coverage is source-read only, not exhaustive.\n` +
    `2. If "${baselinePath}" exists, read it and add each ACCEPTED-RISK or known item to "constraints" ` +
    `as "ACCEPTED: <fingerprint>" so the gate can drop re-discoveries.\n` +
    `3. Choose coverage: if the audit file_count <= ${partitionThreshold}, set coverage "thematic" and return ` +
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
            `PY "${reconScript}" shard --i ${si} --n ${sn} --index "${reconAuditOut}". Audit EVERY file listed.`
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
          `"NO callers" means dead code, not a finding, UNLESS callers reports it IS an entry point or ` +
          `referenced as a value, which means the framework/runtime invokes it and it IS reachable). A bare grep hit with no reachable path is ` +
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
        `Mark INVALID if: recon \`callers\` shows no caller AND the function is not an entry point and ` +
        `not referenced as a value (genuinely dead code — a route/handler the framework invokes is NOT ` +
        `dead even with no in-code caller), the value is trusted or ` +
        `sufficiently bounded, the trigger needs a privileged/local-only actor, it matches an "ACCEPTED:" ` +
        `constraint, it duplicates a known item, or you cannot establish a concrete reachable path.\n` +
        `IMPORTANT — incomplete call graph is NOT a rejection ground: if the recon index is partial ` +
        `(e.g. dynamic dispatch, generated code, or a cross-service boundary stops the trace), ` +
        `an incomplete call tree alone does not justify INVALID. Reject only when a SPECIFIC CODE FACT ` +
        `directly contradicts reachability, attacker-control, or exploitability — e.g. callers confirms ` +
        `the function is unreachable, a const proves the value is bounded, or an upstream check makes ` +
        `the trigger impossible. If the sink sits inside an external entry point or a concrete ` +
        `entry-point-to-sink path is given and no named sufficient defense is found, lean VALID or UNCERTAIN.\n\n` +
        `If VALID: set "verdict":"VALID", "entry_point" to the external source the data enters from, and ` +
        `assign severity, category, and remediation GUIDANCE only (no exploit code, no payloads). If not ` +
        `VALID: set verdict INVALID or UNCERTAIN, "entry_point":"NONE", and leave severity "info". Always ` +
        `fill "why" with a one-to-two sentence justification.\n\n` +
        `REQUIRED — fill these three audit fields with CONCRETE recon facts, not assertions:\n` +
        `"crux": the single fact the verdict turns on — name the exact recon output (e.g. ` +
        `"callers: called only from HTTP handler at routes.js:42", ` +
        `"const LIMIT=4096 resolves to 4096, dest buf is 8192 — not overflowed", ` +
        `"extract: input reaches shell.exec() without sanitization"). Do NOT write unsupported claims like ` +
        `"upstream check bounds the value" — name the check and the resolved bound.\n` +
        `"confidence": a 0.0–1.0 number; 1.0 = full path confirmed via recon, 0.5 = partial/inferred, ` +
        `0.0–0.3 = incomplete call graph or dynamic dispatch stopped the trace.\n` +
        `"checks": an array of every recon command you ran and its key output — one entry per lookup, ` +
        `kind must be one of: extract, callers, const, map, manual-read, other; ` +
        `"command_or_file" is the exact command or file path; "result" is the one-line key output ` +
        `that informed the verdict. If you ran NO recon commands, explain in crux why manual-read ` +
        `was sufficient and record that as a manual-read entry.\n\n` +
        `${carriedBlock}\n\n` +
        `Candidate finding:\n${JSON.stringify(f, null, 2)}`,
      { label: `gate:${i}:${f.where}`, phase: 'Gate', model: gateModel, schema: VERDICT_SCHEMA },
    ).then((v) => (v ? { ...f, ...v } : null)),
  ),
)
const confirmed1 = verdicts.filter((v) => v && v.verdict === 'VALID')
const droppedCount1 = deduped.length - confirmed1.length
log(`gate: ${confirmed1.length} confirmed, ${droppedCount1} dropped of ${deduped.length} candidate findings`)

// 3a. Deep gate (opt-in via gateRounds >= 2) — two blind independent reviewers for serious VALID survivors.
// Deviation from cheap-first: model-routing.md says strong model only for decompose, gate, and synthesis.
// This adds TWO extra gate calls per serious finding (gateRounds default 1 = off). Justified only when
// the caller opts in: high-stakes findings where a missed critical/high costs more than the extra tokens.
// Arbiter runs on Opus (structured inputs only, no transcripts) to break ties — no context bleed.
let confirmed = confirmed1
// Deep-gate reasoning is the most expensive part of an opt-in run; capture every reviewer + arbiter
// verdict so it lands in the run artifacts (verdicts.json only holds the FIRST-pass gate output).
const deepGateRecords = []
if (gateRounds >= 2 && confirmed1.length) {
  const deepCandidates = confirmed1.filter((v) => deepGateSeverities.includes(v.severity))
  const shallowConfirmed = confirmed1.filter((v) => !deepGateSeverities.includes(v.severity))
  if (deepCandidates.length) {
    // Two BLIND independent reviewers per deep candidate, in one parallel fan-out.
    // "Blind" = each reviewer only sees the original finding + recon access (not each other's verdict).
    const deepGatePrompt = (f, reviewerNum) =>
      `You are BLIND REVIEWER ${reviewerNum} of 2 in a second-pass gate. A first gate already marked ` +
        `this finding VALID. Re-examine it independently — do NOT assume the first gate was correct. ` +
        `Apply the same strict standards: reject unless genuinely attacker-reachable.\n\n` +
        `You are a PRECISION-FIRST reachability arbiter with repo read + Bash recon access. ` +
        `REJECT unless the finding is a genuinely attacker-reachable bug. Default to INVALID under uncertainty.\n\n` +
        `${reconBlock}\n\n` +
        `Mark VALID only if ALL hold: (1) the bug pattern really exists in the cited code (read it with ` +
        `recon \`extract\`); (2) a concrete path runs from an EXTERNAL entry point carrying ATTACKER-CONTROLLED ` +
        `data to the sink (confirm reachability with recon \`callers\`); (3) the cited value/size/pointer is ` +
        `actually attacker-controlled — NOT trusted/kernel-set, NOT a fixed-size field, and NOT bounded ` +
        `by an upstream check UNLESS that bound still exceeds the destination size.\n` +
        `Mark INVALID if: callers shows no caller AND the function is not an entry point, the value is ` +
        `trusted or sufficiently bounded, the trigger needs a privileged/local-only actor, or you cannot ` +
        `establish a concrete reachable path.\n\n` +
        `${carriedBlock}\n\n` +
        `Finding to re-examine (do NOT share your reasoning with the other reviewer):\n${JSON.stringify(f, null, 2)}`
    const deepReviewPairs = await parallel(
      deepCandidates.flatMap((f, i) => [
        () => agent(deepGatePrompt(f, 1), { label: `deep:${i}:r1:${f.where}`, phase: 'Gate', model: gateModel, schema: VERDICT_SCHEMA })
          .then((v) => (v ? { ...f, ...v, _deepIdx: i, _reviewer: 1 } : null)),
        () => agent(deepGatePrompt(f, 2), { label: `deep:${i}:r2:${f.where}`, phase: 'Gate', model: gateModel, schema: VERDICT_SCHEMA })
          .then((v) => (v ? { ...f, ...v, _deepIdx: i, _reviewer: 2 } : null)),
      ])
    )
    for (const r of deepReviewPairs) if (r) deepGateRecords.push({ stage: 'reviewer', where: r.where, reviewer: r._reviewer, verdict: r.verdict, crux: r.crux, confidence: r.confidence, checks: r.checks })
    // Pair up the two reviewers per finding; arbitrate disagreements on Opus.
    const deepAgreed = []
    const needsArbiter = []
    for (let i = 0; i < deepCandidates.length; i++) {
      const r1 = deepReviewPairs.find((r) => r && r._deepIdx === i && r._reviewer === 1)
      const r2 = deepReviewPairs.find((r) => r && r._deepIdx === i && r._reviewer === 2)
      const v1 = r1?.verdict ?? 'INVALID'
      const v2 = r2?.verdict ?? 'INVALID'
      if (v1 === 'VALID' && v2 === 'VALID') {
        // Both agree: VALID. Merge the richer of the two verdicts (higher confidence wins).
        const winner = (r1?.confidence ?? 0) >= (r2?.confidence ?? 0) ? r1 : r2
        const { _deepIdx: _a, _reviewer: _b, ...clean } = winner
        deepAgreed.push(clean)
      } else if (v1 !== 'VALID' && v2 !== 'VALID') {
        // Both agree: not VALID. Drop the finding.
        log(`deep-gate: dropped ${deepCandidates[i].where} — both reviewers rejected`)
      } else {
        // Disagreement. Queue for arbiter.
        needsArbiter.push({ original: deepCandidates[i], r1, r2 })
      }
    }
    // Opus arbiter for ties: structured inputs only (no transcripts, no reviewer prose).
    if (needsArbiter.length) {
      const arbitrated = await parallel(
        needsArbiter.map(({ original, r1, r2 }) => () =>
          agent(
            `You are the FINAL ARBITER for a security finding that two independent blind reviewers ` +
              `disagreed on. Make the deciding call based only on the structured evidence below — do NOT ` +
              `generate new analysis, do NOT read additional files unless required to resolve a specific ` +
              `factual conflict in the verdicts. Default INVALID under uncertainty.\n\n` +
              `Original finding:\n${JSON.stringify({ where: original.where, evidence: original.evidence }, null, 2)}\n\n` +
              `Reviewer 1 verdict: ${r1?.verdict ?? 'null'}\n` +
              `Reviewer 1 crux: ${r1?.crux ?? 'n/a'}\n` +
              `Reviewer 1 confidence: ${r1?.confidence ?? 'n/a'}\n` +
              `Reviewer 1 checks: ${JSON.stringify(r1?.checks ?? [])}\n\n` +
              `Reviewer 2 verdict: ${r2?.verdict ?? 'null'}\n` +
              `Reviewer 2 crux: ${r2?.crux ?? 'n/a'}\n` +
              `Reviewer 2 confidence: ${r2?.confidence ?? 'n/a'}\n` +
              `Reviewer 2 checks: ${JSON.stringify(r2?.checks ?? [])}\n\n` +
              `${reconBlock}\n\n` +
              `Return VERDICT_SCHEMA with the deciding verdict. For "crux" state which reviewer's key ` +
              `fact was determinative and why. Remediation guidance only — no exploit code or payloads.`,
            { label: `arbiter:${original.where}`, phase: 'Gate', model: 'opus', schema: VERDICT_SCHEMA },
          ).then((v) => (v ? { ...original, ...v } : null))
        )
      )
      for (const v of arbitrated) {
        if (v) deepGateRecords.push({ stage: 'arbiter', where: v.where, verdict: v.verdict, crux: v.crux, confidence: v.confidence, checks: v.checks })
        if (v && v.verdict === 'VALID') deepAgreed.push(v)
        else if (v) log(`arbiter: dropped ${v.where}`)
      }
    }
    confirmed = [...shallowConfirmed, ...deepAgreed]
    const deepDropped = deepCandidates.length - deepAgreed.length
    log(`deep-gate: ${deepAgreed.length} survived, ${deepDropped} dropped of ${deepCandidates.length} serious findings`)
  }
}
const droppedCount = deduped.length - confirmed.length
log(`gate total: ${confirmed.length} confirmed, ${droppedCount} dropped`)

// 4. Report — Opus. Prioritized, defensive write-up from confirmed findings only.
phase('Report')
const report = await agent(
  `Write a prioritized DEFENSIVE security report for the audit of "${scope}". Use only the confirmed ` +
    `findings below; order by severity. For each finding include: location, the external entry point the ` +
    `attacker reaches it from, why it is a risk, and how to remediate it. Also cite the "crux" field — ` +
    `the concrete recon fact the verdict turns on — and summarize the "checks" (which recon commands ` +
    `were run and their key results) so the reader can verify the conclusion independently. ` +
    `State the audited scope, the coverage model (${coverage}), and the constraints (what was and wasn't ` +
    `covered, incl. whether recon ran with tree-sitter precision, and that config/CI/IaC files are outside ` +
    `recon's index so config/supply-chain coverage is not exhaustive). State skipped files by reason ` +
    `(unsupported extension, too large, symlinks, gitignored) so the reader knows what was NOT analyzed. ` +
    `Do NOT include exploit code, payloads, or step-by-step exploitation — remediation only.\n\n` +
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

// 6. Finalize — Haiku, mechanical. Persist run artifacts for gate debugging (writeArtifacts=true default).
//    The script cannot call Date.now() or touch the filesystem; the agent derives the timestamp and writes.
//    Writes to ${auditDir}/runs/<ts>/: recon-ref.txt, lanes.json, candidates.json, verdicts.json,
//    confirmed.json, coverage.md (skipped-by-reason summary from recon), report.md.
//    Single agent (not a fan-out) — all writes are sequential and cheap on Haiku.
let artifactsDir = null
if (writeArtifacts) {
  const artifactData = {
    reconRef: reconOut,
    lanes: lanes,
    candidates: deduped,
    verdicts: verdicts.filter(Boolean),
    deepGate: deepGateRecords,   // reviewer + arbiter verdicts (empty unless gateRounds >= 2)
    confirmed: confirmed,
    constraints: constraints,
    report: report ?? '',
    reconSummary: recon?.summary ?? '',
  }
  const artifactsResult = await agent(
    `Write per-run audit artifacts to disk. These are debug artifacts for gate review — write them ` +
      `exactly as instructed, no analysis needed.\n\n` +
      `STEP 1 — derive the run timestamp:\n` +
      `ts=$(date -u +%Y-%m-%dT%H%M%SZ)\n` +
      `runDir="${auditDir}/runs/$ts"\n` +
      `mkdir -p "$runDir"\n\n` +
      `STEP 2 — write these files into $runDir (use Bash write-file or Write tool for each):\n` +
      `  recon-ref.txt   — one line: the path to the recon index ("${reconOut}")\n` +
      `  lanes.json      — JSON array of the audit lanes (write exactly as given)\n` +
      `  candidates.json — JSON array of deduped candidate findings (before gate)\n` +
      `  verdicts.json   — JSON array of all FIRST-pass gate verdicts (VALID/INVALID/UNCERTAIN)\n` +
      `  deep-gate.json  — JSON array of the deep-gate reviewer/arbiter verdicts (write ONLY if the ` +
      `deepGate array below is non-empty; skip the file when it is empty)\n` +
      `  confirmed.json  — JSON array of confirmed VALID findings only\n` +
      `  report.md       — the final report text (write exactly as given)\n` +
      `  coverage.md     — a markdown file listing what was NOT analyzed: write a section ` +
      `"## Skipped / Not Analyzed" with bullet points for: (a) config/CI/IaC files outside the recon ` +
      `index, (b) any failure notes from the lanes (if present), (c) diff-mode scope if mode="${mode}" is ` +
      `"diff" (audit scoped to files changed since "${since}"), otherwise note paths-mode full-scope audit.\n\n` +
      `STEP 3 — return the resolved absolute or repo-relative $runDir in the "runDir" field.\n\n` +
      `Data to write:\n${JSON.stringify(artifactData, null, 2)}`,
    { label: 'finalize', phase: 'Write-back', model: workerModel,
      schema: { type: 'object', additionalProperties: false, required: ['runDir'], properties: { runDir: { type: 'string' } } } },
  )
  // Schema-returned runDir (no fragile prose-scraping). Null if the agent died.
  artifactsDir = artifactsResult?.runDir ?? null
  log(`finalize: artifacts written${artifactsDir ? ` to ${artifactsDir}` : ''}`)
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
  artifactsDir,
}
