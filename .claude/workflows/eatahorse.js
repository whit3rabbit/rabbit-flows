// eatahorse — decompose a goal into an Eatahorse Kanban board, gate the plan, then (opt-in) work it
//   unattended one bite at a time:
//     decompose -> seed cards -> plan gate -> [execute: Ralph loop (worker -> completion gate)] -> write-back.
//
// Why a workflow (not a conversation): the unattended execution loop. A conversation can plan a board,
// but the "ralph" pattern — spawn a FRESH-CONTEXT worker each iteration, have it read the durable board,
// take exactly ONE bite, sync, and report state back so the loop can decide whether to continue — is an
// orchestration worth codifying and rerunning. The board is the state; the script is the loop.
//
// The spine (CLAUDE.md): decompose (Opus) -> workers (the loop, Sonnet) -> admission gate (Opus completion
// gate) -> synthesize/write-back (Sonnet). The PLAN GATE is the second required gate: execute depends on a
// well-formed plan, so a fresh Opus context judges the seeded board before any work starts.
//
// NOTED DEVIATIONS (per CLAUDE.md "Bending" — unexplained deviation is a bug):
//   1. Shared MUTABLE store. workflow-design.md says workers must not share a mutable pool. Here the
//      .eatahorse board IS a shared mutable store — ALLOWED because the loop runs workers STRICTLY
//      SEQUENTIALLY, script-coordinated, against a durable ledger. There is no concurrent write race and
//      no agent-to-agent chatter; each worker reads the committed board, makes one change, syncs, exits.
//      This is the cleanest "ralph" substrate: fresh context every iteration + durable state outside it.
//      (The eatahorse hook no longer PostToolUse-syncs on board edits — that path was removed as a
//       single-writer hazard; only a Stop/SessionEnd sync remains, which the sequential loop can't race.
//       EATAHORSE_NO_AUTOSYNC=1 silences that too.)
//   2. The board DOUBLES as write-back (state survives the run in .eatahorse/). We still run the CLAUDE.md
//      finalize stage (memory.md) so cross-cutting decisions + blocked-task reasons (first-class
//      constraints) survive where a future session will actually read them.
//   3. The script has NO filesystem access (VM sandbox). ALL board I/O happens inside agents via the
//      eatahorse.py CLI (Bash). Loop termination therefore comes from each worker's RETURNED report
//      (activeRemaining), not from the script reading the board.
//
// PERMISSIONS / SAFETY: execute:true makes UNATTENDED edits to the project (workers run real bites:
//   editing code/files, running commands), gated only by the session allowlist. Default is execute:false
//   (plan + organize the board only, write nothing but the board). Opt in deliberately, ideally on a
//   scratch project or a slice first.
//
// Knobs (args):
//   goal           the objective to break down (also accepts a bare string: `/eatahorse <goal>`)
//   execute:false  default — decompose, seed, gate the plan, stop. Writes only the .eatahorse board.
//   execute:true   also run the Ralph loop: take bites unattended until the board is clear / caps hit.
//   board          board dir (default ".eatahorse" in the project root)
//   scriptPath     path to eatahorse.py (default the bundled skill copy; worker falls back to `find`)
//   maxIterations  hard loop cap (default 40) — backstop independent of budget
//   maxTokens      per-run OUTPUT-token ceiling (default none). Stops opening iterations once spent
//                  crosses it. Independent of the platform "+500k" turn directive (args can't set that);
//                  when both are set the more restrictive wins.
//   budgetFloor    stop opening iterations below this many remaining tokens (default 50000)
//   workerModel    model for the execute loop workers (default "sonnet")
//   constraints    board invariants/boundaries that must NOT regress (string or string[]). Injected into
//                  decompose + worker + completion gate (the gate reopens a card that violates one) and
//                  persisted to CLAUDE.md. Run-level, NOT a card field — closes the "satisfied acceptance
//                  but regressed something the card never mentioned" hole. Default none.
//   grounding      path to an inventory.json (from `eatahorse-research` with extract:'port'). When set,
//                  PORT MODE: decompose READS the inventory and seeds one card per source unit in
//                  dependency order (priority = topo band P00=leaf), instead of planning blind from the
//                  goal string. The other port knobs shape the target. Default '' (plan from goal).
//   targetLang/targetDir/preserveApi/testCmd  port target language, output dir, public API to keep stable,
//                  and the proving command. testCmd also auto-appends "<testCmd> stays green" + "project
//                  compiles" to constraints, so the completion gate enforces them as run invariants.
//   verifyEquivalence:false  PORT MODE opt-in. After the loop, differentially verify each ported unit
//                  (source-as-oracle vs target) via the bundled diff_test.py, write a graded `equivalence`
//                  record into the card Notes, and REOPEN any card whose outputs diverged. Heavier than the
//                  per-card gate (needs both toolchains + a source oracle live in the sandbox), hence a
//                  separate phase. harnessPath overrides the diff_test.py path; srcRunner/tgtRunner are the
//                  per-unit oracle command TEMPLATES (stdin JSON -> stdout JSON). No proof: differential is
//                  empirical; smt/bounded-mc are labeled-only, not implemented.
//
// NOTED DEVIATION (PORT MODE): grounded decompose reads a FILE (the inventory) via an agent — the script
//   has no FS. Dependency ordering is now a FIRST-CLASS DAG (v2/EH-PORT-10..12): each port card declares
//   `dependsOn` (its unit's intra-repo dep paths); Seed resolves those to card ids via the source:
//   external_id and wires `dep-add` edges, and `next` refuses to offer a card until its upstreams are
//   done. Zero-padded priority bands (P00..P0N) are kept only as a TIEBREAK among dep-free ready cards
//   (still lexical-sort-safe). No worker self-block: `next` excludes `blocked` and the DAG handles gating.
//
// requires-skills: eatahorse
//   (Bundling only — the installer copies the eatahorse skill alongside this workflow so the CLI script
//    travels with it. Workflow stages do NOT auto-load skills; the CLI surface below is distilled INLINE as
//    CMD/cli() and sliced per-agent into each prompt — that const is the runtime source of truth, the
//    bundled skill is the portable human/Skill-tool copy. See .claude/rules/workflow-design.md.)
// Run with /workflows, the `eatahorse` skill, or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` flags the trailing top-level return as "illegal return" — expected: the runtime wraps the
//  script in an async function, so top-level return/await are legal. Same as starter.js / scaffold.js.)
export const meta = {
  name: 'eatahorse',
  description:
    'Break a goal into a Kanban board of small tasks and check the plan, then optionally work the board unattended one task at a time, verifying each task before moving on.',
  whenToUse:
    'Use to plan a goal as small trackable tasks, or to work that board hands-off. Front door: the eatahorse skill.',
  phases: [
    { title: 'Probe' },
    { title: 'Decompose' },
    { title: 'Seed' },
    { title: 'Plan-gate' },
    { title: 'Execute' },
    { title: 'Verify' },
    { title: 'Verify-equivalence' },
    { title: 'Write-back' },
  ],
}

// Decompose output: outcome-oriented cards, each with small bites + testable acceptance checks.
const CARDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['project', 'cards'],
  properties: {
    project: { type: 'string' }, // short board/project name
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'priority', 'bites', 'acceptance'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { enum: ['P0', 'P1', 'P2', 'P3'] },
          bites: { type: 'array', minItems: 1, items: { type: 'string' } },       // 1-3 small executable steps
          acceptance: { type: 'array', minItems: 1, items: { type: 'string' } },  // what proves the card done (checkable); >=1 so a card can't auto-complete on a single check with nothing verifying it
        },
      },
    },
  },
}

// Port-mode decompose output: like CARDS_SCHEMA but priority is a ZERO-PADDED topo band (P00=leaf, deeper
// = larger) — kept as a TIEBREAK, not the sole ordering. Real dependency gating is now first-class:
// `dependsOn` lists the unit's intra-repo dep SOURCE PATHS; Seed resolves each to the card that ports it
// (via its source: external_id) and wires a `dep-add` edge, so `next` never offers a card before its
// upstreams are done (the band-as-topo proxy is retired in favor of explicit edges; bands still order ties).
// Each card also carries externalId (source:<path>) linking it back to its source unit.
const PORT_CARDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['project', 'cards'],
  properties: {
    project: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'priority', 'bites', 'acceptance'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', pattern: '^P[0-9]{2}$' }, // topo band: P00 ported first
          bites: { type: 'array', minItems: 1, items: { type: 'string' } },
          acceptance: { type: 'array', minItems: 1, items: { type: 'string' } },
          externalId: { type: 'string' }, // e.g. "source:<repo-rel path>" — back-link to the source unit
          dependsOn: { type: 'array', items: { type: 'string' } }, // intra-repo dep SOURCE PATHS (this unit's deps); Seed wires edges
        },
      },
    },
  },
}

// Plan gate / loop worker / completion gate all report the live board state so the script's loop can
// terminate without filesystem access. activeRemaining = cards not in done/dropped.
const PLAN_GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'adjustments', 'activeRemaining'],
  properties: {
    ready: { type: 'boolean' },                                   // plan is coherent enough to execute
    adjustments: { type: 'array', items: { type: 'string' } },    // splits/drops/edits the gate applied (via CLI)
    activeRemaining: { type: 'integer' },                         // active cards after adjustments (report --json)
  },
}

// EH-PORT-24: Seed reports its dependency-edge wiring so a silently-dropped edge (the DAG's safety quietly
// vanishing back to the priority-band tiebreak) becomes a visible signal the plan-gate can act on.
const SEED_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: true, // keep the agent's own count fields too
  required: ['wired', 'skipped', 'dangling'],
  properties: {
    wired: { type: 'integer' },                              // dep-add edges successfully added
    skipped: { type: 'integer' },                            // dep paths with no matching card / cycle-rejected
    dangling: { type: 'array', items: { type: 'string' } },  // dep source paths that resolved to no card
  },
}

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'action', 'progressed', 'completed', 'blocked', 'activeRemaining', 'note'],
  properties: {
    taskId: { type: 'string' },        // the card worked this iteration ("" if none was available)
    action: { type: 'string' },        // one-line: the bite taken / what was done
    progressed: { type: 'boolean' },   // did the board move forward (a bite/acceptance checked or status advanced)
    completed: { type: 'boolean' },    // did this card reach done this iteration (triggers the completion gate)
    blocked: { type: 'boolean' },      // did the worker move the card to blocked
    activeRemaining: { type: 'integer' }, // active cards after this iteration (report --json)
    note: { type: 'string' },          // short evidence/why for the action or block
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supported', 'reason', 'activeRemaining'],
  properties: {
    supported: { type: 'boolean' },       // is the card's acceptance ACTUALLY met by real evidence
    reason: { type: 'string' },            // why supported / why reopened
    activeRemaining: { type: 'integer' },  // active cards AFTER any reopen (report --json) — the loop trusts this
  },
}

// Per-card differential-equivalence result (EH-PORT-15). The agent runs diff_test.py for one ported unit,
// writes the record into the card's Notes, and reopens the card if the source and target diverged.
const EQUIV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'method', 'counterexamples', 'confidence', 'reopened'],
  properties: {
    taskId: { type: 'string' },
    method: { enum: ['differential', 'manual', 'smt', 'bounded-mc', 'skipped'] },
    cases: { type: 'integer' },                           // inputs actually tested (diff_test.py "cases")
    counterexamples: { type: 'integer' },                 // >0 => not equivalent => reopened
    coverage: { type: ['number', 'null'] },               // target branch coverage 0..1 if measured, else null
    confidence: { enum: ['proof', 'high', 'medium', 'low'] },
    reopened: { type: 'boolean' },                         // did this card get reopened on divergence
    note: { type: 'string' },
  },
}

// Pre-flight probe: does the target board dir already hold a board, and how many cards are still active?
// Drives the resume-vs-fresh-vs-bail branch BEFORE any decompose, so we never silently re-seed onto (or
// no-op against) an occupied dir. exists=false when `report` errors (no board there yet).
const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['exists', 'active', 'project'],
  properties: {
    exists: { type: 'boolean' },     // is there a board at the dir (report --json succeeded)
    active: { type: 'integer' },     // active cards (not done/dropped); 0 if none or no board
    project: { type: 'string' },     // the existing board's project name ("" if none)
  },
}

// ---- args ----
const goal =
  typeof args === 'string'
    ? args
    : args?.goal ?? 'Describe a goal to break into bite-sized tasks. (Pass args.goal.)'
const execute = args?.execute ?? false
// Default to a GOAL-derived dir (.eatahorse-<slug>), not the shared ".eatahorse" — that generic name
// collides with any prior generic board (a cleared one makes the run silently no-op as "board cleared").
// Mirrors the siblings (eatahorse-research -> .eatahorse-research, docs-from-code -> .eatahorse-docs).
const slugify = (s) =>
  (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'board')
const board = args?.board ?? '.eatahorse-' + slugify(goal)
// Guard: a stringified args blob (the whole {goal,execute,board,...} flattened to one string — the
// recurring "named-workflow args didn't thread" failure, WORKFLOW_ANALYSIS.md "Documentation Gaps")
// lands here as a bare-string `goal`: execute reads undefined -> false -> SILENT plan-only, and slugify
// bakes the blob into .eatahorse-goal-... . Fail LOUD (return, matching the collision-trap idiom below).
// ponytail: regex heuristic, known ceiling — false-positives only on a real goal that itself enumerates
// >=2 of these arg keys with a `:`/`=` after; the error is actionable so the cost is one re-launch.
// `["']?` after each key catches BOTH a comma-blob (`goal: x`) and a JSON-stringified object (`{"goal":"x"}`).
const _argKeys =
  /\b(goal|execute|board|constraints|root|question|outDir|brief|framework|targetLang|targetDir|grounding|maxIterations|maxTokens|budgetFloor|workerModel|preserveApi|testCmd)["']?\s*[:=]/gi
const _keyHits = [...new Set([...String(goal).matchAll(_argKeys)].map((m) => m[1].toLowerCase()))]
if (/^\s*['"{]*\s*(goal|root)["']?\s*[:=]/i.test(goal) || _keyHits.length >= 2) {
  return {
    goal,
    board,
    written: false,
    error:
      `args appear stringified: \`goal\` carries argument keys (${_keyHits.join(', ')}). Pass a STRUCTURED ` +
      `object, not one string blob: Workflow({name:"eatahorse", args:{goal:"<task>", execute:true, ` +
      `board:".eatahorse-<topic>"}}). execute/board/constraints were dropped, so this run would silently plan only.`,
  }
}
// Default to the bundled skill copy (works when run in this repo / after npx install into .claude). The
// worker is told to `find` it if the default is absent, so a relocated install still resolves.
const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
const maxIterations = Math.min(args?.maxIterations ?? 40, 200)
const workerModel = args?.workerModel ?? 'sonnet'
// Run-level invariants/boundaries (a bare string becomes a one-item list). Threaded into prompts; never a
// card field, so the pinned CARDS_SCHEMA / eatahorse.py roundtrip / tests are untouched.
const normList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean)
const constraints = normList(args?.constraints)
// Grounded/port mode: `grounding` = path to an inventory.json from `eatahorse-research` extract:'port'.
const grounding = args?.grounding ?? ''
const targetLang = args?.targetLang ?? ''
const targetDir = args?.targetDir ?? ''
const preserveApi = args?.preserveApi ?? '' // freeform: the public API surface to keep stable
const testCmd = args?.testCmd ?? ''         // the proving command; becomes a run constraint + behavior-parity acceptance
const PORT_MODE = !!grounding
// EH-PORT-13/14/15: opt-in differential equivalence verification AFTER the port loop. Heavier than the
// per-card gate (needs BOTH toolchains + an oracle into the source runtime live in the sandbox), so it is
// a SEPARATE phase, not folded into completion. verifyEquivalence turns it on; harnessPath points at the
// bundled diff_test.py (sibling of eatahorse.py by default). srcRunner/tgtRunner are command TEMPLATES the
// agent specializes per unit — each must read a JSON args list on stdin and print a JSON result (see
// diff_test.py contract). Without runners the agent falls back to a manual check and labels confidence low.
// EH-PORT-20: verifyOnly runs the Verify-equivalence phase against an ALREADY-DONE port board without
// re-porting (the pipeline's recommended follow-up pass, which otherwise dies on the 0-active probe bail).
// It implies verifyEquivalence and short-circuits decompose/seed/plan-gate + the execute loop below.
const verifyOnly = (args?.verifyOnly ?? false) && PORT_MODE
const verifyEquivalence = ((args?.verifyEquivalence ?? false) || verifyOnly) && PORT_MODE
// diff_test.py sits beside eatahorse.py. Replace the eatahorse.py filename when scriptPath ends in it;
// for a non-standard scriptPath (symlink/wrapper not ending eatahorse.py) swap the final path segment so
// we still point at a real sibling instead of silently reusing the wrong binary.
const harnessPath = args?.harnessPath ?? (
  /eatahorse\.py$/.test(scriptPath)
    ? scriptPath.replace(/eatahorse\.py$/, 'diff_test.py')
    : scriptPath.replace(/[^/\\]*$/, 'diff_test.py')
)
const srcRunner = args?.srcRunner ?? '' // template invoking the SOURCE unit as oracle (stdin JSON -> stdout JSON)
const tgtRunner = args?.tgtRunner ?? '' // template invoking the ported TARGET unit (same contract)
// Port runs MUST not regress the build/tests; fold those into constraints so the completion gate enforces
// them as run invariants (first-class, not a per-card field). Pushed before INVARIANTS is built below.
if (PORT_MODE) {
  constraints.push('the project compiles / builds cleanly after each ported unit')
  if (testCmd) constraints.push('`' + testCmd + '` stays green')
}
// Per-run OUTPUT-token ceiling, independent of the platform "+500k" turn directive (which args cannot
// set). null = no extra ceiling; the platform budget still applies. budgetFloor was the hardcoded floor.
const maxTokens = args?.maxTokens ?? null
const budgetFloor = args?.budgetFloor ?? 50_000
// Tokens left = min(platform budget remaining, our own maxTokens ceiling remaining). budget.remaining()
// is Infinity when no platform target is set; our ceiling bounds it. Most restrictive wins.
const tokensLeft = () =>
  Math.min(budget.remaining(), maxTokens ? Math.max(0, maxTokens - budget.spent()) : Infinity)

// Inline CLI contract (runtime source of truth — workers can't auto-load the eatahorse skill).
// Sliced per-agent: each prompt gets cli(...) with ONLY the commands its own steps call, not the whole
// surface. Under-slicing fails as "agent needs a command it wasn't handed" — keep keys exact to the prompt.
// SIBLING COPY: eatahorse-research.js has its own (intentionally smaller) CMD/cli. No runtime sharing is
// possible (VM sandbox, no require/FS) — when you change a command's surface here, mirror the overlapping
// CMD entries in that file by hand. The bundled skill is the portable human copy, not this.
const CLI_HEAD =
  `Eatahorse CLI (stdlib python, no deps): python3 "${scriptPath}" --board "${board}" <cmd>. ` +
  `If absent: find . -name eatahorse.py -path '*eatahorse*'.`
const CMD = {
  report:  `report --json -> {counts, active, done}  (read "active" for activeRemaining)`,
  list:    `list [--status s] [--json] -> cards (id,title,status,path)`,
  show:    `show <id> [--json]`,
  next:    `next [--json] -> top active card (doing>ready>backlog, by priority; blocked is never auto-picked)`,
  move:    `move <id> <backlog|ready|doing|blocked|done|dropped>`,
  bite:    `bite <id> <i> [--done|--open] [--group bites|acceptance]  (1-based; --done checks)`,
  addbite: `add-bite <id> "<text>" [--group bites|acceptance]`,
  reopen:  `reopen <id> [--gap "<what's missing>"]  (atomic: uncheck acceptance + add gap bite + move doing)`,
  add:     `add "<title>" [--priority P0..P3] [--status s] [-d "<desc>"] [--bite "<s>"].. [--accept "<c>"].. [--external-id ns:val].. [--depends-on EH-XXXX]..`,
  init:    `init "<project>" [--goal "<g>"]  (errors if a board exists)`,
  remove:  `remove <id> [--purge]`,
  sync:    `sync  (reconcile cards <-> state.json + board.md; run after edits)`,
  depadd:  `dep-add <id> --on <depId>  (add a dependency edge; rejects cycles. next won't offer <id> until <depId> is done)`,
  deprm:   `dep-rm <id> --on <depId>`,
  deps:    `deps <id> [--json] -> {depends_on:[blocks it], blocks:[downstream]}`,
}
// `done` CLI command omitted on purpose: no prompt uses it (agents tick acceptance + let sync auto-complete).
const cli = (...k) => CLI_HEAD + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
const CARD_RULE = `Card model: each card = one outcome / next 1-3 bites / what proves it done. Keep <=2 cards in "doing".`
// Injected into the loop worker in PORT MODE: it ports ONE source unit per card, keeping the public API
// stable, against already-ported (lower-priority) dependencies. Empty string in normal mode.
const PORT_RULE = PORT_MODE
  ? `\n\nPORT MODE: this board ports source units to ${targetLang || 'the target language'}` +
    `${targetDir ? ` under "${targetDir}"` : ''}. The card's description names the SOURCE file and the public ` +
    `API surface to preserve — port that ONE unit faithfully, keeping its public API stable. Its dependencies ` +
    `are lower-priority cards already ported (the board is ordered leaf-first by priority band), so port ` +
    `AGAINST their ported form. Do NOT modify the source files; write the port under the target dir.`
  : ''
// Built once, injected into decompose/worker/gate prompts. Empty string when no constraints (no-op append).
const INVARIANTS = constraints.length
  ? `\n\nBoard invariants — must NOT regress (boundaries + constraints): ` +
    constraints.map((c, i) => `${i + 1}. ${c}`).join('  ') +
    ` If an invariant names a runnable command, that command staying green is part of "done".`
  : ''

// 0. Probe — Haiku (mechanical, read-only). Look at the target board dir BEFORE decomposing so we never
//    silently re-seed onto / no-op against an occupied dir. Three outcomes below: resume an in-progress
//    board, bail LOUD on a cleared/foreign board, or proceed fresh when the dir is empty.
phase('Probe')
const probe = await agent(
  `Probe an Eatahorse board dir, READ-ONLY. Run \`python3 "${scriptPath}" --board "${board}" report --json\`. ` +
    `If it ERRORS (no board there yet), return exists=false, active=0, project="". Otherwise return ` +
    `exists=true, active = the report's "active" count, and project = the board's project name. Do NOT ` +
    `create or modify anything.\n\n${cli('report')}`,
  { label: 'probe', model: 'haiku', schema: PROBE_SCHEMA },
)
const resume = !!probe && probe.exists && probe.active > 0

// The probe is the ONLY guard against re-seeding an occupied board. A null probe (the agent died) is a
// hard signal, NOT "assume empty": falling through to the fresh path would re-run `add` for every card
// and duplicate them onto whatever board already exists. It also keeps every later probe.* read safe.
if (!probe) {
  return {
    goal,
    board,
    error: 'Probe agent returned nothing; cannot determine whether a board already exists at the dir. ' +
      'Re-run, or pass a known-fresh args.board.',
    written: false,
  }
}

// EH-PORT-20: verifyOnly works the EXISTING done cards — a board is its precondition, not an error.
if (verifyOnly && !probe.exists) {
  return {
    goal,
    board,
    error: `verifyOnly: no board at "${board}" to verify. Run a port first, then re-run with verifyOnly.`,
    written: false,
  }
}

// Existing board with nothing active = the collision trap (complete or foreign board). Fail LOUD instead
// of sweeping into the loop and reporting "board cleared" as if the run succeeded. EXCEPTION: verifyOnly,
// for which a complete (0-active) board is exactly the precondition.
if (probe && probe.exists && probe.active <= 0 && !verifyOnly) {
  return {
    goal,
    board,
    error:
      `Board at "${board}" exists but has 0 active cards (project="${probe.project}"). It is complete or ` +
      `belongs to another goal. Pass a fresh args.board (convention: .eatahorse-<topic>) or remove the stale board.`,
    written: false,
  }
}

let plan = null
let gate = null
if (verifyOnly) {
  // EH-PORT-20: verify existing DONE cards only; never port. Checked BEFORE resume — verifyOnly on a board
  // that still has active cards must NOT silently fall into the resume arm (which logs "Resuming" yet does
  // no work, since the execute loop is gated `!verifyOnly`). If active cards remain, say they are skipped.
  if (probe.active > 0)
    log(
      `verify-only: board "${board}" still has ${probe.active} active card(s) — they are NOT ported in ` +
        `verify-only mode; only DONE cards are verified. Resume the board separately to port them.`,
    )
  else log(`verify-only: working existing done cards on "${board}"; skipping decompose/seed/plan-gate.`)
} else if (resume) {
  // Existing board mid-flight: skip decompose/seed/plan-gate and work the cards already on it.
  log(`Resuming board "${board}": ${probe.active} active card(s). Skipping decompose/seed/plan-gate.`)
} else {
  // 1. Decompose — Opus (sets the trajectory). Two modes:
  //    - Normal: goal -> outcome-oriented cards (CARDS_SCHEMA).
  //    - PORT MODE (grounding set): READ the inventory.json and map each source unit -> one port card in
  //      dependency order (PORT_CARDS_SCHEMA). The script has no FS, so the agent reads the file.
  //    Returns STRUCTURED cards; the mechanical CLI writes happen in Seed (cheap), not here.
  phase('Decompose')
  if (PORT_MODE) {
    plan = await agent(
      `Plan a code PORT as a one-bite-at-a-time Kanban board, GROUNDED in a precomputed inventory. Do NOT ` +
        `plan blind from the goal — READ the inventory and map it one card per unit.\n` +
        `1. Read the JSON file "${grounding}" (e.g. \`cat "${grounding}"\`). Shape: {units:[{path, layer, ` +
        `apiSurface, deps, externalDeps, entryPoint, behavior}], topoOrder, cycles, invariants, entryPoints}. ` +
        `If the file is MISSING or unreadable, STOP and return {project, cards:[]} (do NOT invent units).\n` +
        `2. Emit ONE card per unit, walking units in topoOrder. For each unit:\n` +
        `   - title: "Port <path> to ${targetLang || '<target language>'}".\n` +
        `   - priority: "P" + the unit's layer zero-padded to EXACTLY 2 digits ("P00" for layer 0, "P03" for ` +
        `layer 3). Lower layer = fewer dependencies = ported FIRST. Always two digits; for any layer >= 100 ` +
        `use "P99" (the explicit dependency edges, not the band, enforce true order — the band is only a ` +
        `tiebreak among dep-free cards).\n` +
        `   - description: the source <path>, the public apiSurface to preserve` +
        `${preserveApi ? ` (especially: ${preserveApi})` : ''}, and the intra-repo deps it relies on` +
        `${targetDir ? `, written under "${targetDir}"` : ''}.\n` +
        `   - bites (1-3): port the unit to ${targetLang || 'the target language'}` +
        `${targetDir ? ` under ${targetDir}` : ''}; then reconcile its public API against the inventory apiSurface.\n` +
        `   - acceptance (each MUST name its evidence surface): (a) the ported unit compiles / the project ` +
        `builds; (b) the public API matches the inventory apiSurface for <path>; (c) behavior parity` +
        // EH-PORT-19: (c) names a proof runnable DURING the loop (testCmd or a manual check), NEVER "a record
        // written by the verify-equivalence phase" — that phase is POST-loop, so referencing it deadlocks the
        // card (can't reach done in-loop -> verify-equivalence then finds 0 done cards). verifyEquivalence is an
        // INDEPENDENT post-hoc reopener (same shape as the invariant gate), not an in-loop acceptance item.
        `${testCmd ? ` — \`${testCmd}\` passes` : ` (NO test command was given — state the concrete manual check)`}. ` +
        `If any check needs a live runtime unavailable headless, phrase it as a headless proxy PLUS an explicit ` +
        `"(manual residual: <live check>)", never a bare runtime assertion.\n` +
        `   - externalId: "source:<path>" (back-links the port card to its source unit).\n` +
        `   - dependsOn: the unit's INTRA-REPO dep paths (the inventory unit's "deps" array — repo-relative ` +
        `source paths only, NOT external packages). Seed turns these into real dependency edges so the loop ` +
        `never ports a unit before the units it depends on. Omit or [] for a leaf.\n` +
        // EH-PORT-21: cycle-aware acceptance. An SCC member can't compile standalone (it references a peer not
        // yet ported), so a plain "the project builds" acceptance bounces it forever. Stub-then-fill: all-but-one
        // member is accepted as a syntactically-valid stub; ONE member carries the cluster-compiles check. Seed's
        // would_cycle drops the back-edge, giving the SCC a defined stub-first port order. (Kept as one card per
        // unit, NOT collapsed — collapse breaks the single-namespace source: external_id join.)
        // ponytail: cycle handling is a decompose-prompt nudge, not structural. Ceiling: it relies on the agent
        // reading inventory.cycles correctly. Upgrade if SCCs get large/common -> a real multi-source card model
        // (eatahorse.py external_ids would need a list per namespace, not a scalar).
        `2b. CYCLES: if a unit's "path" appears in the inventory "cycles" array (a strongly-connected group of ` +
        `mutually-dependent units), it CANNOT compile on its own. For such SCC members, phrase acceptance (a) ` +
        `as "<path> is written with its full public API; references to cyclic peers may be stubbed / ` +
        `forward-declared; the file is syntactically valid in ${targetLang || 'the target language'}" — EXCEPT ` +
        `for ONE chosen member of each cycle (the cluster entry), whose acceptance (a) is "the whole cycle ` +
        `[list the member paths] compiles together". Keep (b)/(c) as normal. Order the stub members ahead of ` +
        `the cluster-entry member; their dependsOn edges may be partly dropped by the cycle-breaker at seed ` +
        `time — that is expected, not an error.\n` +
        `3. Use a short project name like "Port to ${targetLang || 'target'}". Return {project, cards}.` +
        INVARIANTS,
      { label: 'decompose', schema: PORT_CARDS_SCHEMA },
    )
  } else {
    plan = await agent(
      `Break this goal into a small set of outcome-oriented task cards for a one-bite-at-a-time Kanban board.\n` +
        `Goal: ${goal}\n\n` +
        `Rules: each card targets ONE meaningful outcome (not a trivial command); give it 1-3 small executable ` +
        `bites (the next concrete steps) and 1-3 acceptance checks that concretely PROVE the card is done. ` +
        `Each acceptance item must NAME its evidence surface — the exact command that passes, the path that ` +
        `exists, or the observable behavior — so a verifier can run or inspect it (never "looks good"). If a ` +
        `check is inherently un-runnable in a headless/CI context (needs a live GUI/device/network), phrase it ` +
        `as the headless-verifiable proxy PLUS an explicit "(manual residual: <live check>)" — never a bare ` +
        `runtime assertion a headless worker cannot satisfy. Order by ` +
        `priority (P0 highest). Prefer fewer, well-scoped cards; if a card would need a long checklist, split it. ` +
        `Return a short project name and the cards.` +
        INVARIANTS,
      { label: 'decompose', schema: CARDS_SCHEMA },
    )
  }
  if (!plan?.cards?.length)
    return {
      goal,
      board,
      error: PORT_MODE ? `decompose produced no cards (inventory "${grounding}" missing or empty?)` : 'decompose produced no cards',
      written: false,
    }

  // 2. Seed — Haiku (mechanical). One agent creates the board (probe proved it's absent) and adds every card.
  //    Deterministic mapping from the decompose JSON; no judgment, so cheapest model.
  phase('Seed')
  const seedResult = await agent(
    `Create an Eatahorse board and seed it with the cards below. Use EXACTLY the board dir "${board}" for ` +
      `every command — do NOT invent, switch to, or improvise a different dir even if one already exists. ` +
      `Steps:\n` +
      `1. Create the board: run ` +
      `\`python3 "${scriptPath}" --board "${board}" init "${(plan.project || 'Eatahorse Project').replace(/"/g, "'")}" --goal "${goal.replace(/"/g, "'")}"\`. ` +
      `If it reports the board already exists, skip this step (do not --force).\n` +
      `2. For EACH card below, run one \`add\` with --priority, -d (description), a --bite per bite, and a ` +
      `--accept per acceptance check. If a card has an "externalId" field, ALSO pass \`--external-id <that ` +
      `value>\` (it back-links the card to its source). Put the highest-priority card(s) (lowest priority ` +
      `string, e.g. P00/P0) in --status ready, the rest backlog.\n` +
      `3. Wire dependency edges (PORT MODE): after ALL cards are added, run \`list --json\` to get each ` +
      `card's id + external_ids. For every card that has a "dependsOn" array, map each dep SOURCE PATH to ` +
      `the card whose external_ids.source equals that path, and run \`dep-add <card-id> --on <dep-card-id>\`. ` +
      `Skip a dep path with no matching card (it is an external/untracked unit). dep-add rejects cycles — if ` +
      `one is rejected, leave it and note it.\n` +
      `4. Run \`sync\`, then \`report --json\` and report the resulting counts. ALSO report the dependency ` +
      `wiring from step 3: \`wired\` (edges you added), \`skipped\` (dep paths with no matching card or ` +
      `cycle-rejected), and \`dangling\` (the list of dep SOURCE PATHS that resolved to no card). In normal ` +
      `(non-port) mode no card has dependsOn, so report wired=0, skipped=0, dangling=[].\n` +
      // seed only creates cards: init/add + sync/report (+ CARD_RULE for well-shaped cards). The init line
      // is spelled out WITH --board so a cheap agent can't drop the flag (which would let resolve_board walk
      // up to a parent board, diverging from where add/report write).
      `Do NOT start working any task. Only create cards.\n\n${cli('report', 'init', 'add', 'list', 'depadd', 'sync')}\n${CARD_RULE}\n\n` +
      `Cards (JSON):\n${JSON.stringify(plan.cards)}`,
    { label: 'seed', model: 'haiku', schema: SEED_RESULT_SCHEMA },
  )
  // EH-PORT-24: surface dropped edges loudly. A nonzero skipped/dangling means the DAG's ordering safety
  // partly reverted to the priority-band tiebreak — the plan-gate below double-checks coverage per card.
  if (PORT_MODE && seedResult && (seedResult.skipped || seedResult.dangling?.length)) {
    log(
      `Seed dep wiring: ${seedResult.wired ?? 0} edge(s) wired, ${seedResult.skipped ?? 0} skipped` +
        (seedResult.dangling?.length ? `; dangling dep paths: ${seedResult.dangling.join(', ')}` : '') +
        `. Ordering for those cards falls back to the priority band — verify they still port after their deps.`,
    )
  }

  // 3. Plan gate — Opus, FRESH context (admission gate for the plan). Reads the seeded board, drops/splits
  //    cards that aren't independent or whose acceptance isn't checkable, and reports the active count. The
  //    execute loop depends on this plan, so it must not rubber-stamp — strong model (model-routing.md).
  phase('Plan-gate')
  gate = await agent(
    `You are a plan admission gate. Inspect the freshly seeded Eatahorse board at "${board}" ` +
      `(\`list --json\`, \`show <id>\`, read board.md). For EACH card judge: is the outcome clear and ` +
      `independent, are the bites genuinely small, and is the acceptance CHECKABLE (a real, observable ` +
      `proof)? Fix problems IN PLACE via the CLI: split an overloaded card into smaller cards, drop a ` +
      `meaningless one (\`remove\`), or tighten bites/acceptance (\`add-bite\` / re-add). REJECT any card ` +
      `with no acceptance check (or only a vague/non-checkable one): add a concrete, observable one before ` +
      `passing it, since a card with no real acceptance auto-completes on a single check with nothing proving it. ` +
      `Also REJECT acceptance that does not NAME its evidence surface (a runnable command, an inspectable path, ` +
      `or a concrete observable): make it name one before passing. ` +
      // EH-PORT-24: in PORT MODE, spot-check that the DAG edges Seed was supposed to wire actually exist, so a
      // silently-dropped edge surfaces here instead of degrading ordering to the band tiebreak unnoticed.
      (PORT_MODE
        ? `Because this is a PORT board, ALSO spot-check the dependency DAG: for each card whose description ` +
          `names intra-repo dependencies, run \`deps <id>\` and confirm it has the expected "depends_on" ` +
          `edges. Note any card missing an expected edge (or any dangling dep) in the adjustments. `
        : '') +
      `Then run \`sync\` ` +
      `and \`report --json\`. Return: ready (is the plan coherent enough to execute), the adjustments you ` +
      // plan-gate inspects + edits in place: list/show/deps to read, remove/addbite/add to fix, sync/report.
      `applied, and activeRemaining (the report's "active" count).\n\n${cli('list', 'show', 'deps', 'remove', 'addbite', 'add', 'sync', 'report')}\n${CARD_RULE}`,
    { label: 'plan-gate', schema: PLAN_GATE_SCHEMA },
  )
  if (!gate) return { goal, board, error: 'plan gate returned nothing', written: false }

  // Fresh-seed loud guard: decompose produced cards but the gate left nothing active (dropped them all, or
  // seed failed). Bail clearly rather than entering the loop and reporting "board cleared" as success.
  if ((gate.activeRemaining ?? 0) <= 0) {
    return {
      goal,
      board,
      project: plan.project,
      error: 'Plan gate left 0 active cards after seeding — nothing to execute. Inspect the gate adjustments.',
      adjustments: gate.adjustments,
      written: true,
    }
  }
}

// Resume-safe locals: on resume there is no plan/gate, so fall back to the probe.
const project = plan?.project ?? probe.project ?? 'Eatahorse'
const cardsSeeded = plan?.cards?.length ?? 0

// Plan-only (default): stop here. The board is written; nothing was executed. (On resume the board already
// existed; planReady/adjustments come from the gate only on the fresh path.) verifyOnly skips this — it does
// no execute loop but MUST reach the Verify-equivalence phase below.
if (!execute && !verifyOnly) {
  return {
    goal,
    board,
    project,
    cardsSeeded,
    resumed: resume,
    planReady: gate?.ready ?? null,
    adjustments: gate?.adjustments ?? [],
    activeRemaining: gate?.activeRemaining ?? probe.active,
    executed: false,
    portMode: PORT_MODE,
    grounding: grounding || undefined,
    written: true, // the board exists on disk
  }
}

// 4 + 5. Execute (Ralph loop) + Verify (completion gate). Only reached with execute:true.
//    Each iteration: a FRESH-CONTEXT Sonnet worker reads the board, takes exactly ONE bite (does the real
//    work), checks that bite, syncs, and reports the live count. When a card reaches done, an Opus
//    completion gate verifies the acceptance against real evidence and REOPENS it if unsupported (the gate
//    owns the reopen + re-counts, so the loop always trusts a freshly measured activeRemaining).
//    Termination: board clear (active==0) OR stall (no progress N times) OR iteration cap OR budget floor.
const STALL_CAP = 3
let active = (gate?.activeRemaining ?? probe.active) ?? 1
let stall = 0
let iter = 0
const completed = []
const blocked = []
const trace = []

phase('Execute')
while (
  !verifyOnly && // EH-PORT-20: verifyOnly never re-ports; it falls straight through to Verify-equivalence
  active > 0 &&
  stall < STALL_CAP &&
  iter < maxIterations &&
  tokensLeft() > budgetFloor
) {
  iter++
  const step = await agent(
    `You are a single unattended work iteration on the Eatahorse board at "${board}". Do EXACTLY this:\n` +
      `1. \`next --json\` to get the highest-priority active card. If none, set taskId "" and ` +
      `activeRemaining 0 and return.\n` +
      `2. If that card is not already in "doing", \`move <id> doing\` (keep at most ~2 in doing).\n` +
      `3. Take EXACTLY ONE bite: the next unchecked bite. ACTUALLY DO THE WORK it describes ` +
      `(edit code/files, run the needed command). Then \`bite <id> <index> --done\`. If you genuinely ` +
      `cannot make progress (missing input, external blocker), \`move <id> blocked\`, set blocked=true, ` +
      `and structure note as "attempted: <what you tried> | blocker: <what stops it> | unlock: <what input ` +
      `would unblock it>" — do NOT fake progress.\n` +
      `4. If, after this bite, every bite AND every acceptance check for the card is satisfied by REAL ` +
      `evidence, check the remaining acceptance items (\`bite <id> <i> --group acceptance --done\`) so the ` +
      `card auto-completes on sync. Only check acceptance you can actually back up.\n` +
      // Residual escape: an acceptance item that ONLY a live runtime can prove (GUI invoke roundtrip, real
      // device, paid API) is impossible to verify in this headless sandbox. Without an escape the worker
      // retries it forever (card never completes -> loop re-hands it) until the harness kills it. Let it
      // record the impossible check as a residual and move on. Gate scrutinizes; invariants stay hard.
      `4b. If an acceptance item can ONLY be proven by a live runtime/GUI/device/network this headless ` +
      `sandbox cannot exercise (e.g. a live GUI \`invoke()\` roundtrip, a real device, a paid API), do NOT ` +
      `retry it. Verify everything headless-checkable for that item, then append one line ` +
      `\`residual: <the manual check a human must run, AND the concrete reason it is impossible here>\` ` +
      `under the card's \`## Notes\` (\`show <id> --json\` gives the card's file path; edit the markdown, ` +
      `then \`sync\`), and check the item so the card can auto-complete. Residual is ONLY for ` +
      `environmentally-impossible checks — never for work you ran out of budget for or could not get ` +
      `working. If the headless portion itself fails, leave it unchecked or block the card; do not residual it.\n` +
      `5. \`sync\`, then \`report --json\`.\n` +
      `Return the step: taskId, a one-line action, progressed (did the board move forward), completed (did ` +
      `this card reach done), blocked, activeRemaining (report's "active"), and a short note with evidence.\n\n` +
      // loop worker takes one bite: next/move/bite + sync/report. show is for the residual Notes edit (4b).
      `${cli('next', 'move', 'show', 'bite', 'sync', 'report')}` +
      PORT_RULE +
      INVARIANTS,
    { label: `bite:${iter}`, phase: 'Execute', model: workerModel, schema: STEP_SCHEMA },
  )
  if (!step) {
    stall++
    trace.push({ iter, taskId: '', action: 'worker returned nothing', progressed: false })
    continue
  }
  trace.push({ iter, taskId: step.taskId, action: step.action, progressed: step.progressed, completed: step.completed, blocked: step.blocked })
  if (step.blocked && step.taskId) blocked.push(step.taskId)

  if (step.completed && step.taskId) {
    // Completion gate — Opus, fresh context. Verify acceptance against real evidence; reopen if unsupported.
    const v = await agent(
      `A worker just marked card ${step.taskId} DONE on the Eatahorse board at "${board}". Independently ` +
        `verify it. \`show ${step.taskId} --json\` and check each acceptance item against REAL evidence ` +
        `(run the proving command, inspect the file/behavior — do not trust the checkbox). An acceptance ` +
        `item whose ONLY remaining gap is an environment-impossible live check that carries a \`residual:\` ` +
        `note (in the card's Notes) naming a CONCRETE environmental reason, and whose headless-verifiable ` +
        `portion you confirmed, counts as supported — do NOT reopen solely for it. But REOPEN if that ` +
        `residual check is actually runnable headless (the worker dodged real work), it names no concrete ` +
        `environmental reason, or any invariant below was regressed. ALSO check the ` +
        `board invariants below: the bite must not have regressed any of them — if an invariant names a ` +
        `runnable command, run it. If every acceptance check is genuinely met AND no invariant was ` +
        `violated, leave it done and set supported=true. If acceptance is unmet OR an invariant was ` +
        `regressed, reopen it in one atomic step: \`reopen ${step.taskId} --gap "<what's missing or which ` +
        `invariant regressed>"\` — that unchecks the acceptance, appends the gap as a bite, and moves the ` +
        `card to doing (doneness derives from acceptance, so there is no ordering footgun). Set ` +
        `supported=false. Then \`sync\` and \`report --json\`. Return ` +
        // completion gate verifies acceptance + invariants, may reopen: show + the atomic reopen verb, then sync/report.
        // ponytail: per-card invariant check is best-effort — the gate runs a NAMED command but won't run a
        // full test suite on every card. If invariants need a heavy suite, the upgrade is a dedicated final
        // "invariants green" card in the plan, not a suite run per completion.
        `supported, a short reason, and activeRemaining (report's "active") AFTER any reopen.\n\n${cli('show', 'reopen', 'sync', 'report')}` +
        INVARIANTS,
      { label: `verify:${step.taskId}`, phase: 'Verify', schema: VERIFY_SCHEMA },
    )
    if (v) {
      active = v.activeRemaining
      if (v.supported) {
        completed.push(step.taskId)
        stall = 0
      } else {
        // Progress was undone on purpose; keep looping (don't count it as a stall).
        stall = 0
      }
      continue
    }
    // verify gate died: fall through to the worker's own count.
  }

  active = step.activeRemaining
  stall = step.progressed ? 0 : stall + 1
}

// 5b. Verify-equivalence (EH-PORT-15) — opt-in, PORT MODE only. A heavier, SEPARATE gate than the per-card
//     completion check: per ported unit, drive the SOURCE as an oracle and the TARGET differentially via
//     diff_test.py, write the graded `equivalence` record into the card's Notes, and REOPEN the card on any
//     counterexample so the divergence becomes the next bite. Kept out of the completion gate because it
//     needs both toolchains + an oracle into the source runtime live in the sandbox. Fans out over the done
//     port cards (parallel — each unit is independent). counterexamples>0 => reopened => not admitted done.
const equivalence = []
let reopenedByEquiv = 0
if (verifyEquivalence) {
  phase('Verify-equivalence')
  const doneCards = await agent(
    `List the Eatahorse port cards at "${board}" that are DONE and carry a source back-link. Run ` +
      `\`list --status done --json\`; return ONLY the cards whose external_ids has a "source" key, as ` +
      `[{taskId, source}] (source = external_ids.source).\n\n${cli('list')}`,
    { label: 'equiv-list', model: 'haiku', schema: {
      type: 'object', additionalProperties: false, required: ['cards'],
      properties: { cards: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['taskId', 'source'],
        properties: { taskId: { type: 'string' }, source: { type: 'string' } } } } },
    } },
  )
  const targets = (doneCards?.cards ?? []).filter((c) => c && c.taskId && c.source)
  if (!targets.length) {
    log('Verify-equivalence: no done port cards with a source back-link; nothing to verify.')
  } else {
    const results = await parallel(
      targets.map((c) => () =>
        agent(
          `Differentially verify the PORT of source unit "${c.source}" (card ${c.taskId}) on the board at ` +
            `"${board}". You have the differential harness diff_test.py at "${harnessPath}".\n` +
            `1. From the inventory "${grounding}", read this unit's apiSurface to derive a primitive ` +
            `argument SIGNATURE (comma-separated, e.g. int,str,list[int]). If the surface is not expressible ` +
            `in primitives, treat method as "manual".\n` +
            `2. Build the two runners (each READS a JSON args list on stdin, WRITES a JSON result on stdout): ` +
            `${srcRunner ? `source from template \`${srcRunner}\`` : 'the SOURCE unit as oracle'}; ` +
            `${tgtRunner ? `target from template \`${tgtRunner}\`` : 'the ported TARGET unit'}. Substitute this ` +
            `unit's path/symbol into the template. If you cannot build a runnable oracle, set method "manual".\n` +
            `3. If you have both runners, run: \`python3 "${harnessPath}" --source-cmd "<src>" --target-cmd ` +
            `"<tgt>" --signature "<sig>" --cases 1000\`. It prints an equivalence JSON and exits nonzero on ` +
            `divergence.\n` +
            `4. Write that JSON (or, for a manual check, a hand-built record with the same fields) as a fenced ` +
            "```json block under the card's `## Notes` (show " + c.taskId + " --json for its file path; edit " +
            `the markdown, then \`sync\`). Lead the block with a line \`equivalence:\`.\n` +
            `5. If counterexamples > 0, REOPEN the card so the divergence is fixed next: ` +
            `\`reopen ${c.taskId} --gap "diverges on input <x>: src=<a> tgt=<b>"\` using a concrete sample.\n` +
            `Return taskId, method, cases (inputs tested), counterexamples, coverage (or null), confidence, ` +
            `reopened, and a short note.\n\n` +
            `${cli('show', 'reopen', 'sync')}`,
          { label: `equiv:${c.taskId}`, phase: 'Verify-equivalence', schema: EQUIV_SCHEMA },
        ),
      ),
    )
    for (const r of results.filter(Boolean)) equivalence.push(r)
    const diverged = equivalence.filter((r) => r.counterexamples > 0).length
    // Count cards actually REOPENED (the board mutation), not merely diverged: an agent can report a
    // counterexample yet fail/decline to reopen, and only reopened cards are active again.
    reopenedByEquiv = equivalence.filter((r) => r.reopened).length
    log(
      `Verify-equivalence: ${equivalence.length} unit(s) checked, ${diverged} diverged, ` +
        `${reopenedByEquiv} reopened.`,
    )
    // Reopened cards are active again, but the Execute loop already exited — they are NOT re-ported this
    // run. Reflect them in the final count and warn so the user runs a resume/verify pass to fix them.
    if (reopenedByEquiv) {
      active += reopenedByEquiv
      log(
        `Verify-equivalence reopened ${reopenedByEquiv} card(s) AFTER the work loop ended — they are not ` +
          `re-ported here. Resume the board (or rerun verifyEquivalence) to close the divergences.`,
      )
    }
  }
}

// Computed AFTER verify-equivalence so it reflects the post-reopen `active` (a reopened card means the
// board is no longer "cleared"). Used by write-back and the final return.
const stopReason = verifyOnly
  ? 'verify-only'
  : active <= 0
    ? 'board cleared'
    : stall >= STALL_CAP
    ? 'stalled (no progress)'
    : iter >= maxIterations
    ? 'iteration cap'
    : 'budget floor'

// 6. Write-back — Sonnet (last stage, nothing propagates; model-routing.md). Append run learnings and, as
//    first-class constraints, the reasons any card is blocked, so a rerun does not re-walk the dead ends.
phase('Write-back')
await agent(
  `An unattended Eatahorse run just finished on the board at "${board}". Write back what's durable so a ` +
    `future session/run benefits. Steps:\n` +
    `1. \`report --json\` and \`list --json\` to see final state.\n` +
    `2. Append a dated, concise section to the project's CLAUDE.md (create it if absent; merge, do NOT ` +
    `clobber): the goal, what was completed, what remains, the board invariants this run honored (so a ` +
    `rerun keeps honoring them), and — most important — the REASON each blocked card is blocked (treat ` +
    `these as constraints so the next run skips the dead end). Keep it short; do not document the obvious ` +
    `file tree.\n` +
    `3. Scan every card's \`## Notes\` for \`residual:\` lines (\`show <id>\` per card) and write a dated ` +
    `"Manual verification residuals" section into that CLAUDE.md — the exact live checks a human must ` +
    `spot-check in a real runtime (the consolidated spot-check queue). Omit the section if there are none.\n` +
    `4. Do not change any task status. Reporting only.\n\n` +
    `Run summary: goal="${goal}"; iterations=${iter}; completed=${JSON.stringify(completed)}; ` +
    // write-back reads final state + Notes: report/list/show. No mutations.
    `blocked=${JSON.stringify(blocked)}; constraints=${JSON.stringify(constraints)}; stopReason="${stopReason}".\n\n${cli('report', 'list', 'show')}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  goal,
  board,
  project,
  cardsSeeded,
  resumed: resume && !verifyOnly, // verifyOnly takes precedence over resume; it ports nothing
  verifyOnly,
  planReady: gate?.ready ?? null,
  executed: execute && !verifyOnly, // verifyOnly ran no port work; it only verified existing done cards
  portMode: PORT_MODE,
  grounding: grounding || undefined,
  iterations: iter,
  completed,
  blocked,
  activeRemaining: active,
  stopReason,
  trace,
  equivalence: verifyEquivalence ? equivalence : undefined,
  equivalenceReopened: verifyEquivalence ? reopenedByEquiv : undefined,
  written: true,
}
