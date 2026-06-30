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

const executeMode = args?.execute ?? false

// 1. Plan — decompose, seed, gate.
phase('Plan')
const planArgs = {
  goal: args?.goal,
  board: args?.board,
  scriptPath: args?.scriptPath,
  constraints: args?.constraints,
  inventory: args?.inventory,
}
const planResult = await workflow({ name: 'eatahorse-plan', args: planArgs })
if (planResult?.error) {
  return planResult
}

const boardResult = planResult?.board ?? args?.board
if (!executeMode) {
  // Plan-only mode: return the plan result directly.
  return planResult
}

// 2. Execute — Ralph loop, gate, write-back.
phase('Execute')
const execArgs = {
  board: boardResult,
  scriptPath: args?.scriptPath,
  maxIterations: args?.maxIterations,
  maxTokens: args?.maxTokens,
  budgetFloor: args?.budgetFloor,
  workerModel: args?.workerModel,
  constraints: args?.constraints,
}
const execResult = await workflow({ name: 'eatahorse-execute', args: execArgs })

return {
  ...(planResult ?? {}),
  executed: true,
  executeResult: execResult,
}
