// scaffold — start a project from scratch: frame -> blind proposals -> decision gate -> build (DAG) -> verify -> write-back.
//
// Why a workflow (not a conversation): two reasons stack here. (1) The architecture call is a hard,
// expensive-to-reverse decision, so it gets the DIVERSITY treatment — several independent attempts kept
// BLIND to each other, merged only at the end. Coupling them in one conversation kills the diversity
// that made running several worth it. (2) The build-out is a DAG with real ordering — the skeleton must
// exist before tests, the manifest before CI — which is the codified-orchestration case. (workflow-design.md:
// "skeleton before tests, manifest before CI"; "independent attempts ... merged only at the end".)
//
// Two gates, each forced by a dependency (and noted because the spine names one): the DECISION gate
// must settle the architecture before any files are written downstream, and the VERIFY gate is the
// empirical check that code-producing stages require — build/install/test and report. (workflow-design.md:
// "Verification ... required when stages depend on each other"; "pair LLM review with an empirical check".)
//
// Routing notes (per CLAUDE.md, deviations get written down): proposals run on Sonnet, not Opus — they
// are candidate drafts, and the strong-model judgment is spent once, on the merge gate, rather than on N
// parallel plans. CI and docs are Haiku (mechanical from a fixed stack); skeleton and tests are Sonnet
// (implementation). Frame, decide, and write-back inherit the session (strong) model. There is no
// auto-repair loop: verify reports failures as next steps rather than silently patching — add an
// arg-gated repair phase only if a real need appears.
//
// Permissions / execution: Build stages WRITE files under args.dir, and Verify EXECUTES generated code —
// it runs the freshly generated manifest's install/build/test, i.e. unreviewed install scripts and deps,
// gated only by whatever allowlist the session grants the subagents. Intended for a from-scratch personal
// scaffold; run it where that sandbox/allowlist is acceptable. Point it at an EMPTY or new dir.
//
// Two independent knobs control how far it goes:
//   write:false                 -> dry run: stop after the decision, write NOTHING. Review architecture first.
//   write:true,  verify:false   -> write the scaffold but do NOT execute anything. Inspect, then run it yourself.
//   write:true,  verify:true    -> default: write, then run install/build/test and report (the empirical gate).
// verify only matters when write is true (a dry run executes nothing regardless).
//
// requires-skills: architect
//   (Bundling only — the installer copies this skill alongside the workflow as a portable role doc.
//    Workflow stages do NOT auto-load skills; agent() has no skills option. The propose stage carries
//    the architect contract inline, and that inline prompt is the runtime source of truth.)
// Run with /workflows, or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` reports "illegal return" on the trailing return — expected; the runtime wraps the
// script in an async function, so top-level return/await are legal there. Same as starter.js.)
export const meta = {
  name: 'scaffold',
  description: 'Start a project from scratch: frame the brief, draft blind architecture attempts, merge to one, build a DAG skeleton, verify it, write back the decisions.',
  phases: [
    { title: 'Frame' },
    { title: 'Propose' },
    { title: 'Decide' },
    { title: 'Build' },
    { title: 'Verify' },
    { title: 'Write-back' },
  ],
}

const FRAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requirements', 'constraints', 'decisions', 'successCheck'],
  properties: {
    requirements: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },  // hard constraints, esp. expensive-to-reverse
    decisions: { type: 'array', items: { type: 'string' } },    // the irreversible choices each attempt must make
    successCheck: { type: 'string' },                           // concrete command(s)/criteria proving the scaffold is sound
  },
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stack', 'layout', 'keyChoices', 'tradeoffs', 'risks'],
  properties: {
    stack: { type: 'string' },
    layout: { type: 'string' }, // the file/dir tree, specific enough to build from
    keyChoices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['decision', 'choice', 'why'],
        properties: { decision: { type: 'string' }, choice: { type: 'string' }, why: { type: 'string' } },
      },
    },
    tradeoffs: { type: 'string' },
    risks: { type: 'string' },
  },
}

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chosen', 'rationale', 'rejected', 'commands'],
  properties: {
    chosen: {
      type: 'object',
      additionalProperties: false,
      required: ['stack', 'layout', 'keyChoices'],
      properties: {
        stack: { type: 'string' },
        layout: { type: 'string' },
        keyChoices: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['decision', 'choice', 'why'],
            properties: { decision: { type: 'string' }, choice: { type: 'string' }, why: { type: 'string' } },
          },
        },
      },
    },
    rationale: { type: 'string' },
    rejected: { // feeds write-back: rejected alternatives + why, so they don't get re-litigated
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['alternative', 'why'],
        properties: { alternative: { type: 'string' }, why: { type: 'string' } },
      },
    },
    commands: { // one source of truth for verify and write-back
      type: 'object',
      additionalProperties: false,
      required: ['install', 'test'],
      properties: {
        install: { type: 'string' },
        build: { type: 'string' },
        test: { type: 'string' },
        lint: { type: 'string' },
        run: { type: 'string' },
      },
    },
  },
}

// Build agents report what they wrote with the canonical note schema.
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
          where: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'results'],
  properties: {
    passed: { type: 'boolean' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'status', 'detail'],
        properties: {
          step: { type: 'string' },
          status: { enum: ['pass', 'fail', 'skip'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}

const brief = args?.brief ?? 'A small command-line tool. (Pass args.brief to describe your project.)'
const dir = args?.dir ?? '.'
const attempts = Math.min(args?.attempts ?? 3, 6) // independent BLIND architecture attempts (diversity knob)
const write = args?.write ?? true                  // false -> stop after the decision (dry run; writes nothing)
const runVerify = args?.verify ?? true             // false -> write the scaffold but don't EXECUTE it (no install/build/test)

// 1. Frame — strong model. Turns the brief into requirements, hard constraints, the irreversible
//    decisions each attempt must make, and the empirical success check. Sets the trajectory.
phase('Frame')
const frame = await agent(
  `Frame this build brief for a from-scratch scaffold.\nBrief: ${brief}\n\n` +
    `Return: requirements; hard constraints (especially anything expensive to reverse); the key ` +
    `DECISIONS each architecture attempt must make (language, runtime, framework, data store, ` +
    `build/test tooling, ...); and a successCheck — the concrete command(s) or criteria that prove ` +
    `the generated scaffold is sound.`,
  { label: 'frame', schema: FRAME_SCHEMA },
)
const frameBlock =
  `Requirements:\n- ${frame.requirements.join('\n- ')}\n\n` +
  `Hard constraints:\n- ${frame.constraints.join('\n- ')}\n\n` +
  `Decisions each attempt must make:\n- ${frame.decisions.join('\n- ')}`

// 2. Propose — N independent attempts, BLIND to each other (diversity knob). Sonnet: candidate drafts;
//    the Opus judgment is spent once on the merge. They DESCRIBE architectures only — nothing is built.
phase('Propose')
const proposals = await parallel(
  Array.from({ length: attempts }, (_, i) => () =>
    agent(
      `Propose ONE independent architecture for this brief. You are blind to the other attempts — ` +
        `commit to a coherent design, don't converge. Describe it; do NOT build anything.\n\n` +
        `Brief: ${brief}\n\n${frameBlock}`,
      { label: `architect:${i}`, phase: 'Propose', model: 'sonnet', schema: PROPOSAL_SCHEMA },
    ),
  ),
)
const candidates = proposals.filter(Boolean)

// 3. Decision gate — strong model, fresh context. The merge the diversity knob exists for: judge the
//    blind attempts against the frame, then pick ONE or merge the strongest elements into a coherent
//    whole. Records rejected alternatives + WHY (write-back reads them) and the canonical commands.
phase('Decide')
const decision = await agent(
  `You are an architecture decision gate. Below are ${candidates.length} INDEPENDENT proposals for the ` +
    `same brief. Judge them against the frame, then output ONE architecture — pick the strongest or merge ` +
    `the best elements into a coherent whole. Give the rationale, list the rejected alternatives with WHY ` +
    `each was rejected, and specify the concrete install/test (and build/lint/run if relevant) commands ` +
    `for the chosen stack.\n\n` +
    `Brief: ${brief}\n\n${frameBlock}\n\nProposals:\n${JSON.stringify(candidates, null, 2)}`,
  { label: 'decide', schema: DECISION_SCHEMA },
)

// Dry run: stop before writing anything — review the architecture + commands first.
if (!write) {
  return {
    brief,
    attempts: candidates.length,
    chosen: decision.chosen,
    rationale: decision.rationale,
    rejected: decision.rejected,
    commands: decision.commands,
    written: false,
  }
}

// 4. Build — DAG. The architecture is fixed, so stages may depend on it and on each other: the skeleton
//    (dirs + source stubs + manifest) must exist before tests/CI/docs. After it, those three are mutually
//    independent, so they fan out. Agents do the writing — the script can't touch the filesystem.
phase('Build')
const chosenBlock = `Chosen architecture:\n${JSON.stringify(decision.chosen, null, 2)}\nTarget directory: ${dir}`
await agent(
  `Create the project skeleton on disk under "${dir}" exactly per the chosen layout: the directory ` +
    `structure, the manifest (package.json / pyproject.toml / go.mod / ... for the stack), and minimal ` +
    `source stubs that compile or parse. Implement no features yet. Return compact notes on what you wrote.\n\n` +
    `${chosenBlock}`,
  { label: 'skeleton', model: 'sonnet', schema: NOTE_SCHEMA },
)
await parallel([
  () =>
    agent(
      `The skeleton exists under "${dir}". Add a minimal but real test setup wired to the project's test ` +
        `runner, with at least one passing test against the stubs. Return compact notes.\n\n` +
        `${chosenBlock}\nTest command: ${decision.commands.test}`,
      { label: 'tests', phase: 'Build', model: 'sonnet', schema: NOTE_SCHEMA },
    ),
  () =>
    agent(
      `The manifest exists under "${dir}". Write a CI workflow (.github/workflows/ci.yml) that installs, ` +
        `builds, and tests using: install="${decision.commands.install}", build="${decision.commands.build ?? 'n/a'}", ` +
        `test="${decision.commands.test}". Return compact notes.\n\n${chosenBlock}`,
      { label: 'ci', phase: 'Build', model: 'haiku', schema: NOTE_SCHEMA },
    ),
  () =>
    agent(
      `Write a README.md under "${dir}": what the project is (from the brief), how to install/build/run/test ` +
        `(use the commands), and the layout. Drafting only. Return compact notes.\n\n` +
        `Brief: ${brief}\n${chosenBlock}\nCommands: ${JSON.stringify(decision.commands)}`,
      { label: 'docs', phase: 'Build', model: 'haiku', schema: NOTE_SCHEMA },
    ),
])

// 5. Verify — empirical admission gate for the generated code (run-and-report -> Haiku). Pairs the LLM
//    build with a real check: run install/build/test and report pass/fail. No auto-repair on purpose.
//    Gated by runVerify: with verify:false we write the scaffold but never EXECUTE unreviewed code.
let verify
if (runVerify) {
  phase('Verify')
  verify = await agent(
    `Run the success check against the scaffold in "${dir}" and report results. Run, in order, capturing ` +
      `each outcome: install ("${decision.commands.install}"), build ("${decision.commands.build ?? 'n/a'}"), ` +
      `test ("${decision.commands.test}"). Success criteria: ${frame.successCheck}. Set passed=true only if the ` +
      `required steps succeed. Report each step's status and a short detail (the error head on failure). ` +
      `Do not fix anything.`,
    { label: 'verify', model: 'haiku', schema: VERIFY_SCHEMA },
  )
} else {
  verify = { passed: null, results: [], skipped: true } // verify:false — scaffold written, not run
}

// 6. Write-back — an agent writes the new project's CLAUDE.md (the script can't). memory.md's three
//    highest-value items map straight onto earlier stages: build/run/test COMMANDS, the chosen
//    architecture's hard choices + WHY, and the REJECTED alternatives + why.
phase('Write-back')
await agent(
  `Write a lean CLAUDE.md (under ~200 lines) at "${dir}/CLAUDE.md" for the freshly scaffolded project. ` +
    `If a CLAUDE.md already exists there, do NOT clobber it — read it first and merge the new decisions in, ` +
    `preserving existing content. ` +
    `Include: the build/run/test commands; the hard constraints and key architecture choices WITH their ` +
    `rationale; and the rejected alternatives with why each was rejected. Do NOT document the obvious file ` +
    `tree or framework version — only durable decisions a future session would otherwise re-derive or ` +
    `re-litigate.\n\n` +
    `Commands: ${JSON.stringify(decision.commands)}\n` +
    `Chosen + rationale: ${JSON.stringify({ chosen: decision.chosen, rationale: decision.rationale }, null, 2)}\n` +
    `Rejected: ${JSON.stringify(decision.rejected, null, 2)}`,
  { label: 'write-back' },
)

return {
  brief,
  dir,
  attempts: candidates.length,
  chosen: decision.chosen.stack,
  rejected: decision.rejected.length,
  verified: runVerify ? verify.passed : null, // null when verify:false (not executed)
  steps: verify.results,
  written: true,
}
