// eatahorse-plan — decompose a goal into an Eatahorse Kanban board and gate the plan.
//
// Phase 1 of the two-phase eatahorse system. Builds a durable board from a goal,
// seeds outcome-oriented cards, and validates them through an admission gate. Does
// NOT execute any work — that is eatahorse-execute.
//
// If the board already exists with active cards (resume), the workflow returns the
// probe state without re-planning.
//
// The optional `inventory` arg points at JSON from map_codebase.py. When set, the
// decompose agent reads it as grounding context for richer task decomposition (file
// listing, dependency hints, exported interfaces). NOT the old grounded/port mode —
// just structured context for the planner.
//
// Knobs (args):
//   goal          the objective to break down (also accepts a bare string)
//   board         board dir (default ".eatahorse-<slug-of-goal>")
//   scriptPath    path to eatahorse.py (default the bundled skill copy)
//   constraints   board invariants/boundaries (string or string[])
//   inventory     path to map_codebase.py JSON output (optional grounding context)
//   resume        board dir to resume (alias for board) — auto-detected via probe
//
// requires-skills: eatahorse
//   (Bundling only — the installer copies the eatahorse skill alongside this workflow
//    so the CLI script travels with it.)
//
// Run with /eatahorse --plan, the `eatahorse` skill, or copy via npx.
export const meta = {
  name: 'eatahorse-plan',
  description:
    'Decompose a goal into a Kanban board of small tasks and gate the plan for soundness.',
  whenToUse:
    'Use to decompose a goal into a ready-to-execute Kanban board. Runs decompose -> seed -> plan-gate.',
  phases: [
    { title: 'Probe' },
    { title: 'Decompose' },
    { title: 'Seed' },
    { title: 'Plan-gate' },
  ],
}

// Decompose output: outcome-oriented cards with small bites + testable acceptance.
const CARDS_SCHEMA = {
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
          priority: { enum: ['P0', 'P1', 'P2', 'P3'] },
          bites: { type: 'array', minItems: 1, items: { type: 'string' } },
          acceptance: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
  },
}

// Plan gate reports live board state for the caller to inspect.
const PLAN_GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'adjustments', 'activeRemaining'],
  properties: {
    ready: { type: 'boolean' },
    adjustments: { type: 'array', items: { type: 'string' } },
    activeRemaining: { type: 'integer' },
  },
}

// Seed result: just the report counts after seeding.
const SEED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['seeded', 'active'],
  properties: {
    seeded: { type: 'integer' },
    active: { type: 'integer' },
  },
}

// Probe: does the board exist, how many active cards, project name.
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

// ---- args ----
const goal =
  typeof args === 'string'
    ? args
    : args?.goal ?? 'Describe a goal to break into bite-sized tasks. (Pass args.goal.)'
const slugify = (s) =>
  (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'board')
const board = args?.board ?? '.eatahorse-' + slugify(goal)

// Pre-compute safe-quoted versions to avoid .replace(/"/g, "'") inside template literals,
// which confuses the heuristic parser's ${} expression tracking (/"/g regex " looks like a string opener).
const _sq = (s) => String(s).replace(/"/g, "'")

// Stringified-args guard — same check as the main eatahorse.js workflow.
const _argKeys =
  /\b(goal|execute|board|constraints|root|question|outDir|brief|framework|targetLang|targetDir|grounding|maxIterations|maxTokens|budgetFloor|workerModel|preserveApi|testCmd|inventory)["']?\s*[:=]/gi
const _keyHits = [...new Set([...String(goal).matchAll(_argKeys)].map((m) => m[1].toLowerCase()))]
if (/^\s*['"{]*\s*(goal|root)["']?\s*[:=]/i.test(goal) || _keyHits.length >= 2) {
  return {
    goal,
    board,
    written: false,
    error:
      `args appear stringified: \`goal\` carries argument keys (${_keyHits.join(', ')}). Pass a STRUCTURED ` +
      `object, not one string blob: Workflow({name:"eatahorse-plan", args:{goal:"<task>", board:".eatahorse-<topic>"}}). ` +
      `board/constraints/inventory were dropped.`,
  }
}

const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
const normList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean)
const constraints = normList(args?.constraints)
const inventory = args?.inventory ?? '' // optional path to map_codebase.py JSON

// eatahorse.py is bundled with the eatahorse skill; agents shell out to it IN PLACE. The script can't
// read the filesystem, so it can't know where the install put eatahorse.py: the dev repo has it at
// plugins/..., an npx project-scope install at .claude/skills/..., a user-scope install at
// ~/.claude/skills/.... A single hardcoded path is wrong in installed targets, which made agents COPY
// eatahorse.py into the project to satisfy it (a stray script in the repo). Instead, every Bash call
// re-runs `eatahorseResolve` first (shell state does NOT persist between Bash tool calls, so it must be
// chained into the same invocation as the real command each time): it probes the candidate locations,
// sets $EH to the first that exists, and NEVER copies the script. scriptPath (override + dev path) is
// the first candidate, so an explicit arg or a dev-repo run still wins. Mirrors reconResolve in
// security-audit.js.
const eatahorseResolve =
  `EH=""; for c in "${scriptPath}" ".claude/skills/eatahorse/scripts/eatahorse.py" "$HOME/.claude/skills/eatahorse/scripts/eatahorse.py"; do [ -f "$c" ] && EH="$c" && break; done\n` +
  `[ -z "$EH" ] && EH=$(find . -maxdepth 6 -name eatahorse.py -path '*eatahorse*' 2>/dev/null | head -1)\n` +
  `PY=python3\n` +
  `# eatahorse.py is READ-ONLY tooling: run it IN PLACE from "$EH" — never copy, move, or recreate it in the project.`

// Inline CLI contract (runtime source of truth).
const CLI_HEAD =
  `Eatahorse CLI (stdlib python, no deps). Locate eatahorse.py IN PLACE (do NOT copy it anywhere) by chaining ` +
  `this prelude into the SAME Bash call as every command below (shell state does not persist between ` +
  `calls):\n${eatahorseResolve}\nThen run: "$PY" "$EH" --board "${board}" <cmd>.`
const CMD = {
  report:  `report --json -> {counts, active, done}`,
  init:    `init "<project>" [--goal "<g>"]  (errors if board exists)`,
  add:     `add "<title>" [--priority P0..P3] [--status s] [-d "<desc>"] [--bite "<s>"].. [--accept "<c>"]..`,
  list:    `list [--status s] [--json] -> cards (id,title,status)`,
  show:    `show <id> [--json]`,
  remove:  `remove <id> [--purge]`,
  addbite: `add-bite <id> "<text>" [--group bites|acceptance]`,
  sync:    `sync  (reconcile cards <-> state.json + board.md; run after edits)`,
}
const cli = (...k) => CLI_HEAD + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
// Same command menu WITHOUT the CLI_HEAD preamble (which re-embeds eatahorseResolve) — for prompts
// that already interpolated ${eatahorseResolve} explicitly above, so the prelude isn't duplicated.
const cmdMenu = (...k) => `Commands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
const CARD_RULE = `Card model: each card = one outcome / next 1-3 bites / what proves it done. Keep <=2 cards in "doing".`

// If inventory is set, inject a reference into the decompose prompt.
const INVENTORY_CONTEXT = inventory
  ? `\n\nThe codebase inventory at "${inventory}" is available for context. Read it (e.g. \`cat "${inventory}"\`) to ` +
    `understand the file structure, imports, and exports. Use this to plan better cards — but you are NOT limited ` +
    `to one card per file. The inventory is grounding context, not a template.`
  : ''

// Built once, injected into decompose/gate prompts. Empty string when no constraints.
const INVARIANTS = constraints.length
  ? `\n\nBoard invariants — must NOT regress (boundaries + constraints): ` +
    constraints.map((c, i) => `${i + 1}. ${c}`).join('  ') +
    ` If an invariant names a runnable command, that command staying green is part of "done".`
  : ''

// ---- phases ----

// 0. Probe — Haiku (mechanical, read-only). Check the board dir before decomposing.
phase('Probe')
const probe = await agent(
  `Probe an Eatahorse board dir, READ-ONLY. Run exactly this via Bash:\n${eatahorseResolve}\n` +
    `"$PY" "$EH" --board "${board}" report --json\n` +
    `If it ERRORS (no board there yet), return exists=false, active=0, project="". Otherwise return ` +
    `exists=true, active = the report's "active" count, and project = the board's project name. Do NOT ` +
    `create or modify anything.\n\n${cmdMenu('report')}`,
  { label: 'probe', model: 'haiku', schema: PROBE_SCHEMA },
)

if (!probe) {
  return {
    goal, board,
    error: 'Probe agent returned nothing; cannot determine whether a board already exists.',
    written: false,
  }
}

// Resume: existing board with active cards — skip decompose/seed/plan-gate.
if (probe.exists && probe.active > 0) {
  log(`Resuming board "${board}": ${probe.active} active card(s). Skipping decompose/seed/plan-gate.`)
  return {
    goal, board,
    project: probe.project,
    resumed: true,
    activeRemaining: probe.active,
    written: true,
  }
}

// Collision trap: board exists but has 0 active cards.
if (probe.exists && probe.active <= 0) {
  return {
    goal, board,
    error:
      `Board at "${board}" exists but has 0 active cards (project="${probe.project}"). It is complete or ` +
      `belongs to another goal. Pass a fresh args.board (convention: .eatahorse-<topic>) or remove the stale board.`,
    written: false,
  }
}

// 1. Decompose — Opus (sets the trajectory). Goal -> outcome-oriented cards.
phase('Decompose')
const plan = await agent(
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
    INVENTORY_CONTEXT +
    INVARIANTS,
  { label: 'decompose', schema: CARDS_SCHEMA, model: 'opus' },
)

if (!plan?.cards?.length) {
  return {
    goal, board,
    error: 'decompose produced no cards',
    written: false,
  }
}

// 2. Seed — Haiku (mechanical). Create the board and add every card.
phase('Seed')
const seedResult = await agent(
  `Create an Eatahorse board and seed it with the cards below. Locate eatahorse.py IN PLACE (do NOT copy it ` +
    `anywhere) — before EVERY command below, chain this prelude into the SAME Bash call (shell state does not ` +
    `persist between calls):\n${eatahorseResolve}\n\n` +
    `Use EXACTLY the board dir "${board}" for ` +
    `every command — do NOT invent, switch to, or improvise a different dir even if one already exists. ` +
    `Steps:\n` +
    `1. Create the board: run ` +
    `\`"$PY" "$EH" --board "${board}" init "${_sq(plan.project || 'Eatahorse Project')}" --goal "${_sq(goal)}"\` ` +
    `(prefixed with the prelude above). ` +
    `If it reports the board already exists, skip this step (do not --force).\n` +
    `2. For EACH card below, run one \`add\` with --priority, -d (description), a --bite per bite, and a ` +
    `--accept per acceptance check. Put the highest-priority card(s) (lowest priority number, e.g. P0) in ` +
    `--status ready, the rest backlog.\n` +
    `3. Run \`sync\`, then \`report --json\` and report the seeded count + active count.\n` +
    `Do NOT start working any task. Only create cards.\n\n${cmdMenu('report', 'init', 'add', 'list', 'sync')}\n${CARD_RULE}\n\n` +
    `Cards (JSON):\n${JSON.stringify(plan.cards)}`,
  { label: 'seed', model: 'haiku', schema: SEED_SCHEMA },
)

if (!seedResult) {
  return {
    goal, board,
    error: 'seed agent returned nothing',
    written: false,
  }
}
log(`Seeded ${seedResult.seeded} card(s), ${seedResult.active} active.`)

// 3. Plan-gate — Opus, FRESH context. Inspect the board, fix problems, approve.
phase('Plan-gate')
const gate = await agent(
  `You are a plan admission gate. Inspect the freshly seeded Eatahorse board at "${board}" ` +
    `(\`list --json\`, \`show <id>\`, read board.md). For EACH card judge: is the outcome clear and ` +
    `independent, are the bites genuinely small, and is the acceptance CHECKABLE (a real, observable ` +
    `proof)? Fix problems IN PLACE via the CLI: split an overloaded card into smaller cards, drop a ` +
    `meaningless one (\`remove\`), or tighten bites/acceptance (\`add-bite\` / re-add). REJECT any card ` +
    `with no acceptance check (or only a vague/non-checkable one): add a concrete, observable one before ` +
    `passing it, since a card with no real acceptance auto-completes on a single check with nothing proving it. ` +
    `Also REJECT acceptance that does not NAME its evidence surface (a runnable command, an inspectable path, ` +
    `or a concrete observable): make it name one before passing. ` +
    `Then run \`sync\` ` +
    `and \`report --json\`. Return: ready (is the plan coherent enough to execute), the adjustments you ` +
    `applied, and activeRemaining (the report's "active" count).\n\n${cli('list', 'show', 'remove', 'addbite', 'add', 'sync', 'report')}\n${CARD_RULE}`,
  { label: 'plan-gate', schema: PLAN_GATE_SCHEMA, model: 'opus' },
)

if (!gate) {
  return { goal, board, error: 'plan gate returned nothing', written: false }
}

if ((gate.activeRemaining ?? 0) <= 0) {
  return {
    goal, board,
    project: plan.project,
    error: 'Plan gate left 0 active cards after seeding — nothing to execute.',
    adjustments: gate.adjustments,
    written: true,
  }
}

return {
  goal,
  board,
  project: plan.project,
  cardsSeeded: plan.cards.length,
  planReady: gate.ready,
  adjustments: gate.adjustments ?? [],
  activeRemaining: gate.activeRemaining,
  written: true,
}
