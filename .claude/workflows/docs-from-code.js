// docs-from-code — document a whole CODEBASE into an Astro Starlight site, using an Eatahorse board as a
//   DURABLE, RESUMABLE ledger:
//     enumerate source -> frame-IA + plan (one card per PAGE) -> seed cards -> [author rounds: parallel
//     page authors + one sync + grounding gate, loop-until-dry] -> gather admitted -> assemble config ->
//     write-back.
//
// FUSION, not "eatahorse-research with a docs prompt" (a doc page is NOT a source file):
//   - Board substrate from eatahorse-research.js: durable resumable ledger, single-writer discipline,
//     loop-until-dry with load caps, a grounding gate that re-reads source.
//   - IA framing + Starlight authoring contract + assemble from docs-create.js: group BY READER TASK,
//     tag Diátaxis, emit content + config.
//   - The UNIT is one card per planned doc page (≈ a module), each carrying a file SCOPE (the source it
//     covers). Cards seed from the PAGE PLAN, never one-per-file — per-file done-ness would coarsen the
//     reader-facing page set. Some source files contribute to no page; that is correct.
//
// DECIDED SHAPE (this build):
//   1. Output = content + config, NOT a full buildable project (mirror docs-create). The grounding gate
//      is the REAL verifier: it re-reads the page's scope SOURCE and reopens any page whose claims the
//      code doesn't back — that catches hallucinated APIs, the code->docs failure mode. `astro check`
//      runs only if outDir is already buildable, else "skipped: not a buildable project".
//   2. Default page set = reference + module overviews (groundable from source). Tutorials/getting-started
//      need intent the source rarely states, so Plan DEFERS them (needsHumanBrief) instead of authoring
//      confidently-wrong pages the gate would keep reopening. args.includeTutorials=true opts in.
//
// NOTED DEVIATIONS (CLAUDE.md "Bending") — same as eatahorse-research.js:
//   1. Shared MUTABLE store (the board), made race-free by WRITE DISCIPLINE: within a round every page
//      author writes ONLY its own page file (under outDir) + its own card markdown (under the board) — both
//      distinct paths — and runs NO eatahorse CLI. The ONLY writer of state.json/board.md is the single
//      sync agent that runs alone after the round. EATAHORSE_NO_AUTOSYNC=1 silences the Stop/SessionEnd sync.
//   2. Board DOUBLES as durable resume state; we still run the CLAUDE.md write-back for the cross-cutting
//      summary + deferred/skipped constraints.
//   3. Script has NO filesystem access (VM sandbox): enumeration, all board I/O, page writes, and config
//      assembly happen INSIDE agents. The loop terminates on the sync agent's returned active count.
//
// PERMISSIONS: READS source files; WRITES under outDir (the site), the board dir, and CLAUDE.md. Does not
//   modify the documented source. Runs under the session allowlist.
//
// Knobs (args): root (or bare string), outDir (required), framework (default starlight), board, brief,
//   workerModel (default sonnet), maxRounds (default 3), includeTutorials (default false), filesPerPage,
//   pages (skip Plan), include/exclude globs, scriptPath (eatahorse.py).
//
// requires-skills: eatahorse, docs-site-builder, document-codebase
//   (Bundling only. The eatahorse CLI surface is distilled INLINE as CMD/cli() and sliced per-agent; the
//    Starlight CONTRACT + IA_CONTRACT are distilled inline from docs-site-builder. Those consts are the
//    runtime source of truth; the bundled skills are the portable copies. Workflow stages do NOT auto-load
//    skills. See .claude/rules/workflow-design.md.)
// Run with /workflows or copy via `npx @whit3rabbit/rabbit-flows`.
// (`node --check` flags the trailing top-level return as "illegal return" — expected; the runtime wraps the
//  script in an async function. Same as eatahorse-research.js / docs-create.js.)
export const meta = {
  name: 'docs-from-code',
  description:
    'Document a whole codebase into a Starlight site using an Eatahorse board as a durable resumable ledger: enumerate source, frame IA and plan one card per module page, fan out grounded authors gated and synced until dry, then assemble config and write back.',
  phases: [
    { title: 'Enumerate' },
    { title: 'Plan' },
    { title: 'Seed' },
    { title: 'Author' },
    { title: 'Gate' },
    { title: 'Assemble' },
    { title: 'Write-back' },
  ],
}

// --- Starlight authoring contract (distilled from docs-site-builder, v0.40.0) -------------------
// Runtime source of truth for page authors. Refresh from plugins/workflow-kit/skills/docs-site-builder/
// references/*.md if the skill changes. Kept identical to docs-create.js CONTRACT on purpose.
const CONTRACT = `STARLIGHT AUTHORING CONTRACT (authoritative; do not re-derive syntax from memory).

PROJECT
- Content lives under src/content/docs/** as .md or .mdx. Route = file path. Use .mdx ONLY when the
  page uses components; plain prose stays .md.
- Content collection (src/content.config.ts):
    import { defineCollection } from 'astro:content';
    import { docsLoader } from '@astrojs/starlight/loaders';
    import { docsSchema } from '@astrojs/starlight/schema';
    export const collections = { docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }) };

FRONTMATTER (per page)
- title (required), description.
- template: doc (default) | splash (landing pages).
- sidebar: { label?, order?, badge?, hidden? }.
- hero (splash pages): { tagline, image?, actions: [{ text, link, icon?, variant: primary|secondary|minimal }] }.
- Also available: banner, tableOfContents, lastUpdated, prev, next, draft.

astro.config.mjs
    import starlight from '@astrojs/starlight';
    starlight({
      title: '...', description: '...',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://...' }],   // ARRAY of objects (v0.40), not the old object map
      sidebar: [ /* see below */ ],
    })
- Sidebar items:
    group:        { label: 'Guides', items: [ ... ], collapsed?: true }
    page by slug: { slug: 'guides/getting-started' }
    explicit link:{ label: 'Home', link: '/' }
    autogenerate: { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] }  // v0.39+: wrap in items; bare { autogenerate } (no label) is also valid standalone
    badge:        { slug: '...', badge: { text: 'New', variant: 'tip' } }

COMPONENTS (MDX only): import { Aside, Badge, Card, CardGrid, FileTree, Icon, LinkButton, LinkCard, Steps, Tabs, TabItem } from '@astrojs/starlight/components';
- Aside:   <Aside type="note|tip|caution|danger" title?="..." icon?="...">...</Aside>  (markdown form: :::note / :::tip[Custom title])
- Tabs:    <Tabs syncKey?="pkg"><TabItem label="npm" icon?="seti:npm">...</TabItem>...</Tabs>  (label required)
- Steps:   <Steps> wraps an ordered markdown list (1. 2. 3.); each step may hold code blocks.
- Card:    <Card title="..." icon?="rocket">...</Card>;  <CardGrid stagger?>...</CardGrid> wraps Cards.
- LinkCard:<LinkCard title="..." href="..." description?="..." />
- LinkButton: <LinkButton href="..." variant?="primary|secondary|minimal" icon?="..." iconPlacement?="start|end" />
- FileTree:<FileTree> wraps a markdown nested list of files/dirs.
- Badge:   <Badge text="..." variant?="note|tip|caution|danger|success|default" size?="small|medium|large" />

CODE BLOCKS (Expressive Code, built in): fence with options, e.g.
    \`\`\`js title="src/util.js" {1,3-5} ins={2} del={4}
- title="..." adds a frame title; {1,3-5} highlights lines; ins=/del= mark added/removed lines.`

// --- IA contract (distilled from docs-site-builder/references/information-architecture.md) -------
// Kept identical to docs-create.js IA_CONTRACT. Design before syntax; injected into Plan + every author.
const IA_CONTRACT = `DOCS INFORMATION-ARCHITECTURE CONTRACT (authoritative; design before syntax).

DIÁTAXIS — every page serves exactly ONE reader need. Never mix modes on one page.
- tutorial    (reader is LEARNING): a guided first success. Hand-held, one happy path, no choices.
- howto       (reader is WORKING): one specific task done. Goal-directed, assumes competence.
- reference   (reader is LOOKING SOMETHING UP): exhaustive, accurate, scannable. No narrative/opinion.
- explanation (reader is UNDERSTANDING): context + the "why" + tradeoffs. Discursive, no steps.
- index/splash (structural): routes the journey — what this is, who it's for, links to each quadrant.

SECTION TEMPLATE per kind (the author MUST follow the matching skeleton):
- tutorial:    prerequisites -> numbered steps (each a visible runnable result) -> final result -> next steps.
- howto:       goal up front -> ordered steps -> a verification step. Omit teaching.
- reference:   consistent exhaustive entries, grouped/alphabetised, same shape each (signature, params, returns, example). No narrative.
- explanation: context (why it exists) -> discussion -> tradeoffs/alternatives. No step-by-step.
- index/splash: what/who/entry-points; route first-touch readers to the right quadrant.

NAVIGATION: shallow over deep (<=2 sidebar levels); group by user task not internal module; a landing
page routes the journey; order groups first-touch -> proficient.

WRITING: task-oriented headings ("Deploy to production" not "Deployment"); examples first; one concept
per page; scannable (short paragraphs, code early, lists); define jargon once.

CODEBASE GROUNDING: this set is generated FROM SOURCE. A reference or module-overview page states facts
that live in the code (signatures, exports, config keys, CLI flags) — never invent them; cite file:area.
A tutorial/getting-started page needs INTENT the source rarely states; default to DEFERRING those for a
human brief rather than guessing.`

// --- args / guards -----------------------------------------------------------------------------
const root = typeof args === 'string' ? args : args?.root ?? '.'
const outDir = typeof args?.outDir === 'string' ? args.outDir : null
const framework = args?.framework ?? 'starlight'
const isStarlight = framework === 'starlight'
const brief = typeof args?.brief === 'string' ? args.brief : ''
const board = args?.board ?? '.eatahorse-docs'
const workerModel = args?.workerModel ?? 'sonnet'      // page authoring is real writing, not mechanical -> sonnet (model-routing.md)
const maxRounds = Math.min(args?.maxRounds ?? 3, 10)
const includeTutorials = args?.includeTutorials === true
const filesPerPage = args?.filesPerPage ?? 12          // soft ceiling: split oversized modules into sub-pages at plan time so no author reads 40 files
const include = args?.include ?? ''
const exclude = args?.exclude ?? ''
const explicitPages = Array.isArray(args?.pages) ? args.pages.filter(Boolean) : null
const scriptPath = args?.scriptPath ?? 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py'

if (!outDir) return { error: 'args.outDir is required (dir to write the docs site into)', got: { root, outDir } }

const ENUM_CAP = 5000        // hard cap on source files enumerated in one run
const LIVE_CAP = 40          // max pages authored per ROUND; the rest stay in backlog and carry forward
const RUN_TOUCH_CAP = 200    // ponytail: per-RUN ceiling on distinct pages authored; keeps authors+sync+gate under the 1000-agent lifetime cap. rerun continues from backlog. raise if a run must cover more pages in one pass.
const BUDGET_FLOOR = 50_000  // stop opening new rounds below this many remaining output tokens
const MAX_ATTEMPTS = 2       // drop a page after this many failed rounds so a permanently-failing one isn't re-run every round

// Only Starlight has an inline authoring contract; other frameworks author from current official docs.
const authoringContract = isStarlight ? CONTRACT
  : `AUTHORING NOTE: there is NO inline syntax contract for "${framework}". Do NOT emit Starlight syntax. ` +
    `Author from the CURRENT official ${framework} documentation (use the find-docs skill / context7). ` +
    `Never invent config keys, frontmatter, or component syntax from memory. Mark anything you are unsure of.`
if (!isStarlight) log(`framework="${framework}" has no inline contract; authors work from current ${framework} docs. Starlight is the first-class path.`)

// --- schemas -----------------------------------------------------------------------------------
const ENUM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['files', 'total', 'truncated'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    total: { type: 'integer' },
    truncated: { type: 'boolean' },
  },
}

// Plan: reader-facing pages, each carrying a file SCOPE so the author + grounding gate know which source to
// read. Tutorials/getting-started land in `deferred` unless includeTutorials.
const PLAN_SCHEMA = {
  type: 'object', required: ['pages'], additionalProperties: false,
  properties: {
    pages: { type: 'array', items: {
      type: 'object', required: ['path', 'title', 'kind', 'group', 'brief', 'diataxisType', 'template', 'scope'], additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'repo-relative under outDir, e.g. src/content/docs/reference/cli.md(x)' },
        title: { type: 'string' },
        kind: { enum: ['index', 'splash', 'guide', 'reference'] },
        group: { type: 'string', description: 'sidebar group label' },
        brief: { type: 'string', description: 'what this page must cover' },
        diataxisType: { enum: ['tutorial', 'howto', 'reference', 'explanation', 'index', 'splash'] },
        template: { type: 'string', description: 'section skeleton for this diataxisType' },
        scope: { type: 'array', items: { type: 'string' }, description: 'the source files this page documents (the author + gate read these)' },
      } } },
    deferred: { type: 'array', items: {
      type: 'object', required: ['title', 'reason'], additionalProperties: false,
      properties: { title: { type: 'string' }, reason: { type: 'string' } },
      description: 'pages that need a human brief (e.g. tutorials whose intent is not in the source)' } },
  },
}

const SEED_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['cards'],
  properties: { cards: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['title', 'mdPath', 'status'],
    properties: { title: { type: 'string' }, mdPath: { type: 'string' }, status: { type: 'string' } } } } },
}

const SYNC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['activeRemaining', 'done'],
  properties: { activeRemaining: { type: 'integer' }, done: { type: 'integer' } },
}

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['hollow', 'checked'],
  properties: { hollow: { type: 'array', items: { type: 'string' } }, checked: { type: 'integer' } },
}

const DONE_TITLES_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['titles'],
  properties: { titles: { type: 'array', items: { type: 'string' } } },
}

const FINAL_SCHEMA = {
  type: 'object', required: ['configWritten', 'buildResult', 'summary'], additionalProperties: false,
  properties: {
    configWritten: { type: 'boolean' },
    buildResult: { type: 'string', description: 'astro check output summary, or "skipped: not a buildable project"' },
    planPath: { type: 'string', description: 'path to the written .docs-plan.md' },
    decisions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// Sliced per-agent: cli(...) hands each board-touching prompt ONLY the commands its steps call. Page
// authors run NO CLI — they get CARD_MD (markdown layout) only. Keep `reopen` consistent with the sibling
// CMD in eatahorse{,-research}.js by hand (no runtime sharing in the VM sandbox).
const CLI_HEAD =
  `Eatahorse CLI (stdlib python, no deps): python3 "${scriptPath}" --board "${board}" <cmd>. ` +
  `If absent: find . -name eatahorse.py -path '*eatahorse*'.`
const CMD = {
  report: `report --json -> {counts, active, done}  (read "active" and "done")`,
  list:   `list [--status s] [--json] -> cards (id,title,status,path)`,
  show:   `show <id> [--json] -> card incl. "description" (holds page path + scope)`,
  init:   `init "<name>"  (errors if a board exists)`,
  add:    `add "<title>" --status backlog -d "<desc>" --bite "author it" --accept "page written and grounded in source"`,
  reopen: `reopen <id> [--gap "<why hollow>"]  (atomic: uncheck acceptance + add gap bite + move doing)`,
  sync:   `sync  (reconcile cards <-> state.json + board.md; run after edits)`,
}
const cli = (...k) => CLI_HEAD + `\nCommands:\n  ` + k.map((x) => CMD[x]).join('\n  ')
// Card layout only — for the page author, which writes its page file + edits its own card markdown, no CLI.
const CARD_MD =
  `Card markdown: a "## Notes" section + checkbox sections "## One-bite-at-a-time plan" and ` +
  `"## Acceptance checks" with "- [ ]"/"- [x]" items. In "## Notes" record ONE line: the written page path ` +
  `+ a one-line grounding summary (do NOT paste the page body here). Tick ALL boxes to auto-complete on sync.`

// 1. Enumerate — haiku, mechanical. List the SOURCE files to document. Script can't touch the FS.
phase('Enumerate')
const enumed = await agent(
  `List the source files to document under "${root}". Prefer \`git ls-files\` when "${root}" is a git repo, ` +
    `else \`find\`. SKIP .git, node_modules, dist/build, vendored, lockfiles, binary/media, and SKIP the docs ` +
    `output dir "${outDir}" and the board dir "${board}" (do not document generated output). ` +
    `${include ? `INCLUDE only paths matching: ${include}. ` : ''}${exclude ? `EXCLUDE paths matching: ${exclude}. ` : ''}` +
    `Return repo-relative paths. Cap the list at ${ENUM_CAP}; if more exist set truncated=true and report the true total.`,
  { label: 'enumerate', model: 'haiku', schema: ENUM_SCHEMA },
)
const files = (enumed?.files ?? []).filter(Boolean)
if (!files.length) return { root, outDir, error: 'no source files enumerated', written: false }
if (enumed.truncated) log(`enumerate: capped at ${files.length} of ${enumed.total} files; the rest are not covered this run`)

// 2. Plan — strong model (inherits session; this is the decompose stage where a mistake propagates). One
//    call frames IA over the tree + entry points and emits the PAGE plan: group by reader task, tag Diátaxis,
//    attach a file SCOPE, split modules over ~${filesPerPage} files into sub-pages, defer tutorials.
phase('Plan')
let pages = explicitPages
let deferred = []
if (!pages) {
  const plan = await agent(
    `You are planning a ${framework} documentation site generated FROM a codebase. Apply the IA contract: ` +
      `group BY READER TASK (not internal module layout), merge trivial dirs, split god-modules.\n\n` +
      `Source files (${files.length}${enumed.truncated ? ` of ${enumed.total}` : ''}):\n${JSON.stringify(files)}\n\n` +
      (brief ? `Author brief / focus:\n${brief}\n\n` : '') +
      `READ the entry points first to frame the IA: the README, the package/manifest file, and the public ` +
      `exports / main modules / CLI entry. Then produce a FOCUSED set of pages (prefer FEWER, well-scoped ` +
      `pages over many thin ones). For each page give:\n` +
      `- path: repo-relative under "${outDir}", e.g. src/content/docs/reference/cli.md (use .mdx ONLY if it needs components)\n` +
      `- title, kind (index|splash|guide|reference), group (sidebar group label), brief (what it must cover).\n` +
      `- diataxisType: the ONE reader need this page serves.\n` +
      `- template: the section skeleton for that diataxisType (from the IA contract), tailored to this page.\n` +
      `- scope: the SOURCE files this page documents (the author and the grounding gate read exactly these). ` +
      `Keep scope <= ~${filesPerPage} files; if a module is bigger, SPLIT it into sub-pages.\n\n` +
      `DEFAULT to pages a codebase can GROUND: reference pages + module overviews + one index/splash. ` +
      (includeTutorials
        ? `You MAY also include tutorial/getting-started pages; ground every concrete claim in source.\n`
        : `Put any tutorial/getting-started page into \`deferred\` (with a reason) instead of \`pages\` — its ` +
          `intent is not in the source and a guessed tutorial would fail the grounding gate.\n`) + `\n` +
      `IA CONTRACT\n${IA_CONTRACT}\n\nAuthoring contract for reference:\n${authoringContract}`,
    { label: 'plan', schema: PLAN_SCHEMA },
  )
  pages = (plan?.pages ?? []).filter(Boolean)
  deferred = plan?.deferred ?? []
}
if (!pages.length) return { root, outDir, error: 'planning produced no pages', written: false }
const pageByPath = new Map(pages.map((p) => [p.path, p]))
log(`planned ${pages.length} page(s)${deferred.length ? `; deferred ${deferred.length} (needs human brief)` : ''}: ${pages.map((p) => p.path).join(', ')}`)

// 3. Seed — haiku. One card per PAGE (title = page path). The card description holds the page path + scope
//    so the grounding gate can recover which source to re-read. Resume-safe: don't re-add or un-done cards.
phase('Seed')
const descOf = (p) => `path=${p.path} | diataxis=${p.diataxisType} | scope=${(p.scope ?? []).join(',')} | ${p.brief}`
const seed = await agent(
  `Ensure an Eatahorse board exists at "${board}" and holds one "backlog" card per page below. Steps:\n` +
    `1. \`report --json\`; if it errors (no board), \`init "Docs: ${root.replace(/"/g, "'")}"\`.\n` +
    `2. \`list --json\` to see existing cards. For EACH page whose "path" is NOT already a card title, ` +
    `\`add "<path>" --status backlog -d "<description>" --bite "author it" --accept "page written and grounded in source"\`. ` +
    `Use the page path as the title and the provided description verbatim. Do NOT re-add existing titles and do NOT ` +
    `change cards already done (supports resume).\n` +
    `3. \`sync\`, then \`list --json\`. Return EVERY card as {title, mdPath (its "path" field), status}.\n` +
    `Do not author anything yet.\n\n${cli('report', 'init', 'add', 'sync', 'list')}\n\n` +
    `Pages (title=path, with description):\n${JSON.stringify(pages.map((p) => ({ title: p.path, description: descOf(p) })))}`,
  { label: 'seed', model: 'haiku', schema: SEED_SCHEMA },
)
if (!seed?.cards?.length) return { root, outDir, board, error: 'seed returned no cards', written: false }
const cardByTitle = new Map(seed.cards.map((c) => [c.title, c]))

// 4 + 5. Author rounds (loop-until-dry) + grounding gate. Authors write ONLY their own page file + own card
//    markdown and run NO CLI; ONE sync agent per round is the sole state writer; the gate re-reads the page's
//    SCOPE source and reopens pages whose claims aren't code-backed. Caps mirror eatahorse-research.js.
const notDone = (c) => c.status !== 'done' && c.status !== 'dropped'
let pending = seed.cards.filter(notDone).map((c) => c.title)
let round = 0
let activeRemaining = pending.length
const touched = new Set()
const attempts = new Map()
const keepRetryable = (titles) => {
  const giveUp = titles.filter((t) => (attempts.get(t) ?? 0) >= MAX_ATTEMPTS)
  if (giveUp.length) log(`dropping ${giveUp.length} page(s) after ${MAX_ATTEMPTS} failed rounds: ${giveUp.join(', ')}`)
  return titles.filter((t) => (attempts.get(t) ?? 0) < MAX_ATTEMPTS)
}

phase('Author')
while (pending.length && round < maxRounds && (!budget.total || budget.remaining() > BUDGET_FLOOR)) {
  const retryable = keepRetryable(pending)
  const retry = retryable.filter((t) => touched.has(t))
  const fresh = retryable.filter((t) => !touched.has(t)).slice(0, Math.max(0, RUN_TOUCH_CAP - touched.size))
  const batch = [...retry, ...fresh].slice(0, LIVE_CAP)
  if (!batch.length) break
  round++
  for (const t of batch) {
    attempts.set(t, (attempts.get(t) ?? 0) + 1)
    touched.add(t)
  }
  log(`round ${round}: authoring ${batch.length} page(s) (${touched.size}/${pages.length} touched this run)`)
  await parallel(
    batch.map((title) => () => {
      const card = cardByTitle.get(title)
      const p = pageByPath.get(title) ?? { path: title, title, kind: 'reference', group: 'Reference', brief: '', diataxisType: 'reference', template: '', scope: [] }
      return agent(
        `Author ONE ${framework} documentation page FROM SOURCE, save it to disk, then mark its card. Do NOT run ` +
          `any eatahorse command and do NOT touch any other card or page.\n\n` +
          `1. READ the scope source files below — they are the FACTUAL BASIS. Every signature, export, config ` +
          `key, CLI flag, or example MUST come from the code; never invent API. Cite file:area where useful.\n` +
          `   scope: ${JSON.stringify(p.scope ?? [])}\n\n` +
          `2. WRITE the page (Write tool, create parent dirs) to: ${outDir}/${p.path}\n` +
          `   - title: ${p.title}\n   - kind: ${p.kind}\n   - sidebar group: ${p.group}\n   - must cover: ${p.brief}\n` +
          `   - Diátaxis type: ${p.diataxisType} (serve this ONE reader need; do NOT mix modes)\n` +
          `   - section template: ${p.template || '(use the matching skeleton from the IA contract)'}\n` +
          `   Valid frontmatter (title required; template: splash + hero only for a splash page). Use .mdx with ` +
          `the correct import line iff you use components, else .md. Write the RIGHT SHAPE for the Diátaxis type ` +
          `(a reference is exhaustive/scannable with no narrative; an explanation discusses why/tradeoffs).\n\n` +
          `3. EDIT the card markdown file "${card?.mdPath ?? '(find it under ' + board + '/tasks by title)'}": put ONE ` +
          `line in "## Notes" — the written page path + a one-line grounding summary (which source backs it). ` +
          `Tick EVERY checkbox in "## One-bite-at-a-time plan" and "## Acceptance checks" (- [ ] -> - [x]); ` +
          `ticking acceptance marks the card done on the next sync. Leave frontmatter and other sections intact.\n\n` +
          `If the scope is unreadable/empty so the page can't be grounded, say so in "## Notes" and do NOT tick ` +
          `acceptance (leave it for the gate).\n\n` +
          `Card markdown layout:\n${CARD_MD}\n\nIA CONTRACT\n${IA_CONTRACT}\n\nAUTHORING CONTRACT\n${authoringContract}`,
        { label: `author:${title}`, phase: 'Author', model: workerModel },
      )
    }),
  )

  // Single serialized writer: reconcile the round's card edits into state.json + board.md.
  const sync = await agent(
    `Run \`python3 "${scriptPath}" --board "${board}" sync\` then \`report --json\`. Return activeRemaining ` +
      `(the "active" count) and done (the "done" count). Reporting only; change nothing else.\n\n${cli('sync', 'report')}`,
    { label: `sync:${round}`, phase: 'Author', model: 'haiku', schema: SYNC_SCHEMA },
  )
  if (sync) activeRemaining = sync.activeRemaining

  // Grounding gate (strong model, fresh context): re-read each sampled page's SCOPE SOURCE and the written
  // page; reopen any whose claims the code doesn't back. This is the REAL verifier (hallucinated-API guard),
  // not shape-checking. Reopened cards re-queue for the next round.
  phase('Gate')
  await agent(
    `You are a GROUNDING gate for a code->docs board at "${board}"; the site is written under "${outDir}". ` +
      `Sample up to 8 cards marked done (\`list --status done --json\`, then \`show <id> --json\`). For each ` +
      `sampled card: read its "description" to get the page path + scope, READ those scope SOURCE files, and ` +
      `READ the written page at "${outDir}/<path>". Judge whether the page's concrete claims (signatures, ` +
      `exports, config keys, CLI flags, examples) are actually BACKED by the source — not hallucinated, vague, ` +
      `or empty. For any page NOT grounded, reopen it atomically: \`reopen <id> --gap "<what's unbacked>"\` ` +
      `(unchecks acceptance, notes the gap, moves to doing). Then \`sync\`. Return reopened (hollow) card ` +
      `TITLES and how many you checked.\n\n${cli('list', 'show', 'reopen', 'sync')}`,
    { label: `gate:${round}`, phase: 'Gate', schema: GATE_SCHEMA },
  )

  // Re-derive the carry queue from the board (source of truth).
  const reload = await agent(
    `\`python3 "${scriptPath}" --board "${board}" list --json\`. Return EVERY card as {title, mdPath (its ` +
      `"path"), status}.\n\n${cli('list')}`,
    { label: `reload:${round}`, phase: 'Author', model: 'haiku', schema: SEED_SCHEMA },
  )
  if (reload?.cards?.length) {
    for (const c of reload.cards) cardByTitle.set(c.title, c)
    pending = keepRetryable(reload.cards.filter(notDone).map((c) => c.title))
  } else {
    pending = []
  }
}

const carryOver = pending.filter((t) => !touched.has(t)).length
if (carryOver) log(`carry-over: ${carryOver} page(s) left in backlog (touched ${touched.size}/${pages.length} this run); rerun to continue`)
const stopReason =
  activeRemaining <= 0 ? 'all pages done'
  : touched.size >= RUN_TOUCH_CAP && carryOver ? 'run touch cap (backlog carried)'
  : round >= maxRounds ? 'round cap'
  : pending.length ? 'budget floor'
  : 'no pending'

// 6a. Gather admitted — haiku. Read which page cards survived the gate (done) off the durable board, so a
//     resumed run assembles the WHOLE admitted set, not just this run's slice.
phase('Assemble')
const admittedTitles =
  (
    await agent(
      `\`python3 "${scriptPath}" --board "${board}" list --status done --json\` and return the "title" (page path) ` +
        `of every done card.\n\n${cli('list')}`,
      { label: 'gather-admitted', model: 'haiku', schema: DONE_TITLES_SCHEMA },
    )
  )?.titles ?? []
const admittedSet = new Set(admittedTitles)
const admittedPages = pages.filter((p) => admittedSet.has(p.path))
log(`admitted ${admittedPages.length}/${pages.length} grounded page(s)`)

// 6b. Assemble — sonnet, single serialized finalize. Wire the admitted pages into config (content.config.ts
//     + astro.config sidebar), write the durable .docs-plan.md, and run astro check ONLY if buildable.
//     Per-page grounding already happened in the loop gate; this is config + light shape + empirical build.
const assembleGroups = [...new Set(admittedPages.map((p) => p.group))].join(', ') || '(none)'
const final = admittedPages.length
  ? await agent(
      `You are the finalizer for a ${framework} docs site at "${outDir}". These pages were authored and passed ` +
        `the grounding gate (admitted):\n${JSON.stringify(admittedPages.map((p) => ({ path: p.path, group: p.group, diataxisType: p.diataxisType })), null, 2)}\n\n` +
        `Do, in order:\n` +
        (isStarlight
          ? `1. Ensure the content collection exists: write ${outDir}/src/content.config.ts with docsLoader()+docsSchema() if missing.\n` +
            `2. Assemble ${outDir}/astro.config.mjs: a starlight() integration whose sidebar reflects the admitted ` +
            `page groups (${assembleGroups}). Use slug items for the admitted pages; derive a title from the repo/brief. ` +
            `If an astro.config already exists, update its sidebar/title rather than clobbering unrelated config.\n` +
            `3. EMPIRICAL CHECK: if "${outDir}" is a buildable Astro project (has package.json with astro + node_modules), ` +
            `run \`npx astro check\` from there and summarize pass/fail in buildResult. If it is NOT buildable (no install), ` +
            `set buildResult to "skipped: not a buildable project" — do NOT run npm install. ` +
            `// ponytail: content + config only by design; scaffolding a full installable project is the upgrade if astro check must always run.\n`
          : `1. Write or repair the ${framework} primary config (nav/sidebar reflecting groups: ${assembleGroups}; title from repo/brief), ` +
            `using current ${framework} config syntax; update rather than clobber an existing config.\n` +
            `2. (no Astro content collection step for ${framework}.)\n` +
            `3. EMPIRICAL CHECK: set buildResult to "skipped: ${framework} build not run".\n`) +
        `4. Light IA pass: confirm each admitted page matches its declared Diátaxis type; fix tiny shape ` +
        `mismatches in place with Edit, note them in decisions. (Deep grounding already happened upstream.)\n` +
        `5. Write ${outDir}/.docs-plan.md: the admitted page list + sidebar structure + decisions + the deferred ` +
        `pages below (needs human brief). This is the durable record.\n` +
        `   deferred: ${JSON.stringify(deferred)}\n\n` +
        `Return configWritten, buildResult, planPath, decisions, summary.\n\n` +
        `IA CONTRACT\n${IA_CONTRACT}\n\nAUTHORING CONTRACT\n${authoringContract}`,
      { label: 'assemble', model: 'sonnet', schema: FINAL_SCHEMA },
    )
  : { configWritten: false, buildResult: 'skipped: no admitted pages', summary: 'no pages were grounded this run' }

// 7. Write-back — sonnet. Persist a short CLAUDE.md section + deferred/skipped constraints so a rerun and a
//    human know what was covered and what still needs a brief.
phase('Write-back')
await agent(
  `Append a short dated section to the project's CLAUDE.md (create if absent; MERGE, do not clobber). Record: ` +
    `the codebase documented ("${root}"), the docs site location ("${outDir}"), how many pages were admitted ` +
    `(${admittedPages.length} of ${pages.length} planned this run${carryOver ? `, ${carryOver} left in backlog for a rerun` : ''}), ` +
    `the board ("${board}"), and — as CONSTRAINTS so a rerun does not re-walk them — the DEFERRED pages that ` +
    `need a human brief and any source skipped. Keep it short; do not document the obvious file tree.\n\n` +
    `Deferred (needs human brief): ${JSON.stringify(deferred)}\n` +
    `stopReason="${stopReason}"; rounds=${round}; admitted page paths: ${JSON.stringify(admittedPages.map((p) => p.path))}\n` +
    `Finalizer summary: ${final?.summary ?? '(none)'} ; buildResult: ${final?.buildResult ?? '(none)'}`,
  { label: 'write-back', model: 'sonnet' },
)

return {
  root,
  outDir,
  framework,
  board,
  planned: pages.length,
  admitted: admittedPages.length,
  deferred: deferred.length,
  touched: touched.size,
  carryOver,
  rounds: round,
  activeRemaining,
  stopReason,
  configWritten: final?.configWritten ?? false,
  buildResult: final?.buildResult,
  planPath: final?.planPath,
  written: true,
}
