// eatahorse-execute — work an existing Eatahorse Kanban board one bite at a time.
//
// Phase 2 of the two-phase eatahorse system. Runs the Ralph loop: each iteration
// spawns a FRESH-CONTEXT worker that reads the durable board, takes exactly ONE
// bite (does real work: editing code, running commands), syncs, and reports state.
// When a card reaches done, an Opus completion gate verifies the acceptance against
// real evidence and reopens the card if unsupported. Writes back run learnings.
//
// The board MUST already exist with active cards (built by eatahorse-plan or seeded
// manually). The initial probe confirms this and bails if not.
//
// Knobs (args):
//   board          board dir to work (default ".eatahorse-board")
//   scriptPath     path to eatahorse.py (default the bundled skill copy)
//   maxIterations  hard loop cap (default 40)
//   maxTokens      per-run OUTPUT-token ceiling (default none)
//   budgetFloor    stop opening iterations below this many remaining tokens (default 50000)
//   workerModel    model for the execute loop workers (default "sonnet")
//   constraints    board invariants/boundaries that must NOT regress (string or string[])
//
// NOTED DEVIATIONS (per CLAUDE.md "Bending" — unexplained deviation is a bug):
//   1. Shared MUTABLE store. workflow-design.md says workers must not share a mutable
//      store. Here the .eatahorse board IS a shared mutable store — ALLOWED because the
//      loop runs workers STRICTLY SEQUENTIALLY, script-coordinated, against a durable
//      ledger. There is no concurrent write race and no agent-to-agent chatter; each
//      worker reads the committed board, makes one change, syncs, exits. (The eatahorse
//      hook no longer PostToolUse-syncs on board edits — that path was removed as a
//      single-writer hazard; only a Stop/SessionEnd sync remains, which the sequential
//      loop can't race. EATAHORSE_NO_AUTOSYNC=1 silences that too.)
//   2. The board DOUBLES as write-back (state survives the run in .eatahorse/). We still
//      run the CLAUDE.md finalize stage (memory.md) so cross-cutting decisions + blocked-task
//      reasons (first-class constraints) survive where a future session will read them.
//   3. The script has NO filesystem access (VM sandbox). ALL board I/O happens inside
//      agents via the eatahorse.py CLI (Bash). Loop termination relies on each worker's
//      RETURNED report (activeRemaining), not on the script reading the board directly.
//
// requires-skills: eatahorse
//
// Run with /eatahorse --execute, the `eatahorse` skill, or copy via npx.
export const meta = {
  name: 'eatahorse-execute',
  description:
    'Work an existing Eatahorse Kanban board one task at a time, verifying each task before moving on.',
  whenToUse:
    'Use after eatahorse-plan has seeded a board. Runs the execute loop, a Ralph-style loop, with a completion gate and write-back.',
  phases: [
    { title: 'Probe' },
    { title: 'Execute' },
    { title: 'Verify' },
    { title: 'Write-back' },
  ],
}

// Probe: does the board exist and have active cards?
const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['exists', 'active', 'project'],
  properties: {
    exists: { type: 'boolean' },
    active: { type: 'integer' },
    project: { type: 'string' },
  },
}

// Loop worker step: one bite taken.
const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'action', 'progressed', 'completed', 'blocked', 'activeRemaining', 'note'],
  properties: {
    taskId: { type: 'string' },
    action: { type: 'string' },
    progressed: { type: 'boolean' },
    completed: { type: 'boolean' },
    blocked: { type: 'boolean' },
    activeRemaining: { type: 'integer' },
    note: { type: 'string' },
  },
}

// Completion gate: verify acceptance against real evidence.
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supported', 'reason', 'activeRemaining'],
  properties: {
    supported: { type: 'boolean' },
    reason: { type: 'string' },
    activeRemaining: { type: 'integer' },
  },
}

// ---- args ----
const board = args?.board ?? '.eatahorse-board'
const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
const maxIterations = Math.min(args?.maxIterations ?? 40, 200)
const workerModel = args?.workerModel ?? 'sonnet'
const normList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean)
const constraints = normList(args?.constraints)
const maxTokens = args?.maxTokens ?? null
const budgetFloor = args?.budgetFloor ?? 50_000

const tokensLeft = () =>
  Math.min(budget.remaining(), maxTokens != null ? Math.max(0, maxTokens - budget.spent()) : Infinity)

// Inline CLI contract — sliced per agent.
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
  reopen:  `reopen <id> [--gap "<what's missing>"]  (atomic: uncheck acceptance + add gap bite + move doing)`,
  sync:    `sync  (reconcile cards <-> state.json + board.md; run after edits)`,
}
const cli = (...k) => CLI_HEAD + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
const CARD_RULE = `Card model: each card = one outcome / next 1-3 bites / what proves it done. Keep <=2 cards in "doing".`

const INVARIANTS = constraints.length
  ? `\n\nBoard invariants — must NOT regress (boundaries + constraints): ` +
    constraints.map((c, i) => `${i + 1}. ${c}`).join('  ') +
    ` If an invariant names a runnable command, that command staying green is part of "done".`
  : ''

// ---- phases ----

// 0. Probe — confirm the board exists and has active cards.
phase('Probe')
const probe = await agent(
  `Probe an Eatahorse board dir, READ-ONLY. Run \`python3 "${scriptPath}" --board "${board}" report --json\`. ` +
    `If it ERRORS (no board there yet), return exists=false, active=0, project="". Otherwise return ` +
    `exists=true, active = the report's "active" count, and project = the board's project name.\n\n${cli('report')}`,
  { label: 'probe', model: 'haiku', schema: PROBE_SCHEMA },
)

if (!probe || !probe.exists) {
  return {
    board,
    error: !probe
      ? 'Probe agent returned nothing.'
      : `Board at "${board}" does not exist. Run eatahorse-plan first, or pass an existing board dir.`,
    written: false,
  }
}

if (probe.active <= 0) {
  return {
    board,
    project: probe.project,
    error:
      `Board at "${board}" has 0 active cards (project="${probe.project}"). It is complete. ` +
      `Create a new plan first.`,
    written: false,
  }
}

log(`Working board "${board}": ${probe.active} active card(s).`)
if (maxIterations <= 0) {
  log(`maxIterations=${maxIterations} — no iterations will run. Set maxIterations > 0 to proceed.`)
}

// 1 + 2. Execute (Ralph loop) + Verify (completion gate).
//    Each iteration: a FRESH-CONTEXT Sonnet worker, one bite, sync, report.
//    When a card reaches done, an Opus completion gate verifies acceptance against
//    real evidence and REOPENS the card if unsupported.
const STALL_CAP = 3
let active = probe.active
let stall = 0
let iter = 0
const completed = []
const blocked = []
const trace = []

phase('Execute')
while (active > 0 && stall < STALL_CAP && iter < maxIterations && tokensLeft() > budgetFloor) {
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
      // retries it forever. Let it record the impossible check as a residual and move on.
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
      `${cli('next', 'move', 'show', 'bite', 'sync', 'report')}` +
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
    // Completion gate — Opus, fresh context. Verify acceptance against real evidence.
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
        `supported, a short reason, and activeRemaining (report's "active") AFTER any reopen.\n\n${cli('show', 'reopen', 'sync', 'report')}` +
        INVARIANTS,
      { label: `verify:${step.taskId}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' },
    )
    if (v) {
      active = v.activeRemaining
      if (v.supported) {
        completed.push(step.taskId)
        stall = 0
      } else {
        stall = 0  // Progress was undone on purpose; keep looping.
      }
      continue
    }
    // verify gate died: log the gap so tracking is not silently lost.
    log(`verify gate returned nothing for card ${step.taskId} — completion tracking gap.`)
    active = step.activeRemaining
    stall = step.progressed ? 0 : stall + 1
    continue
  }

  active = step.activeRemaining
  stall = step.progressed ? 0 : stall + 1
}

const stopReason =
  active <= 0
    ? 'board cleared'
    : stall >= STALL_CAP
    ? 'stalled (no progress)'
    : iter >= maxIterations
    ? 'iteration cap'
    : 'budget floor'

// 3. Write-back — Sonnet. Durable knowledge from the run.
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
    `Run summary: iterations=${iter}; completed=${JSON.stringify(completed)}; ` +
    `blocked=${JSON.stringify(blocked)}; constraints=${JSON.stringify(constraints)}; stopReason="${stopReason}".\n\n${cli('report', 'list', 'show')}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  board,
  project: probe.project,
  iterations: iter,
  completed,
  blocked,
  activeRemaining: active,
  stopReason,
  trace,
  written: true,
}
