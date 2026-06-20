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
//
// Calls per run ~= 1 (plan) + N (one author per page) + 1 (verify & finalize).
//
// args: {
//   brief:     string  (required) what the docs cover + any authoring instructions
//   outDir:    string  (required) absolute or repo-relative dir to write the site into
//   sources?:  string[]          files the authors should read as source material
//   framework?: string           default 'starlight' (only framework with an inline contract)
//   pages?:    [{path,title,kind,group,brief}]  skip planning and author exactly these
//   refsDir?:  string            default points at this repo's docs-site-builder references
// }

// requires-skills: docs-site-builder
export const meta = {
  name: 'docs-create',
  description: 'Author an Astro Starlight documentation site from a brief: plan pages, fan out authors, verify + assemble config.',
  phases: [
    { title: 'Plan', detail: 'one strong-model call: brief -> page list + sidebar groups' },
    { title: 'Author', detail: 'one Sonnet worker per page; each writes its file from the inline contract' },
    { title: 'Verify & finalize', detail: 'one strong-model call: review vs contract, fix, write astro.config + decisions' },
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
const PLAN_SCHEMA = {
  type: 'object', required: ['pages'], additionalProperties: false,
  properties: {
    pages: { type: 'array', items: {
      type: 'object', required: ['path', 'title', 'kind', 'group', 'brief'], additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'repo-relative under outDir, e.g. src/content/docs/guides/intro.md(x)' },
        title: { type: 'string' },
        kind: { enum: ['index', 'splash', 'guide', 'reference'] },
        group: { type: 'string', description: 'sidebar group label, e.g. Guides / Reference' },
        brief: { type: 'string', description: 'what this page must cover' },
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

// --- Plan --------------------------------------------------------------------------------------
phase('Plan')
let pages = explicitPages
if (!pages) {
  const plan = await agent(
    `You are planning a ${framework} documentation site. Brief:\n${brief}\n${sourcesNote}\n\n` +
    `Produce a focused set of pages (prefer FEWER, well-scoped pages over many thin ones). For each page give:\n` +
    `- path: repo-relative under "${outDir}", e.g. src/content/docs/guides/getting-started.md (use .mdx ONLY if it needs components, .md otherwise)\n` +
    `- title, kind (index|splash|guide|reference), group (sidebar group label), brief (what it must cover).\n` +
    `Group guides vs reference sensibly. Include exactly one landing page (kind index or splash) if the brief implies a homepage.\n\n` +
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
    `${sourcesNote}\n\n` +
    `Rules: valid frontmatter (title required; template: splash + a hero block only for a splash page). ` +
    `Use .mdx with the correct import line if and only if you use components. Write the file with the Write tool ` +
    `(create parent dirs). Keep prose tight and technical.\n\n` +
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
  `Do, in order:\n` +
  `1. READ each written page file. Check it against the contract: valid frontmatter, .mdx iff components are used, ` +
  `correct component imports and prop names, valid Aside/Tabs/Steps usage, sensible links. Fix small problems in place ` +
  `with the Edit tool. If a page is broken beyond a quick fix, reject it (record path + reason).\n` +
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
