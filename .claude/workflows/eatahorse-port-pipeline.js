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
// trusting it. Equivalence verification is NOT folded in — run `eatahorse grounding=<inventory>
// verifyEquivalence:true verifyOnly:true` as a separate pass afterward (verifyOnly skips the 0-active bail so
// it runs against the cleared port board; keeps this lean; see eatahorse.js / docs/eatahorse-workflow-log.md).
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
//   maxTokens      per-run OUTPUT-token ceiling (default null = none); bounds budget.remaining()
//   budgetFloor    stop opening rounds below this many remaining tokens (default 50000)
//   workerModel    model for the per-unit port agents (default "sonnet")
//
// requires-skills: eatahorse, eatahorse-port
//   (eatahorse-port is the conversational FRONT DOOR — it runs AskUserQuestion then launches this
//    workflow with a clean args object; bundled only, not loaded at runtime. eatahorse:
//    Workflow stages don't auto-load skills; the CLI surface is distilled INLINE below as
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

// args may arrive as a stringified object on some launch paths (named launch / GLM harness);
// the docs claim verbatim JSON but stringified JSON can reach the script (WORKFLOW_ANALYSIS.md
// "Documentation Gaps"). Normalize so a `'{"root":...}'` blob doesn't read every field as undefined
// and bail. Same guard as docs-migrate.js / docs-scrape.js.
let _args = args
if (typeof _args === 'string') {
  const t = _args.trim()
  if (t.startsWith('{') || t.startsWith('[')) { try { _args = JSON.parse(t) } catch {} }
}
const root = _args?.root ?? ''
const targetLang = _args?.targetLang ?? ''
const targetDir = _args?.targetDir ?? ''
if (!root || !targetLang || !targetDir)
  return {
    error:
      'root, targetLang, and targetDir are required. Pass args as a JSON OBJECT, e.g. ' +
      'args: { root: "bs4", targetLang: "rust", targetDir: "rust-port" } — not a comma string ' +
      'and not a JSON-stringified object.',
    got: { root, targetLang, targetDir },
    written: false,
  }

const board = _args?.board ?? '.eatahorse-port'
const researchBoard = _args?.researchBoard ?? '.eatahorse-comprehend'
const inventory = _args?.inventory ?? root.replace(/\/+$/, '') + '.inventory.json'
const question = _args?.question ?? `Comprehend every file as a unit to port to ${targetLang}: its public API surface, intra-repo dependencies, and behavior.`
const testCmd = _args?.testCmd ?? ''
const scriptPath = _args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'
const maxRounds = Math.min(_args?.maxRounds ?? 60, 200)
const maxTokens = _args?.maxTokens ?? null
const budgetFloor = _args?.budgetFloor ?? 50_000
const workerModel = _args?.workerModel ?? 'sonnet'

// Inline CLI contract (FOURTH copy — see header). Sliced per agent.
const CLI_HEAD = (b) =>
  `Eatahorse CLI (stdlib python): python3 "${scriptPath}" --board "${b}" <cmd>. If absent: find . -name eatahorse.py.`
const CMD = {
  init:    `init "<project>" [--goal "<g>"]`,
  add:     `add "<title>" [--priority P0..P3] [--status s] [-d "<desc>"] [--bite "<s>"].. [--accept "<c>"].. [--external-id ns:val].. [--depends-on EH-XXXX]..`,
  depadd:  `dep-add <id> --on <depId>  (rejects cycles)`,
  list:    `list [--status s] [--json]`,
  show:    `show <id> [--json]`,
  next:    `next [--json] -> top active card whose deps are all done (won't offer a dep-blocked card)`,
  bite:    `bite <id> <i> [--done|--open] [--group bites|acceptance]  (1-based)`,
  move:    `move <id> <backlog|ready|doing|blocked|done|dropped>`,
  sync:    `sync`,
  report:  `report --json`,
}
const cli = (b, ...k) => CLI_HEAD(b) + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
// Tokens left = min(platform budget remaining, our own maxTokens ceiling remaining). budget.remaining()
// is Infinity when no platform target is set; our ceiling bounds it. Most restrictive wins.
// `maxTokens != null` (not truthiness): a caller passing maxTokens:0 means "spend nothing", NOT "no
// ceiling" — a falsy-zero check would invert that and run unbounded.
const tokensLeft = () =>
  Math.min(budget.remaining(), maxTokens != null ? Math.max(0, maxTokens - budget.spent()) : Infinity)

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
          // EH-PORT-22: this round does NOT recompute "portable" in prose. It SEEDS port cards with real
          // dep-add edges, then lets the port board's DAG + `next` decide port ORDER — `next` refuses any card
          // whose deps aren't done. The DAG gates port ORDER. One ordering surface (the port board), composing
          // with EH-PORT-12.
          // EH-PORT-27: seeding is TWO-pass (add ALL cards, THEN wire) because `dep-add` errors on a missing
          // dep card — "comprehended" does not imply "carded". A card whose dep is not comprehended yet is
          // parked `blocked` (which `next` excludes) until a later round wires + unblocks it, so a transitive
          // chain can never be ported out of order. (The old one-pass seed wired per-unit and ERRORED, or
          // dropped the edge and let `next` offer the card early — its "every edge can be wired" claim was
          // false one level deep.)
          `You are ONE round of a port scheduler. Source tree "${root}" is being comprehended into the ` +
            `research board at "${researchBoard}" CONCURRENTLY (it may still be in progress). Your job: SEED ` +
            `port cards for newly-comprehended units, then port whatever the DAG now allows, onto the PORT ` +
            `board at "${board}".\n` +
            `Already ported this run (for your awareness; the board is the source of truth): ${JSON.stringify(ported)}.\n` +
            `Steps:\n` +
            `1. If the port board does not exist yet, \`init "Port to ${targetLang}"\` on it (board "${board}").\n` +
            `2. Read comprehended units: on the RESEARCH board "${researchBoard}", \`list --status done --json\`, ` +
            `then \`show <id> --json\` for each and parse the fenced \`\`\`json block in its notes ` +
            `({path, exports, deps, ...}). These are the units comprehended SO FAR (path + its INTRA-repo deps).\n` +
            `3. SEED cards (do NOT port yet) in TWO passes, because \`dep-add\` ERRORS if the dep card does ` +
            `not exist — so every card must be created BEFORE any edge is wired. "Comprehended" does NOT ` +
            `imply "carded": a unit is only carded once you add it.\n` +
            `   3a. ADD-ALL: \`list --json\` the PORT board to see which units already have a card (match on ` +
            `external_ids.source). For EVERY comprehended unit from step 2 with NO card yet, \`add\` a ` +
            `backlog card (--external-id source:<path>, -d describing the source path + the public API to ` +
            `keep). Add them ALL before wiring any edge.\n` +
            `   3b. WIRE: now every comprehended unit has a card. For each card, for each of its intra-repo ` +
            `deps: if the dep has a card (it is comprehended), \`dep-add <card> --on <depCard>\` (resolve ` +
            `depCard via its source: external_id). If the dep has NO card (not comprehended yet), \`move ` +
            `<card> blocked\` and note the missing dep — \`next\` skips blocked cards, so the card cannot be ` +
            `ported out of order; a later round wires it and unblocks it. If a \`dep-add\` is REJECTED as a ` +
            `cycle, the two units are mutually dependent (an SCC): leave that back-edge off and note the pair ` +
            `— it is handled at port time (step 4).\n` +
            `   3c. UNBLOCK: re-check every card currently \`blocked\`. If all its intra-repo deps now have ` +
            `cards, wire the still-missing edges and \`move <card> backlog\` so \`next\` can offer it once ` +
            `its deps are done.\n` +
            (finalDrain
              ? `   Because comprehension is FINISHED: a still-\`blocked\` card depends on a unit that was ` +
                `NEVER comprehended (external/cyclic). \`move\` each such card \`backlog\` and wire only the ` +
                `edges whose dep cards exist, so the board drains instead of stalling on a dep that will ` +
                `never arrive.\n`
              : '') +
            `4. PORT via the DAG: repeatedly \`next --json\` on the PORT board. \`next\` only returns a card ` +
            `whose deps are all done, so you never port out of order. For each card it returns: \`move <id> ` +
            `doing\`, DO THE PORT (write the ${targetLang} file under "${targetDir}", keep the public API ` +
            `stable, do NOT edit source files). If the card is part of an SCC pair you noted in 3b (a cyclic ` +
            `peer not yet ported), write it with the peer references STUBBED / forward-declared so the file is ` +
            `syntactically valid, and do NOT block its acceptance on a full project build until both members ` +
            `are ported — accept it as a valid stub. Then tick the card's acceptance bites and \`sync\`. ` +
            `Repeat until \`next\` returns no card. Do NOT port a card \`next\` did not offer.\n` +
            `5. \`sync\` the port board, then \`report --json\`.\n` +
            (finalDrain
              ? ``
              : `NOTE: comprehension is STILL RUNNING — more units appear in later rounds. Do not wait or spin.\n`) +
            `Return portedThisRound (source paths you ported now), comprehendedNotPorted (comprehended units ` +
            `not yet ported, including dep-blocked), and a short note.\n\n` +
            `RESEARCH board reads:\n${cli(researchBoard, 'list', 'show')}\n\nPORT board writes:\n${cli(board, 'init', 'add', 'depadd', 'list', 'show', 'next', 'bite', 'move', 'sync', 'report')}`,
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
        // EH-PORT-27: a round that ports NOTHING is empty whether or not comprehension is still running.
        // Pre-comprehension it means "no portable units yet"; POST-comprehension with cards still unported
        // it means a genuine stall (dep-blocked / cyclic / unsatisfiable acceptance). Count BOTH toward the
        // cap — gating the streak on `!comprehendDone` (the old bug) reset it every post-comprehension round
        // and spun the scheduler to maxRounds, one worker agent per round, doing no useful work.
        if (!portedNow) {
          if (++emptyStreak >= EMPTY_CAP) { stalledEarly = true; break }
        } else {
          emptyStreak = 0
        }
      }
      if (stalledEarly)
        log(
          `Scheduler stopped after ${EMPTY_CAP} consecutive rounds that ported nothing — the remaining ` +
            `units are dep-blocked, cyclic, or could not satisfy acceptance. Run \`eatahorse ` +
            `grounding="${inventory}"\` to port the remainder (no work lost).`,
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
    `\`eatahorse grounding="${inventory}" verifyEquivalence:true verifyOnly:true\` to confirm behavior ` +
    `parity against the cleared port board. Keep it short.\n` +
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
  note: `Equivalence NOT verified here — run eatahorse grounding="${inventory}" verifyEquivalence:true verifyOnly:true as a separate pass.`,
  written: true,
}
