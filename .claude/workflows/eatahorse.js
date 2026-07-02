// eatahorse — orchestrate the eatahorse two-phase workflow.
//
// Thin orchestrator that dispatches to eatahorse-plan (decompose -> seed -> plan-gate)
// and/or eatahorse-execute (Ralph loop -> completion gate -> write-back).
//
// The skill (SKILL.md) is the conversational entry point; this workflow is the
// headless runner. Use --plan or --execute to run one phase, or set execute:true
// to run both in sequence.
//
// Default (execute:false): plan only. Set execute:true to also work the board.
// To run phases independently:
//   Workflow({ name: "eatahorse-plan", args: { goal, board, ... } })
//   Workflow({ name: "eatahorse-execute", args: { board, ... } })
//
// Knobs (args):
//   goal           the objective to break down
//   execute:false  default — plan only. Set execute:true to also run the execute phase.
//   board          board dir (forwarded to plan; execute gets the plan's board)
//   scriptPath     path to eatahorse.py (forwarded to both children)
//   constraints    board invariants (forwarded to both children)
//   inventory      path to map_codebase.py JSON (forwarded to plan only)
//   maxIterations  hard loop cap (forwarded to execute only)
//   maxTokens      per-run OUTPUT-token ceiling (forwarded to execute only)
//   budgetFloor    stop below this many remaining tokens (forwarded to execute only)
//   workerModel    model for execute loop workers (forwarded to execute only)
//
// requires-skills: eatahorse
export const meta = {
  name: 'eatahorse',
  description:
    'Break a goal into a Kanban board of small tasks and check the plan, then optionally work the board unattended one task at a time, verifying each task before moving on.',
  whenToUse:
    'Use to plan a goal as small trackable tasks, or to work that board hands-off. Front door: the eatahorse skill.',
  phases: [
    { title: 'Plan' },
    { title: 'Execute' },
  ],
}

// Stringified-args guard — same check as eatahorse-plan.js. If the whole `args` arrives as ONE string
// blob (comma-form "goal: X, execute: true, board: Y" or a JSON-stringified object) instead of a
// structured object, every per-arg access below reads undefined: execute silently drops to false
// (plan-only, no error) and goal forwards as eatahorse-plan's placeholder. Fail LOUD instead.
const _argKeys =
  /\b(goal|execute|board|constraints|scriptPath|inventory|maxIterations|maxTokens|budgetFloor|workerModel)["']?\s*[:=]/gi
const _argsBlob = typeof args === 'string' ? args : ''
const _keyHits = [...new Set([..._argsBlob.matchAll(_argKeys)].map((m) => m[1].toLowerCase()))]
if (_argsBlob && (/^\s*['"{]*\s*(goal|execute|board)["']?\s*[:=]/i.test(_argsBlob) || _keyHits.length >= 2)) {
  return {
    goal: _argsBlob,
    written: false,
    error:
      `args appear stringified: a single string carries argument keys (${_keyHits.join(', ')}). Pass a ` +
      `STRUCTURED object, not one string blob: Workflow({name:"eatahorse", args:{goal:"<task>", execute:true, ` +
      `board:".eatahorse-<topic>"}}). execute/board/constraints were dropped.`,
  }
}

// A plain string that ISN'T key/value-shaped (no colon/equals hits above) is a bare goal, same
// convenience eatahorse-plan.js supports directly. Without this, args?.goal below reads undefined
// and the goal silently becomes eatahorse-plan's placeholder text — the same silent-drop failure
// the guard above exists to catch, just via a plain-prose string instead of a stringified object.
const _args = _argsBlob ? { goal: _argsBlob } : args

const executeMode = _args?.execute ?? false

// 1. Plan — decompose, seed, gate.
phase('Plan')
const planArgs = {
  goal: _args?.goal,
  board: _args?.board,
  scriptPath: _args?.scriptPath,
  constraints: _args?.constraints,
  inventory: _args?.inventory,
}
const planResult = await workflow({ name: 'eatahorse-plan', args: planArgs })
if (planResult?.error) {
  return planResult
}

const boardResult = planResult?.board ?? _args?.board
if (!executeMode) {
  // Plan-only mode: return the plan result directly.
  return planResult
}

// 2. Execute — Ralph loop, gate, write-back.
phase('Execute')
const execArgs = {
  board: boardResult,
  scriptPath: _args?.scriptPath,
  maxIterations: _args?.maxIterations,
  maxTokens: _args?.maxTokens,
  budgetFloor: _args?.budgetFloor,
  workerModel: _args?.workerModel,
  constraints: _args?.constraints,
}
const execResult = await workflow({ name: 'eatahorse-execute', args: execArgs })
if (execResult?.error) {
  return { ...(planResult ?? {}), executed: true, executeResult: execResult, error: execResult.error }
}

return {
  ...(planResult ?? {}),
  executed: true,
  executeResult: execResult,
}
