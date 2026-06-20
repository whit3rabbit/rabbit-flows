// docs-create — author a documentation site (Astro Starlight) from a brief, in one rerunnable run.
//
// WHY this shape (deviations from the default spine, noted per CLAUDE.md "Bending"):
//   - The author workers do NOT load the docs-site-builder skill at runtime. They CAN'T: agent() has
//     no `skills` option, and a worker only sees a skill via the Skill tool if it's registered in the
//     session (WORKFLOW_ANALYSIS.md). Even when available, running the full skill dance (read SKILL.md
//     -> pick refs -> read refs) on every page is MORE calls, the opposite of the goal here. So the
//     skill's distilled contract is baked inline below (CONTRACT) and injected into every author. That
//     is the sanctioned pattern: the inline prompt is the runtime source; the skill is the portable copy.
//     `refsDir` is passed only as a deep-escalation fallback for edge cases the contract doesn't cover.
//   - The admission gate is a SINGLE batched call over all pages, not one verifier per page. Pages are
//     small and independent; one strong-model pass keeps the call count low (the explicit ask) while
//     still being a fresh-context check separate from the authors. It also pairs LLM review with an
//     empirical `astro build`/`astro check` when the target is a buildable project (workflow-design.md).
//   - A FRAME IA stage runs before Plan (strong model, inherits session). Good docs are an information-
//     architecture problem before a syntax one: this pass frames audiences, the reader journey, the
//     Diátaxis split, and the sidebar shape, so Plan can tag each page with a diataxisType + section
//     template and authors write the RIGHT SHAPE of page (a reference isn't secretly a tutorial). It
//     sets the trajectory, so it gets the strong model (model-routing.md). Skipped when `pages` is
//     supplied. Its contract is baked inline below (IA_CONTRACT), same runtime-source rule as CONTRACT.
//
// Calls per run ~= 1 (frame IA) + 1 (plan) + N (one author per page) + 1 (verify & finalize).
//
// args: {
//   brief:     string  (required) what the docs cover + any authoring instructions
//   outDir:    string  (required) absolute or repo-relative dir to write the site into
//   sources?:  string[]          files the authors should read as source material
//   framework?: string           default 'starlight' (only framework with an inline contract)
//   pages?:    [{path,title,kind,group,brief,diataxisType?,template?}]  skip Frame IA + Plan, author exactly these
//   refsDir?:  string            default points at this repo's docs-site-builder references
// }

// requires-skills: docs-site-builder
export const meta = {
  name: 'docs-create',
  description: 'Author an Astro Starlight documentation site from a brief: plan pages, fan out authors, verify + assemble config.',
  phases: [
    { title: 'Frame IA', detail: 'one strong-model call: brief -> audiences, journey, Diátaxis split, sidebar shape' },
    { title: 'Plan', detail: 'one strong-model call: IA + brief -> page list, each tagged diataxisType + template' },
    { title: 'Author', detail: 'one Sonnet worker per page; each writes its file from the inline contract' },
    { title: 'Verify & finalize', detail: 'one strong-model call: review vs contract + Diátaxis type, fix, write astro.config + decisions' },
  ],
}

// --- Starlight authoring contract (distilled from the docs-site-builder skill, v0.40.0) ---------
// This is the authors' single source of truth at runtime. If the skill's references change, refresh
// this block from plugins/workflow-kit/skills/docs-site-builder/references/*.md. Keep it compact.
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
    autogenerate: { label: 'Reference', autogenerate: { directory: 'reference' } }
    badge:        { slug: '...', badge: { text: 'New', variant: 'tip' } }

COMPONENTS (MDX only): import { Aside, Badge, Card, CardGrid, FileTree, Icon, LinkButton, LinkCard, Steps, Tabs, TabItem } from '@astrojs/starlight/components';
- Aside:   <Aside type="note|tip|caution|danger" title?="...">...</Aside>  (markdown form: :::note / :::tip[Custom title])
- Tabs:    <Tabs syncKey?="pkg"><TabItem label="npm" icon?="seti:npm">...</TabItem>...</Tabs>  (label required)
- Steps:   <Steps> wraps an ordered markdown list (1. 2. 3.); each step may hold code blocks.
- Card:    <Card title="..." icon?="rocket">...</Card>;  <CardGrid stagger?>...</CardGrid> wraps Cards.
- LinkCard:<LinkCard title="..." href="..." description?="..." />
- LinkButton: <LinkButton href="..." variant?="primary|secondary|minimal" icon?="..." iconPlacement?="start|end" />
- FileTree:<FileTree> wraps a markdown nested list of files/dirs.
- Badge:   <Badge text="..." variant?="note|tip|caution|danger|success" size?="small|medium|large" />

CODE BLOCKS (Expressive Code, built in): fence with options, e.g.
    \`\`\`js title="src/util.js" {1,3-5} ins={2} del={4}
- title="..." adds a frame title; {1,3-5} highlights lines; ins=/del= mark added/removed lines.`

// --- IA contract (distilled from docs-site-builder/references/information-architecture.md) -------
// Framework-agnostic docs DESIGN guidance, injected into Plan + every author so pages get the right
// SHAPE, not just valid syntax. Runtime source of truth; refresh from the reference if it changes.
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

GETTING-STARTED RULE: a new reader reaches a first success within ~5 minutes. Design the journey
backwards from that page; it is the highest-leverage page in the set.`

// --- args / guards -----------------------------------------------------------------------------
const brief = typeof args?.brief === 'string' ? args.brief : null
const outDir = typeof args?.outDir === 'string' ? args.outDir : null
const framework = args?.framework ?? 'starlight'
const sources = Array.isArray(args?.sources) ? args.sources : []
const explicitPages = Array.isArray(args?.pages) ? args.pages.filter(Boolean) : null
const refsDir = args?.refsDir ?? 'plugins/workflow-kit/skills/docs-site-builder/references'

if (!brief || !outDir) {
  return { error: 'args.brief and args.outDir are required', got: { brief, outDir } }
}
if (framework !== 'starlight') {
  // Only Starlight has an inline contract. Other frameworks are skeletons in the skill.
  log(`framework="${framework}" has no inline contract; authors will fall back to the skill skeleton + current docs. Starlight is the supported path.`)
}

const sourcesNote = sources.length
  ? `\nSource material to read first (use as the factual basis, do not invent):\n${sources.map(s => `- ${s}`).join('\n')}`
  : '\nNo source files provided; write from the brief and general knowledge, and mark anything uncertain.'

// --- schemas -----------------------------------------------------------------------------------
const IA_SCHEMA = {
  type: 'object', required: ['audiences', 'journey', 'diataxis', 'sidebar'], additionalProperties: false,
  properties: {
    audiences: { type: 'array', items: { type: 'string' }, description: 'who the docs serve + their goal' },
    journey: { type: 'array', items: { type: 'string' }, description: 'ordered steps: first-touch -> proficient' },
    diataxis: {
      type: 'object', additionalProperties: false,
      properties: {
        tutorial: { type: 'string', description: 'count/intent of tutorial pages this set needs' },
        howto: { type: 'string' }, reference: { type: 'string' }, explanation: { type: 'string' },
      },
    },
    sidebar: { type: 'array', items: { type: 'object' }, description: 'group structure + ordering (the shape, not raw pages)' },
  },
}

const PLAN_SCHEMA = {
  type: 'object', required: ['pages'], additionalProperties: false,
  properties: {
    pages: { type: 'array', items: {
      type: 'object', required: ['path', 'title', 'kind', 'group', 'brief', 'diataxisType', 'template'], additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'repo-relative under outDir, e.g. src/content/docs/guides/intro.md(x)' },
        title: { type: 'string' },
        kind: { enum: ['index', 'splash', 'guide', 'reference'] },
        group: { type: 'string', description: 'sidebar group label, e.g. Guides / Reference' },
        brief: { type: 'string', description: 'what this page must cover' },
        diataxisType: { enum: ['tutorial', 'howto', 'reference', 'explanation', 'index', 'splash'], description: 'the ONE reader need this page serves' },
        template: { type: 'string', description: 'the section skeleton the author must follow for this diataxisType' },
      } } },
    sidebar: { type: 'array', items: { type: 'object' }, description: 'optional explicit astro.config sidebar' },
  },
}

const NOTE_SCHEMA = {
  type: 'object', required: ['path', 'status', 'kind'], additionalProperties: false,
  properties: {
    path: { type: 'string' },
    status: { enum: ['written', 'failed'] },
    kind: { type: 'string' },
    componentsUsed: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    failure: { type: 'string', description: 'why it failed, if status=failed (first-class, read by finalize)' },
  },
}

const FINAL_SCHEMA = {
  type: 'object', required: ['admitted', 'rejected', 'summary'], additionalProperties: false,
  properties: {
    admitted: { type: 'array', items: { type: 'string' } },
    rejected: { type: 'array', items: {
      type: 'object', required: ['path', 'reason'], additionalProperties: false,
      properties: { path: { type: 'string' }, reason: { type: 'string' } } } },
    fixed: { type: 'array', items: { type: 'string' }, description: 'pages the gate edited in place' },
    configWritten: { type: 'boolean' },
    buildResult: { type: 'string', description: 'astro build/check output summary, or "skipped: not a buildable project"' },
    decisions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// --- Frame IA (strong model; sets the trajectory, skipped when pages are supplied) --------------
let ia = null
if (!explicitPages) {
  phase('Frame IA')
  ia = await agent(
    `You are framing the information architecture for a ${framework} documentation site BEFORE any pages ` +
    `are planned. Brief:\n${brief}\n${sourcesNote}\n\n` +
    `Apply the IA contract below. Return: audiences (and their goal), the reader journey (ordered, ` +
    `first-touch -> proficient), the Diátaxis split (how many of tutorial/howto/reference/explanation this ` +
    `set needs and why), and the sidebar SHAPE (group structure + ordering, not raw pages yet).\n\n` +
    `IA CONTRACT\n${IA_CONTRACT}`,
    { label: 'frame-ia', schema: IA_SCHEMA },
  )
  if (ia) log(`IA: ${ia.audiences?.length ?? 0} audience(s), ${ia.journey?.length ?? 0} journey step(s)`)
}
const iaNote = ia
  ? `\nFRAMED INFORMATION ARCHITECTURE (honor this; do not re-derive it):\n${JSON.stringify(ia, null, 2)}\n`
  : ''

// --- Plan --------------------------------------------------------------------------------------
phase('Plan')
let pages = explicitPages
if (!pages) {
  const plan = await agent(
    `You are planning a ${framework} documentation site. Brief:\n${brief}\n${sourcesNote}\n${iaNote}\n` +
    `Produce a focused set of pages (prefer FEWER, well-scoped pages over many thin ones) that realizes the ` +
    `framed IA above. For each page give:\n` +
    `- path: repo-relative under "${outDir}", e.g. src/content/docs/guides/getting-started.md (use .mdx ONLY if it needs components, .md otherwise)\n` +
    `- title, kind (index|splash|guide|reference), group (sidebar group label), brief (what it must cover).\n` +
    `- diataxisType (tutorial|howto|reference|explanation|index|splash): the ONE reader need this page serves.\n` +
    `- template: the section skeleton for that diataxisType (from the IA contract), tailored to this page.\n` +
    `Map groups + ordering to the framed sidebar. Include exactly one landing page (kind index or splash) if the brief implies a homepage.\n\n` +
    `IA CONTRACT\n${IA_CONTRACT}\n\n` +
    `Authoring contract for reference:\n${CONTRACT}`,
    { label: 'plan', schema: PLAN_SCHEMA },
  )
  pages = (plan?.pages ?? []).filter(Boolean)
}
if (!pages.length) return { error: 'planning produced no pages', brief }
log(`planned ${pages.length} page(s): ${pages.map(p => p.path).join(', ')}`)

// --- Author (fan-out: one worker per page, each writes its own file) ----------------------------
phase('Author')
const notes = (await parallel(pages.map((p, i) => () =>
  agent(
    `Write ONE ${framework} documentation page and save it to disk. Do not re-derive Starlight syntax: ` +
    `the contract below is authoritative. Only Read a file under "${refsDir}" if the contract genuinely ` +
    `does not cover something you need (avoid extra reads, this run optimizes for fewer calls).\n\n` +
    `PAGE\n- file: ${outDir}/${p.path}\n- title: ${p.title}\n- kind: ${p.kind}\n- sidebar group: ${p.group}\n- must cover: ${p.brief}\n` +
    `- Diátaxis type: ${p.diataxisType ?? '(infer from kind/brief)'}  (serve this ONE reader need; do NOT mix modes)\n` +
    `- section template to follow: ${p.template ?? '(use the matching skeleton from the IA contract)'}\n` +
    `${sourcesNote}\n\n` +
    `Write the RIGHT SHAPE for the Diátaxis type: a tutorial is task-ordered and outcome-first; a reference is ` +
    `exhaustive, consistent and scannable with no narrative; a how-to is goal-then-steps-then-verify; an explanation ` +
    `discusses context and tradeoffs without step-by-step. Follow the section template.\n\n` +
    `Rules: valid frontmatter (title required; template: splash + a hero block only for a splash page). ` +
    `Use .mdx with the correct import line if and only if you use components. Write the file with the Write tool ` +
    `(create parent dirs). Keep prose tight and technical.\n\n` +
    `IA CONTRACT\n${IA_CONTRACT}\n\n` +
    `AUTHORING CONTRACT\n${CONTRACT}`,
    { label: `author:${p.path || i}`, phase: 'Author', model: 'sonnet', schema: NOTE_SCHEMA },
  ),
))).filter(Boolean)

const written = notes.filter(n => n.status === 'written')
const failed = notes.filter(n => n.status === 'failed')
log(`authored ${written.length}/${pages.length} page(s)${failed.length ? `; ${failed.length} failed` : ''}`)
if (!written.length) return { error: 'no pages were written', notes }

// --- Verify & finalize (single fresh-context strong pass + empirical build + write-back) --------
phase('Verify & finalize')
const final = await agent(
  `You are the verification gate and finalizer for a ${framework} docs site at "${outDir}". A fan-out of ` +
  `authors just wrote these pages (their self-reported notes):\n${JSON.stringify(notes, null, 2)}\n\n` +
  `Each page was planned with a Diátaxis type (the ONE reader need it must serve):\n` +
  `${pages.map(p => `- ${p.path}: ${p.diataxisType ?? '(untyped)'}`).join('\n')}\n\n` +
  `Do, in order:\n` +
  `1. READ each written page file. Check it against the contract: valid frontmatter, .mdx iff components are used, ` +
  `correct component imports and prop names, valid Aside/Tabs/Steps usage, sensible links. Fix small problems in place ` +
  `with the Edit tool. If a page is broken beyond a quick fix, reject it (record path + reason).\n` +
  `1b. IA CHECK: confirm each page actually matches its declared Diátaxis type and does not mix modes ` +
  `(e.g. a reference page is not secretly a tutorial; a tutorial is not a wall of explanation). Fix small ` +
  `shape mismatches in place; note any you fixed in decisions. Reject a page only if its mode is hopelessly wrong.\n` +
  `2. Ensure the content collection exists: write ${outDir}/src/content.config.ts with docsLoader()+docsSchema() if missing.\n` +
  `3. Assemble ${outDir}/astro.config.mjs: a starlight() integration whose sidebar reflects the page groups ` +
  `(${[...new Set(pages.map(p => p.group))].join(', ')}). Use slug items for the admitted pages. Derive a title from the brief. ` +
  `If an astro.config already exists, update its sidebar/title rather than clobbering unrelated config.\n` +
  `4. EMPIRICAL CHECK: if "${outDir}" is a buildable Astro project (has package.json with astro + node_modules), run ` +
  `\`npx astro check\` (or \`npx astro build\`) from there and summarize pass/fail in buildResult. If it is not buildable ` +
  `(no install), set buildResult to "skipped: not a buildable project" — do NOT run npm install.\n` +
  `5. WRITE-BACK: write ${outDir}/.docs-plan.md capturing the final page list, sidebar structure, and any decisions/constraints ` +
  `(e.g. rejected pages and why) so a future run or human has the durable record.\n\n` +
  `Return admitted paths, rejected {path,reason}, pages you fixed, configWritten, buildResult, decisions, and a short summary.\n\n` +
  `IA CONTRACT\n${IA_CONTRACT}\n\n` +
  `AUTHORING CONTRACT\n${CONTRACT}`,
  { label: 'verify-finalize', schema: FINAL_SCHEMA },
)

return {
  framework,
  outDir,
  planned: pages.length,
  authored: written.length,
  authorFailures: failed.map(n => ({ path: n.path, failure: n.failure })),
  ...(final ?? { error: 'verify-finalize returned null', notes }),
}
