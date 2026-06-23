// docs-migrate — migrate a documentation site from one framework to another.
//
// WHY a workflow (both CLAUDE.md conditions met):
//   - COVERAGE: a site has many pages; acquisition + per-page conversion fan out wider than one conversation.
//   - RERUNNABLE: re-migrate when the source updates. Codifying the orchestration is worth it.
//
// SHAPE:
//   1. Acquire source corpus via the docs-scrape pipeline (recon -> acquire -> gate -> emit file tree).
//   2. Map source pages to target contentRoot using a crosswalk (section -> dir, slug -> file).
//   3. Fan out one conversion worker per page: apply the CROSSWALK, convert admonitions and syntax,
//      write target-framework pages under contentRoot.
//   4. Quality gate: drops pages that still carry source-framework syntax leaks.
//   5. Assemble target config from admitted pages + write-back.
//
// DEVIATIONS from the default spine (noted per CLAUDE.md "Bending"):
//   - No "decompose" agent: the source corpus IS the decomposition. Pages are parallel and independent.
//   - The docs-scrape pipeline is reused inline rather than calling the docs-scrape workflow as a sub-run:
//     agent() has no workflow-call option; the inline approach keeps the corpus metadata in script scope
//     so the crosswalk and conversion steps can use it without reading files twice.
//   - Conversion workers use Sonnet (implementation workhorse) not Haiku: syntax conversion requires
//     judgment about admonition mapping, internal link rewriting, and frontmatter transformation.
//     Haiku misses edge-cases in admonition blocks and nested code fences.
//   - Quality gate is the ONE strong-model call: it runs over admitted pages to drop syntax-leak failures
//     before config assembly. This mirrors the docs-create.js quality-gate pattern.
//
// CROSSWALK (from -> to) inline contracts:
//   Only mkdocs->starlight is distilled with a full crosswalk; other pairs use a generic conversion
//   prompt that instructs the worker to fetch current target-framework docs if needed. Starlight is
//   the one framework with a baked inline CONTRACT here (same rationale as docs-create.js / docs-from-code.js).
//
// MODEL ROUTING:
//   - Recon / acquisition / assemble-manifest: Haiku (mechanical, code-like, checkable).
//   - Conversion workers: Sonnet (syntax judgment; errors show up in the quality gate not everywhere).
//   - Quality gate: Opus (the admission gate; a weak gate rubber-stamps leaks).
//   - Config assembly: Sonnet (workhorse; the config shape is deterministic per framework).
//
// PERMISSIONS: reads source URL (network), writes under outDir. Does NOT modify source.
//
// args: {
//   from:         string  (required) source framework: mkdocs|starlight|docusaurus|vitepress|gitbook|sphinx|generic
//   to:           string  (required) target framework: starlight|docusaurus|vitepress|mkdocs
//   source:       string  (required) source URL or local directory path
//   outDir:       string  (required) where to write the migrated site
//   maxPages?:    number  (default 50, hard cap 200)
//   title?:       string  site title (default derived from source)
//   repoUrl?:     string  force git acquisition path
//   scriptsDir?:  string  where scrape.py + setup_venv.sh live (default: bundled skill copy)
//   refsDir?:     string  deep-escalation fallback for docs-scraper references
// }

// requires-skills: docs-scraper, docs-site-builder, document
export const meta = {
  name: 'docs-migrate',
  description: 'Migrate a documentation site from one framework to another: acquire source corpus, map pages via crosswalk, fan out conversion workers, gate for syntax leaks, assemble target config.',
  phases: [
    { title: 'Recon', detail: 'one Haiku call: identify source platform, probe acquisition paths' },
    { title: 'Acquire', detail: 'cheapest path: git clone -> python scrape -> webfetch; writes .md corpus under outDir/source' },
    { title: 'Gate', detail: 'drop empty/failed/nav-junk pages before conversion' },
    { title: 'Convert', detail: 'one Sonnet worker per page: crosswalk frontmatter, convert admonitions + syntax to target framework' },
    { title: 'Resolve links/assets', detail: 'one Haiku batch call: copy referenced local assets to target assetDir, rewrite src/href to framework-correct routes' },
    { title: 'Quality gate', detail: 'one Opus call: drop pages with source-framework syntax leaks or missing required frontmatter' },
    { title: 'Assemble', detail: 'write target config, sidebar, and INDEX.md with migration gaps' },
  ],
}

// --- DETECTION contract (distilled from docs-scraper/references/detection.md) -------------------
const DETECTION = `DOCS PLATFORM DETECTION (check signals in order; generator tag is strongest).
Signatures:
- starlight (Astro):  <meta generator "Astro">; markup .sl-markdown-content, custom <starlight-*>; /_astro/ assets.
- docusaurus:         <meta generator "Docusaurus">; #__docusaurus, .theme-doc-markdown, .markdown, .navbar__inner.
- mkdocs/material:    <meta generator "mkdocs"/"Material for MkDocs">; .md-content, .md-main, .md-nav; search_index.json.
- vitepress:          <meta generator "VitePress">; .VPDoc, .vp-doc, #VPContent, .VPSidebar; /assets/chunks/.
- gitbook:            often no generator; .gitbook-root, [data-testid], data-view/data-card-* attrs.
- sphinx/rtd:         <meta generator "Docutils"/"Sphinx">; .rst-content, div.body[role=main], .wy-nav-content.
- docsify:            no generator; near-empty <body> with <div id="app"> + window.$docsify script. CLIENT-RENDERED.
- generic:            no signature matched.`

// --- SELECTORS map (distilled from docs-scraper/references/platform-signatures.md) ---------------
const SELECTORS = {
  starlight:  { selector: '.sl-markdown-content,main article', source: 'auto' },
  docusaurus: { selector: '.theme-doc-markdown.markdown,article', source: 'auto' },
  mkdocs:     { selector: '.md-content__inner.md-typeset,.md-content article,[role=main]', source: 'auto' },
  vitepress:  { selector: '.vp-doc,.VPDoc .content', source: 'auto' },
  gitbook:    { selector: 'main,[data-testid="page.content"],.markdown-section .page-inner', source: 'auto' },
  sphinx:     { selector: '.rst-content [role=main],div.body[role=main]', source: 'auto' },
  docsify:    { selector: '.markdown-section', source: 'sitemap', rawMdSuffix: '.md' },
  generic:    { selector: 'article,main,.content', source: 'auto' },
}
const STRIP = '.md-sidebar,.toc,.theme-doc-toc-mobile,.pagination-nav,.prev-next,.edit-this-page,.copy,[role=navigation],[data-pagefind-ignore]'

// --- CROSSWALK: source admonition -> target syntax (the key conversion table) -------------------
// Maps known source-framework admonition patterns to target-framework equivalents.
// Workers must apply these; the quality gate checks for un-converted source patterns.
const ADMONITION_CROSSWALK = {
  // From MkDocs/Material admonitions (Python-Markdown, "!!! type" blocks)
  mkdocs: {
    pattern: 'admonition syntax: !!! note, !!! warning, !!! tip, !!! danger, !!! info, !!! success, !!! example, !!! abstract, !!! question, !!! failure, !!! bug, !!! quote, and ??? (collapsible) variants',
    to_starlight: ':::note, :::tip, :::caution, :::danger, ::: (no type = note) — title after the type on the same line, content indented, close with :::',
    to_docusaurus: ':::note, :::tip, :::warning, :::danger, :::info (custom types use :::type[Title])',
    to_vitepress: '::: info, ::: tip, ::: warning, ::: danger (colon-fence with type; title on same line)',
    note: 'MkDocs ??? collapsible -> use details HTML element in Starlight/Docusaurus/VitePress (no native equivalent)',
  },
  // From Starlight/Astro admonitions
  starlight: {
    pattern: ':::note, :::tip, :::caution, :::danger, :::aside fence blocks',
    to_mkdocs: '!!! note/tip/warning/danger (map caution->warning, aside->note)',
    to_docusaurus: ':::note, :::tip, :::warning, :::danger (caution->warning)',
    to_vitepress: '::: info (note->info), ::: tip, ::: warning, ::: danger (caution->warning)',
  },
  // From Docusaurus admonitions
  docusaurus: {
    pattern: ':::note, :::tip, :::warning, :::danger, :::info',
    to_starlight: ':::note, :::tip, :::caution, :::danger (warning->caution, info->note)',
    to_mkdocs: '!!! note/tip/warning/danger (info->note)',
    to_vitepress: '::: info (note->info), ::: tip, ::: warning, ::: danger',
  },
  // From VitePress admonitions
  vitepress: {
    pattern: '::: info, ::: tip, ::: warning, ::: danger, ::: details',
    to_starlight: ':::note (info->note), :::tip, :::caution (warning->caution), :::danger; details -> HTML <details>',
    to_docusaurus: ':::info, :::tip, :::warning, :::danger; details -> <details>',
    to_mkdocs: '!!! note/tip/warning/danger (info->note; details -> ??? collapsible)',
  },
}

// --- Starlight authoring contract (distilled from docs-site-builder, v0.40.0) -------------------
// Required frontmatter for Starlight pages. Workers converting TO starlight must emit this.
// Keep in sync with docs-create.js and docs-from-code.js.
const STARLIGHT_FRONTMATTER = `STARLIGHT REQUIRED FRONTMATTER:
Every page under src/content/docs/ must have:
  title: string (required)
  description: string (recommended)
  sidebar:
    order: number (optional, for sort order)
    label: string (optional, overrides title in sidebar)

Content root: src/content/docs/ (pages at <contentRoot>/<path>.md)
Config file: astro.config.mjs (starlight integration, sidebar array)
Admonitions: :::note :::tip :::caution :::danger (close with :::)
Code blocks: triple backtick with language tag
Internal links: use relative paths or /slug-based absolute paths`

// --- args / guards ------------------------------------------------------------------------------
let _args = args
if (typeof _args === 'string') {
  const t = _args.trim()
  if (t.startsWith('{') || t.startsWith('[')) { try { _args = JSON.parse(t) } catch {} }
}

const fromFramework = typeof _args?.from === 'string' ? _args.from.toLowerCase() : null
const toFramework = typeof _args?.to === 'string' ? _args.to.toLowerCase() : null
const source = typeof _args?.source === 'string' ? _args.source : null
const outDir = typeof _args?.outDir === 'string' ? _args.outDir : null

if (!fromFramework || !toFramework || !source || !outDir) {
  return { error: 'args.from, args.to, args.source, and args.outDir are required', got: { fromFramework, toFramework, source, outDir } }
}
const MAX_PAGES = Math.min(Math.max(1, _args?.maxPages ?? 50), 200)
const siteTitle = typeof _args?.title === 'string' ? _args.title : null
const repoUrl = typeof _args?.repoUrl === 'string' ? _args.repoUrl : null
const scriptsDir = typeof _args?.scriptsDir === 'string' ? _args.scriptsDir : 'plugins/workflow-kit/skills/docs-scraper/scripts'
const refsDir = _args?.refsDir ?? 'plugins/workflow-kit/skills/docs-scraper/references'

// Derived dirs: acquisition goes to source corpus, conversion output goes to contentRoot
const sourceCorpusDir = `${outDir}/.source-corpus`
const contentRoot = toFramework === 'starlight'   ? `${outDir}/src/content/docs`
                  : toFramework === 'docusaurus'  ? `${outDir}/docs`
                  : toFramework === 'vitepress'   ? `${outDir}/docs`
                  : toFramework === 'mkdocs'      ? `${outDir}/docs`
                  : `${outDir}/docs`

// assetDir: where copied assets live relative to outDir. Mirrors the FRAMEWORKS.assetDir in docs-create.js.
// null means the target framework has no conventional prose asset directory (skip resolution).
const TARGET_ASSET_DIRS = {
  starlight:  'src/assets',
  docusaurus: 'static',
  vitepress:  'docs/public',
  mkdocs:     'docs/assets',
}
const assetDir = TARGET_ASSET_DIRS[toFramework] ? `${outDir}/${TARGET_ASSET_DIRS[toFramework]}` : null

// --- resolveLinksAndAssets (shared helper; mirrored from docs-create.js) -----------------------
// Scans each converted page for local asset references, copies files to assetDir, rewrites links.
// Called after conversion workers, before the quality gate, so the gate sees resolved paths.
async function resolveLinksAndAssets(convertedPages, contentRoot, assetDir, toFramework) {
  if (!assetDir) {
    return { copied: [], rewritten: [], skipped: [`${toFramework} has no assetDir; link resolution skipped`] }
  }
  const pageList = convertedPages.map(p => `${contentRoot}/${p.path}`).join('\n')
  const result = await agent(
    `You are a link-and-asset resolver for a ${toFramework} docs site at "${contentRoot}".\n\n` +
    `TASK: For each page listed below, find all local (non-http/https) asset references — ` +
    `markdown image syntax \`![alt](path)\`, HTML \`<img src="path">\`, and \`<source src="path">\` — ` +
    `then for each referenced local file:\n` +
    `1. If the source file EXISTS at the path as written (relative to the page's directory or absolute), ` +
    `   copy it to "${assetDir}/<filename>": \`mkdir -p "${assetDir}" && cp "<src>" "${assetDir}/<filename>"\`.\n` +
    `2. Rewrite the reference in the page to the framework-correct route:\n` +
    `   - ${toFramework === 'starlight'  ? 'Starlight: relative path from the page to src/assets/, e.g. ../../assets/image.png.' :
       toFramework === 'docusaurus' ? 'Docusaurus: absolute path from site root, e.g. /img/image.png (maps to static/img/).' :
       toFramework === 'mkdocs'     ? 'MkDocs: relative path from the page to docs/assets/, e.g. ../assets/image.png.' :
       toFramework === 'vitepress'  ? 'VitePress: absolute path, e.g. /image.png (maps to docs/public/).' :
       `path relative to the framework's asset directory.`}\n` +
    `   Use the Edit tool to rewrite the reference in the page file.\n` +
    `3. If the source file does NOT exist, record it in "skipped" with reason "source not found".\n` +
    `4. External URLs and root-relative paths that already point into the asset dir are SKIPPED.\n\n` +
    `PAGES:\n${pageList}\n\n` +
    `Return: copied (array of {src, dest}), rewritten (array of {page, from, to}), ` +
    `skipped (array of strings), summary (one sentence).`,
    {
      label: 'resolve-links-assets',
      phase: 'Quality gate',
      model: 'haiku',
      schema: {
        type: 'object', required: ['copied', 'rewritten', 'skipped', 'summary'], additionalProperties: false,
        properties: {
          copied: { type: 'array', items: {
            type: 'object', required: ['src', 'dest'], additionalProperties: false,
            properties: { src: { type: 'string' }, dest: { type: 'string' } }
          }},
          rewritten: { type: 'array', items: {
            type: 'object', required: ['page', 'from', 'to'], additionalProperties: false,
            properties: { page: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }
          }},
          skipped: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
      },
    },
  )
  return result ?? { copied: [], rewritten: [], skipped: ['resolve-links-assets agent returned null'], summary: 'skipped' }
}

const admonitionGuide = ADMONITION_CROSSWALK[fromFramework] ?? ADMONITION_CROSSWALK.generic
const conversionAdmonitions = admonitionGuide
  ? `SOURCE ADMONITIONS (${fromFramework}): ${admonitionGuide.pattern ?? 'unknown'}\nTARGET: ${admonitionGuide[`to_${toFramework}`] ?? 'convert to standard blockquote with bold label'}`
  : `Convert any source-framework admonitions to target-framework equivalents.`

log(`migration: ${fromFramework} -> ${toFramework} | source=${source} | outDir=${outDir}`)

// --- schemas ------------------------------------------------------------------------------------
const RECON_SCHEMA = {
  type: 'object', required: ['platform', 'baseUrl'], additionalProperties: false,
  properties: {
    platform: { type: 'string' },
    baseUrl: { type: 'string' },
    jsRendered: { type: 'boolean' },
    hasLlms: { type: 'boolean' },
    hasSitemap: { type: 'boolean' },
    hasSearchIndex: { type: 'boolean' },
    sourceFormat: { enum: ['md', 'mdx', 'rst', 'asciidoc', 'none'] },
    repo: {
      type: 'object', additionalProperties: false,
      properties: {
        repoUrl: { type: 'string' },
        branch: { type: 'string' },
        docsSubdir: { type: 'string' },
      },
    },
    source: { type: 'string' },
    pages: { type: 'array', items: {
      type: 'object', required: ['url'], additionalProperties: false,
      properties: { url: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' } } } },
    inferredTitle: { type: 'string', description: 'site title inferred from the source if not provided in args' },
  },
}

const ACQUIRE_SCHEMA = {
  type: 'object', required: ['ok', 'failed', 'pages'], additionalProperties: false,
  properties: {
    ok: { type: 'number' }, failed: { type: 'number' },
    source: { type: 'string' },
    fallback: { type: 'boolean' },
    fallbackReason: { type: 'string' },
    pages: { type: 'array', items: {
      type: 'object', required: ['url', 'status'], additionalProperties: false,
      properties: {
        url: { type: 'string' }, path: { type: 'string' },
        title: { type: 'string' }, section: { type: 'string' },
        words: { type: 'number' }, status: { enum: ['ok', 'empty', 'error'] },
        failure: { type: 'string' },
      } } },
  },
}

const GATE_SCHEMA = {
  type: 'object', required: ['kept', 'dropped'], additionalProperties: false,
  properties: {
    kept: { type: 'array', items: {
      type: 'object', required: ['url', 'path'], additionalProperties: false,
      properties: {
        url: { type: 'string' }, path: { type: 'string' },
        title: { type: 'string' }, section: { type: 'string' },
        words: { type: 'number' }, thin: { type: 'boolean' },
      } } },
    dropped: { type: 'array', items: {
      type: 'object', required: ['url', 'reason'], additionalProperties: false,
      properties: { url: { type: 'string' }, path: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

const CONVERT_SCHEMA = {
  type: 'object', required: ['path', 'status'], additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'output path relative to contentRoot' },
    title: { type: 'string' },
    section: { type: 'string' },
    status: { enum: ['ok', 'error'] },
    failure: { type: 'string' },
    words: { type: 'number' },
  },
}

const QUALITY_SCHEMA = {
  type: 'object', required: ['admitted', 'rejected'], additionalProperties: false,
  properties: {
    admitted: { type: 'array', items: {
      type: 'object', required: ['path'], additionalProperties: false,
      properties: { path: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' }, words: { type: 'number' } } } },
    rejected: { type: 'array', items: {
      type: 'object', required: ['path', 'reason'], additionalProperties: false,
      properties: { path: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

// --- 1. Recon (Haiku; gather facts — code picks acquisition strategy) ---------------------------
phase('Recon')
const isLocalSource = source.startsWith('/') || source.startsWith('.') || !source.includes('://')
let map
if (isLocalSource) {
  // Local directory: skip network recon, treat as git-mode (files already on disk).
  log('source is a local path; skipping network recon, using direct-copy acquisition')
  map = {
    platform: fromFramework,
    baseUrl: source,
    jsRendered: false,
    hasLlms: false,
    hasSitemap: false,
    hasSearchIndex: false,
    sourceFormat: 'md',
    source: 'local',
    pages: [],
    inferredTitle: siteTitle ?? null,
  }
} else {
  map = await agent(
    `Recon the documentation site at ${source}. Gather FACTS only — do NOT pick a strategy or convert anything.\n\n` +
    `1. PLATFORM: fetch the entry URL and identify the platform per the DETECTION contract` +
    (fromFramework !== 'generic' ? ` (caller hint: from="${fromFramework}" — confirm or correct this)` : '') + `.\n` +
    `2. CURATED SOURCES: probe hasLlms (baseUrl/llms.txt), hasSitemap (baseUrl/sitemap.xml), hasSearchIndex (mkdocs search_index.json).\n` +
    `3. SOURCE REPO: look for a backing GitHub repo (mkdocs.yml repo_url, editUrl, "Edit on GitHub", *.github.io).\n` +
    `   If found, verify with gh: \`gh api repos/{owner}/{repo}/contents/{docsSubdir}\`. Set repo:{repoUrl,branch,docsSubdir} ONLY if confirmed. Else omit.\n` +
    `4. FALLBACK PAGE LIST: enumerate pages preferring llms.txt -> sitemap.xml -> sidebar nav. Same-origin, drop anchors/assets/external.\n` +
    `5. INFERRED TITLE: read the site's <title> or <h1> on the homepage; set inferredTitle.\n\n` +
    `Return { platform, baseUrl, jsRendered, hasLlms, hasSitemap, hasSearchIndex, sourceFormat, repo?, source, pages:[{url,title,section}], inferredTitle }.\n\n` +
    `DETECTION CONTRACT\n${DETECTION}`,
    { label: 'recon', model: 'haiku', schema: RECON_SCHEMA },
  )
  if (!map?.platform) return { error: 'recon failed', source, map }
}

const effectiveTitle = siteTitle ?? map.inferredTitle ?? 'Migrated Docs'
const sel = SELECTORS[map.platform] || SELECTORS.generic
const fmt = map.sourceFormat
const repoVerified = !!(map.repo && map.repo.repoUrl)

// Strategy: same ladder as docs-scrape (git > python > webfetch)
let strategy =
  (repoUrl ? 'git'
  : isLocalSource ? 'local'
  : (repoVerified && (fmt === 'md' || fmt === 'mdx')) ? 'git'
  : (map.jsRendered && !map.hasSitemap && !map.hasLlms) ? 'webfetch'
  : 'python')

log(`platform=${map.platform}; strategy=${strategy}; pages enumerated=${map.pages?.length ?? 0}`)

// --- 2. Acquire source corpus (writes .md files to sourceCorpusDir) ----------------------------
phase('Acquire')
let manifest = null   // pages metadata (ACQUIRE_SCHEMA.pages)
let acqSource = strategy

if (strategy === 'local') {
  // Local source: enumerate existing .md files and build the manifest without copying.
  const localAcq = await agent(
    `Enumerate and catalog all .md/.mdx files under "${source}" (the source docs directory). Use Bash only.\n\n` +
    `1. Find files: find "${source}" -name "*.md" -o -name "*.mdx" | head -${MAX_PAGES}\n` +
    `2. For each file: compute words (wc -w), title (first # heading or slug), section (parent dir name).\n` +
    `3. Derive url = "local:" + relative path from "${source}".\n` +
    `4. Write "${sourceCorpusDir}/manifest.json" with the pages array (mkdir -p "${sourceCorpusDir}" first).\n` +
    `   Also copy all .md/.mdx files to "${sourceCorpusDir}" mirroring the subtree (cp -r "${source}/." "${sourceCorpusDir}/" or rsync).\n\n` +
    `Return { ok, failed, source:"local:${source}", pages:[{url,path,title,section,words,status}] } where path is relative to "${sourceCorpusDir}".`,
    { label: 'acquire:local', model: 'haiku', schema: ACQUIRE_SCHEMA },
  )
  manifest = localAcq?.pages ?? []; acqSource = `local:${source}`
  log(`local: cataloged ${localAcq?.ok ?? 0} file(s)`)
}

if (strategy === 'git') {
  const repo = (repoUrl ? { ...map.repo, repoUrl } : map.repo) || {}
  if (!repo.repoUrl) {
    log('git selected but no repoUrl resolved -> falling back to python')
    strategy = 'python'
  } else {
    const isMdx = map.sourceFormat === 'mdx'
    const git = await agent(
      `Acquire docs from the git repo ${repo.repoUrl}${repo.branch ? ` (branch ${repo.branch})` : ''} into "${sourceCorpusDir}". Use Bash only.\n\n` +
      `1. Shallow-clone: git clone --depth 1${repo.branch ? ` --branch ${repo.branch}` : ''} ${repo.repoUrl} <tmp> (mktemp -d). If clone fails, return {ok:0,failed:0,fallback:true,fallbackReason:"..."}.\n` +
      `2. Locate docs dir: prefer "${repo.docsSubdir || 'docs/'}"; else find the dir with the most .md/.mdx files. If none, set fallback:true.\n` +
      `3. Copy every .md and .mdx into "${sourceCorpusDir}", mirroring the subtree. Rename .mdx -> .md.\n` +
      (isMdx
        ? `4. Clean MDX: locate scripts dir (try "${scriptsDir}"), PY=$(bash <dir>/setup_venv.sh), "$PY" <dir>/scrape.py --clean-mdx ${JSON.stringify(sourceCorpusDir)}.\n`
        : `4. (Source is .md, no cleaning needed.)\n`) +
      `5. For each copied file compute words (wc -w) and title (first # heading, else slug). Derive url = ${repo.repoUrl} + relative path.\n` +
      `6. Write "${sourceCorpusDir}/manifest.json" with the pages array. rm -rf the temp clone.\n\n` +
      `Return { ok, failed, source:"git:${repo.repoUrl}", fallback?, fallbackReason?, pages:[{url,path,title,section,words,status}] }.`,
      { label: 'acquire:git', model: 'haiku', schema: ACQUIRE_SCHEMA },
    )
    if (git?.fallback || !(git?.pages?.length)) {
      log(`git acquire empty (${git?.fallbackReason || 'no files'}) -> falling back to python`)
      strategy = 'python'
    } else {
      manifest = git.pages; acqSource = git.source || `git:${repo.repoUrl}`
      log(`git: copied ${git.ok} file(s)`)
    }
  }
}

if (strategy === 'python') {
  const py = await agent(
    `Scrape the docs at ${source} into "${sourceCorpusDir}" using the bundled python scraper. Use Bash only.\n\n` +
    `1. Locate scripts dir. Try: "${scriptsDir}", ".claude/skills/docs-scraper/scripts", "$HOME/.claude/skills/docs-scraper/scripts".\n` +
    `2. Bootstrap: PY=$(bash <dir>/setup_venv.sh)\n` +
    `3. Run: "$PY" <dir>/scrape.py --base-url ${JSON.stringify(source)} --out ${JSON.stringify(sourceCorpusDir)} ` +
    `--platform ${JSON.stringify(map.platform)} ` +
    `--selector ${JSON.stringify(sel.selector)} --strip ${JSON.stringify(STRIP)} --source ${sel.source} ` +
    `--max ${MAX_PAGES} --timeout 30` +
    `${sel.rawMdSuffix ? ` --raw-md-suffix ${JSON.stringify(sel.rawMdSuffix)}` : ''}\n` +
    `4. Exit code 3 (or ok=0) -> set fallback:true. Read "${sourceCorpusDir}/manifest.json" and return entries as pages.\n\n` +
    `Return { ok, failed, source, fallback?, fallbackReason?, pages:[{url,path,title,section,words,status,failure}] }. Do NOT put page content in reply.`,
    { label: 'acquire:python', model: 'haiku', schema: ACQUIRE_SCHEMA },
  )
  if (py?.fallback || !(py?.pages?.some(p => p.status === 'ok'))) {
    log(`python acquire empty (${py?.fallbackReason || 'no ok pages'}) -> falling back to webfetch`)
    strategy = 'webfetch'
  } else {
    manifest = py.pages; acqSource = py.source || 'python'
    const okc = py.pages.filter(p => p.status === 'ok').length
    log(`python: scraped ${okc} ok / ${py.pages.length} page(s)`)
  }
}

if (strategy === 'webfetch') {
  // webfetch: pages must have been enumerated by recon
  if (!map.pages?.length) return { error: 'webfetch fallback but no pages enumerated by recon', source, platform: map.platform }
  const seen = new Set(); let slots = MAX_PAGES
  const fetched = (await pipeline(
    map.pages.slice(0, MAX_PAGES),
    (page) => {
      const key = page.url.toLowerCase().replace(/\/$/, '')
      if (seen.has(key) || slots <= 0) return null
      seen.add(key); slots--
      return agent(
        `Fetch ${page.url} and extract its main documentation content as clean markdown. Use WebFetch or a web-reader MCP.\n` +
        `Content container for ${map.platform}: ${sel.selector}. Strip chrome (nav/sidebar/footer/TOC/breadcrumbs/edit-on-GitHub/pagination).\n` +
        `Preserve: headings, fenced code blocks with language, tables, admonitions. Make ONE retrieval attempt. On failure set status='error'.\n` +
        `Return { url, title, section, status:'ok'|'empty'|'error', markdown, wordCount }.`,
        { label: `fetch:${page.url.slice(-40)}`, phase: 'Acquire', model: 'haiku' },
      ).then(n => n && { ...n, section: n.section ?? page.section, title: n.title ?? page.title })
       .catch(e => ({ url: page.url, section: page.section, status: 'error', failure: String(e?.message || e), markdown: '' }))
    },
  )).filter(Boolean)
  // Write fetched pages to disk so the rest of the pipeline is uniform (files on disk)
  const wfWrite = await agent(
    `Write these fetched markdown pages to disk under "${sourceCorpusDir}", one .md file per page. Use Write + Bash.\n` +
    `1. mkdir -p "${sourceCorpusDir}".\n` +
    `2. For each page: derive a filename from the URL slug (url -> last path segment + .md; strip query/anchor). Write the markdown to that path.\n` +
    `3. Write "${sourceCorpusDir}/manifest.json" with the pages array (path relative to "${sourceCorpusDir}", status, title, section, words=wordCount).\n\n` +
    `PAGES\n${JSON.stringify(fetched)}\n\n` +
    `Return { ok, failed, source:"webfetch", pages:[{url,path,title,section,words,status}] }.`,
    { label: 'acquire:webfetch-write', model: 'haiku', schema: ACQUIRE_SCHEMA },
  )
  manifest = wfWrite?.pages ?? []; acqSource = 'webfetch'
  const okc = manifest.filter(p => p.status === 'ok').length
  log(`webfetch: fetched ${fetched.length} page(s); ${okc} written ok`)
  if (!okc) return { error: 'no pages extracted content', source, platform: map.platform }
}

if (!manifest?.length) return { error: 'acquisition produced no pages', source, strategy }

// --- 3. Admission gate: drop empty/failed/nav-junk before conversion ---------------------------
phase('Gate')
const gate = await agent(
  `You are the admission gate for a scraped docs corpus from ${source} (platform=${map.platform}, source=${acqSource}).\n` +
  `Page CONTENT is on disk under "${sourceCorpusDir}" at each page's "path". Below is the manifest (metadata only).\n\n` +
  `Decision rules:\n` +
  `- DROP any page with status != "ok", or with a failure note, or a slug that looks like 404/redirect.\n` +
  `- DROP near-duplicate paths (trailing-slash twins, print/amp variants).\n` +
  `- FLAG thin:true but KEEP pages with words < 25.\n` +
  `- SPOT-READ at most 8 suspicious files (very low word count, or title looks like nav/sidebar capture). Drop captured nav.\n\n` +
  `Return { kept:[{url,path,title,section,words,thin}], dropped:[{url,path,reason}] }.\n\n` +
  `MANIFEST\n${JSON.stringify(manifest)}`,
  { label: 'gate', schema: GATE_SCHEMA },
)
const { kept: keptPages = [], dropped: droppedPages = [] } = gate ?? {}
log(`gate: kept ${keptPages.length}, dropped ${droppedPages.length}`)
if (!keptPages.length) return { error: 'gate dropped all pages', source, platform: map.platform, dropped: droppedPages }

// --- 4. Convert: fan out one Sonnet worker per page -------------------------------------------
phase('Convert')
// Slice the conversion contract per worker: only what each agent needs.
// (CLAUDE.md: "SLICE that inline contract per agent; don't inject the whole surface into every prompt")
const conversionContract = toFramework === 'starlight' ? STARLIGHT_FRONTMATTER : (
  `TARGET FRAMEWORK: ${toFramework}\n` +
  `Content root: ${contentRoot}\n` +
  `Use correct ${toFramework} frontmatter: at minimum title. ` +
  (toFramework === 'docusaurus' ? 'Docusaurus: id (optional), title, description, sidebar_position. Admonitions: :::note :::tip :::warning :::danger :::info' :
   toFramework === 'vitepress'  ? 'VitePress: title, description in frontmatter. Admonitions: ::: info ::: tip ::: warning ::: danger' :
   toFramework === 'mkdocs'     ? 'MkDocs: use !!! note/tip/warning/danger/info admonition blocks. Frontmatter: title only.' :
   'Use correct frontmatter and admonition syntax for the target framework.')
)

const converted = (await pipeline(
  keptPages,
  (page) => agent(
    `Convert this documentation page from ${fromFramework} to ${toFramework}.\n\n` +
    `SOURCE: read "${sourceCorpusDir}/${page.path}" (the acquired markdown). Use the Read tool.\n` +
    `OUTPUT: write the converted page to "${contentRoot}/${page.path}" (mkdir -p the parent dir). Use Write tool.\n\n` +
    `CONVERSION RULES:\n` +
    `1. ADMONITIONS: ${conversionAdmonitions}\n` +
    `2. FRONTMATTER: add/replace with target-framework frontmatter. Source title="${page.title}". ${conversionContract}\n` +
    `3. LINKS: rewrite internal doc links from source-framework slug patterns to target-framework slug patterns. Keep external links as-is.\n` +
    `4. CODE BLOCKS: preserve fenced code blocks with language tags. Do NOT alter code content.\n` +
    `5. PRESERVE: prose, heading hierarchy, tables, images (keep src paths as-written). Do NOT rewrite content.\n` +
    `6. STRIP LEFTOVERS: remove source-framework-specific elements (MkDocs macros, Docusaurus JSX imports, VitePress custom containers with source syntax). Anything that would break in the target framework.\n\n` +
    `On success return { path:"${page.path}", title, section:"${page.section}", status:"ok", words }.\n` +
    `On failure (unreadable source, write error) return { path:"${page.path}", status:"error", failure:"..." }.\n\n` +
    `${conversionContract}`,
    { label: `convert:${page.path}`, model: 'sonnet', schema: CONVERT_SCHEMA },
  ).catch(e => ({ path: page.path, status: 'error', failure: String(e?.message || e) })),
)).filter(Boolean)

const convOk = converted.filter(c => c.status === 'ok')
const convFailed = converted.filter(c => c.status === 'error')
log(`convert: ${convOk.length} ok, ${convFailed.length} failed`)
if (!convOk.length) return { error: 'all conversion workers failed', converted }

// --- Link/asset resolution (scripted Haiku step; runs before quality gate) --------------------
// Copies referenced local assets to the framework's assetDir and rewrites links so the quality
// gate sees resolved paths, not broken references from the source corpus.
phase('Resolve links/assets')
const linkResult = await resolveLinksAndAssets(convOk, contentRoot, assetDir, toFramework)
log(`links/assets: ${linkResult.copied?.length ?? 0} copied, ${linkResult.rewritten?.length ?? 0} rewritten, ${linkResult.skipped?.length ?? 0} skipped`)

// --- 5. Quality gate: drop pages with syntax leaks or missing required frontmatter -------------
phase('Quality gate')
// Only source-framework syntax patterns that are clearly wrong in the target.
const leakPatterns =
  toFramework === 'starlight'  ? `MkDocs admonitions "!!! note" / "??? note", Docusaurus :::type blocks NOT using :::note/tip/caution/danger, VitePress "::: info" containers, raw JSX imports, MDX export statements` :
  toFramework === 'docusaurus' ? `MkDocs "!!! note" admonitions, VitePress "::: info" containers, Starlight ":::caution" (must be :::warning), raw MDX export/import` :
  toFramework === 'vitepress'  ? `MkDocs "!!! note" admonitions, Docusaurus/Starlight ::: fenced admonitions with wrong type names, raw JSX/MDX imports` :
  toFramework === 'mkdocs'     ? `Starlight/Docusaurus/VitePress ::: admonition fences (must be !!! blocks), JSX/MDX syntax` :
  `any source-framework-specific admonition syntax or component syntax not valid in ${toFramework}`

const qgate = await agent(
  `You are the quality gate for a ${fromFramework} -> ${toFramework} migration.\n` +
  `Converted pages are under "${contentRoot}". Review each converted page for migration completeness.\n\n` +
  `READ each page listed below and check:\n` +
  `1. SYNTAX LEAK: does it still contain source-framework syntax? Patterns to catch: ${leakPatterns}.\n` +
  `2. FRONTMATTER: does it have the required target-framework frontmatter (at minimum: title)?\n` +
  `3. CONTENT INTEGRITY: is the page recognizable documentation (not empty, not nav-only)?\n\n` +
  `ADMIT pages that pass all checks. REJECT pages with syntax leaks or missing required frontmatter.\n` +
  `For rejected pages: note the specific issue in "reason".\n\n` +
  `Return { admitted:[{path,title,section,words}], rejected:[{path,reason}] }.\n\n` +
  `CONVERTED PAGES\n${JSON.stringify(convOk)}`,
  { label: 'quality-gate', schema: QUALITY_SCHEMA },
)

const admitted = qgate?.admitted ?? convOk.map(c => ({ path: c.path, title: c.title, section: c.section, words: c.words }))
const rejected = qgate?.rejected ?? []
log(`quality gate: admitted ${admitted.length}, rejected ${rejected.length}`)
if (!admitted.length) return { error: 'quality gate rejected all converted pages', rejected }

// All pages that didn't make it through (gate drop + convert fail + quality reject)
const allGaps = [
  ...droppedPages.map(p => ({ url: p.url, path: p.path, reason: `gate: ${p.reason}` })),
  ...convFailed.map(c => ({ path: c.path, reason: `convert error: ${c.failure}` })),
  ...rejected.map(r => ({ path: r.path, reason: `quality gate: ${r.reason}` })),
]

// --- 6. Assemble: write target config + INDEX.md -----------------------------------------------
phase('Assemble')
const configNote =
  toFramework === 'starlight'  ? `Write astro.config.mjs with starlight({title:"${effectiveTitle}",sidebar:[autogenerate from admitted sections]}) and src/content.config.ts with docsLoader()+docsSchema(). Content root: src/content/docs/.` :
  toFramework === 'docusaurus' ? `Write docusaurus.config.js with title:"${effectiveTitle}", docs plugin pointing to docs/ with sidebar autogeneration. No manual sidebar.js needed if autogenerate is true.` :
  toFramework === 'vitepress'  ? `Write .vitepress/config.js (or config.ts) with title:"${effectiveTitle}", themeConfig.sidebar autogenerated from admitted sections.` :
  toFramework === 'mkdocs'     ? `Write mkdocs.yml with site_name:"${effectiveTitle}", docs_dir: docs/, nav autogenerated or manually structured from admitted sections.` :
  `Write the appropriate ${toFramework} config file with title:"${effectiveTitle}".`

const assembled = await agent(
  `Assemble the migrated ${toFramework} site from the admitted pages under "${contentRoot}". Use Bash + Write.\n\n` +
  `1. CONFIG: ${configNote}\n` +
  `2. CLEANUP: rm the "${sourceCorpusDir}" acquisition directory (rm -rf) now that conversion is done.\n` +
  `3. INDEX: write "${outDir}/MIGRATION.md" with:\n` +
  `   - Migration summary: ${fromFramework} -> ${toFramework}, source="${source}", ${admitted.length} pages admitted, ${allGaps.length} gaps.\n` +
  `   - Table: admitted pages (path, title, words).\n` +
  `   - GAPS section: each gap with its reason (source URL/path + reason).\n` +
  `   - Next steps: install instructions for ${toFramework}, remaining manual review items.\n\n` +
  `Return a summary of what was written.\n\n` +
  `ADMITTED PAGES\n${JSON.stringify(admitted)}\n\n` +
  `GAPS\n${JSON.stringify(allGaps)}`,
  { label: 'assemble', model: 'sonnet' },
)

return {
  from: fromFramework,
  to: toFramework,
  source,
  outDir,
  contentRoot,
  effectiveTitle,
  strategy: acqSource,
  acquired: manifest.length,
  admitted: admitted.length,
  gaps: allGaps.length,
  rejected: rejected.length,
  assemble: assembled,
}
