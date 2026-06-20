// docs-scrape — ingest a documentation website into a local markdown corpus, in one rerunnable run.
//
// WHY a workflow (the bar from CLAUDE.md, both conditions met):
//   - COVERAGE: N independent page fetches fan out wider than one conversation can coordinate.
//   - RERUNNABLE: re-ingest when upstream docs change. Codifying the orchestration is worth it.
//
// WHY this shape (deviations noted per CLAUDE.md "Bending"):
//   - Mirrors /deep-research's search→dedup→fetch pipeline, minus the 5-angle decompose: a docs site
//     has ONE canonical page list, so Detect&Map emits it directly and the pipeline fans out fetches
//     over it with URL dedup (normURL + closure `seen`) and a budget cap (maxPages / budget.total).
//   - The platform DETECTION + EXTRACTION contracts are baked inline below, NOT loaded from the
//     docs-scraper skill: agent() has no `skills` option (WORKFLOW_ANALYSIS.md). The inline consts are
//     the runtime source of truth; the skill is the portable copy. Refresh the consts when the skill
//     changes. `refsDir` is passed only as a deep-escalation fallback the contract doesn't cover.
//   - Write-back is delegated to an agent (the script has no filesystem access): it writes the .md
//     tree + INDEX.md. The gaps section in INDEX.md is the durable record of what failed/was dropped.
//
// MODEL ROUTING: Detect&Map + the admission gate inherit the session (strong — they set the page list
//   and the quality bar, where mistakes propagate). Fetch lanes run on Haiku (mechanical, parallel,
//   verifiable). Assemble runs on Sonnet (writing files from given markdown).
//
// PERMISSIONS: needs network egress (WebFetch) and write access under `outDir`.
//
// Calls per run ~= 1 (detect&map) + N (one fetch per page, capped) + 1 (gate) + 1 (assemble).
//
// args: {
//   url:      string  (required) docs root / entry URL
//   outDir:   string  (required) where to write the corpus
//   maxPages?: number  (default 50, hard cap 500)
//   platform?: string             override auto-detection (starlight|docusaurus|mkdocs|vitepress|generic)
//   include?: string[]            URL-glob filters (keep only matching)
//   exclude?: string[]            URL-glob filters (drop matching)
//   format?:  'tree' | 'single'   per-page .md tree (default) or one concatenated corpus
//   refsDir?: string              deep-escalation fallback -> docs-scraper references
// }

// requires-skills: docs-scraper
export const meta = {
  name: 'docs-scrape',
  description: 'Ingest a documentation website into a local markdown corpus: detect platform, enumerate pages, fetch+extract, gate, assemble.',
  phases: [
    { title: 'Detect & Map', detail: 'one strong call: WebFetch entry, identify platform, enumerate pages' },
    { title: 'Fetch & Extract', detail: 'one Haiku worker per page in a dedup + budget-capped pipeline: WebFetch -> clean markdown' },
    { title: 'Gate', detail: 'one strong call: drop empty/404/dupe/nav-junk pages, flag thin ones' },
    { title: 'Assemble', detail: 'one Sonnet call: write the .md tree + INDEX.md with a gaps section' },
  ],
}

// --- DETECTION contract (distilled from docs-scraper/references/detection.md) -------------------
const DETECTION = `DOCS PLATFORM DETECTION (check signals in order; generator tag is strongest).
Signatures:
- starlight (Astro):  <meta generator "Astro">; markup .sl-markdown-content, custom <starlight-*>; /_astro/ assets.
- docusaurus:         <meta generator "Docusaurus">; #__docusaurus, .theme-doc-markdown, .markdown, .navbar__inner.
- mkdocs/material:    <meta generator "mkdocs"/"Material for MkDocs">; .md-content, .md-main, .md-nav; search_index.json.
- vitepress:          <meta generator "VitePress">; .VPDoc, .vp-doc, #VPContent, .VPSidebar; /assets/chunks/.
- generic:            no signature matched -> return platform:'generic' with whatever evidence you found.
CLIENT-RENDERED GOTCHA: Docsify/some GitBook/SPA ship an empty shell hydrated by JS (tiny HTML, single
mount div, $docsify/SPA bootstrap). A plain fetch returns no content. Prefer the raw .md source URL if
exposed (e.g. /foo -> /foo.md); else set jsRendered:true and report it rather than capturing the shell.
Return { platform, baseUrl, jsRendered, evidence }.`

// --- EXTRACTION contract (distilled from docs-scraper/references/extraction.md) -----------------
const EXTRACTION = `CONTENT EXTRACTION (isolate main content, strip chrome, convert to clean markdown).
Main content container by platform:
- starlight:   .sl-markdown-content  (fallback: main article)
- docusaurus:  .theme-doc-markdown.markdown  (fallback: article)
- mkdocs:      .md-content__inner.md-typeset  (fallback: .md-content article)
- vitepress:   .vp-doc  (fallback: .VPDoc .content)
- generic:     largest <article>/<main>/highest text-density block (verify it is body, not a card grid).
ALWAYS STRIP: navbar, sidebar, right TOC aside, footer, breadcrumbs, edit-on-GitHub, prev/next pager,
  search box, version/locale switcher, last-updated banner, cookie notice, skip-to-content.
PRESERVE: heading hierarchy (drop anchor-link icons); fenced code blocks WITH language (collapse
  syntax-highlight spans back to raw code, drop copy buttons + line-number gutters); tables as GFM;
  admonitions -> blockquote with bold label (> **Note:** ...); links as-written (do NOT rewrite to local
  paths here); images as markdown with absolute src.
GOTCHAS: client-rendered -> prefer raw .md source else mark status:'error' (JS-rendered) and skip;
  if "content" is mostly a flat link list, wrong container was picked -> fall back to next selector.
Return the compact note { url, title, section, status:'ok'|'empty'|'error', markdown, wordCount }.
On failure set status and leave markdown empty.`

// --- args / guards -----------------------------------------------------------------------------
const url = typeof args === 'string' ? args : (typeof args?.url === 'string' ? args.url : null)
const outDir = typeof args?.outDir === 'string' ? args.outDir : null
if (!url || !outDir) {
  return { error: 'args.url and args.outDir are required', got: { url, outDir } }
}
const MAX_PAGES = Math.min(Math.max(1, args?.maxPages ?? 50), 500)
const platformOverride = typeof args?.platform === 'string' ? args.platform : null
const include = Array.isArray(args?.include) ? args.include : []
const exclude = Array.isArray(args?.exclude) ? args.exclude : []
const format = args?.format === 'single' ? 'single' : 'tree'
const refsDir = args?.refsDir ?? 'plugins/workflow-kit/skills/docs-scraper/references'

const globNote = (include.length || exclude.length)
  ? `\nURL filters (apply during enumeration): include=${JSON.stringify(include)} exclude=${JSON.stringify(exclude)}`
  : ''

// --- schemas -----------------------------------------------------------------------------------
const MAP_SCHEMA = {
  type: 'object', required: ['platform', 'baseUrl', 'pages'], additionalProperties: false,
  properties: {
    platform: { type: 'string', description: 'starlight|docusaurus|mkdocs|vitepress|generic' },
    baseUrl: { type: 'string' },
    jsRendered: { type: 'boolean' },
    source: { type: 'string', description: 'how pages were found: llms.txt|sitemap|nav' },
    pages: { type: 'array', items: {
      type: 'object', required: ['url'], additionalProperties: false,
      properties: {
        url: { type: 'string' },
        title: { type: 'string' },
        section: { type: 'string', description: 'sidebar group, used to mirror hierarchy at assemble' },
      } } },
    constraints: { type: 'array', items: { type: 'string' }, description: 'content selector + chrome-to-strip for this platform' },
  },
}

const NOTE_SCHEMA = {
  type: 'object', required: ['url', 'status'], additionalProperties: false,
  properties: {
    url: { type: 'string' },
    title: { type: 'string' },
    section: { type: 'string' },
    status: { enum: ['ok', 'empty', 'error'] },
    markdown: { type: 'string' },
    wordCount: { type: 'number' },
    failure: { type: 'string', description: 'why it failed/was empty (first-class, read by the gate)' },
  },
}

const GATE_SCHEMA = {
  type: 'object', required: ['kept', 'dropped'], additionalProperties: false,
  properties: {
    kept: { type: 'array', items: {
      type: 'object', required: ['url', 'section', 'markdown'], additionalProperties: false,
      properties: {
        url: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' },
        markdown: { type: 'string' }, wordCount: { type: 'number' },
        thin: { type: 'boolean', description: 'flagged thin but kept' },
      } } },
    dropped: { type: 'array', items: {
      type: 'object', required: ['url', 'reason'], additionalProperties: false,
      properties: { url: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

// --- dedup state (mirrors deep-research) --------------------------------------------------------
const normURL = u => {
  try {
    const p = new URL(u)
    return (p.hostname.replace(/^www\./, '') + p.pathname.replace(/\/$/, '')).toLowerCase()
  } catch { return String(u).toLowerCase() }
}
const seen = new Map()
let slots = MAX_PAGES

// --- 1. Detect & Map (strong; WebFetch entry, identify platform, enumerate pages) --------------
phase('Detect & Map')
const map = await agent(
  `Detect the documentation platform at ${url} and enumerate ALL its pages.\n\n` +
  `Use WebFetch on the entry URL. Identify the platform per the DETECTION contract` +
  `${platformOverride ? ` (caller override: assume platform="${platformOverride}" unless evidence clearly contradicts it)` : ''}.\n` +
  `Then enumerate pages, preferring in order: <baseUrl>/llms.txt -> <baseUrl>/sitemap.xml -> sidebar-nav DOM ` +
  `extraction. Keep only same-origin links under the docs path; drop anchors/assets/external.${globNote}\n` +
  `Emit { platform, baseUrl, jsRendered, source, pages:[{url,title,section}], constraints } where constraints ` +
  `carry the content-container selector + chrome-to-strip for this platform (passed read-only to fetch workers).\n` +
  `If the site is client-rendered with no fetchable .md source, set jsRendered:true and return whatever pages you can.\n\n` +
  `DETECTION CONTRACT\n${DETECTION}\n\n` +
  `(Deep reference if the contract is insufficient: ${refsDir}/{detection,enumeration}.md)`,
  { label: 'detect-map', schema: MAP_SCHEMA },
)
if (!map?.pages?.length) return { error: 'no pages enumerated', url, map }
log(`platform=${map.platform}${map.jsRendered ? ' (JS-rendered!)' : ''}, ${map.pages.length} page(s) via ${map.source ?? '?'}`)
const constraintsNote = (map.constraints?.length)
  ? `\nPlatform constraints (honor; do not re-derive):\n${map.constraints.map(c => `- ${c}`).join('\n')}`
  : ''

// --- 2. Fetch & Extract (Haiku, pipeline, dedup + budget cap, no barrier) -----------------------
phase('Fetch & Extract')
const fetched = (await pipeline(
  map.pages,
  (page) => {                                    // dedup + budget cap are code, not an agent
    const key = normURL(page.url)
    if (seen.has(key) || slots <= 0) return null
    seen.set(key, true); slots--
    let host = 'page'
    try { host = new URL(page.url).pathname.slice(0, 40) || 'page' } catch {}
    return agent(
      `Fetch ${page.url} and extract its main content as clean markdown.\n` +
      `Platform: ${map.platform}. Section: ${page.section ?? '(none)'}.${constraintsNote}\n\n` +
      `Use WebFetch to retrieve the page. Apply the EXTRACTION contract: isolate the platform's content ` +
      `container, strip ALL chrome, convert to markdown preserving headings/code-fences/tables/admonitions. ` +
      `Keep links as-written (do not localize). If the fetch fails, the page is a login wall, or it is a ` +
      `JS-rendered empty shell, set status='error'/'empty' with a failure note and leave markdown empty.\n\n` +
      `EXTRACTION CONTRACT\n${EXTRACTION}`,
      { label: `fetch:${host}`, phase: 'Fetch & Extract', model: 'haiku', schema: NOTE_SCHEMA },
    ).then(n => n && { ...n, section: n.section ?? page.section, title: n.title ?? page.title })
     .catch(e => ({ url: page.url, section: page.section, status: 'error', failure: String(e?.message || e), markdown: '' }))
  },
)).filter(Boolean)

const okCount = fetched.filter(n => n.status === 'ok').length
log(`fetched ${fetched.length} page(s); ${okCount} ok, ${fetched.length - okCount} empty/error`)
if (!okCount) return { error: 'no pages extracted content', url, platform: map.platform, fetched: fetched.length }

// --- 3. Admission gate (strong, fresh context: drop empty/404/dupe/nav-junk; flag thin) ---------
phase('Gate')
const gate = await agent(
  `You are the admission gate for a scraped docs corpus from ${url} (platform=${map.platform}). ` +
  `Below are the fetched page notes. Keep ONLY pages with real extracted content; DROP the rest with a reason.\n\n` +
  `Drop a page if it: is empty / status!=ok, is a 404 / redirect / login wall, duplicates another kept page ` +
  `(same content), or captured navigation/sidebar junk instead of body text. FLAG (set thin:true) but KEEP ` +
  `pages that are real but very short. Do NOT under-drop: nav-junk and dupes poison the corpus.\n\n` +
  `Return { kept:[{url,title,section,markdown,wordCount,thin}], dropped:[{url,reason}] }.\n\n` +
  `FETCHED NOTES\n${JSON.stringify(fetched)}`,
  { label: 'gate', schema: GATE_SCHEMA },
)
const kept = gate?.kept ?? []
const dropped = gate?.dropped ?? []
log(`gate: kept ${kept.length}, dropped ${dropped.length}`)
if (!kept.length) return { error: 'gate dropped all pages', url, platform: map.platform, dropped }

// --- 4. Assemble & write-back (Sonnet; agent writes files — script has no fs access) ------------
phase('Assemble')
const assembled = await agent(
  `Write a local markdown corpus under "${outDir}" from these admitted pages (format=${format}).\n` +
  (format === 'tree'
    ? `- format=tree: one .md file per page, MIRRORING the source section hierarchy (use each page's ` +
      `"section" as a subdirectory; derive a slug filename from its URL path). Create parent dirs.\n`
    : `- format=single: one concatenated "${outDir}/corpus.md", pages in section order, each under an ` +
      `H1 with its title and a source-URL line.\n`) +
  `- ALWAYS write "${outDir}/INDEX.md": detected platform, page counts, a source-URL -> local-path map ` +
  `(table), and a GAPS section listing every dropped/failed page and why (from the dropped list below). ` +
  `This is the durable record.\n` +
  `Use the Write tool. Return how many files you wrote.\n\n` +
  `ADMITTED PAGES\n${JSON.stringify(kept)}\n\n` +
  `DROPPED (for the gaps section)\n${JSON.stringify(dropped)}`,
  { label: 'assemble', model: 'sonnet' },
)

return {
  url,
  platform: map.platform,
  jsRendered: !!map.jsRendered,
  enumerated: map.pages.length,
  fetched: fetched.length,
  admitted: kept.length,
  dropped: dropped.length,
  outDir,
  format,
  assemble: assembled,
}
