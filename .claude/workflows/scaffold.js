// scaffold — start a project from scratch and stub+document the whole tree:
//   frame -> (blind proposals || library research) -> [rebuttal] -> decision gate -> forward-review lanes ->
//   tasklist gate -> build fan-out (skeleton + per-file stub workers) -> [checks] -> [once-over] -> verify -> write-back.
//
// Why a workflow (not a conversation): two reasons stack. (1) The architecture call is a hard,
// expensive-to-reverse decision, so it gets the DIVERSITY treatment — several independent attempts
// kept BLIND to each other, merged only at the end. (2) The build-out is a DAG with real ordering and
// wide fan-out (one cheap worker per file) that one conversation can't coordinate. (workflow-design.md:
// "skeleton before tests, manifest before CI"; "independent attempts ... merged only at the end".)
//
// The DISCUSSION phase is NOT in this script. Workflows run in the background with no user IO, so the
// brief/license/interface/OS/frontend-backend interview lives in the front-door `new-project` skill, which
// collects answers via AskUserQuestion and launches this workflow with them as args. This script assumes
// those args are already gathered (it falls back to sane defaults so a bare `/scaffold <brief>` still runs).
//
// Three gates, each forced by a dependency (the spine names the first two):
//   - DECISION gate (Opus): settles ONE architecture from the blind proposals + research before anything downstream.
//   - TASKLIST gate (Opus): the admission gate. Forward-review LANES (Sonnet) emit adjustment notes; this
//     strong stage judges/folds them and only THEN emits the file-by-file build plan. Kept on the strong
//     model so it can't rubber-stamp the lanes' notes (model-routing.md: "never under-spend the gate").
//   - VERIFY gate (Haiku): the empirical check — run install/build/test and report. (workflow-design.md:
//     "pair LLM review with an empirical check".)
//
// Routing notes (per CLAUDE.md/model-routing.md — deviations get written down):
//   - Research feeds DECIDE, not PROPOSE. Proposals stay BLIND on the frame only; injecting shared research
//     would converge them and kill the diversity the blind-attempts knob exists for (workflow-design.md).
//   - REBUTTAL (arg-gated, default off): GENERATION stays blind; only AFTER proposals are locked does each
//     proposer attack the others in one round, feeding DECIDE. Coupling after lock keeps diversity intact.
//   - Forward-review lanes are WORKERS on Sonnet (architecture judgment, a step up from Haiku), the strong
//     judgment is spent once on the TASKLIST gate that consumes their notes — mirrors why proposals are Sonnet.
//   - Build is HAIKU: each task is one explicit, checkable file-stub from a fixed plan — the canonical cheap
//     fan-out case. Parallel workers each own a DISTINCT file path, so there is no write race (no worktree).
//   - CHECKS is HAIKU and runs on the write path even when verify:false — it executes NO project code, only
//     read-only wc -l / grep, so the hard line ceiling is validated against actual files, not the estimate.
//   - Frame, Decide, Tasklist inherit the session (strong) model. Lanes, Once-over, and WRITE-BACK are Sonnet:
//     write-back is the last stage, nothing propagates from it, so per model-routing it must not burn Opus.
//   - Once-over is JUDGMENT-only (duplication/consistency/API-match); the mechanical line+docstring checks
//     moved to the always-on CHECKS stage (deterministic, free).
//   - No auto-repair: verify reports failures as next steps. Add an arg-gated repair phase only if needed.
//
// MAINTAINABILITY CONTRACT (threaded into frame/propose/review/tasklist/build): prefer well-maintained
// libraries over reinvention, design for reuse, and keep every file under MAX_LINES (default 400). The
// TASKLIST gate is where "if a module would exceed it, break down the repo structure" is enforced — one
// task = one file < MAX_LINES; oversized modules are split into multiple file tasks there.
//
// Permissions / execution: Build stages WRITE files under args.dir; Verify EXECUTES generated code (the
// freshly generated manifest's install/build/test — unreviewed deps/scripts), gated only by the session's
// allowlist. Intended for a from-scratch personal scaffold; run where that sandbox is acceptable. dir
// defaults to ./scaffold-out (a fresh subdir, never the cwd); pass args.dir to override an EMPTY/new dir.
//
// Knobs:
//   write:false               -> dry run: stop after the decision, write NOTHING. Review architecture first.
//   write:true, verify:false  -> write the scaffold + run the deterministic CHECKS, but EXECUTE nothing.
//   write:true, verify:true   -> default: write, run Checks, then run install/build/test and report (the empirical gate).
//   debate:true               -> one blind rebuttal round before Decide (proposers attack each other). Off by default.
//   polish:true               -> add a Sonnet once-over after Checks (duplication + consistency + API-match). Off by default.
//
// requires-skills: architect, new-project
//   (Bundling only — the installer copies these alongside the workflow. `architect` is the portable copy of
//    the blind-proposal role (carried inline by the propose stage). `new-project` is the front-door discussion
//    skill that launches this workflow. Workflow stages do NOT auto-load skills; the inline prompts are the
//    runtime source of truth.)
// Run with /workflows or the `new-project` skill, or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` reports "illegal return" on the trailing return — expected; the runtime wraps the
// script in an async function, so top-level return/await are legal there. Same as starter.js.)
export const meta = {
  name: 'scaffold',
  description: 'Start a project from scratch and stub+document the whole tree: discuss-driven brief, research deps, blind architecture attempts merged to one, forward-review, then fan out cheap workers to build every file under a 400-line ceiling, verify, write back the decisions.',
  phases: [
    { title: 'Frame' },
    { title: 'Propose' },
    { title: 'Research' },
    { title: 'Rebuttal' },
    { title: 'Decide' },
    { title: 'Review' },
    { title: 'Tasklist' },
    { title: 'Build' },
    { title: 'Checks' },
    { title: 'Once-over' },
    { title: 'Verify' },
    { title: 'Write-back' },
  ],
}

const FRAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requirements', 'constraints', 'decisions', 'candidateLibraries', 'successCheck'],
  properties: {
    requirements: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },       // hard constraints: interface, OS, license, publish, API, MAX_LINES, reuse
    decisions: { type: 'array', items: { type: 'string' } },         // the irreversible choices each attempt must make
    candidateLibraries: { type: 'array', items: { type: 'string' } }, // libs/frameworks worth researching (versions, vulns, compat)
    successCheck: { type: 'string' },                                // concrete command(s)/criteria proving the scaffold is sound
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

// Research lane output: one entry per library investigated. Haiku, mechanical, checkable.
const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['libraries'],
  properties: {
    libraries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'latestVersion', 'advisories', 'maintenance', 'compat', 'docsUrl'],
        properties: {
          name: { type: 'string' },
          latestVersion: { type: 'string' },        // current stable version (or "unknown" if not found)
          advisories: { type: 'string' },           // known CVEs / security advisories, or "none found"
          maintenance: { type: 'string' },          // last release / activity / maturity signal
          compat: { type: 'string' },               // runtime/OS compatibility notes for the target
          docsUrl: { type: 'string' },              // canonical docs link
        },
      },
    },
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
      required: ['stack', 'layout', 'keyChoices', 'dependencies'],
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
        dependencies: { // pinned from Research: name + version + why. Empty array if none.
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'version', 'why'],
            properties: { name: { type: 'string' }, version: { type: 'string' }, why: { type: 'string' } },
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

// Forward-review lanes emit the canonical note schema. Severity/judgment is deferred to the Tasklist gate.
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
          where: { type: 'string' },    // the file/area/decision the note is about
          evidence: { type: 'string' }, // the concrete concern + the suggested adjustment
        },
      },
    },
  },
}

// Tasklist gate output: the file-by-file build plan. order[0] is the skeleton/manifest root.
const TASKLIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'adjustments'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'role', 'publicSymbols', 'estLines', 'dependsOn'],
        properties: {
          path: { type: 'string' },                                  // file path under dir, e.g. src/auth/session.ts
          role: { type: 'string' },                                  // what this file is responsible for (one line)
          publicSymbols: { type: 'array', items: { type: 'string' } }, // EXACT signatures to stub (name + typed params + return type), not bare names — so importing files transcribe, not guess
          estLines: { type: 'integer' },                             // estimate; MUST be < MAX_LINES (split otherwise)
          dependsOn: { type: 'array', items: { type: 'string' } },   // other paths this file imports (for ordering/correctness)
        },
      },
    },
    adjustments: { type: 'array', items: { type: 'string' } }, // forward-review notes the gate ACCEPTED and folded in
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

// Skeleton stage result — gated before any file worker runs, so an occupied/failed target aborts
// the run instead of letting per-file workers write into a half-formed (or non-empty) tree.
const SKELETON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'detail'],
  properties: {
    status: { enum: ['created', 'occupied', 'failed'] },
    detail: { type: 'string' },
  },
}

// Tolerate a bare string (mirrors deep-research) so `/scaffold <brief>` works, not just `{brief}`.
const brief =
  typeof args === 'string' ? args : args?.brief ?? 'A small command-line tool. (Pass args.brief to describe your project.)'
// Default to a fresh subdir, never the cwd: Build writes files and Verify EXECUTES them, so a
// misparsed invocation must not clobber/run in the user's working tree. Pass args.dir to override.
const dir = args?.dir ?? './scaffold-out'
// Coerce loose arg shapes: string "false"/"true" (e.g. from a shell or a sloppy caller) must not read
// as truthy, and a non-integer/zero/negative attempts must not silently produce 0 proposals.
const bool = (v, d) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d)
const attempts = Math.min(Math.max(Math.trunc(Number(args?.attempts)) || 2, 1), 6) // independent BLIND architecture attempts (diversity knob; bump for contested briefs)
const write = bool(args?.write, true)              // false -> stop after the decision (dry run; writes nothing)
const runVerify = bool(args?.verify, true)         // false -> write the scaffold but don't EXECUTE it
const debate = bool(args?.debate, false)           // true -> one blind rebuttal round before Decide (off: token-lazy)
const polish = bool(args?.polish, false)           // true -> add a Sonnet once-over after build (off: token-lazy)
const maxLines = Math.min(Math.max(Math.trunc(Number(args?.maxFileLines)) || 400, 80), 1000) // per-file maintainability ceiling, threaded everywhere

// Discussion answers (from the `scaffold` skill). All optional; blank-friendly so a bare brief still runs.
const interface_ = args?.interface ?? 'unspecified'     // cli | tui | gui | library | service
const targetOS = Array.isArray(args?.targetOS) ? args.targetOS.join(', ') : args?.targetOS ?? 'cross-platform'
const language = args?.language ?? 'pick the best fit'
const license = args?.license ?? 'unspecified'
const priorArt = args?.priorArt ?? 'none stated'
const apiSurface = args?.apiSurface ?? 'none stated'
const willPublish = args?.publish ?? false
const wantFrontend = args?.frontend ?? (interface_ === 'gui')
const wantBackend = args?.backend ?? (interface_ === 'service')
const preferDeps = args?.deps ?? 'no preference stated'

const discussionBlock =
  `Project profile (from discussion):\n` +
  `- Interface: ${interface_}\n- Target OS: ${targetOS}\n- Language/runtime: ${language}\n` +
  `- License: ${license}\n- Will publish: ${willPublish ? 'yes' : 'no'}\n` +
  `- Public API surface: ${apiSurface}\n- Prior art / inspired by: ${priorArt}\n` +
  `- Dependency preferences: ${preferDeps}\n- Frontend involved: ${wantFrontend ? 'yes' : 'no'}\n` +
  `- Backend involved: ${wantBackend ? 'yes' : 'no'}`
const maintainabilityRule =
  `MAINTAINABILITY CONTRACT (hard): prefer well-maintained libraries over reinventing them; design for ` +
  `reuse (clear public API, small focused modules); keep EVERY source file under ${maxLines} lines. If a ` +
  `module would exceed ${maxLines} lines, split the repo structure into smaller files instead.`

// 1. Frame — strong model. Turns brief + discussion profile into requirements, hard constraints (incl.
//    the maintainability contract), the irreversible decisions each attempt must make, the candidate
//    libraries Research should vet, and the empirical success check. Sets the trajectory.
phase('Frame')
const frame = await agent(
  `Frame this build brief for a from-scratch scaffold.\nBrief: ${brief}\n\n${discussionBlock}\n\n` +
    `${maintainabilityRule}\n\n` +
    `Return: requirements; hard constraints (fold in the interface type, target OS, license, publish ` +
    `intent, public API surface, and the maintainability contract as explicit constraints); the key ` +
    `DECISIONS each architecture attempt must make (language, runtime, framework, data store, build/test ` +
    `tooling, ...); candidateLibraries — the libraries/frameworks worth researching for current version, ` +
    `vulnerabilities, and compatibility; and a successCheck — the concrete command(s)/criteria that prove ` +
    `the generated scaffold is sound.`,
  { label: 'frame', schema: FRAME_SCHEMA },
)
if (!frame) return { error: 'frame stage returned no result', brief, written: false }
const frameBlock =
  `Requirements:\n- ${frame.requirements.join('\n- ')}\n\n` +
  `Hard constraints:\n- ${frame.constraints.join('\n- ')}\n\n` +
  `Decisions each attempt must make:\n- ${frame.decisions.join('\n- ')}`

// 2 + 3. Propose || Research — both depend only on the frame, so run them CONCURRENTLY.
//    Propose: N independent attempts, BLIND to each other AND to the research (coupling kills diversity).
//    Research: Haiku lanes vetting the candidate libraries for latest version, advisories, maintenance,
//    and compatibility. Research feeds DECIDE, never the blind proposals. phase set per-agent to avoid a
//    race on the global phase() state inside concurrent groups.
const proposeThunks = Array.from({ length: attempts }, (_, i) => () =>
  agent(
    `Propose ONE independent architecture for this brief. You are blind to the other attempts and to any ` +
      `dependency research — commit to a coherent design, don't converge. Describe it; do NOT build ` +
      `anything. Honor the maintainability contract in your layout (small files under ${maxLines} lines, ` +
      `reuse over reinvention).\n\nBrief: ${brief}\n\n${frameBlock}`,
    { label: `architect:${i}`, phase: 'Propose', model: 'sonnet', schema: PROPOSAL_SCHEMA },
  ),
)
// Chunk candidate libraries into a few lanes (cap 4) so research parallelizes without over-spawning.
const candidateLibs = frame.candidateLibraries ?? []
const researchLaneCount = Math.min(Math.max(candidateLibs.length ? Math.ceil(candidateLibs.length / 3) : 1, 1), 4)
const researchChunks = Array.from({ length: researchLaneCount }, (_, i) =>
  candidateLibs.filter((_, idx) => idx % researchLaneCount === i),
)
const researchThunks = researchChunks.map((chunk, i) => () =>
  agent(
    `Research these candidate libraries for a new ${interface_} project targeting ${targetOS} ` +
      `(language: ${language}). For EACH, report the current stable version, any known security ` +
      `advisories/CVEs, maintenance signal (recent activity / maturity), compatibility with the target ` +
      `runtime/OS, and the canonical docs URL. Use the find-docs / context7 skill and web search; if a ` +
      `fact can't be confirmed, say "unknown" rather than guessing.\n\n` +
      `Libraries: ${chunk.length ? chunk.join(', ') : '(none named — return an empty libraries array)'}`,
    { label: `research:${i}`, phase: 'Research', model: 'haiku', schema: RESEARCH_SCHEMA },
  ),
)
const [proposals, researchResults] = await Promise.all([parallel(proposeThunks), parallel(researchThunks)])
const candidates = proposals.filter(Boolean)
const research = researchResults.filter(Boolean).flatMap((r) => r.libraries ?? [])
if (!candidates.length) return { error: 'no architecture proposals were produced', brief, written: false }

// 3.5. Rebuttal — arg-gated (default off), only meaningful with >1 proposal. GENERATION above stayed BLIND;
//      now that the proposals are LOCKED, each proposer attacks the others in ONE round (coupling after lock
//      keeps diversity intact). Sonnet, no schema (free-text paragraph). Feeds DECIDE so its "which is better"
//      judgment has adversarial input instead of judging the proposals cold.
let rebuttals = []
if (debate && candidates.length > 1) {
  phase('Rebuttal')
  rebuttals = (
    await parallel(
      candidates.map((_, i) => () =>
        agent(
          `You authored proposal #${i} below. The proposals were written BLIND to each other; now argue your ` +
            `case. In ONE paragraph: why is YOUR design the better choice for this brief, and where are the ` +
            `others weaker or riskier? Be specific and concrete; no hedging. One round only.\n\n` +
            `Brief: ${brief}\n\n${frameBlock}\n\nProposals:\n${JSON.stringify(candidates, null, 2)}`,
          { label: `rebuttal:${i}`, phase: 'Rebuttal', model: 'sonnet' },
        ),
      ),
    )
  ).filter(Boolean)
}

// 4. Decision gate — strong model, fresh context. Judges the blind attempts against the frame AND the
//    research, picks ONE or merges the strongest elements, and PINS dependency versions from the research
//    (flagging anything with advisories). Records rejected alternatives + WHY and the canonical commands.
phase('Decide')
const researchBlock = research.length
  ? `Dependency research (use to pin versions and avoid advisories):\n${JSON.stringify(research, null, 2)}`
  : 'No dependency research was available.'
const rebuttalBlock = rebuttals.length
  ? `\n\nProposer rebuttals (each argues its OWN design is best — weigh them, do not rubber-stamp):\n- ${rebuttals.join('\n\n- ')}`
  : ''
const decision = await agent(
  `You are an architecture decision gate. Below are ${candidates.length} INDEPENDENT proposals for the ` +
    `same brief, plus dependency research. Judge the proposals against the frame, then output ONE ` +
    `architecture — pick the strongest or merge the best elements into a coherent whole. Use the research ` +
    `to PIN concrete dependency versions and to avoid libraries with open advisories or poor maintenance. ` +
    `Honor the maintainability contract. Give the rationale, list rejected alternatives with WHY each was ` +
    `rejected, and specify the concrete install/test (and build/lint/run if relevant) commands.\n\n` +
    `Brief: ${brief}\n\n${frameBlock}\n\n${researchBlock}\n\nProposals:\n${JSON.stringify(candidates, null, 2)}${rebuttalBlock}`,
  { label: 'decide', schema: DECISION_SCHEMA },
)
if (!decision?.chosen) return { error: 'decision stage returned no architecture', brief, written: false }

// Dry run: stop before writing anything — review the architecture + commands first.
if (!write) {
  return {
    brief,
    attempts: candidates.length,
    chosen: decision.chosen,
    rationale: decision.rationale,
    rejected: decision.rejected,
    commands: decision.commands,
    research,
    debated: debate && candidates.length > 1 ? rebuttals.length : false,
    written: false,
  }
}

const chosenBlock = `Chosen architecture:\n${JSON.stringify(decision.chosen, null, 2)}\nTarget directory: ${dir}`

// 5. Forward-review lanes — Sonnet WORKERS reviewing the PLANNED architecture (no code exists yet), like a
//    code review aimed forward. Each lane owns a theme and returns adjustment notes; the strong Tasklist
//    gate judges/folds them. 4 core lanes, +frontend if frontend, +backend if backend. They share the
//    chosen arch read-only and never write.
phase('Review')
const lanes = [
  { focus: 'maintainability', ask: `Flag any module in the layout that would plausibly exceed ${maxLines} lines or mixes too many concerns; propose how to split the repo structure. Flag missing separation between layers.` },
  { focus: 'reusability+api', ask: `Critique the public API shape and naming for reusability. Flag anything reinvented that a well-maintained library covers, and anything that should be a clear seam/module instead of inline.` },
  { focus: 'testability', ask: `Flag designs that will be hard to test (hidden side effects, no seams for dependency injection, global state). Propose the seams the stubs should expose so the smoke tests are real.` },
  { focus: 'dependency+security', ask: `Cross-check the chosen dependencies against the research: flag pinned versions with advisories, unmaintained libs, or runtime/OS-compat risks for ${targetOS}. Suggest safer alternatives where warranted.` },
]
if (wantFrontend) lanes.push({ focus: 'frontend', ask: `Act as a senior frontend engineer. Review component/state/data-flow structure, accessibility basics, and rendering boundaries for this ${interface_} project. Flag concrete weaknesses and the modules the stubs should expose.` })
if (wantBackend) lanes.push({ focus: 'backend', ask: `Act as a senior backend engineer. Review service boundaries, data model, error/IO handling, and the API surface (${apiSurface}). Flag concrete weaknesses and the seams the stubs should expose.` })
const laneResults = await parallel(
  lanes.map((lane, i) => () =>
    agent(
      `Forward-review the PLANNED architecture below for one theme and return compact notes only (no ` +
        `transcript). Nothing is built yet — you are reviewing the design before code exists.\n` +
        `Theme: ${lane.focus}\nWhat to check: ${lane.ask}\n\n${maintainabilityRule}\n\n${chosenBlock}\n\n` +
        `Research:\n${JSON.stringify(research, null, 2)}\n\n` +
        `For each concern: type "finding", "where" = the file/area/decision, "evidence" = the concrete ` +
        `problem + the suggested adjustment. Use "constraint" for facts the build must respect, "failure" ` +
        `for anything you could not assess.`,
      { label: `review:${lane.focus}`, phase: 'Review', model: 'sonnet', schema: NOTE_SCHEMA },
    ),
  ),
)
const reviewNotes = laneResults.filter(Boolean).flatMap((r) => r.notes ?? [])

// 6. Tasklist gate — strong model, fresh context. The admission gate: judge the forward-review notes,
//    fold the ones worth acting on, and emit the file-by-file build plan. ENFORCE the line ceiling here —
//    every file estLines < ${maxLines}; split oversized modules into multiple file tasks.
phase('Tasklist')
const tasklist = await agent(
  `You are the build-plan gate. Below is the chosen architecture and forward-review notes from independent ` +
    `lanes. JUDGE the notes (drop unsupported/contradictory ones), fold the valuable adjustments into the ` +
    `plan, and emit a file-by-file build plan for the scaffold. RULES: one task = one file; every file's ` +
    `estLines MUST be under ${maxLines} — if a module would exceed it, split it into multiple files. Cover ` +
    `the whole tree the layout implies (source modules + their stubs), not just the entry point. For each ` +
    `file give path (under "${dir}"), role, the public symbols to stub AS EXACT SIGNATURES (name + typed ` +
    "params + return type, e.g. `getUser(id: string): Promise<User>`) so importing files transcribe rather " +
    `than guess, an estLines estimate, and dependsOn (other paths it imports). List the adjustments you ` +
    `ACCEPTED.\n\n${chosenBlock}\n\n` +
    `Forward-review notes:\n${JSON.stringify(reviewNotes, null, 2)}`,
  { label: 'tasklist', schema: TASKLIST_SCHEMA },
)
const files = (tasklist?.files ?? []).filter((f) => f?.path)
if (!files.length) return { error: 'tasklist stage returned no files to build', brief, dir, written: false }
// Pure-script admission of the plan's PATHS before any parallel worker claims one: a traversal/absolute
// path would write outside ${dir}, a duplicate would put two workers on the same file (a real write race
// the "distinct path per worker" assumption relies on). Cheaper and more reliable than asking an agent.
const badPaths = files
  .map((f) => f.path)
  .filter((p) => p.startsWith('/') || p.includes('..') || p.endsWith('/') || !/^[A-Za-z0-9._/@+-]+$/.test(p))
const dupePaths = files.map((f) => f.path).filter((p, i, all) => all.indexOf(p) !== i)
if (badPaths.length || dupePaths.length) {
  return { error: 'invalid tasklist paths', badPaths, dupePaths: [...new Set(dupePaths)], brief, dir, written: false }
}

// 7. Build — DAG. Skeleton/manifest first (DAG root: dirs + manifest + minimal entry that parses), THEN a
//    parallel worker per file task (each owns a DISTINCT path -> no write race), plus tests/CI/README.
//    Workers are Haiku: writing one stub from an explicit task is mechanical and checkable.
phase('Build')
const stubContract =
  `STUB CONTRACT: write the file's public surface only — signatures, types/interfaces, and a header ` +
  `comment + per-symbol docstrings stating intent. Bodies raise NotImplementedError / return a TODO ` +
  `placeholder (idiomatic for the language). Implement no real logic. Keep the file under ${maxLines} ` +
  `lines. It must parse/compile.`
// Cross-file signature index: each worker stubs ONE file BLIND to its siblings, so hand it the EXACT
// signatures of the symbols it imports (emitted once by the Tasklist gate) rather than letting Haiku
// re-invent them — prevents getThing/fetchThing drift. Verify stays the backstop.
const sigByPath = new Map(files.map((f) => [f.path, f.publicSymbols ?? []]))
// Three ordered barriers, not one parallel group: the file stubs assume the skeleton exists, and the
// tests/CI/README workers assume the stubs + manifest exist (the CI/README prompts literally say so).
// Firing them all together raced those reads against the writes they depend on.
const skeleton = await agent(
  `Create the project skeleton on disk under "${dir}" per the chosen layout: the directory structure, the ` +
    `manifest (package.json / pyproject.toml / go.mod / ... for the stack with the PINNED dependencies), ` +
    `and a minimal entry point that parses. Implement no features. SAFETY: if "${dir}" already exists and ` +
    `is non-empty, or already contains a manifest, do NOT overwrite anything — report status "occupied". ` +
    `Report "created" only if you wrote the skeleton, "failed" if you could not.\n\n` +
    `${chosenBlock}\nDependencies to pin: ${JSON.stringify(decision.chosen.dependencies)}`,
  { label: 'skeleton', model: 'haiku', schema: SKELETON_SCHEMA },
)
if (skeleton?.status !== 'created') {
  return { error: 'skeleton not created', skeleton: skeleton ?? null, brief, dir, written: false }
}
// Barrier 1: one worker per file, each owns a DISTINCT path (validated above) -> no write race.
const fileStubThunks = files.map((f) => () =>
  agent(
    `The skeleton exists under "${dir}". Create EXACTLY this one file and nothing else: "${f.path}".\n` +
      `Role: ${f.role}\nPublic symbols to stub (use these EXACT signatures): ${(f.publicSymbols ?? []).join(', ') || '(as the role implies)'}\n` +
      `Imports it depends on: ${(f.dependsOn ?? []).join(', ') || '(none)'}\n` +
      `Exact signatures of the symbols in those imports — transcribe, do NOT invent names:\n${
        (f.dependsOn ?? [])
          .map((d) => `  ${d}: ${(sigByPath.get(d) ?? []).join('; ') || "(see that file's role)"}`)
          .join('\n') || '  (none)'
      }\n\n${stubContract}\n\n` +
      `SAFETY: if the file already exists, do NOT overwrite — report it instead.`,
    { label: `build:${f.path}`, phase: 'Build', model: 'haiku' },
  ),
)
const stubResults = (await parallel(fileStubThunks)).filter(Boolean)
// Barrier 2: tests/CI/README run ONLY after the stubs + manifest are on disk (they read them).
const supportThunks = [
  () =>
    agent(
      `The skeleton + stubs exist under "${dir}". Add a minimal but real test setup wired to the project's ` +
        `test runner, with at least one passing smoke test against the stubs.\n\n${chosenBlock}\n` +
        `Test command: ${decision.commands.test}`,
      { label: 'tests', phase: 'Build', model: 'haiku' },
    ),
  () =>
    agent(
      `The manifest exists under "${dir}". Write a CI workflow (.github/workflows/ci.yml). Run ONLY the ` +
        `non-empty commands below; skip any blank one, do not invent a command for it: ` +
        `install="${decision.commands.install}", build="${decision.commands.build ?? ''}", ` +
        `test="${decision.commands.test}".\n\n${chosenBlock}`,
      { label: 'ci', phase: 'Build', model: 'haiku' },
    ),
  () =>
    agent(
      `Write a README.md under "${dir}": what the project is (from the brief), how to install/build/run/test ` +
        `(use the commands), the layout, and the license (${license}). Drafting only.\n\n` +
        `Brief: ${brief}\n${chosenBlock}\nCommands: ${JSON.stringify(decision.commands)}`,
      { label: 'docs', phase: 'Build', model: 'haiku' },
    ),
]
const supportResults = (await parallel(supportThunks)).filter(Boolean)

// 8. Checks — deterministic admission of the HARD constraints (Haiku, read-only shell, NO project code run).
//    Runs on the write path even when verify:false: wc -l vs the line ceiling, docstring/header presence per
//    public symbol, and a smoke-test file present. Validates the < maxLines hard constraint against ACTUAL
//    files (Tasklist only enforced it on an estimate). Free: no model judgment, just find/wc -l/grep.
let checks = null
if (write) {
  phase('Checks')
  checks = await agent(
    `Run deterministic, READ-ONLY checks on the scaffold under "${dir}". Do NOT install, build, run, or ` +
      `execute any project code — only file inspection (wc -l, grep/cat). Check ONLY the authored source ` +
      `files listed below; NEVER scan node_modules, .git, dist, build, coverage, vendored, or generated ` +
      `files, and ignore lockfiles. Report one results entry per check:\n` +
      `1. Line ceiling: each LISTED source file's line count is UNDER ${maxLines} (wc -l). status "fail" ` +
      `with the path and count for ANY listed file at or over the ceiling.\n` +
      `2. Docstrings: each listed file's stubbed public symbols have a docstring/header comment stating ` +
      `intent (grep). status "fail" naming any file/symbol missing one.\n` +
      `3. Smoke test: at least one non-empty test file exists in the project's own test location (NOT under ` +
      `node_modules). status "fail" if absent.\n` +
      `Set passed=true ONLY if every check passes. step = the check name, status = pass/fail, detail = the ` +
      `offending path(s) or "ok".\n\n` +
      `Authored source files to check:\n${JSON.stringify(files.map((f) => f.path))}`,
    { label: 'checks', model: 'haiku', schema: VERIFY_SCHEMA },
  )
}

// 9. Once-over — optional Sonnet JUDGMENT pass (off by default; token-lazy). The MECHANICAL checks (line
//    ceiling, docstring presence) moved to the deterministic Checks stage above; this pass is judgment-only:
//    duplication, cross-file consistency, and that the public API matches the tasklist. Fixes minor drift
//    only; does NOT implement features.
let onceOver = null
if (polish) {
  phase('Once-over')
  onceOver = await agent(
    `Review the freshly scaffolded stubs under "${dir}" as a senior engineer. This is a JUDGMENT pass — the ` +
      `line ceiling and docstring presence are already checked deterministically, so do NOT re-count lines. ` +
      `Verify: the files match the build plan's public symbols/signatures, imports line up across files, ` +
      `naming is consistent, and there is no obvious duplication. Fix ONLY minor drift (a stray import, a ` +
      `symbol named inconsistently with its signature, duplicated boilerplate). Do NOT implement features. ` +
      `Report what you changed and anything left for the developer.\n\n` +
      `Build plan:\n${JSON.stringify(files, null, 2)}`,
    { label: 'once-over', model: 'sonnet' },
  )
}

// 10. Verify — empirical admission gate for the generated code (run-and-report -> Haiku). Runs the chosen
//    install/build/test and reports pass/fail. No auto-repair. Gated by runVerify.
let verify
if (runVerify) {
  phase('Verify')
  verify = await agent(
    `Run the success check against the scaffold in "${dir}" and report results. Run, in order, capturing ` +
      `each outcome: install ("${decision.commands.install}"), build ("${decision.commands.build ?? ''}"), ` +
      `test ("${decision.commands.test}"). Run ONLY steps with a non-empty command; mark any blank step ` +
      `"skip" and do NOT invent a command for it. Success criteria: ${frame.successCheck}. Set passed=true ` +
      `only if the required steps succeed. Report each step's status and a short detail (the error head on ` +
      `failure). Do not fix anything.`,
    { label: 'verify', model: 'haiku', schema: VERIFY_SCHEMA },
  )
} else {
  verify = { passed: null, results: [], skipped: true } // verify:false — scaffold written, not run
}

// 11. Write-back — an agent writes the new project's CLAUDE.md (the script can't). Records the durable
//     decisions a future session would otherwise re-derive/re-litigate: commands, key choices + WHY,
//     rejected alternatives, plus license/publish/API surface, pinned dep versions, and the line ceiling.
//     SONNET, not the strong model: it's the last stage, nothing propagates from it (model-routing.md).
phase('Write-back')
await agent(
  `Write a lean CLAUDE.md (under ~200 lines) at "${dir}/CLAUDE.md" for the freshly scaffolded project. If a ` +
    `CLAUDE.md already exists there, do NOT clobber it — read it first and merge the new decisions in. ` +
    `Include: the build/run/test commands; the hard constraints and key architecture choices WITH rationale; ` +
    `the rejected alternatives with why; the license (${license}) and publish intent (${willPublish ? 'will publish' : 'not publishing'}); ` +
    `the public API surface; the PINNED dependency versions with why; and the maintainability convention ` +
    `(files under ${maxLines} lines, reuse over reinvention). Do NOT document the obvious file tree or ` +
    `framework version.\n\n` +
    `Commands: ${JSON.stringify(decision.commands)}\n` +
    `Chosen + rationale: ${JSON.stringify({ chosen: decision.chosen, rationale: decision.rationale }, null, 2)}\n` +
    `Rejected: ${JSON.stringify(decision.rejected, null, 2)}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  brief,
  dir,
  attempts: candidates.length,
  chosen: decision.chosen.stack,
  dependencies: decision.chosen.dependencies?.length ?? 0,
  filesPlanned: files.length,
  stubsWritten: stubResults.length,        // workers that returned (vs files.length planned)
  supportWritten: supportResults.length,   // tests/CI/README workers that returned (of 3)
  reviewNotes: reviewNotes.length,
  rejected: decision.rejected.length,
  debated: debate && candidates.length > 1 ? rebuttals.length : false,
  checksPassed: checks?.passed ?? null,                  // null when write:false OR checks agent returned nothing
  polished: polish ? Boolean(onceOver) : null,
  verified: runVerify ? verify?.passed ?? null : null, // null when verify:false OR verify agent returned nothing
  steps: verify?.results ?? [],
  written: true,
}
