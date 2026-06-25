// docs-scrape — ingest a documentation website into a local markdown corpus, in one rerunnable run.
//
// WHY a workflow (the bar from CLAUDE.md, both conditions met):
//   - COVERAGE: a docs site is many pages; acquisition + gating fan out wider than one chat coordinates.
//   - RERUNNABLE: re-ingest when upstream docs change. Codifying the orchestration is worth it.
//
// ACQUISITION LADDER (cheapest first — the whole point of this rewrite, per the user's token brief):
//   The old design fetched EVERY page through a model: one Haiku WebFetch agent per page, raw HTML in
//   the model's context, model emits the markdown. For 50 pages that is 50 model round-trips carrying
//   full HTML — the dominant cost. The fix is structural: do fetch+extract+convert in DETERMINISTIC
//   CODE so the model sees only a small manifest (counts/paths/failures), never raw HTML. Ladder:
//     1. git   — docs source is markdown in a repo: shallow-clone, copy the .md/.mdx. Zero conversion.
//     2. python — run scripts/scrape.py (venv): enumerate (trafilatura.sitemaps / llms.txt / MkDocs
//                 search_index.json), extract with trafilatura (readability -> markdown; bs4+markdownify
//                 fallback), write .md + manifest.json. All in code, no per-platform selectors needed.
//     3. playwright — same scrape.py with --render: headless Chromium for CLIENT-RENDERED / SPA docs
//                 (Docsify, hydration-only sites). Opt-in heavy dep; reached only when python comes up
//                 empty AND the site is jsRendered.
//     4. webfetch — the original per-page model fan-out. LAST RESORT (and the only path where page
//                 content flows through a model). Reached when nothing above can acquire.
//   git/python/playwright are CONFIDENT-ONLY / curated-source-only; on any miss they FALL BACK down the ladder.
//
// WHY this shape (deviations noted per CLAUDE.md "Bending"):
//   - git + python + playwright converge on the SAME post-condition (files under outDir + manifest.json),
//     so the Gate and Assemble stages have exactly two modes: FILE (metadata-only through the model,
//     content stays on disk) and INLINE (webfetch; the legacy notes-carry-markdown path).
//   - Extraction engine is trafilatura (Apache-2.0), NOT per-platform CSS selectors: selector maintenance
//     is per-theme fragile (the MkDocs default-theme break). The DETECTION contract + SELECTORS map are
//     still baked inline (the SELECTORS feed the bs4 FALLBACK + the webfetch lane); agent() has no
//     `skills` option (WORKFLOW_ANALYSIS.md), so the inline consts are the runtime truth, skill is the copy.
//   - `ultimate-sitemap-parser` was REJECTED (GPL-3.0, undistributable in a marketplace plugin);
//     `trafilatura.sitemaps.sitemap_search` covers discovery (Apache-2.0).
//   - scrape.py is invoked by an agent via Bash (subagents CAN run shell; the workflow VM cannot —
//     WORKFLOW_ANALYSIS.md). `scriptsDir` locates it; `refsDir` is the deep-escalation fallback.
//   - v1 static enumeration is llms.txt / sitemap / MkDocs search_index; sidebar-DOM crawl happens only
//     in the playwright lane (rendered) or the webfetch fallback. File-mode keeps links as-written.
//
// MODEL ROUTING (cheap-first; strong only where a mistake propagates):
//   - Recon is HAIKU — mechanical fact-gathering (platform signatures, llms/sitemap/search_index probes,
//     gh repo+format lookup, fallback page list). It does NOT decide.
//   - Strategy selection is CODE (a deterministic rule over recon facts; no agent). DEVIATION from the
//     spine's "strong-model decompose": there is one canonical site and a 4-way rule, and a wrong pick
//     self-corrects by falling back down the ladder — so a strong decompose earns nothing here.
//   - git / python / playwright acquire are HAIKU (clone+copy / run a script / report JSON; the mdx
//     clean is code via scrape.py --clean-mdx, so the git lane needs no model judgment).
//   - The Gate is the strong stage (OPUS/session) — EXCEPT for `trusted` content (git pure-.md), where a
//     CODE filter replaces it: the gh-verified authored markdown IS the verification, no nav-junk risk.
//   - Assemble is HAIKU for file-mode (mechanical: rm dropped, index from metadata) and Sonnet for the
//     inline (webfetch) path (writing the corpus from notes). webfetch fetch lanes are Haiku.
//
// PERMISSIONS: needs network egress, Bash (git, gh, python venv), and write access under `outDir`.
//   Recon uses `gh` to VERIFY a backing repo; if gh is absent/unauthenticated or the host isn't GitHub,
//   recon reports the repo unverified and the script picks python (never errors on gh). webfetch uses
//   WebFetch where available; on harnesses without it the agent falls to a web-reader MCP.
//
// CAVEAT (carried from the original): a webfetch lane is one agent making one retrieval tool call; a
//   HUNG tool call cannot be aborted from the script. Mitigate in the HARNESS (MCP_TOOL_TIMEOUT) and
//   keep maxPages small. The python lane sidesteps this — httpx has its own --timeout per request.
//
// args: {
//   url:       string  (required) docs root / entry URL
//   outDir:    string  (required) where to write the corpus (git/python write the .md tree here directly)
//   maxPages?: number  (default 50, hard cap 500)
//   platform?: string             override auto-detection (starlight|docusaurus|mkdocs|vitepress|fumadocs|gitbook|sphinx|docsify|generic)
//   repoUrl?:  string             force/seed the git path (clone this repo for the docs source)
//   strategy?: 'git'|'python'|'playwright'|'webfetch'   override the auto-selected acquisition strategy
//   scriptsDir?: string           where scrape.py + setup_venv.sh live (default: the bundled skill copy)
//   include?:  string[]           URL-glob filters (keep only matching)
//   exclude?:  string[]           URL-glob filters (drop matching)
//   format?:   'tree' | 'single'  per-page .md tree (default) or one concatenated corpus
//   refsDir?:  string             deep-escalation fallback -> docs-scraper references
// }

// requires-skills: docs-scraper
export const meta = {
  name: 'docs-scrape',
  description: 'Save an external documentation website as a local markdown corpus: detect the platform, then clone, scrape, or fetch the pages, and assemble them.',
  whenToUse: 'Use to mirror or archive an external docs website as markdown. Front door: the docs-scraper skill.',
  phases: [
    { title: 'Recon', detail: 'one Haiku call: identify platform, probe llms/sitemap/search_index, gh-verify the source repo + format, enumerate fallback pages' },
    { title: 'Acquire', detail: 'cheapest path the script picks: git clone -> python scrape.py via trafilatura -> playwright render -> per-page WebFetch' },
    { title: 'Gate', detail: 'drop empty/404/dupe/nav-junk, flag thin: code filter for trusted git-md, else a strong-model gate' },
    { title: 'Assemble', detail: 'arrange the .md tree + INDEX.md with a gaps section' },
  ],
}

// --- DETECTION contract (distilled from docs-scraper/references/detection.md) -------------------
const DETECTION = `DOCS PLATFORM DETECTION (check signals in order; generator tag is strongest).
Signatures:
- starlight (Astro):  <meta generator "Astro">; markup .sl-markdown-content, custom <starlight-*>; /_astro/ assets.
- docusaurus:         <meta generator "Docusaurus">; #__docusaurus, .theme-doc-markdown, .markdown, .navbar__inner.
- mkdocs/material:    <meta generator "mkdocs"/"Material for MkDocs">; .md-content, .md-main, .md-nav; search_index.json.
- vitepress:          <meta generator "VitePress">; .VPDoc, .vp-doc, #VPContent, .VPSidebar; /assets/chunks/.
- fumadocs (Next.js): no generator; ids #nd-docs-layout, #nd-sidebar, #nd-page, #nd-toc; DocsBody -> <article>. SSR'd (HTML always has content). MAY serve /llms.txt + per-page raw .md (opt-in -> probe, don't assume).
- gitbook:            often no generator; .gitbook-root, [data-testid], data-view/data-card-* attrs; legacy self-hosted .markdown-section/.page-inner. Modern hosted SSRs content (retrievable) but markup shifts -> confirm the container.
- sphinx/rtd:         <meta generator "Docutils"/"Sphinx">; .rst-content, div.body[role=main], .wy-nav-content (RTD theme); searchindex.js, objects.inv, /_static/.
- docsify:            no generator; near-empty <body> with <div id="app"> + window.$docsify script. CLIENT-RENDERED (raw HTML empty).
- generic:            no signature matched -> return platform:'generic' with whatever evidence you found.
CLIENT-RENDERED GOTCHA: Docsify (and some modern GitBook/SPA) ship an empty shell hydrated by JS. A plain
fetch returns no content. Prefer the raw .md source URL if exposed (Docsify maps /foo -> /foo.md); else
set jsRendered:true. Fumadocs is the inverse: JS framework but server-rendered, so HTML HAS content.`

// --- EXTRACTION contract (distilled from docs-scraper/references/extraction.md) -----------------
// Used ONLY by the webfetch (model) lane. The python lane uses the SELECTORS map below instead.
const EXTRACTION = `CONTENT EXTRACTION (isolate main content, strip chrome, convert to clean markdown).
Main content container by platform:
- starlight:   .sl-markdown-content  (fallback: main article)
- docusaurus:  .theme-doc-markdown.markdown  (fallback: article)
- mkdocs:      .md-content__inner.md-typeset  (fallback: .md-content article)
- vitepress:   .vp-doc  (fallback: .VPDoc .content)
- fumadocs:    prefer per-page raw .md source if exposed; else #nd-page article  (fallback: article .prose)
- gitbook:     legacy .markdown-section .page-inner; modern hosted main / [data-testid="page.content"] (confirm prose, not nav).
- sphinx/rtd:  .rst-content [role=main]  (fallback: div.body[role=main]); strip .headerlink anchors + .wy-nav-side/.sphinxsidebar.
- docsify:     fetch raw .md source at /<route>.md, NOT the rendered HTML  (fallback: .markdown-section).
- generic:     largest <article>/<main>/highest text-density block (verify it is body, not a card grid).
ALWAYS STRIP: navbar, sidebar, right TOC aside, footer, breadcrumbs, edit-on-GitHub, prev/next pager,
  search box, version/locale switcher, last-updated banner, cookie notice, skip-to-content.
PRESERVE: heading hierarchy (drop anchor-link icons); fenced code blocks WITH language (collapse
  syntax-highlight spans back to raw code, drop copy buttons + line-number gutters); tables as GFM;
  admonitions -> blockquote with bold label (> **Note:** ...); links as-written (do NOT rewrite); images
  as markdown with absolute src.
GOTCHAS: client-rendered -> prefer raw .md source else mark status:'error' (JS-rendered) and skip;
  if "content" is mostly a flat link list, wrong container was picked -> fall back to next selector.
Return the compact note { url, title, section, status:'ok'|'empty'|'error', markdown, wordCount }.
On failure set status and leave markdown empty.`

// --- SELECTORS map (distilled from references/platform-signatures.md; consumed by scrape.py) -----
// Per-platform content container(s) the python lane passes as --selector (primary,fallbacks). `source`
// is scrape.py's enumeration mode; rawMdSuffix triggers raw-.md fetch (skip HTML parse) where it applies.
const SELECTORS = {
  starlight:  { selector: '.sl-markdown-content,main article', source: 'auto' },
  docusaurus: { selector: '.theme-doc-markdown.markdown,article', source: 'auto' },
  mkdocs:     { selector: '.md-content__inner.md-typeset,.md-content article,[role=main]', source: 'auto' },
  vitepress:  { selector: '.vp-doc,.VPDoc .content', source: 'auto' },
  fumadocs:   { selector: '#nd-page article,article .prose', source: 'auto' },
  gitbook:    { selector: 'main,[data-testid="page.content"],.markdown-section .page-inner', source: 'auto' },
  sphinx:     { selector: '.rst-content [role=main],div.body[role=main]', source: 'auto' },
  docsify:    { selector: '.markdown-section', source: 'sitemap', rawMdSuffix: '.md' },
  generic:    { selector: 'article,main,.content', source: 'auto' },
}
// Chrome stripped on top of scrape.py's built-in (script/style/nav/aside/footer/headerlink/anchor).
const STRIP = '.md-sidebar,.toc,.theme-doc-toc-mobile,.pagination-nav,.prev-next,.edit-this-page,.copy,[role=navigation],[data-pagefind-ignore]'

// --- args / guards -----------------------------------------------------------------------------
// `args` SHOULD arrive as a real object, but some harnesses (observed: zai/GLM) hand the script the
// JSON-STRINGIFIED form instead. Normalize: a string that parses to an object becomes that object;
// a bare string stays the url (back-compat).
let _args = args
if (typeof _args === 'string') {
  const t = _args.trim()
  if (t.startsWith('{') || t.startsWith('[')) { try { _args = JSON.parse(t) } catch {} }
}
const url = typeof _args === 'string' ? _args : (typeof _args?.url === 'string' ? _args.url : null)
const outDir = typeof _args?.outDir === 'string' ? _args.outDir : null
if (!url || !outDir) {
  return { error: 'args.url and args.outDir are required', got: { url, outDir } }
}
const MAX_PAGES = Math.min(Math.max(1, _args?.maxPages ?? 50), 500)
const platformOverride = typeof _args?.platform === 'string' ? _args.platform : null
const repoUrl = typeof _args?.repoUrl === 'string' ? _args.repoUrl : null
const strategyOverride = ['git', 'python', 'playwright', 'webfetch'].includes(_args?.strategy) ? _args.strategy : null
const scriptsDir = typeof _args?.scriptsDir === 'string' ? _args.scriptsDir : 'plugins/workflow-kit/skills/docs-scraper/scripts'
const include = Array.isArray(_args?.include) ? _args.include : []
const exclude = Array.isArray(_args?.exclude) ? _args.exclude : []
const format = _args?.format === 'single' ? 'single' : 'tree'
const refsDir = _args?.refsDir ?? 'plugins/workflow-kit/skills/docs-scraper/references'
const THIN_WORDS = 25  // below this, a page is real-but-thin: flag, do not drop

const globNote = (include.length || exclude.length)
  ? `\nURL filters: include=${JSON.stringify(include)} exclude=${JSON.stringify(exclude)}`
  : ''

// --- schemas -----------------------------------------------------------------------------------
// RECON facts (Haiku gathers; the SCRIPT decides strategy from them — no `strategy` field here).
const RECON_SCHEMA = {
  type: 'object', required: ['platform', 'baseUrl'], additionalProperties: false,
  properties: {
    platform: { type: 'string', description: 'starlight|docusaurus|mkdocs|vitepress|fumadocs|gitbook|sphinx|docsify|generic' },
    baseUrl: { type: 'string' },
    jsRendered: { type: 'boolean', description: 'true if the entry HTML is a near-empty shell hydrated by JS' },
    hasLlms: { type: 'boolean', description: 'baseUrl/llms.txt exists' },
    hasSitemap: { type: 'boolean', description: 'a sitemap.xml/sitemap-index is reachable' },
    hasSearchIndex: { type: 'boolean', description: 'MkDocs search/search_index.json exists' },
    sourceFormat: { enum: ['md', 'mdx', 'rst', 'asciidoc', 'none'], description: 'extension of the verified in-repo docs source; none if no repo verified' },
    repo: {
      type: 'object', additionalProperties: false,
      properties: {
        repoUrl: { type: 'string', description: 'gh-verified source repo URL (only when the docs dir was confirmed)' },
        branch: { type: 'string' },
        docsSubdir: { type: 'string', description: 'path within the repo holding the docs source (e.g. docs/)' },
      },
    },
    source: { type: 'string', description: 'how fallback pages were found: llms.txt|sitemap|nav' },
    pages: { type: 'array', description: 'enumerated pages, used by the webfetch fallback', items: {
      type: 'object', required: ['url'], additionalProperties: false,
      properties: { url: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' } } } },
  },
}

// File-mode acquire output (git + python converge here): metadata only, content lives at outDir/<path>.
const ACQUIRE_SCHEMA = {
  type: 'object', required: ['ok', 'failed', 'pages'], additionalProperties: false,
  properties: {
    ok: { type: 'number' }, failed: { type: 'number' },
    source: { type: 'string', description: 'sitemap|llms.txt|git:<repo>' },
    fallback: { type: 'boolean', description: 'true if this path could not acquire and the workflow should drop to webfetch' },
    fallbackReason: { type: 'string' },
    pages: { type: 'array', items: {
      type: 'object', required: ['url', 'status'], additionalProperties: false,
      properties: {
        url: { type: 'string' }, path: { type: 'string', description: 'file path relative to outDir' },
        title: { type: 'string' }, section: { type: 'string' },
        words: { type: 'number' }, status: { enum: ['ok', 'empty', 'error'] },
        failure: { type: 'string' },
      } } },
  },
}

// Inline-mode (webfetch) note — unchanged from the original.
const NOTE_SCHEMA = {
  type: 'object', required: ['url', 'status'], additionalProperties: false,
  properties: {
    url: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' },
    status: { enum: ['ok', 'empty', 'error'] }, markdown: { type: 'string' },
    wordCount: { type: 'number' },
    failure: { type: 'string', description: 'why it failed/was empty (first-class, read by the gate)' },
  },
}

// File-mode gate output: kept carry `path` (content on disk), not inline markdown.
const GATE_FILE_SCHEMA = {
  type: 'object', required: ['kept', 'dropped'], additionalProperties: false,
  properties: {
    kept: { type: 'array', items: {
      type: 'object', required: ['url', 'path'], additionalProperties: false,
      properties: {
        url: { type: 'string' }, path: { type: 'string' }, title: { type: 'string' },
        section: { type: 'string' }, words: { type: 'number' },
        thin: { type: 'boolean', description: 'flagged thin but kept' },
      } } },
    dropped: { type: 'array', items: {
      type: 'object', required: ['url', 'reason'], additionalProperties: false,
      properties: { url: { type: 'string' }, path: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

// Inline-mode gate output — unchanged from the original (kept carry markdown).
const GATE_INLINE_SCHEMA = {
  type: 'object', required: ['kept', 'dropped'], additionalProperties: false,
  properties: {
    kept: { type: 'array', items: {
      type: 'object', required: ['url', 'section', 'markdown'], additionalProperties: false,
      properties: {
        url: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' },
        markdown: { type: 'string' }, wordCount: { type: 'number' }, thin: { type: 'boolean' },
      } } },
    dropped: { type: 'array', items: {
      type: 'object', required: ['url', 'reason'], additionalProperties: false,
      properties: { url: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

// --- dedup state (mirrors deep-research; used by the webfetch lane) ------------------------------
const normURL = u => {
  try {
    const p = new URL(u)
    return (p.hostname.replace(/^www\./, '') + p.pathname.replace(/\/$/, '')).toLowerCase()
  } catch { return String(u).toLowerCase() }
}

// --- 1. Recon (Haiku; gather FACTS only — mechanical. The SCRIPT picks the strategy below) --------
phase('Recon')
const map = await agent(
  `Recon the documentation site at ${url}. Gather FACTS only — do NOT pick a strategy or convert anything. ` +
  `Use Bash (curl, gh) and/or a fetch tool. Keep your reply to the compact facts; do NOT paste raw HTML.\n\n` +
  `1. PLATFORM: fetch the entry URL and identify the platform per the DETECTION contract` +
  `${platformOverride ? ` (caller hint: platform="${platformOverride}" unless evidence clearly contradicts it)` : ''}. ` +
  `Set jsRendered=true if the HTML is a near-empty shell hydrated by JS (Docsify/SPA).\n` +
  `2. CURATED SOURCES: probe and set booleans — hasLlms (<baseUrl>/llms.txt), hasSitemap ` +
  `(<baseUrl>/sitemap.xml or sitemap-index.xml), hasSearchIndex (<baseUrl>/search/search_index.json). ` +
  `A quick GET that returns 200 + the right content-type counts; a 404/HTML-error page does not.\n` +
  `3. SOURCE REPO (for the git lane): look for a backing repo — mkdocs.yml repo_url, docusaurus/starlight ` +
  `editUrl, an "Edit on GitHub" link, or a *.github.io host. If you find a GitHub repo, VERIFY it with gh: ` +
  `try \`gh api repos/{owner}/{repo}/contents/{docsSubdir}\` for likely docs dirs (docs, content/docs, ` +
  `src/content/docs, website/docs). Set repo:{repoUrl,branch?,docsSubdir} ONLY if the dir is confirmed, and ` +
  `set sourceFormat to the dominant extension there (md|mdx|rst|asciidoc). If gh is unavailable/unauthenticated, ` +
  `the host is not GitHub, or nothing is confirmed -> omit repo and set sourceFormat="none". Do NOT guess.\n` +
  `4. FALLBACK PAGE LIST: enumerate pages (for the webfetch fallback), preferring llms.txt -> sitemap.xml -> ` +
  `sidebar-nav DOM. Same-origin under the docs path; drop anchors/assets/external.${globNote}\n\n` +
  `Emit { platform, baseUrl, jsRendered, hasLlms, hasSitemap, hasSearchIndex, sourceFormat, repo?, source, pages:[{url,title,section}] }.\n\n` +
  `DETECTION CONTRACT\n${DETECTION}\n\n` +
  `(Deep reference if needed: ${refsDir}/{detection,enumeration}.md)`,
  { label: 'recon', model: 'haiku', schema: RECON_SCHEMA },
)
if (!map?.platform) return { error: 'recon failed', url, map }

// Strategy selection is CODE, not an agent: a deterministic rule over recon facts, self-correcting via
// the fallback ladder (a wrong pick just drops to the next rung). `trusted` => content is authored .md,
// so the admission gate is unnecessary (the repo IS the verification) — see the Gate phase.
const fmt = map.sourceFormat
const repoVerified = !!(map.repo && map.repo.repoUrl)
let strategy =
  strategyOverride
  || (repoUrl ? 'git'
  : (repoVerified && (fmt === 'md' || fmt === 'mdx')) ? 'git'
  : (map.jsRendered && !map.hasSitemap && !map.hasLlms) ? 'playwright'
  : 'python')
let trusted = strategy === 'git' && fmt === 'md'   // gate-skip eligible (pure authored markdown)
const sel = SELECTORS[map.platform] || SELECTORS.generic
log(`platform=${map.platform}${map.jsRendered ? ' (JS-rendered)' : ''}; sourceFormat=${fmt ?? '?'}; ` +
    `strategy=${strategy}${trusted ? ' (trusted)' : ''}` +
    `${map.pages?.length ? `; ${map.pages.length} page(s) enumerated for fallback` : ''}`)

// --- 2. Acquire (git -> python -> playwright -> webfetch; all but webfetch => FILE mode) ---------
phase('Acquire')
let mode = 'file'        // 'file' (git/python: content on disk) | 'inline' (webfetch: notes carry md)
let manifest = null      // file mode: ACQUIRE_SCHEMA.pages (metadata only)
let fetched = null       // inline mode: NOTE_SCHEMA[]
let acqSource = strategy

// 2a. git — shallow clone, copy the markdown docs into outDir, write a manifest. Mechanical => Haiku.
if (strategy === 'git') {
  const repo = (repoUrl ? { ...map.repo, repoUrl } : map.repo) || {}
  if (!repo.repoUrl) {
    log('git selected but no repoUrl resolved -> falling back to python')
    strategy = 'python'; trusted = false
  } else {
    const isMdx = map.sourceFormat === 'mdx'
    const git = await agent(
      `Acquire docs from the git repo ${repo.repoUrl}${repo.branch ? ` (branch ${repo.branch})` : ''} into "${outDir}". ` +
      `Use Bash only.\n\n` +
      `1. Shallow-clone into a temp dir: git clone --depth 1${repo.branch ? ` --branch ${repo.branch}` : ''} ${repo.repoUrl} <tmp> (mktemp -d). If clone fails, return {ok:0,failed:0,fallback:true,fallbackReason:"..."}.\n` +
      `2. Locate the docs dir: prefer "${repo.docsSubdir || 'docs/'}"; if absent, find the dir with the most .md/.mdx files under docs/, content/docs/, src/content/docs/, website/docs/. If none, set fallback:true.\n` +
      `3. Copy every .md and .mdx file into "${outDir}", MIRRORING the docs-dir subtree (mkdir -p parents). Rename .mdx -> .md. Keep index/_meta files.\n` +
      (isMdx
        ? `4. CLEAN MDX: run the bundled cleaner so the .mdx-sourced files become real markdown — locate the scripts dir (try "${scriptsDir}", ".claude/skills/docs-scraper/scripts", "$HOME/.claude/skills/docs-scraper/scripts"), then PY=$(bash <dir>/setup_venv.sh) and "$PY" <dir>/scrape.py --clean-mdx ${JSON.stringify(outDir)} (strips import/export/JSX-only lines).\n`
        : `4. (Source is .md — no cleaning needed.)\n`) +
      `5. For each copied file compute words (wc -w) and a title (first "# " heading, else the slug). Derive "url" = ${repo.repoUrl} + relative path, "section" = the top-level subdir.\n` +
      `6. Write "${outDir}/manifest.json" = the pages array, and rm -rf the temp clone.\n\n` +
      `Return { ok, failed, source:"git:${repo.repoUrl}", fallback?, fallbackReason?, pages:[{url,path,title,section,words,status}] } ` +
      `where path is relative to "${outDir}" and status is "ok" for copied files. Do NOT put file contents in your reply.`,
      { label: 'acquire:git', model: 'haiku', schema: ACQUIRE_SCHEMA },
    )
    if (git?.fallback || !(git?.pages?.length)) {
      log(`git acquire empty (${git?.fallbackReason || 'no files'}) -> falling back to python`)
      strategy = 'python'; trusted = false
    } else {
      manifest = git.pages; acqSource = git.source || `git:${repo.repoUrl}`
      log(`git: copied ${git.ok} file(s) from ${repo.repoUrl}${isMdx ? ' (mdx-cleaned)' : ''}`)
    }
  }
}

// 2b. python — run scrape.py in its venv; it writes the .md tree + manifest.json under outDir.
if (strategy === 'python') {
  const py = await agent(
    `Scrape the docs at ${url} into "${outDir}" by running the bundled python scraper. Use Bash only — ` +
    `do NOT fetch or convert pages yourself (the script does it in code; that is the point).\n\n` +
    `1. Locate the scripts dir. Try in order: "${scriptsDir}", ".claude/skills/docs-scraper/scripts", ` +
    `"$HOME/.claude/skills/docs-scraper/scripts". Use the first that contains scrape.py.\n` +
    `2. Bootstrap the venv: PY=$(bash <dir>/setup_venv.sh)  (prints the venv python path on the last line).\n` +
    `3. Run: "$PY" <dir>/scrape.py --base-url ${JSON.stringify(url)} --out ${JSON.stringify(outDir)} ` +
    `--platform ${JSON.stringify(map.platform)} ` +
    `--selector ${JSON.stringify(sel.selector)} --strip ${JSON.stringify(STRIP)} --source ${sel.source} ` +
    `--max ${MAX_PAGES} --timeout 30` +
    `${sel.rawMdSuffix ? ` --raw-md-suffix ${JSON.stringify(sel.rawMdSuffix)}` : ''}` +
    `${include.length ? ` --include ${include.map(g => JSON.stringify(g)).join(' ')}` : ''}` +
    `${exclude.length ? ` --exclude ${exclude.map(g => JSON.stringify(g)).join(' ')}` : ''}\n` +
    `4. The script prints one JSON line and writes "${outDir}/manifest.json". EXIT CODE 3 means ` +
    `"enumeration found nothing" — set fallback:true so the workflow can escalate. Any other nonzero ` +
    `exit with ok=0 -> also fallback:true with the reason.\n` +
    `5. Read "${outDir}/manifest.json" and return its entries as pages.\n\n` +
    `Return { ok, failed, source, fallback?, fallbackReason?, pages:[{url,path,title,section,words,status,failure}] }. ` +
    `Do NOT put page content in your reply — only this metadata.`,
    { label: 'acquire:python', model: 'haiku', schema: ACQUIRE_SCHEMA },
  )
  if (py?.fallback || !(py?.pages?.some(p => p.status === 'ok'))) {
    // jsRendered sites are worth a headless-browser pass before the model lane; others go straight to webfetch.
    const next = map.jsRendered ? 'playwright' : 'webfetch'
    log(`python acquire empty (${py?.fallbackReason || 'no ok pages'}) -> falling back to ${next}`)
    strategy = next
  } else {
    manifest = py.pages; acqSource = py.source || 'python'
    const okc = py.pages.filter(p => p.status === 'ok').length
    log(`python: scraped ${okc} ok / ${py.pages.length} page(s) via ${acqSource}`)
  }
}

// 2b-render. playwright — same scrape.py, but --render fetches client-rendered HTML via headless Chromium.
if (strategy === 'playwright') {
  const pw = await agent(
    `Scrape the CLIENT-RENDERED docs at ${url} into "${outDir}" using the bundled scraper in render mode. ` +
    `Use Bash only.\n\n` +
    `1. Locate the scripts dir (try "${scriptsDir}", ".claude/skills/docs-scraper/scripts", ` +
    `"$HOME/.claude/skills/docs-scraper/scripts"; first containing scrape.py).\n` +
    `2. Bootstrap the venv WITH the browser: PY=$(bash <dir>/setup_venv.sh --with-playwright)  ` +
    `(installs playwright + Chromium into the venv on first run; prints the venv python on the last line). ` +
    `This step downloads a browser and may take a minute.\n` +
    `3. Run: "$PY" <dir>/scrape.py --render --base-url ${JSON.stringify(url)} --out ${JSON.stringify(outDir)} ` +
    `--platform ${JSON.stringify(map.platform)} --selector ${JSON.stringify(sel.selector)} ` +
    `--strip ${JSON.stringify(STRIP)} --source ${sel.source} --max ${MAX_PAGES} --timeout 45` +
    `${include.length ? ` --include ${include.map(g => JSON.stringify(g)).join(' ')}` : ''}` +
    `${exclude.length ? ` --exclude ${exclude.map(g => JSON.stringify(g)).join(' ')}` : ''}\n` +
    `4. Exit 3 (or ok=0, or the browser failing to install/launch) -> set fallback:true; the workflow drops to webfetch.\n` +
    `5. Read "${outDir}/manifest.json" and return its entries as pages.\n\n` +
    `Return { ok, failed, source, fallback?, fallbackReason?, pages:[{url,path,title,section,words,status,failure}] }. ` +
    `Do NOT put page content in your reply — only this metadata.`,
    { label: 'acquire:playwright', model: 'haiku', schema: ACQUIRE_SCHEMA },
  )
  if (pw?.fallback || !(pw?.pages?.some(p => p.status === 'ok'))) {
    log(`playwright acquire empty (${pw?.fallbackReason || 'no ok pages'}) -> falling back to webfetch`)
    strategy = 'webfetch'
  } else {
    manifest = pw.pages; acqSource = pw.source || 'playwright'
    const okc = pw.pages.filter(p => p.status === 'ok').length
    log(`playwright: scraped ${okc} ok / ${pw.pages.length} page(s) via ${acqSource}`)
  }
}

// 2c. webfetch — the legacy per-page model fan-out (INLINE mode). Last resort.
if (strategy === 'webfetch') {
  mode = 'inline'
  if (!map.pages?.length) return { error: 'webfetch fallback but no pages enumerated', url, platform: map.platform }
  const constraintsNote = `\nPlatform content container (honor): ${sel.selector}. Strip all chrome.`
  const seen = new Map(); let slots = MAX_PAGES
  fetched = (await pipeline(
    map.pages,
    (page) => {
      const key = normURL(page.url)
      if (seen.has(key) || slots <= 0) return null
      seen.set(key, true); slots--
      let host = 'page'
      try { host = new URL(page.url).pathname.slice(0, 40) || 'page' } catch {}
      return agent(
        `Fetch ${page.url} and extract its main content as clean markdown.\n` +
        `Platform: ${map.platform}. Section: ${page.section ?? '(none)'}.${constraintsNote}\n\n` +
        `Retrieve with whatever fetch tool you have (WebFetch, or a web-reader MCP). Apply the EXTRACTION ` +
        `contract: isolate the content container, strip ALL chrome, convert preserving ` +
        `headings/code-fences/tables/admonitions. Keep links as-written. Make a SINGLE retrieval attempt: ` +
        `do NOT retry. On failure/timeout/login-wall/JS-empty-shell, set status='error'/'empty' with a ` +
        `failure note and leave markdown empty.\n\nEXTRACTION CONTRACT\n${EXTRACTION}`,
        { label: `fetch:${host}`, phase: 'Acquire', model: 'haiku', schema: NOTE_SCHEMA },
      ).then(n => n && { ...n, section: n.section ?? page.section, title: n.title ?? page.title })
       .catch(e => ({ url: page.url, section: page.section, status: 'error', failure: String(e?.message || e), markdown: '' }))
    },
  )).filter(Boolean)
  const okCount = fetched.filter(n => n.status === 'ok').length
  log(`webfetch: fetched ${fetched.length} page(s); ${okCount} ok, ${fetched.length - okCount} empty/error`)
  if (!okCount) return { error: 'no pages extracted content', url, platform: map.platform, fetched: fetched.length }
}

// --- 3. Admission gate (strong, fresh context: drop empty/404/dupe/nav-junk; flag thin) ---------
// DEVIATION (noted in header): `trusted` content (git pure-.md) skips the Opus gate. It is the author's
// own markdown verified by gh — there is no nav-junk/extraction risk for the gate to catch, so a cheap
// CODE filter (drop non-ok, dedup, flag thin) replaces the strong agent. Everything else is gated.
phase('Gate')
let kept, dropped
if (trusted) {
  const seenG = new Set()
  kept = []; dropped = []
  for (const p of (manifest || [])) {
    if (p.status !== 'ok' || !p.path) { dropped.push({ url: p.url, path: p.path, reason: p.failure || `status=${p.status}` }); continue }
    const k = normURL(p.url)
    if (seenG.has(k)) { dropped.push({ url: p.url, path: p.path, reason: 'duplicate url' }); continue }
    seenG.add(k)
    kept.push({ url: p.url, path: p.path, title: p.title, section: p.section, words: p.words, thin: (p.words ?? 0) < THIN_WORDS })
  }
} else if (mode === 'file') {
  // Metadata-only through the model; content stays on disk. scrape.py already tagged empty/nav-junk,
  // so the gate trusts the manifest and SPOT-READS only the suspicious/borderline files.
  const gate = await agent(
    `You are the admission gate for a scraped docs corpus from ${url} (platform=${map.platform}, source=${acqSource}). ` +
    `The page CONTENT is already on disk under "${outDir}" at each page's "path" — do NOT expect it inline. ` +
    `Below is the manifest (metadata only).\n\n` +
    `Decide keep/drop using the metadata first:\n` +
    `- DROP any page with status != "ok", or with a failure note, or an obvious 404/redirect slug.\n` +
    `- DROP near-duplicate paths (e.g. trailing-slash twins, print/amp variants).\n` +
    `- FLAG thin:true but KEEP pages with words < ${THIN_WORDS} (real but short).\n` +
    `- For any page you are UNSURE about (suspiciously low words, or a title that looks like nav), READ ` +
    `"${outDir}/<path>" and judge whether it is real prose or captured nav/sidebar junk; drop junk.\n` +
    `Spot-read at most ~8 files — do not read the whole corpus.\n\n` +
    `Return { kept:[{url,path,title,section,words,thin}], dropped:[{url,path,reason}] }.\n\n` +
    `MANIFEST\n${JSON.stringify(manifest)}`,
    { label: 'gate', schema: GATE_FILE_SCHEMA },
  )
  kept = gate?.kept ?? []; dropped = gate?.dropped ?? []
} else {
  const gate = await agent(
    `You are the admission gate for a scraped docs corpus from ${url} (platform=${map.platform}). ` +
    `Below are the fetched page notes. Keep ONLY pages with real extracted content; DROP the rest with a reason.\n\n` +
    `Drop a page if it: is empty / status!=ok, is a 404 / redirect / login wall, duplicates another kept page, ` +
    `or captured navigation/sidebar junk instead of body text. FLAG (thin:true) but KEEP pages that are real ` +
    `but very short. Do NOT under-drop: nav-junk and dupes poison the corpus.\n\n` +
    `Return { kept:[{url,title,section,markdown,wordCount,thin}], dropped:[{url,reason}] }.\n\n` +
    `FETCHED NOTES\n${JSON.stringify(fetched)}`,
    { label: 'gate', schema: GATE_INLINE_SCHEMA },
  )
  kept = gate?.kept ?? []; dropped = gate?.dropped ?? []
}
log(`gate (${trusted ? 'code filter' : 'opus'}): kept ${kept.length}, dropped ${dropped.length}`)
if (!kept.length) return { error: 'gate dropped all pages', url, platform: map.platform, dropped }

// --- 4. Assemble & write-back (Sonnet; agent writes files — script has no fs access) ------------
phase('Assemble')
let assembled
if (mode === 'file') {
  // Files already exist at outDir/<path> (good markdown from git/python). Keep the model OUT of the
  // content: arrange via Bash (rm dropped, concat for single), write INDEX.md from metadata only.
  // ponytail: intra-corpus links stay as-written in v1 — no localization pass (the URL->path map in
  // INDEX.md covers navigation). Add a link-rewrite stage if cross-references must resolve locally.
  assembled = await agent(
    `Finalize the docs corpus already written under "${outDir}" (format=${format}). The kept files exist ` +
    `on disk at each page's "path"; the dropped/failed pages may also have stray files. Use Bash + Write.\n\n` +
    `1. Remove the files of DROPPED pages from "${outDir}" (rm -f each dropped "path" that exists).\n` +
    (format === 'single'
      ? `2. Concatenate the KEPT files in section order into "${outDir}/corpus.md": each under an H1 with its ` +
        `title and a source-URL line; then rm the now-merged per-page .md files (keep INDEX.md + manifest.json).\n`
      : `2. Leave the kept per-page .md tree in place (it already mirrors the section hierarchy).\n`) +
    `3. ALWAYS write "${outDir}/INDEX.md": detected platform + acquisition source (${acqSource}), page counts, ` +
    `a source-URL -> local-path table (from the kept list), and a GAPS section listing every dropped/failed ` +
    `page and why (from the dropped list). This is the durable record.\n` +
    `Do NOT read or re-emit page bodies except as needed for the single-file concat. Return how many files the corpus has.\n\n` +
    `KEPT (url,path,section,title,words,thin)\n${JSON.stringify(kept)}\n\n` +
    `DROPPED (for the gaps section)\n${JSON.stringify(dropped)}`,
    { label: 'assemble', model: 'haiku' },
  )
} else {
  assembled = await agent(
    `Write a local markdown corpus under "${outDir}" from these admitted pages (format=${format}).\n` +
    (format === 'tree'
      ? `- format=tree: one .md file per page, MIRRORING the source section hierarchy (use each page's ` +
        `"section" as a subdirectory; derive a slug filename from its URL path). Create parent dirs.\n`
      : `- format=single: one concatenated "${outDir}/corpus.md", pages in section order, each under an H1 ` +
        `with its title and a source-URL line.\n`) +
    `- ALWAYS write "${outDir}/INDEX.md": detected platform, page counts, a source-URL -> local-path map ` +
    `(table), and a GAPS section listing every dropped/failed page and why. This is the durable record.\n` +
    `Use the Write tool. Return how many files you wrote.\n\n` +
    `ADMITTED PAGES\n${JSON.stringify(kept)}\n\n` +
    `DROPPED (for the gaps section)\n${JSON.stringify(dropped)}`,
    { label: 'assemble', model: 'sonnet' },
  )
}

return {
  url,
  platform: map.platform,
  jsRendered: !!map.jsRendered,
  strategy,
  source: acqSource,
  enumerated: map.pages?.length ?? 0,
  acquired: mode === 'file' ? (manifest?.length ?? 0) : (fetched?.length ?? 0),
  admitted: kept.length,
  dropped: dropped.length,
  outDir,
  format,
  assemble: assembled,
}
