// eatahorse-port-pipeline — cross-run scheduler that PIPELINES comprehend -> execute (EH-PORT-18).
//
// WHY THIS EXISTS / WHAT IT IS NOT: v1 ran comprehend (`eatahorse-research extract:'port'`) and execute
// (`eatahorse grounding=<inventory>`) as two SEQUENTIAL runs — you waited for the whole tree to be
// comprehended before any unit was ported. The locked decision keeps those two as SEPARATE workflows
// (single-writer invariant + incompatible cap regimes: research is read-only/lifetime-capped, execute is
// write/token-capped). This pipeline does NOT merge them. It runs comprehend as-is and, CONCURRENTLY,
// drives a thin scheduler that starts porting a leaf unit the moment its comprehension lands and its
// upstreams are ported — so port work overlaps the tail of comprehension. The two never share a writer:
// comprehend owns the RESEARCH board; the scheduler owns the PORT board; they meet only by reading.
//
// HEAVY + OPT-IN + RUNTIME-UNVERIFIED: this is the most expensive, most speculative piece of the port v2.
// It cannot be unit-tested (it is pure orchestration over live agents); validate it on a TINY slice before
// trusting it. Equivalence verification is NOT folded in — run `eatahorse verifyEquivalence:true` as a
// separate pass afterward (keeps this lean; see eatahorse.js / docs/eatahorse-workflow-log.md).
//
// Knobs (args):
//   root           source folder to port (required)
//   targetLang     target language (required, e.g. "rust")
//   targetDir      where ported files go (required)
//   board          PORT board dir (default ".eatahorse-port")
//   researchBoard  COMPREHEND board dir (default ".eatahorse-comprehend")
//   inventory      inventory.json path comprehend writes (default "<root>.inventory.json")
//   question       comprehension question (default a port-comprehension prompt)
//   testCmd        proving command; passed through as a port constraint
//   scriptPath     eatahorse.py (default bundled skill copy)
//   maxRounds      scheduler round cap (default 60) — backstop independent of budget
//   budgetFloor    stop opening rounds below this many remaining tokens (default 50000)
//   workerModel    model for the per-unit port agents (default "sonnet")
//
// requires-skills: eatahorse
//   (Bundling only. Workflow stages don't auto-load skills; the CLI surface is distilled INLINE below as
//    CMD/cli() — a FOURTH hand-synced copy alongside eatahorse.js / eatahorse-research.js / docs-from-code.js.
//    Mirror it when an eatahorse.py subcommand changes. See plugins/workflow-kit/skills/eatahorse/CLAUDE.md.)
// Run with /workflows or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` flags the trailing top-level return as "illegal return" — expected; the runtime wraps the
//  script in an async function. Same as starter.js / eatahorse.js.)
export const meta = {
  name: 'eatahorse-port-pipeline',
  description:
    'Pipeline a code port: comprehend a source tree and concurrently start porting each unit as soon as its comprehension lands and its dependencies are ported.',
  whenToUse:
    'Use to overlap comprehension and porting on a large tree instead of waiting for the whole tree to be comprehended first. Heavy and opt-in; validate on a small slice.',
  phases: [{ title: 'Pipeline' }, { title: 'Write-back' }],
}

// One scheduler round: read the comprehension board, port every unit that just became portable, report.
const ROUND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['portedThisRound', 'comprehendedNotPorted', 'note'],
  properties: {
    portedThisRound: { type: 'array', items: { type: 'string' } }, // source paths ported this round
    comprehendedNotPorted: { type: 'integer' },                    // units comprehended but not yet ported (incl. dep-blocked)
    note: { type: 'string' },
  },
}

const root = args?.root ?? ''
const targetLang = args?.targetLang ?? ''
const targetDir = args?.targetDir ?? ''
if (!root || !targetLang || !targetDir)
  return { error: 'root, targetLang, and targetDir are required', written: false }

const board = args?.board ?? '.eatahorse-port'
const researchBoard = args?.researchBoard ?? '.eatahorse-comprehend'
const inventory = args?.inventory ?? root.replace(/\/+$/, '') + '.inventory.json'
const question = args?.question ?? `Comprehend every file as a unit to port to ${targetLang}: its public API surface, intra-repo dependencies, and behavior.`
const testCmd = args?.testCmd ?? ''
const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
const maxRounds = Math.min(args?.maxRounds ?? 60, 200)
const budgetFloor = args?.budgetFloor ?? 50_000
const workerModel = args?.workerModel ?? 'sonnet'

// Inline CLI contract (FOURTH copy — see header). Sliced per agent.
const CLI_HEAD = (b) =>
  `Eatahorse CLI (stdlib python): python3 "${scriptPath}" --board "${b}" <cmd>. If absent: find . -name eatahorse.py.`
const CMD = {
  init:    `init "<project>" [--goal "<g>"]`,
  add:     `add "<title>" [--priority P0..P3] [--status s] [-d "<desc>"] [--bite "<s>"].. [--accept "<c>"].. [--external-id ns:val].. [--depends-on EH-XXXX]..`,
  depadd:  `dep-add <id> --on <depId>  (rejects cycles)`,
  list:    `list [--status s] [--json]`,
  show:    `show <id> [--json]`,
  bite:    `bite <id> <i> [--done|--open] [--group bites|acceptance]  (1-based)`,
  move:    `move <id> <backlog|ready|doing|blocked|done|dropped>`,
  sync:    `sync`,
  report:  `report --json`,
}
const cli = (b, ...k) => CLI_HEAD(b) + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
const tokensLeft = () => budget.remaining()

// Concurrency: comprehend (the unmodified research workflow) and the port scheduler run together. They
// share ONLY this closure flag — never a writer. comprehend writes the research board; the scheduler
// writes the port board. When comprehend's promise resolves, comprehendDone flips and the scheduler
// drains the last portable units, then both finish.
let comprehendDone = false
const portedAll = new Set()
const rounds = []

phase('Pipeline')
log(`Pipelining: comprehend "${root}" -> port to ${targetLang} under "${targetDir}". Research board ${researchBoard}, port board ${board}.`)

const pipelineResults = await parallel([
  // 1. Comprehend — the EXISTING research workflow, untouched. Writes the research board + inventory.json.
  () =>
    workflow('eatahorse-research', {
      root,
      question,
      extract: 'port',
      board: researchBoard,
      inventory,
      scriptPath,
    }).then((r) => {
      comprehendDone = true
      return r
    }),

  // 2. Port scheduler — polls the research board and ports newly-portable units. One agent per round does
  //    the read + the ports; the await yields back to comprehend, so the two genuinely interleave.
  () =>
    (async () => {
      // First round creates the port board; later rounds reuse it.
      let r = 0
      // Backoff: the script has no sleep, so a scheduler that keeps finding NOTHING portable while
      // comprehension is still running would just burn worker-model rounds polling. Cap consecutive empty
      // rounds — if comprehension hasn't produced any portable unit in this many tries, the overlap isn't
      // happening; stop spinning and let the standalone `eatahorse grounding=` execute pass port the rest
      // after comprehension finishes (no work is lost — it degrades to the sequential path).
      const EMPTY_CAP = 6
      let emptyStreak = 0
      let stalledEarly = false
      // Drain until comprehension is done AND nothing comprehended remains unported. The caps are backstops.
      while (r < maxRounds && tokensLeft() > budgetFloor) {
        r++
        const ported = [...portedAll]
        const finalDrain = comprehendDone // once true, relax the "deps must be ported" gate to avoid a stall
        const round = await agent(
          `You are ONE round of a port scheduler. Source tree "${root}" is being comprehended into the ` +
            `research board at "${researchBoard}" CONCURRENTLY (it may still be in progress). Your job: port ` +
            `every unit that is now PORTABLE to ${targetLang} under "${targetDir}", onto the PORT board at ` +
            `"${board}".\n` +
            `Already ported this run (do NOT re-port): ${JSON.stringify(ported)}.\n` +
            `Steps:\n` +
            `1. If the port board does not exist yet, \`init "Port to ${targetLang}"\` on it (board "${board}").\n` +
            `2. Read comprehended units: on the RESEARCH board "${researchBoard}", \`list --status done --json\`, ` +
            `then \`show <id> --json\` for each and parse the fenced \`\`\`json block in its notes ` +
            `({path, exports, deps, ...}). These are the units comprehended SO FAR.\n` +
            `3. A unit is PORTABLE when every one of its INTRA-repo deps is itself (a) comprehended (present ` +
            `in step 2) AND (b) already ported (in the "already ported" set OR ported earlier this round).\n` +
            `4. For each NOT-yet-ported portable unit, leaf-first: \`add\` a port card on "${board}" ` +
            `(--external-id source:<path>, --status doing, -d describing the source path + public API to keep), ` +
            `wire \`dep-add\` edges to the port cards of its deps (resolve via their source: external_id from ` +
            `\`list --json\`), DO THE PORT (write the ${targetLang} file under "${targetDir}", keep the public ` +
            `API stable, do NOT edit source), then tick the card's acceptance and \`sync\`.\n` +
            `5. \`sync\` the port board.\n` +
            (finalDrain
              ? `NOTE: comprehension is FINISHED. If a comprehended unit is still blocked only because a dep ` +
                `was never comprehended (external/cyclic), port it anyway leaf-first and say so in the note.\n`
              : `NOTE: comprehension is STILL RUNNING — only port what is genuinely portable now; more units ` +
                `will appear in later rounds. Do not wait or spin.\n`) +
            `Return portedThisRound (source paths you ported now), comprehendedNotPorted (comprehended units ` +
            `not yet ported, including dep-blocked), and a short note.\n\n` +
            `RESEARCH board reads:\n${cli(researchBoard, 'list', 'show')}\n\nPORT board writes:\n${cli(board, 'init', 'add', 'depadd', 'list', 'show', 'bite', 'move', 'sync', 'report')}`,
          { label: `port-round:${r}`, phase: 'Pipeline', model: workerModel, schema: ROUND_SCHEMA },
        )
        if (!round) {
          // Agent died this round. If comprehension is already done, stop; otherwise count it toward the
          // empty-streak cap (a flapping agent must not spin to maxRounds either).
          if (comprehendDone) break
          if (++emptyStreak >= EMPTY_CAP) { stalledEarly = true; break }
          continue
        }
        const portedNow = (round.portedThisRound || []).length
        for (const p of round.portedThisRound || []) portedAll.add(p)
        rounds.push({ round: r, ported: portedNow, remaining: round.comprehendedNotPorted })
        // Done when comprehension finished and this round left nothing comprehended-but-unported.
        if (comprehendDone && (round.comprehendedNotPorted ?? 0) <= 0 && !portedNow) break
        // Backoff while comprehension is still running and nothing got ported this round.
        if (!comprehendDone && !portedNow) {
          if (++emptyStreak >= EMPTY_CAP) { stalledEarly = true; break }
        } else {
          emptyStreak = 0
        }
      }
      if (stalledEarly)
        log(
          `Scheduler stopped after ${EMPTY_CAP} consecutive empty rounds while comprehension was still ` +
            `running — the overlap isn't producing portable units. Run \`eatahorse grounding="${inventory}"\` ` +
            `after comprehension finishes to port the remainder (no work lost).`,
        )
      // Sentinel object, not the bare count: r===0 (e.g. budget exhausted before the first round) is falsy
      // and would be dropped by the filter(Boolean) below, masquerading as a crashed scheduler thunk.
      return { rounds: r, stalledEarly }
    })(),
])

// parallel() resolves a thunk that threw to null; if comprehend itself died, say so loudly rather than
// reporting a partial port as success.
const liveResults = pipelineResults.filter(Boolean)
if (liveResults.length < 2)
  log('warning: a pipeline stage (comprehend or scheduler) returned nothing — the port may be incomplete.')

// 3. Write-back — persist what the run produced (script vars evaporate). Reports only; mutates no status.
phase('Write-back')
await agent(
  `A pipelined port run just finished. Source "${root}" -> ${targetLang} under "${targetDir}". Port board ` +
    `at "${board}".\n` +
    `1. \`report --json\` on the port board and \`list --json\`.\n` +
    `2. Append a short dated section to the project's CLAUDE.md (create if absent; MERGE, do not clobber): ` +
    `what was ported (count), what remains active, the inventory at "${inventory}", the test command ` +
    `("${testCmd || 'none given'}"), and a reminder that EQUIVALENCE was NOT verified here — run ` +
    `\`eatahorse grounding="${inventory}" verifyEquivalence:true\` (or the board's verify pass) to confirm ` +
    `behavior parity. Keep it short.\n` +
    `3. Do not change any task status.\n\n${cli(board, 'report', 'list')}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  root,
  targetLang,
  targetDir,
  board,
  researchBoard,
  inventory,
  portedCount: portedAll.size,
  ported: [...portedAll],
  rounds,
  note: 'Equivalence NOT verified here — run eatahorse verifyEquivalence:true as a separate pass.',
  written: true,
}
