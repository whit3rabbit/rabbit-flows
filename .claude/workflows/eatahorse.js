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
    'Decompose a goal into an Eatahorse Kanban board and gate the plan; optionally work it unattended one bite at a time in a Ralph-style loop, a fresh-context completion-gated worker each iteration, then write back the decisions.',
  phases: [
    { title: 'Probe' },
    { title: 'Decompose' },
    { title: 'Seed' },
    { title: 'Plan-gate' },
    { title: 'Execute' },
    { title: 'Verify' },
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
// Default to the bundled skill copy (works when run in this repo / after npx install into .claude). The
// worker is told to `find` it if the default is absent, so a relocated install still resolves.
const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
const maxIterations = Math.min(args?.maxIterations ?? 40, 200)
const workerModel = args?.workerModel ?? 'sonnet'
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
  add:     `add "<title>" [--priority P0..P3] [--status s] [-d "<desc>"] [--bite "<s>"].. [--accept "<c>"]..`,
  init:    `init "<project>" [--goal "<g>"]  (errors if a board exists)`,
  remove:  `remove <id> [--purge]`,
  sync:    `sync  (reconcile cards <-> state.json + board.md; run after edits)`,
}
// `done` CLI command omitted on purpose: no prompt uses it (agents tick acceptance + let sync auto-complete).
const cli = (...k) => CLI_HEAD + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
const CARD_RULE = `Card model: each card = one outcome / next 1-3 bites / what proves it done. Keep <=2 cards in "doing".`

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

// Existing board with nothing active = the collision trap (complete or foreign board). Fail LOUD instead
// of sweeping into the loop and reporting "board cleared" as if the run succeeded.
if (probe && probe.exists && probe.active <= 0) {
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
if (resume) {
  // Existing board mid-flight: skip decompose/seed/plan-gate and work the cards already on it.
  log(`Resuming board "${board}": ${probe.active} active card(s). Skipping decompose/seed/plan-gate.`)
} else {
  // 1. Decompose — Opus (sets the trajectory). Goal -> outcome-oriented cards with small bites + checkable
  //    acceptance. Returns STRUCTURED cards; the mechanical CLI writes happen in Seed (cheap), not here.
  phase('Decompose')
  plan = await agent(
    `Break this goal into a small set of outcome-oriented task cards for a one-bite-at-a-time Kanban board.\n` +
      `Goal: ${goal}\n\n` +
      `Rules: each card targets ONE meaningful outcome (not a trivial command); give it 1-3 small executable ` +
      `bites (the next concrete steps) and 1-3 acceptance checks that concretely PROVE the card is done ` +
      `(a command that passes, a file that exists, an observable behavior — not "looks good"). Order by ` +
      `priority (P0 highest). Prefer fewer, well-scoped cards; if a card would need a long checklist, split it. ` +
      `Return a short project name and the cards.`,
    { label: 'decompose', schema: CARDS_SCHEMA },
  )
  if (!plan?.cards?.length) return { goal, board, error: 'decompose produced no cards', written: false }

  // 2. Seed — Haiku (mechanical). One agent creates the board (probe proved it's absent) and adds every card.
  //    Deterministic mapping from the decompose JSON; no judgment, so cheapest model.
  phase('Seed')
  await agent(
    `Create an Eatahorse board and seed it with the cards below. Use EXACTLY the board dir "${board}" for ` +
      `every command — do NOT invent, switch to, or improvise a different dir even if one already exists. ` +
      `Steps:\n` +
      `1. Create the board: run ` +
      `\`python3 "${scriptPath}" --board "${board}" init "${(plan.project || 'Eatahorse Project').replace(/"/g, "'")}" --goal "${goal.replace(/"/g, "'")}"\`. ` +
      `If it reports the board already exists, skip this step (do not --force).\n` +
      `2. For EACH card below, run one \`add\` with --priority, -d (description), a --bite per bite, and a ` +
      `--accept per acceptance check. Put the highest-priority card(s) in --status ready, the rest backlog.\n` +
      `3. Run \`sync\`, then \`report --json\` and report the resulting counts.\n` +
      // seed only creates cards: init/add + sync/report (+ CARD_RULE for well-shaped cards). The init line
      // is spelled out WITH --board so a cheap agent can't drop the flag (which would let resolve_board walk
      // up to a parent board, diverging from where add/report write).
      `Do NOT start working any task. Only create cards.\n\n${cli('report', 'init', 'add', 'sync')}\n${CARD_RULE}\n\n` +
      `Cards (JSON):\n${JSON.stringify(plan.cards)}`,
    { label: 'seed', model: 'haiku' },
  )

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
      `passing it, since a card with no real acceptance auto-completes on a single check with nothing proving it. Then run \`sync\` ` +
      `and \`report --json\`. Return: ready (is the plan coherent enough to execute), the adjustments you ` +
      // plan-gate inspects + edits in place: list/show to read, remove/addbite/add to fix, sync/report.
      `applied, and activeRemaining (the report's "active" count).\n\n${cli('list', 'show', 'remove', 'addbite', 'add', 'sync', 'report')}\n${CARD_RULE}`,
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
// existed; planReady/adjustments come from the gate only on the fresh path.)
if (!execute) {
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
      `and explain in note — do NOT fake progress.\n` +
      `4. If, after this bite, every bite AND every acceptance check for the card is satisfied by REAL ` +
      `evidence, check the remaining acceptance items (\`bite <id> <i> --group acceptance --done\`) so the ` +
      `card auto-completes on sync. Only check acceptance you can actually back up.\n` +
      `5. \`sync\`, then \`report --json\`.\n` +
      `Return the step: taskId, a one-line action, progressed (did the board move forward), completed (did ` +
      `this card reach done), blocked, activeRemaining (report's "active"), and a short note with evidence.\n\n` +
      // loop worker takes one bite: next/move/bite + sync/report. No card-creation commands needed.
      `${cli('next', 'move', 'bite', 'sync', 'report')}`,
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
        `(run the proving command, inspect the file/behavior — do not trust the checkbox). If every ` +
        `acceptance check is genuinely met, leave it done and set supported=true. If NOT, reopen it in one ` +
        `atomic step: \`reopen ${step.taskId} --gap "<what's missing>"\` — that unchecks the acceptance, ` +
        `appends the gap as a bite, and moves the card to doing (doneness derives from acceptance, so there ` +
        `is no ordering footgun). Set supported=false. Then \`sync\` and \`report --json\`. Return ` +
        // completion gate verifies + may reopen: show + the atomic reopen verb, then sync/report.
        `supported, a short reason, and activeRemaining (report's "active") AFTER any reopen.\n\n${cli('show', 'reopen', 'sync', 'report')}`,
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

const stopReason =
  active <= 0
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
    `clobber): the goal, what was completed, what remains, and — most important — the REASON each blocked ` +
    `card is blocked (treat these as constraints so the next run skips the dead end). Keep it short; do not ` +
    `document the obvious file tree.\n` +
    `3. Do not change any task status. Reporting only.\n\n` +
    `Run summary: goal="${goal}"; iterations=${iter}; completed=${JSON.stringify(completed)}; ` +
    // write-back only reads final state: report/list. No mutations.
    `blocked=${JSON.stringify(blocked)}; stopReason="${stopReason}".\n\n${cli('report', 'list')}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  goal,
  board,
  project,
  cardsSeeded,
  resumed: resume,
  planReady: gate?.ready ?? null,
  executed: true,
  iterations: iter,
  completed,
  blocked,
  activeRemaining: active,
  stopReason,
  trace,
  written: true,
}
