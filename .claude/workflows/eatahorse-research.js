// eatahorse-research — research every file in a folder, using an Eatahorse board as a DURABLE,
//   RESUMABLE, cap-scaling ledger:
//     enumerate -> auto-pick scale -> seed/load cards -> [research rounds: parallel workers + one sync
//     + sampling gate, loop-until-dry] -> synthesize -> write-back.
//
// Why a workflow (not a conversation): coverage over a whole tree that outlives one context. The board
// records which files are done at ONE-CARD-PER-FILE resolution, so a re-run skips finished work and the
// per-file detail is never coarsened away — the way past BOTH runtime ceilings (the 1000-agents/run
// lifetime cap and the session-scoped resume journal; see docs/WORKFLOW_ANALYSIS.md). The loop is the
// point: research a round, review it, loop back on the weak/missed units until dry.
//
// Caps, correctly (docs/WORKFLOW_ANALYSIS.md): concurrency is capped at ~16 (min(16, cores-2)), the
// LIFETIME cap is 1000 agents/run. parallel() of N items AUTO-QUEUES at the concurrency cap — you do NOT
// hand-batch to "fit" concurrency. We keep one card per file ALWAYS and instead cap LOAD: research <=
// LIVE_CAP files per round and <= RUN_TOUCH_CAP new files per run, so the per-run agent total (workers +
// one sync/round + gate sample + gather + synth) stays well under 1000. Files beyond the per-run cap stay
// in `backlog` on the durable board and carry to the next run — no coarsening, no lost resolution.
//
// NOTED DEVIATIONS (CLAUDE.md "Bending"):
//   1. Shared MUTABLE store (the board). Allowed because the WRITE DISCIPLINE removes the race: within a
//      round every worker edits ONLY its own card markdown file (distinct paths) and runs NO eatahorse CLI;
//      the ONLY writer of state.json/board.md is the single sync agent that runs alone after the round.
//      No concurrent state writes, no agent-to-agent chatter. The eatahorse hook no longer PostToolUse-syncs
//      (that path was removed as exactly this single-writer hazard); only a Stop/SessionEnd sync remains,
//      which a sequential phase can't race. EATAHORSE_NO_AUTOSYNC=1 silences that too if a run overlaps it.
//   2. Board DOUBLES as durable resume state. We still run the CLAUDE.md write-back (memory.md) for the
//      cross-cutting summary + skipped-file constraints.
//   3. Script has NO filesystem access (VM sandbox): enumeration, all board I/O, and the per-card markdown
//      edits happen INSIDE agents. The loop terminates on the sync agent's returned active count.
//
// PERMISSIONS: this workflow READS files and WRITES under the board dir + the output report + CLAUDE.md.
//   It does not modify the researched source files. Still runs under the session allowlist.
//
// Knobs (args): root (or bare string), question, include/exclude globs, board, workerModel (default haiku),
//   maxRounds (default 3), maxTokens (per-run OUTPUT-token ceiling, default none — independent of the
//   platform "+500k" turn directive; more restrictive of the two wins), budgetFloor (stop opening rounds
//   below this many remaining tokens, default 50000), out (report path), scriptPath (eatahorse.py).
//
// requires-skills: eatahorse
//   (Bundling only. The eatahorse CLI surface is distilled INLINE as CMD/cli() and sliced per-agent into the
//    agents that touch the board — that const is the runtime source of truth; the bundled skill is the
//    portable copy. Workflow stages do NOT auto-load skills. See .claude/rules/workflow-design.md.)
// Run with /workflows or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` flags the trailing top-level return as "illegal return" — expected; the runtime wraps the
//  script in an async function. Same as starter.js / scaffold.js / eatahorse.js.)
export const meta = {
  name: 'eatahorse-research',
  description:
    'Research every file in a folder and synthesize a cited report. Progress is tracked on a resumable board so large trees run in batches.',
  whenToUse:
    'Use to understand a folder file by file and get a cited report. Front door: the eatahorse skill.',
  phases: [
    { title: 'Enumerate' },
    { title: 'Seed' },
    { title: 'Research' },
    { title: 'Gate' },
    { title: 'Gather' },
    { title: 'Synthesize' },
    { title: 'Write-back' },
  ],
}

const ENUM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'total', 'truncated'],
  properties: {
    files: { type: 'array', items: { type: 'string' } }, // repo-relative paths
    total: { type: 'integer' },                          // true count found (may exceed files.length if truncated)
    truncated: { type: 'boolean' },                      // true if the list was capped
  },
}

const SEED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'mdPath', 'status'],
        properties: {
          title: { type: 'string' },  // = the unit path (file or dir)
          mdPath: { type: 'string' }, // path to the card markdown file under the board
          status: { type: 'string' }, // backlog|ready|doing|blocked|done|dropped
        },
      },
    },
  },
}

// Gather (durable read-back from the board): done-card ids, then compact notes distilled from each card's
// "## Notes". Synthesis runs on THESE, not on a per-run accumulator, so a resumed run sees the whole board.
const DONE_IDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ids'],
  properties: { ids: { type: 'array', items: { type: 'string' } } },
}

const GATHER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['where', 'evidence'],
        properties: {
          where: { type: 'string' },    // file:area the note is about
          evidence: { type: 'string' }, // the concrete observation
        },
      },
    },
  },
}

const SYNC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['activeRemaining', 'done'],
  properties: {
    activeRemaining: { type: 'integer' }, // report --json "active"
    done: { type: 'integer' },            // report --json "done"
  },
}

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hollow', 'checked'],
  properties: {
    hollow: { type: 'array', items: { type: 'string' } }, // unit titles whose notes are unsupported (reopened)
    checked: { type: 'integer' },                          // how many cards were sampled
  },
}

// ---- args ----
const root = typeof args === 'string' ? args : args?.root ?? '.'
const question = args?.question ?? 'Summarize what each file does and flag anything notable.'
const include = args?.include ?? '' // optional glob, e.g. "**/*.py"
const exclude = args?.exclude ?? '' // optional glob to drop
const board = args?.board ?? '.eatahorse-research'
const workerModel = args?.workerModel ?? 'haiku'
const maxRounds = Math.min(args?.maxRounds ?? 3, 10)
const out = args?.out ?? 'eatahorse-research.md'
const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
// Per-run OUTPUT-token ceiling, independent of the platform "+500k" turn directive (which args cannot
// set). null = no extra ceiling; the platform budget still applies. budgetFloor was the hardcoded floor.
const maxTokens = args?.maxTokens ?? null
const budgetFloor = args?.budgetFloor ?? 50_000
// Tokens left = min(platform budget remaining, our own maxTokens ceiling remaining). budget.remaining()
// is Infinity when no platform target is set; our ceiling bounds it. Most restrictive wins.
const tokensLeft = () =>
  Math.min(budget.remaining(), maxTokens ? Math.max(0, maxTokens - budget.spent()) : Infinity)

const LIVE_CAP = 400        // max files researched per ROUND; the rest stay in backlog and carry forward
const RUN_TOUCH_CAP = 700   // ponytail: per-RUN ceiling on distinct files researched; keeps workers+sync+gate+gather under the 1000-agent lifetime cap. rerun continues from backlog. raise if a run must cover more in one pass.
const ENUM_CAP = 5000       // hard cap on files we enumerate in one run
const MAX_ATTEMPTS = 2      // drop a unit after this many research rounds so a permanently-failing one (binary/unreadable) isn't re-run every round

// Sliced per-agent: cli(...) gives each board-touching prompt ONLY the commands its steps call. The
// research worker runs NO CLI — it gets CARD_MD (just the markdown layout).
// SIBLING COPY: eatahorse.js holds a fuller CMD (add-bite/remove/next/move); this copy is intentionally
// smaller (research only reads, reopens, and syncs). No runtime sharing (VM sandbox); keep overlapping CMD
// entries (notably `reopen`) consistent with eatahorse.js by hand when either changes.
const CLI_HEAD =
  `Eatahorse CLI (stdlib python, no deps): python3 "${scriptPath}" --board "${board}" <cmd>. ` +
  `If absent: find . -name eatahorse.py -path '*eatahorse*'.`
const CMD = {
  report: `report --json -> {counts, active, done}  (read "active" and "done")`,
  list:   `list [--status s] [--json] -> cards (id,title,status,path)`,
  show:   `show <id> [--json]`,
  init:   `init "<name>"  (errors if a board exists)`,
  add:    `add "<title>" --status backlog --bite "research it" --accept "notes recorded"`,
  reopen: `reopen <id> [--gap "<why hollow>"]  (atomic: uncheck acceptance + add gap bite + move doing)`,
  sync:   `sync  (reconcile cards <-> state.json + board.md; run after edits)`,
}
const cli = (...k) => CLI_HEAD + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
// Card layout only — for the research worker, which edits its own markdown and runs no command.
const CARD_MD =
  `Card markdown: a "## Notes" section + checkbox sections "## One-bite-at-a-time plan" and ` +
  `"## Acceptance checks" with "- [ ]"/"- [x]" items. Tick ALL boxes to auto-complete the card on sync.`

// 1. Enumerate — haiku, mechanical. List the files to research. Script can't touch the FS.
phase('Enumerate')
const enumed = await agent(
  `List the files to research under "${root}". Prefer \`git ls-files\` when "${root}" is in a git repo, ` +
    `else \`find\`. SKIP .git, node_modules, dist/build, vendored, lockfiles, and binary/media files ` +
    `(images, archives, fonts, compiled artifacts). ${include ? `INCLUDE only paths matching: ${include}. ` : ''}` +
    `${exclude ? `EXCLUDE paths matching: ${exclude}. ` : ''}` +
    `Return repo-relative paths. Cap the returned list at ${ENUM_CAP}; if more exist, set truncated=true and ` +
    `report the true total.`,
  { label: 'enumerate', model: 'haiku', schema: ENUM_SCHEMA },
)
const files = (enumed?.files ?? []).filter(Boolean)
if (!files.length) return { root, error: 'no files enumerated', written: false }
if (enumed.truncated) log(`enumerate: capped at ${files.length} of ${enumed.total} files; the rest are not covered this run`)

// 2. One card per file, ALWAYS. The board exists to track per-file done-ness; coarsening would throw that
//    away. Load is bounded by LIVE_CAP (per round) and RUN_TOUCH_CAP (per run) in the loop, not by merging
//    files into fewer cards — overflow stays in backlog and carries to the next run.
const granularity = 'one card per file'
const unitTitles = files
log(`scale: ${files.length} file(s) -> ${files.length} card(s) (${granularity}); LIVE_CAP=${LIVE_CAP}/round, RUN_TOUCH_CAP=${RUN_TOUCH_CAP}/run`)

// 3. Seed-or-load — haiku. Ensure the board + one card per unit (title = unit path). On resume, existing
//    done cards keep their status. Returns the card list so the script can address each worker's markdown.
phase('Seed')
const seed = await agent(
  `Ensure an Eatahorse board exists at "${board}" and holds one "backlog" card per unit title below. Steps:\n` +
    `1. \`report --json\`; if it errors (no board), \`init "Research: ${root.replace(/"/g, "'")}"\`.\n` +
    `2. \`list --json\` to see existing cards. For EACH unit title NOT already present as a card title, ` +
    `\`add "<title>" --status backlog --bite "research it" --accept "notes recorded"\`. Do NOT re-add titles ` +
    `that already exist, and do NOT change cards already marked done (this supports resume). All new cards go ` +
    `to backlog; the script pulls a capped batch into each round.\n` +
    `3. \`sync\`, then \`list --json\`. Return EVERY card as {title, mdPath (its "path" field), status}.\n` +
    // seed creates/loads cards: report/init/add + sync/list.
    `Do not research anything yet.\n\n${cli('report', 'init', 'add', 'sync', 'list')}\n\n` +
    `Unit titles (${unitTitles.length}):\n${JSON.stringify(unitTitles)}`,
  { label: 'seed', model: 'haiku', schema: SEED_SCHEMA },
)
if (!seed?.cards?.length) return { root, board, error: 'seed returned no cards', written: false }
const cardByTitle = new Map(seed.cards.map((c) => [c.title, c]))

// 4 + 5. Research rounds (loop-until-dry) + sampling gate. Workers edit ONLY their own card markdown and
//    run NO CLI; ONE sync agent per round is the sole state writer; the gate samples done cards and reopens
//    hollow ones. Each round researches at most LIVE_CAP files and the run touches at most RUN_TOUCH_CAP
//    distinct files; whatever is left in backlog at exit carries to the next run via the durable board.
const notDone = (c) => c.status !== 'done' && c.status !== 'dropped'
let pending = seed.cards.filter(notDone).map((c) => c.title) // carry queue: every not-done file (fresh run: all)
let round = 0
let activeRemaining = pending.length
const touched = new Set() // distinct files researched THIS run; bounded by RUN_TOUCH_CAP
const attempts = new Map() // title -> rounds attempted; bounds permanently-failing units
// Drop titles that have hit MAX_ATTEMPTS so a binary/unreadable unit doesn't burn an agent every round.
const keepRetryable = (titles) => {
  const giveUp = titles.filter((t) => (attempts.get(t) ?? 0) >= MAX_ATTEMPTS)
  if (giveUp.length) log(`dropping ${giveUp.length} unit(s) after ${MAX_ATTEMPTS} failed rounds: ${giveUp.join(', ')}`)
  return titles.filter((t) => (attempts.get(t) ?? 0) < MAX_ATTEMPTS)
}

phase('Research')
while (pending.length && round < maxRounds && tokensLeft() > budgetFloor) {
  // Per-round load cap. Already-touched files (gate-reopened or failed) re-research freely; only FRESH
  // backlog files grow `touched`, bounded by RUN_TOUCH_CAP. The whole round is capped at LIVE_CAP.
  const retryable = keepRetryable(pending)
  const retry = retryable.filter((t) => touched.has(t))
  const fresh = retryable.filter((t) => !touched.has(t)).slice(0, Math.max(0, RUN_TOUCH_CAP - touched.size))
  const batch = [...retry, ...fresh].slice(0, LIVE_CAP)
  if (!batch.length) break // touch cap hit with backlog remaining, or nothing retryable left -> carry forward
  round++
  for (const t of batch) {
    attempts.set(t, (attempts.get(t) ?? 0) + 1)
    touched.add(t)
  }
  log(`round ${round}: researching ${batch.length} file(s) (${touched.size}/${files.length} touched this run)`)
  await parallel(
    batch.map((title) => () => {
      const card = cardByTitle.get(title)
      return agent(
        `Research ONE file for an Eatahorse card, then record findings INTO the card's markdown. Do NOT run ` +
          `any eatahorse command and do NOT touch any other card.\n` +
          `Research question: ${question}\n` +
          `File to read: ${JSON.stringify(title)}\n` +
          `Card markdown file to EDIT: "${card?.mdPath ?? '(find it under ' + board + '/tasks by title)'}"\n` +
          `Title: ${title}\n\n` +
          `In that markdown file:\n` +
          `1. Replace the body of the "## Notes" section with your findings: concise, concrete, cite ` +
          `file:area. If the file is unreadable/binary/irrelevant, say so in one line (that is a valid result).\n` +
          `2. Tick EVERY checkbox in the "## One-bite-at-a-time plan" and "## Acceptance checks" sections ` +
          `(change "- [ ]" to "- [x]"). Ticking the acceptance is what marks the card done on the next sync.\n` +
          `Leave the frontmatter and other sections intact.\n\n` +
          // Worker runs no CLI (concurrency-safety invariant): give it ONLY the card layout, not the command surface.
          `Card markdown layout:\n${CARD_MD}`,
        // No schema: the worker's product is the edited card markdown; the Gather phase reads notes off the board.
        { label: `research:${title}`, phase: 'Research', model: workerModel },
      )
    }),
  )

  // Single serialized writer: reconcile the round's markdown edits into state.json + board.md.
  const sync = await agent(
    `Run \`python3 "${scriptPath}" --board "${board}" sync\` then \`report --json\`. Return activeRemaining ` +
      // sole state writer: sync then report.
      `(the "active" count) and done (the "done" count). Reporting only; change nothing else.\n\n${cli('sync', 'report')}`,
    { label: `sync:${round}`, phase: 'Research', model: 'haiku', schema: SYNC_SCHEMA },
  )
  if (sync) activeRemaining = sync.activeRemaining

  // Sampling gate (opus, fresh context): spot-check a sample of cards that should now be done; reopen any
  // whose notes are not supported by the actual files. Reopened cards are not-done, so the reload below
  // re-queues them for the next round.
  phase('Gate')
  await agent(
    `You are an admission gate for a file-research board at "${board}". Sample up to 8 cards that are ` +
      `marked done (\`list --status done --json\`, then \`show <id>\`). For each sampled card, READ the ` +
      `actual file named by its title and judge whether its "## Notes" are genuinely supported (not ` +
      `vague/hallucinated/empty). For any card whose notes are NOT supported, reopen it atomically: ` +
      `\`reopen <id> --gap "<why hollow>"\` (unchecks acceptance, notes the gap, moves it back to doing). ` +
      // gate samples + reopens: list/show to read, the atomic reopen verb, then sync.
      `Then \`sync\`. Return the reopened (hollow) card TITLES and how many you checked.\n\n${cli('list', 'show', 'reopen', 'sync')}`,
    { label: `gate:${round}`, phase: 'Gate', schema: GATE_SCHEMA },
  )

  // Re-derive the carry queue from the board (source of truth): reopened + failed + still-backlog files,
  // minus give-ups. A done card drops out for good; a reopened/failed card stays until MAX_ATTEMPTS.
  const reload = await agent(
    `\`python3 "${scriptPath}" --board "${board}" list --json\`. Return EVERY card as {title, mdPath ` +
      // reload only re-reads the board: list.
      `(its "path"), status}.\n\n${cli('list')}`,
    { label: `reload:${round}`, phase: 'Research', model: 'haiku', schema: SEED_SCHEMA },
  )
  if (reload?.cards?.length) {
    for (const c of reload.cards) cardByTitle.set(c.title, c)
    pending = keepRetryable(reload.cards.filter(notDone).map((c) => c.title))
  } else {
    pending = []
  }
}

// Files never pulled into a round (touch/round/budget cap) remain as backlog cards on the durable board.
const carryOver = pending.filter((t) => !touched.has(t)).length
if (carryOver) log(`carry-over: ${carryOver} file(s) left in backlog (touched ${touched.size}/${files.length} this run); rerun to continue`)

const stopReason =
  activeRemaining <= 0
    ? 'all units done'
    : touched.size >= RUN_TOUCH_CAP && carryOver
    ? 'run touch cap (backlog carried)'
    : round >= maxRounds
    ? 'round cap'
    : pending.length
    ? 'budget floor'
    : 'no pending'

// 6a. Gather — haiku, batched. Read the durable "## Notes" off EVERY done card on the board, not just what
//     this run's workers returned. This makes the report a function of the board (all runs, gate-survived
//     cards only), so a resumed run synthesizes the whole corpus instead of just the slice it touched.
phase('Gather')
const doneIds =
  (
    await agent(
      `\`python3 "${scriptPath}" --board "${board}" list --status done --json\` and return the "id" of every ` +
        `done card.\n\n${cli('list')}`,
      { label: 'gather-list', model: 'haiku', schema: DONE_IDS_SCHEMA },
    )
  )?.ids ?? []
const idChunks = []
for (let i = 0; i < doneIds.length; i += 25) idChunks.push(doneIds.slice(i, i + 25))
const gatherResults = await parallel(
  idChunks.map((chunk, ci) => () =>
    agent(
      `For EACH card id below, \`show <id> --json\` and read its "notes" field (the card's "## Notes"). ` +
        `Distill into compact {where, evidence} items: concrete observations with a file:area, drop filler. ` +
        `Skip cards whose notes are empty or just say "unreadable". Return all items flattened.\n\n` +
        `Card ids (${chunk.length}): ${JSON.stringify(chunk)}\n\n${cli('show')}`,
      { label: `gather:${ci}`, phase: 'Gather', model: 'haiku', schema: GATHER_SCHEMA },
    ),
  ),
)
const gathered = gatherResults.filter(Boolean).flatMap((g) => g.notes ?? [])

// 6b. Synthesize — opus, from the notes gathered off the durable board.
phase('Synthesize')
const report = await agent(
  `Synthesize a cited research report answering "${question}" for the folder "${root}", from these notes ` +
    `only. Group by area/directory, cite the "where" of each note you rely on, and call out failures and ` +
    `constraints explicitly. Be concrete; no filler.\n\n` +
    `Notes (${gathered.length}):\n${JSON.stringify(gathered)}`,
  { label: 'synthesize' },
)

// 7. Write-back — sonnet. Persist the report and a short summary + skipped/blocked constraints.
phase('Write-back')
await agent(
  `Two writes, then report what you did:\n` +
    `1. Write the research report below to "${out}" (overwrite is fine; it is a generated artifact).\n` +
    `2. Append a short dated section to the project's CLAUDE.md (create if absent; MERGE, do not clobber): ` +
    `the folder researched ("${root}"), the question, how many files were covered (${touched.size} of ` +
    `${files.length} this run${carryOver ? `, ${carryOver} left in backlog for a rerun` : ''}), where the ` +
    `full report lives ("${out}"), and any files that were skipped/unreadable as CONSTRAINTS so a rerun does ` +
    `not re-walk them. Keep it short; do not document the obvious file tree.\n\n` +
    `Coverage: ${files.length} files (one card each); touched ${touched.size} this run; rounds=${round}; ` +
    `stopReason="${stopReason}".\n\n` +
    `Report to write:\n${report}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  root,
  board,
  question,
  files: files.length,
  granularity,
  touched: touched.size,
  carryOver,
  truncated: Boolean(enumed.truncated),
  rounds: round,
  notes: gathered.length,
  activeRemaining,
  stopReason,
  report: out,
  written: true,
}
