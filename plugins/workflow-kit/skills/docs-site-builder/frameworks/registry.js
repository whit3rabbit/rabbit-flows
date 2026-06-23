// SPLICE FRAGMENT — single source of truth for the framework-aware docs substrate.
//
// This file is NOT standalone-valid JS. It is inlined verbatim by
// scripts/build-docs-contracts.mjs between the docs-contracts/frameworks generated markers
// into .claude/workflows/docs-create.js and docs-from-code.js. (The marker strings are
// intentionally NOT repeated here: a verbatim copy of an end-marker inside the block would
// make the build splice match the wrong boundary.) It references symbols that
// exist in the HOST workflow's scope, not here:
//   - CONTRACT and the per-framework <FW>_CONTRACT consts (generated contract blocks above this one)
//   - the agent() and log() workflow globals
// Edit HERE, then run: node scripts/build-docs-contracts.mjs  (npm run check enforces no drift).
//
// Contents: CROSSWALK + getCrosswalkColumn + STARLIGHT_LEAK_PATTERNS + the FRAMEWORKS registry
// (13 frameworks) + resolveLinksAndAssets. The build-repair loop (runBuildRepairLoop) stays in
// docs-create.js — it is that workflow's orchestration, not shared substrate.

// --- CROSSWALK: framework-neutral intent -> syntax map ----------------------------------------
// Maps each documentation construct (by intent) to the correct syntax per framework.
// Inject ONLY the active framework's column into author + gate prompts (slice-per-agent rule).
// "filled" frameworks below have confirmed syntax; unfilled entries are null (fall back to docs).
//
// Constructs covered:
//   callout   - information callout / admonition
//   tabs      - tabbed content switcher
//   steps     - numbered sequential procedure
//   card      - highlighted content card block
//   filetree  - annotated directory/file tree
//   code-title - code block with a visible filename/title label
//
// Usage: getCrosswalkColumn(framework) -> string to inject into an author prompt.
// The quality gate also uses this to check for syntax leaks (e.g. <Aside in a mkdocs page).
const CROSSWALK = {
  callout: {
    starlight:  ':::note / :::tip / :::caution / :::danger  (or <Aside type="note|tip|caution|danger"> in .mdx)',
    docusaurus: ':::note / :::tip / :::info / :::warning / :::danger  (CommonMark-adjacent; no import needed)',
    mkdocs:     '!!! note "Optional title" / !!! tip / !!! warning / !!! danger  (Material admonition)',
    vitepress:  '::: info / ::: tip / ::: warning / ::: danger  (followed by content, closed with :::)',
    // frameworks without a confirmed callout short-form (authors consult official docs):
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  tabs: {
    starlight:  '<Tabs syncKey?="pkg"><TabItem label="npm">...</TabItem></Tabs>  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: '<Tabs><TabItem value="npm" label="npm">...</TabItem></Tabs>  (.mdx, import from @docusaurus/theme-common)',
    mkdocs:     '=== "Tab 1"\n    content\n=== "Tab 2"\n    content  (Material tabbed extension, no import)',
    vitepress:  'No native tabs — use <script setup> + component or a custom VitePress plugin',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  steps: {
    starlight:  '<Steps> wrapping a markdown ordered list (1. 2. 3.)  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: 'Plain markdown ordered list (1. 2. 3.) — no special wrapper needed; Docusaurus renders them as steps.',
    mkdocs:     'Plain markdown ordered list (1. 2. 3.); no dedicated steps component in Material.',
    vitepress:  'Plain markdown ordered list (1. 2. 3.); no dedicated steps component.',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  card: {
    starlight:  '<Card title="..." icon?="...">content</Card> inside <CardGrid stagger?>  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: 'No native Card component — use a custom component or admonition with :::tip as a visual workaround.',
    mkdocs:     'No native card — use Material grid cards: <div class="grid cards" markdown> ... </div> (requires grid plugin).',
    vitepress:  'No native card — use a custom Vue component or style a <div class="custom-block tip">.',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  filetree: {
    starlight:  '<FileTree> wrapping a markdown nested list  (.mdx, import from @astrojs/starlight/components)',
    docusaurus: 'No native FileTree — use a code block with bash/text language and indentation to represent structure.',
    mkdocs:     'No native FileTree — use a code block with bash language and indentation.',
    vitepress:  'No native FileTree — use a code block with a bash/text language label.',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
  'code-title': {
    starlight:  'Fenced code block with title="filename.js" attribute: ```js title="src/util.js"',
    docusaurus: 'Fenced code block with title="filename.js" meta: ```js title="src/util.js"',
    mkdocs:     'Fenced code block with title added via Material\'s annotations or code block title feature: ``` js title="src/util.js"',
    vitepress:  'Fenced code block with filename label in the info string: ```js [filename.js]  (or use codegroup feature for multiple)',
    fumadocs: null, mdbook: null, docsify: null, sphinx: null, nextra: null,
    mintlify: null, docsy: null, scalar: null, redocly: null,
  },
}

// getCrosswalkColumn: returns the slice of CROSSWALK for the given framework as an injected string.
// Null entries are omitted (author consults framework docs for those constructs).
// leakPatterns: Starlight-specific patterns that must NOT appear in non-Starlight output.
function getCrosswalkColumn(fw) {
  const lines = []
  for (const [construct, fwMap] of Object.entries(CROSSWALK)) {
    const syntax = fwMap[fw]
    if (syntax) lines.push(`  ${construct}: ${syntax}`)
  }
  if (!lines.length) return null
  return `COMPONENT CROSSWALK for ${fw} (authoritative per-construct syntax — use these, not Starlight syntax):\n${lines.join('\n')}`
}

// Starlight-specific syntax patterns that indicate a syntax leak into other frameworks.
// The quality gate uses these to detect and reject pages that incorrectly include Starlight syntax.
const STARLIGHT_LEAK_PATTERNS = [
  `@astrojs/starlight`,
  `<Aside`,
  `<Card`,
  `<CardGrid`,
  `<FileTree`,
  `<Steps`,
  `<Tabs`,
  `<TabItem`,
  `<LinkCard`,
  `<LinkButton`,
  `<Badge`,
]

// --- FRAMEWORKS registry -----------------------------------------------------------------------
// Single source of truth keyed by framework id. Each entry covers everything a docs-create run
// needs to be framework-aware without branching on strings throughout the script.
//
// Schema per entry:
//   contentRoot    — where page files live (relative to outDir)
//   configFiles    — the config files this framework uses (so the verify stage knows what to write)
//   contract       — inline authoring contract text (authoritative runtime source; null = no inline contract)
//   assemblePrompt — instructions the verify/finalize agent uses to write or update the primary config
//                    (injected into the verify prompt so per-framework config assembly logic lives here;
//                     covers steps 2-3 only; the empirical build gate is scripted via runBuildRepairLoop)
//   validate       — empirical build check: { buildCmd(outDir, scaffoldMode) -> string|null,
//                    parseErrors(stderr) -> string[] }
//                    buildCmd returns the shell command to run (null = not runnable for this framework),
//                    parseErrors extracts human-readable error lines from stderr/stdout.
//                    null validate = no empirical check at all (legacy sentinel for unrecognized frameworks).
//                    parseErrors is consumed by runBuildRepairLoop (defined near the top of this file).
//
// Only Starlight is fully populated. Other frameworks fall back to their refsDir skeletons and
// current-docs lookups (context7/find-docs). Add a new entry — populate all five keys — before
// using a framework id in a run; a missing `contract` means authors get the "no inline contract"
// fallback warning. The sentinel key "_unfilled" is the runtime fallback for any unrecognised
// framework id; do NOT name a real framework "_unfilled".
const FRAMEWORKS = {
  starlight: {
    contentRoot: 'src/content/docs',
    // assetDir: where authored assets (images, diagrams) are placed relative to outDir.
    // resolveLinksAndAssets copies files here and rewrites src/href paths in page content.
    assetDir: 'src/assets',
    configFiles: ['astro.config.mjs', 'src/content.config.ts'],
    // CONTRACT is defined above; bound here so callers reach it through the registry.
    contract: CONTRACT,
    // assemblePrompt covers steps 2-3 (config writing). The empirical build gate is scripted
    // separately (runBuildRepairLoop); assemblePrompt does NOT include a build step.
    // scaffoldMode routing:
    //   content-only (default): write content + config; empirical check skipped unless already buildable.
    //   add-to-existing: same as content-only but SKIP writing astro.config if one already exists.
    //   full-project: scaffold a complete buildable project (package.json + npm install) then run astro check.
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Astro top-level `base` option in defineConfig (e.g. base: '/docs').
      const baseNote = basePath
        ? `   Set base: '${basePath}' in the defineConfig() call (outside starlight()); this makes Astro prefix all routes with the subpath.\n`
        : ''
      // i18n -> Starlight locales config (defaultLocale + locales map).
      const i18nNote = i18n
        ? `   Add a locales block inside starlight(): defaultLocale: '${i18n.defaultLocale}', ` +
          `locales: { ${i18n.locales.map(l => `'${l}': { label: '${l}' }`).join(', ')} }. ` +
          `Create src/content/docs/<locale>/ dirs for each locale.\n`
        : ''
      // Starlight has no built-in versioning; note it and skip.
      const versioningNote = versioning
        ? `   NOTE: Starlight has no built-in versioning support. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use community plugins or manual subpath routing if needed.\n`
        : ''
      return (
        `2. Ensure the content collection exists: write ${outDir}/src/content.config.ts with docsLoader()+docsSchema() if missing.\n` +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE (do NOT clobber) ${outDir}/astro.config.mjs: patch the sidebar to reflect the page groups ` +
            `(${groups}). Use slug items for the admitted pages. Derive a title from the brief only if one is missing. ` +
            `If no astro.config exists, create one.\n`
          : `3. Assemble ${outDir}/astro.config.mjs: a starlight() integration whose sidebar reflects the page groups ` +
            `(${groups}). Use slug items for the admitted pages. Derive a title from the brief. ` +
            `If an astro.config already exists, update its sidebar/title rather than clobbering unrelated config.\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    // validate: per-framework empirical build gate. buildCmd returns the shell command to run;
    // parseErrors extracts actionable error lines from build output for the repair loop.
    // prerequisiteNote: checked by runBuildRepairLoop's haiku bash-agent to decide when to skip.
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          // full-project scaffolds first then runs check
          return `npm install --prefix "${outDir}" && npx astro check --root "${outDir}"`
        }
        // content-only / add-to-existing: only run if already installable
        return `npx astro check --root "${outDir}"`
      },
      // prerequisiteNote: used by the bash-agent in runBuildRepairLoop to know when to skip.
      prerequisiteNote: 'has package.json with astro dependency and node_modules present',
      // parseErrors: extract type-check and config error lines from astro check output.
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|✗|✘|cannot|Cannot|failed|Failed/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },
  // --- Docusaurus (facebook/docusaurus v3.x) ----------------------------------------------------
  // Content lives in docs/ (markdown) and src/pages/ (React/MDX standalone pages).
  // Config: docusaurus.config.js + sidebars.js at project root.
  // No inline contract: authors fetch current Docusaurus docs via find-docs/context7.
  docusaurus: {
    contentRoot: 'docs',
    assetDir: 'static',
    configFiles: ['docusaurus.config.js', 'sidebars.js'],
    contract: DOCUSAURUS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Docusaurus `baseUrl` in docusaurus.config.js.
      const baseNote = basePath
        ? `   Set baseUrl: '${basePath}' in docusaurus.config.js (the subpath the site is served under).\n`
        : ''
      // i18n -> Docusaurus i18n config block.
      const i18nNote = i18n
        ? `   Add an i18n block to docusaurus.config.js: { defaultLocale: '${i18n.defaultLocale}', ` +
          `locales: [${i18n.locales.map(l => `'${l}'`).join(', ')}] }. ` +
          `Create i18n/<locale>/docusaurus-plugin-content-docs/current/ dirs for each locale.\n`
        : ''
      // versioning -> Docusaurus versions config.
      const versioningNote = versioning
        ? `   Add docs.versions to the preset config: { current: { label: '${versioning.current}' }` +
          (versioning.versions.length ? `, ${versioning.versions.map(v => `'${v}': { label: '${v}' }`).join(', ')}` : '') +
          ` }. Also set docs.lastVersion: '${versioning.current}'.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) ${outDir}/sidebars.js: patch the sidebar to reflect the page groups ` +
            `(${groups}). Use doc-id or category items. Derive a title only if missing.\n`
          : `2. Write or repair ${outDir}/sidebars.js: a tutorialSidebar (or named per the brief) that groups ` +
            `the admitted pages (${groups}) using category + doc items. ` +
            `If it already exists, update categories/items rather than clobbering unrelated config.\n`) +
        `3. Ensure ${outDir}/docusaurus.config.js exists with title, url, baseUrl, presets: [['classic', {docs:{sidebarPath:'./sidebars.js'}}]]. ` +
        `Update title/sidebar only if already present; never clobber unrelated themeConfig.\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx docusaurus build --out-dir "${outDir}/build" "${outDir}"`
        }
        return `npx docusaurus build --out-dir "${outDir}/build" "${outDir}"`
      },
      prerequisiteNote: 'has package.json with @docusaurus/core and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|\[ERROR\]|failed|Failed|SyntaxError|Cannot/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- MkDocs + Material (v9.x) ----------------------------------------------------------------
  // Content lives in docs/. Config: mkdocs.yml at project root.
  // No inline contract: authors fetch current MkDocs Material docs via find-docs/context7.
  mkdocs: {
    contentRoot: 'docs',
    // MkDocs: assets live alongside content (docs/assets/); relative links work from any page.
    assetDir: 'docs/assets',
    configFiles: ['mkdocs.yml'],
    contract: MKDOCS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> MkDocs site_url (the canonical URL prefix; controls absolute link generation).
      const baseNote = basePath
        ? `   Set site_url: '${basePath}' in mkdocs.yml so absolute links and the sitemap use the correct subpath.\n`
        : ''
      // i18n -> MkDocs i18n plugin (mkdocs-material extra: i18n, or the mkdocs-i18n plugin).
      const i18nNote = i18n
        ? `   Add the i18n plugin to mkdocs.yml: plugins: [i18n: {default_language: '${i18n.defaultLocale}', ` +
          `languages: { ${i18n.locales.map(l => `${l}: { name: '${l}', build: true }`).join(', ')} } }]. ` +
          `Requires mkdocs-material or the mkdocs-i18n package.\n`
        : ''
      // versioning -> mike (the MkDocs versioning tool).
      const versioningNote = versioning
        ? `   NOTE: MkDocs versioning is handled by the 'mike' tool, not by mkdocs.yml config. ` +
          `Add 'mike' to the plugins list so the version switcher appears (current="${versioning.current}"). ` +
          `Run: mike deploy ${versioning.current} latest --update-aliases after building.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) ${outDir}/mkdocs.yml: patch the nav section to reflect the page groups ` +
            `(${groups}). Preserve existing theme, plugins, and markdown_extensions blocks.\n`
          : `2. Write or repair ${outDir}/mkdocs.yml: include site_name (from the brief), theme: {name: material}, ` +
            `and a nav section mapping the page groups (${groups}) to their files. ` +
            `If it already exists, update site_name and nav only.\n`) +
        `3. (no content-collection step for MkDocs.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `pip install mkdocs mkdocs-material 2>&1 | tail -1 && mkdocs build --strict -f "${outDir}/mkdocs.yml"`
        }
        // --strict promotes warnings (missing nav pages, broken links) to errors
        return `mkdocs build --strict -f "${outDir}/mkdocs.yml"`
      },
      prerequisiteNote: 'mkdocs binary available and mkdocs.yml exists in outDir',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /ERROR|WARNING.*not found|error|Failed/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- VitePress (v1.x) -------------------------------------------------------------------------
  // Content lives in docs/ (or the srcDir configured in .vitepress/config.mts).
  // Config: docs/.vitepress/config.mts at project root.
  // No inline contract: authors fetch current VitePress docs via find-docs/context7.
  vitepress: {
    contentRoot: 'docs',
    // VitePress: public/ for global assets; docs/public/ is aliased to the site root.
    assetDir: 'docs/public',
    configFiles: ['docs/.vitepress/config.mts'],
    contract: VITEPRESS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> VitePress `base` in defineConfig (served under a subpath).
      const baseNote = basePath
        ? `   Set base: '${basePath}' in defineConfig() so all assets and links are prefixed with the subpath.\n`
        : ''
      // i18n -> VitePress locales config object.
      const i18nNote = i18n
        ? `   Add a locales object to defineConfig(): { root: { label: '${i18n.defaultLocale}', lang: '${i18n.defaultLocale}' }, ` +
          `${i18n.locales.filter(l => l !== i18n.defaultLocale).map(l => `'/${l}/': { label: '${l}', lang: '${l}' }`).join(', ')} }. ` +
          `Create docs/<locale>/ directories for each non-default locale.\n`
        : ''
      // VitePress has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: VitePress has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a multi-dir approach (docs/v1/, docs/v2/) if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) ${outDir}/docs/.vitepress/config.mts: patch themeConfig.sidebar to reflect ` +
            `the page groups (${groups}). Preserve nav, socialLinks, and other themeConfig keys.\n`
          : `2. Write or repair ${outDir}/docs/.vitepress/config.mts: a defineConfig with title (from the brief), ` +
            `description, and themeConfig.sidebar reflecting the page groups (${groups}) as grouped items with text+link. ` +
            `If it already exists, update title and sidebar only.\n`) +
        `3. (no content-collection step for VitePress.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx vitepress build docs --root "${outDir}"`
        }
        return `npx vitepress build docs --root "${outDir}"`
      },
      prerequisiteNote: 'has package.json with vitepress devDependency and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|\[vitepress\].*warn|dead link|ENOENT/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Fumadocs (fuma-nama/fumadocs v14.x) -----------------------------------------------------
  // Content lives in content/docs/ as .mdx files. No single config file — config is spread across
  // source.config.ts, app/docs/[[...slug]]/page.tsx, layout.tsx, and lib/source.ts.
  // Nav order controlled by meta.json files (not frontmatter).
  // No inline contract: authors fetch current Fumadocs docs via find-docs/context7.
  fumadocs: {
    contentRoot: 'content/docs',
    assetDir: 'public',
    configFiles: ['source.config.ts', 'lib/source.ts'],
    contract: FUMADOCS_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Next.js basePath in next.config.mjs (Fumadocs runs on Next.js).
      const baseNote = basePath
        ? `   Add basePath: '${basePath}' to the Next.js config in ${outDir}/next.config.mjs so all routes are prefixed.\n`
        : ''
      // i18n -> Next.js i18n config in next.config.mjs.
      const i18nNote = i18n
        ? `   Add i18n: { defaultLocale: '${i18n.defaultLocale}', locales: [${i18n.locales.map(l => `'${l}'`).join(', ')}] } ` +
          `to the Next.js config in ${outDir}/next.config.mjs. Create app/[lang]/docs/ layout for locale routing.\n`
        : ''
      // Fumadocs has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: Fumadocs has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a route-prefix approach (content/docs/v1/, v2/) if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE meta.json files in each content/docs/ subdirectory to reflect the page groups ` +
            `(${groups}). Each meta.json controls the sidebar order for its directory via the "pages" array.\n`
          : `2. For each page group (${groups}), write or update the meta.json in its content/docs/<group>/ directory. ` +
            `Each meta.json: {"title":"<group>","pages":[...filenames without ext...],"defaultOpen":true}. ` +
            `Ensure source.config.ts exists with defineDocs({dir:'content/docs'}) if missing.\n`) +
        `3. (Fumadocs uses Next.js app router — no single sidebar config file; structure flows from meta.json.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx next build "${outDir}"`
        }
        return `npx next build "${outDir}"`
      },
      prerequisiteNote: 'has package.json with next and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|Failed to compile|Type error|✗/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- mdBook (rust-lang/mdBook v0.4.x) --------------------------------------------------------
  // Content lives in src/. SUMMARY.md (required) defines the entire chapter structure.
  // Config: book.toml at project root. No frontmatter processing by default.
  // No inline contract: authors fetch current mdBook docs via find-docs/context7.
  mdbook: {
    contentRoot: 'src',
    // mdBook: images referenced relatively from src/ live alongside chapter files; src/images/ is convention.
    assetDir: 'src/images',
    configFiles: ['book.toml', 'src/SUMMARY.md'],
    contract: MDBOOK_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> mdBook [output.html] site-url.
      const baseNote = basePath
        ? `   Set site-url = '${basePath}' under [output.html] in book.toml so absolute links use the correct subpath.\n`
        : ''
      // mdBook has limited i18n support; note it.
      const i18nNote = i18n
        ? `   NOTE: mdBook has no built-in i18n. Internationalization (defaultLocale="${i18n.defaultLocale}") is noted ` +
          `but NOT configured — use separate book.toml per language or the mdbook-i18n-helpers crate if needed.\n`
        : ''
      // mdBook has no versioning; note it.
      const versioningNote = versioning
        ? `   NOTE: mdBook has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use subpath deployments (e.g. /v1/, /v2/) if needed.\n`
        : ''
      return (
        `2. Write or repair ${outDir}/src/SUMMARY.md: the required navigation definition. ` +
        `List every admitted page as "- [Title](path/to/file.md)" organized under Part headers (# Part) ` +
        `reflecting the page groups (${groups}). Prefix chapters (before the first list) for any intro/overview pages.\n` +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE (do NOT clobber) ${outDir}/book.toml: patch [book] title only if missing. ` +
            `Preserve all other toml sections.\n`
          : `3. Write or repair ${outDir}/book.toml: [book] with title (from the brief), language="en", src="src". ` +
            `Add [output.html] with git-repository-url if the brief mentions a repo. ` +
            `If it already exists, update [book].title only.\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      // mdbook is a binary (cargo install mdbook); no npm/pip prerequisite.
      buildCmd: (outDir, _scaffoldMode) => `mdbook build "${outDir}"`,
      prerequisiteNote: 'mdbook binary available (install via cargo or prebuilt release)',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /\[ERROR\]|\[WARN\].*missing|error\[|panicked|SUMMARY\.md/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Docsify (docsifyjs/docsify v4.x) --------------------------------------------------------
  // Content lives at the docs root (no subfolder convention). Navigation via _sidebar.md.
  // Config lives entirely in index.html (window.$docsify object). No frontmatter support by default.
  // No inline contract: authors fetch current Docsify docs via find-docs/context7.
  docsify: {
    contentRoot: '.',
    assetDir: '_media',
    configFiles: ['index.html', '_sidebar.md'],
    contract: DOCSIFY_CONTRACT,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Docsify window.$docsify.basePath option.
      const baseNote = basePath
        ? `   Set basePath: '${basePath}' in window.$docsify config in index.html.\n`
        : ''
      // Docsify has limited i18n; note it.
      const i18nNote = i18n
        ? `   NOTE: Docsify has no official i18n plugin. Internationalization (defaultLocale="${i18n.defaultLocale}") is noted ` +
          `but NOT configured — use separate index.html + _sidebar.md per locale in subfolders if needed.\n`
        : ''
      // Docsify has no versioning; note it.
      const versioningNote = versioning
        ? `   NOTE: Docsify has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a dropdown navbar or subpath deploy if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/_sidebar.md: patch the navigation to reflect the page groups ` +
            `(${groups}). Preserve any existing entries unrelated to the admitted pages.\n`
          : `2. Write or repair ${outDir}/_sidebar.md: a Docsify sidebar listing all admitted pages ` +
            `grouped by section (plain text heading, no link, followed by indented "- [Title](path.md)" items). ` +
            `Groups: ${groups}. Include a "- [Home](/)" link at the top.\n`) +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE ${outDir}/index.html: patch window.$docsify.name if missing; ` +
            `ensure loadSidebar: true is set. Do NOT clobber other config or CDN script tags.\n`
          : `3. Write or repair ${outDir}/index.html: a minimal Docsify bootstrap with ` +
            `window.$docsify = {name: '<title from brief>', loadSidebar: true, subMaxLevel: 2, repo: ''}. ` +
            `Include CDN scripts for docsify v4. If it already exists, patch name/loadSidebar only.\n`) +
        // Step 4 (empirical build check) is scripted — runBuildRepairLoop returns "skipped" for Docsify
        // because buildCmd returns null. No step 4 needed here.
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      // Docsify is client-side only; no build command.
      buildCmd: (_outDir, _scaffoldMode) => null,
      skipReason: 'docsify has no build step (client-side SPA)',
      parseErrors: (_output) => [],
    },
  },

  // --- Sphinx (sphinx-doc/sphinx v8.x + MyST-Parser for Markdown) --------------------------------
  // Content lives in docs/ as .rst or .md (with MyST-Parser). Config: docs/conf.py at project root.
  // Navigation controlled by toctree directives embedded in index.rst / index.md.
  // No inline contract: authors fetch current Sphinx docs via find-docs/context7.
  sphinx: {
    contentRoot: 'docs',
    assetDir: 'docs/_static',
    configFiles: ['docs/conf.py', 'docs/index.rst'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Sphinx html_baseurl in conf.py (used by the sitemap extension).
      const baseNote = basePath
        ? `   Set html_baseurl = '${basePath}' in conf.py so the canonical sitemap uses the correct subpath.\n`
        : ''
      // i18n -> Sphinx language setting and gettext extraction.
      const i18nNote = i18n
        ? `   Set language = '${i18n.defaultLocale}' in conf.py. For additional locales ` +
          `(${i18n.locales.filter(l => l !== i18n.defaultLocale).join(', ')}), ` +
          `note that Sphinx i18n uses gettext: run 'make gettext' then 'sphinx-intl update -p _build/gettext -l <locale>' ` +
          `to generate per-locale .po files. Document the commands in the README.\n`
        : ''
      // versioning -> Sphinx version/release in conf.py.
      const versioningNote = versioning
        ? `   Set version = '${versioning.current}' and release = '${versioning.current}' in conf.py. ` +
          (versioning.versions.length ? `Prior versions: ${versioning.versions.join(', ')} — use separate Sphinx builds or sphinx-multiversion for a version switcher.\n` : '\n')
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/docs/index.rst (or index.md): patch the toctree directive to include ` +
            `the admitted pages (${groups}). Preserve all existing toctree entries and directives.\n`
          : `2. Write or repair ${outDir}/docs/index.rst: a root document with a toctree listing the admitted ` +
            `pages organized by group (${groups}). Use :maxdepth: 2 and :caption: per group. ` +
            `If an index already exists, add missing toctree entries without removing existing ones.\n`) +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE ${outDir}/docs/conf.py: patch project/author/release only if missing. ` +
            `Preserve existing extensions, html_theme, and other settings.\n`
          : `3. Write or repair ${outDir}/docs/conf.py: set project (from the brief), author, release, ` +
            `extensions = ['myst_parser', 'sphinx.ext.autodoc', 'sphinx.ext.viewcode'], ` +
            `html_theme = 'furo' (or 'sphinx_rtd_theme'), source_suffix = {'.rst':'restructuredtext','.md':'markdown'}. ` +
            `If it already exists, update project/author only.\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `pip install sphinx furo myst-parser 2>&1 | tail -1 && sphinx-build -W -b html "${outDir}/docs" "${outDir}/docs/_build/html"`
        }
        // -W promotes warnings to errors for stricter checking
        return `sphinx-build -W -b html "${outDir}/docs" "${outDir}/docs/_build/html"`
      },
      prerequisiteNote: 'sphinx-build available and docs/conf.py exists in outDir',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /WARNING:|ERROR:|Exception|error:/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Nextra (shuding/nextra v3.x) -------------------------------------------------------------
  // Next.js-based docs framework. Content lives in pages/ (v2) or content/ (v3) as .mdx.
  // Config: theme.config.tsx (Nextra docs theme) + next.config.mjs at project root.
  // No inline contract: authors fetch current Nextra docs via find-docs/context7.
  nextra: {
    contentRoot: 'content',
    assetDir: 'public',
    configFiles: ['next.config.mjs', 'theme.config.tsx'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Next.js basePath in next.config.mjs.
      const baseNote = basePath
        ? `   Add basePath: '${basePath}' to the Next.js config in ${outDir}/next.config.mjs.\n`
        : ''
      // i18n -> Next.js i18n config.
      const i18nNote = i18n
        ? `   Add i18n: { defaultLocale: '${i18n.defaultLocale}', locales: [${i18n.locales.map(l => `'${l}'`).join(', ')}] } ` +
          `to the Next.js config in ${outDir}/next.config.mjs.\n`
        : ''
      // Nextra has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: Nextra has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a content version subpath approach if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE _meta files in each content/ subdirectory to reflect the page groups ` +
            `(${groups}). Each _meta.{js|ts|json} controls sidebar order for its directory.\n`
          : `2. For each page group (${groups}), write or update the _meta.ts file in its content/<group>/ directory. ` +
            `Each _meta.ts exports a default object mapping filenames (without ext) to their display titles. ` +
            `The root content/_meta.ts should list the top-level sections in order.\n`) +
        (scaffoldMode === 'add-to-existing'
          ? `3. UPDATE ${outDir}/theme.config.tsx: patch docsRepositoryBase, project.link, and logo only if missing. ` +
            `Preserve existing navigation and footer configuration.\n`
          : `3. Write or repair ${outDir}/theme.config.tsx: export default { docsRepositoryBase: '', ` +
            `project: { link: '' }, logo: <b>title from brief</b>, useNextSeoProps() { return { titleTemplate: '%s - <title>' } } }. ` +
            `Ensure ${outDir}/next.config.mjs wraps the config with nextra({theme: 'nextra-theme-docs', themeConfig: './theme.config.tsx'}).\n`) +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx next build "${outDir}"`
        }
        return `npx next build "${outDir}"`
      },
      prerequisiteNote: 'has package.json with next and node_modules present',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|Failed to compile|Type error|✗/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Mintlify (mintlify/mintlify v4.x) -------------------------------------------------------
  // SaaS-hosted docs platform. Content lives in the repo root (or a configured directory) as .mdx.
  // Config: mint.json (or docs.json in newer versions) at the repo root.
  // No inline contract: authors fetch current Mintlify docs via find-docs/context7.
  mintlify: {
    contentRoot: '.',
    assetDir: 'images',
    configFiles: ['mint.json'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // Mintlify has no configurable basePath in mint.json; SaaS routing controls it.
      const baseNote = basePath
        ? `   NOTE: Mintlify is SaaS-hosted; basePath ("${basePath}") is set in the Mintlify dashboard, ` +
          `not in mint.json. No config key to write here.\n`
        : ''
      // Mintlify localization.
      const i18nNote = i18n
        ? `   Add "localization": { "defaultLocale": "${i18n.defaultLocale}", "locales": [${i18n.locales.map(l => `"${l}"`).join(', ')}] } ` +
          `to mint.json. Create <locale>/ directories for translated pages.\n`
        : ''
      // Mintlify versioning.
      const versioningNote = versioning
        ? `   NOTE: Mintlify versioning is SaaS-managed. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured in mint.json — use version tags in the Mintlify dashboard.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/mint.json: patch the "navigation" array to include the admitted page groups ` +
            `(${groups}). Each group is {"group":"<name>","pages":["path/to/page",...]}. ` +
            `Preserve existing groups and the name/logo/colors blocks.\n`
          : `2. Write or repair ${outDir}/mint.json: include name (from the brief), logo (object with light/dark paths or omit), ` +
            `colors (primary, light, dark), and a navigation array grouping the admitted pages (${groups}). ` +
            `Each navigation entry: {"group":"<group>","pages":["<path without .mdx>",...]}. ` +
            `If it already exists, update name and navigation only.\n`) +
        `3. (Mintlify content-collection step not applicable — mint.json is the sole config.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      // mintlify CLI: `npx mintlify dev` starts a local server; no static build output.
      // Use `mintlify broken-links` for a headless check when available.
      buildCmd: (_outDir, _scaffoldMode) => null,
      skipReason: 'mintlify is SaaS-hosted; no offline build step (use mintlify CLI for local preview)',
      parseErrors: (_output) => [],
    },
  },

  // --- Docsy (google/docsy Hugo theme v0.11.x) -------------------------------------------------
  // Hugo-based documentation theme. Content lives in content/en/ as .md or .html.
  // Config: hugo.toml (or config.toml) at project root; Docsy module in go.mod.
  // No inline contract: authors fetch current Docsy docs via find-docs/context7.
  docsy: {
    contentRoot: 'content/en',
    assetDir: 'static/images',
    configFiles: ['hugo.toml', 'go.mod'],
    contract: null,
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath -> Hugo baseURL in hugo.toml.
      const baseNote = basePath
        ? `   Set baseURL = '${basePath}' in hugo.toml (or preserve an existing baseURL if already set).\n`
        : ''
      // i18n -> Hugo multilingual config in hugo.toml.
      const i18nNote = i18n
        ? `   Add [languages] blocks to hugo.toml for each locale: ` +
          `${i18n.locales.map(l => `[languages.${l}] { languageName = '${l}'${l === i18n.defaultLocale ? ', weight = 1' : ''} }`).join('; ')}. ` +
          `Create content/<locale>/ directories for each non-default locale. Docsy picks up multilingual ` +
          `routes automatically when [languages] is configured.\n`
        : ''
      // Docsy/Hugo has no built-in versioning.
      const versioningNote = versioning
        ? `   NOTE: Docsy/Hugo has no built-in versioning. Versioning (current="${versioning.current}") is noted ` +
          `but NOT configured — use a version dropdown in config/menus.toml or subpath deploys if needed.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE ${outDir}/hugo.toml: patch [params] title and [[menus.main]] entries only if missing. ` +
            `Preserve existing module, markup, and taxonomies blocks.\n`
          : `2. Write or repair ${outDir}/hugo.toml: set [module] imports = [{path:"github.com/google/docsy"}], ` +
            `[params] with ui.breadcrumb_disable=false, ui.sidebar_menu_compact=true, ` +
            `title (from the brief), and [languages.en]. ` +
            `Add [[menus.main]] entries for top-level page groups (${groups}). ` +
            `If it already exists, update title and menus.main only.\n`) +
        `3. Each content group goes in ${outDir}/content/en/<group>/_index.md with frontmatter title and weight for ordering. ` +
        `Admitted pages live at ${outDir}/content/en/<group>/<page>.md.\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    validate: {
      buildCmd: (outDir, _scaffoldMode) => `hugo --source "${outDir}"`,
      prerequisiteNote: 'hugo binary available and go.mod references github.com/google/docsy',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /ERROR|WARN.*ref|error:|panic/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // --- Scalar (scalar/scalar v1.x) ----------------------------------------------------------------
  // OpenAPI reference renderer. Not a prose-page authoring tool: the "pages" contract is replaced
  // by a single renderer config (scalar.config.json or similar) that points at an OpenAPI spec.
  // The assemblePrompt skips the per-page MDX authoring and instead writes the renderer config.
  // args.sources should include the OpenAPI spec path (e.g. openapi.yaml).
  // No inline contract: authors work from current Scalar docs (find-docs / context7).
  scalar: {
    contentRoot: '.',
    assetDir: null, // API renderer; no prose asset directory
    configFiles: ['scalar.config.json'],
    contract: null,
    assemblePrompt: (outDir, _groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath/i18n/versioning: not applicable for API renderers (Scalar is a client-side spec renderer).
      const notesNote = [
        basePath ? `NOTE: basePath ("${basePath}") is not configurable in scalar.config.json; set it in the serving proxy/CDN.` : '',
        i18n ? `NOTE: Scalar has no i18n config; locale (${i18n.defaultLocale}) not applied.` : '',
        versioning ? `NOTE: Scalar has no versioning config; version (${versioning.current}) not applied.` : '',
      ].filter(Boolean).map(n => `   ${n}\n`).join('')
      const specNote = `Use the OpenAPI spec provided in sources (e.g. openapi.yaml / openapi.json) as the spec path.`
      return (
        `2. Write ${outDir}/scalar.config.json: a Scalar renderer config referencing the OpenAPI spec. ` +
        `Minimum shape: {"openapi":"<path-to-spec>","info":{"title":"<API title from spec or brief>"},"servers":[]}. ` +
        `If the spec is a URL, use the url field instead of a file path. ${specNote}\n` +
        `3. (No content-collection step — Scalar renders directly from the OpenAPI spec; do NOT author MDX prose pages.)\n` +
        notesNote
      )
    },
    validate: {
      // Scalar is a browser renderer; no static build. CLI validate only available with @scalar/cli.
      buildCmd: (_outDir, _scaffoldMode) => null,
      skipReason: 'scalar renders client-side (serve with any static file server or the scalar CLI)',
      parseErrors: (_output) => [],
    },
  },

  // --- Redocly (Redocly/redoc v2.x + redocly CLI) -----------------------------------------------
  // OpenAPI reference renderer. Not a prose-page authoring tool: the "pages" contract is replaced
  // by redocly.yaml (the Redocly CLI config) that points at an OpenAPI spec and controls theming.
  // The assemblePrompt skips per-page MDX authoring and instead writes the Redocly config.
  // args.sources should include the OpenAPI spec path (e.g. openapi.yaml).
  // No inline contract: authors work from current Redocly docs (find-docs / context7).
  redocly: {
    contentRoot: '.',
    assetDir: null, // API renderer; no prose asset directory
    configFiles: ['redocly.yaml'],
    contract: null,
    assemblePrompt: (outDir, _groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // basePath/i18n/versioning: not applicable for API renderers (Redocly is a spec-driven renderer).
      const notesNote = [
        basePath ? `NOTE: basePath ("${basePath}") is not configurable in redocly.yaml; set it in the serving proxy/CDN.` : '',
        i18n ? `NOTE: Redocly has no i18n config in redocly.yaml; locale (${i18n.defaultLocale}) not applied.` : '',
        versioning ? `NOTE: Redocly versioning is handled via separate API definitions in the apis block; version (${versioning.current}) not applied here.` : '',
      ].filter(Boolean).map(n => `   ${n}\n`).join('')
      const specNote = `Use the OpenAPI spec provided in sources (e.g. openapi.yaml) as the spec path.`
      return (
        `2. Write ${outDir}/redocly.yaml: a Redocly CLI config referencing the OpenAPI spec. ` +
        `Minimum shape:\n` +
        `  apis:\n` +
        `    main@latest:\n` +
        `      root: <path-to-spec>  # relative to redocly.yaml\n` +
        `  theme:\n` +
        `    openapi:\n` +
        `      generateCodeSamples:\n` +
        `        languages: [curl, JavaScript, Python]\n` +
        `${specNote}\n` +
        `If the brief names a theme or custom logo, add a [theme.colors] or [theme.logo] section. ` +
        `If it already exists, patch the apis root path and theme block only; do NOT clobber other keys.\n` +
        `3. (No content-collection step — Redocly renders directly from the OpenAPI spec; do NOT author MDX prose pages.)\n` +
        notesNote
      )
    },
    validate: {
      buildCmd: (outDir, scaffoldMode) => {
        if (scaffoldMode === 'full-project') {
          return `npm install --prefix "${outDir}" && npx @redocly/cli lint "${outDir}/redocly.yaml"`
        }
        return `npx @redocly/cli lint "${outDir}/redocly.yaml"`
      },
      prerequisiteNote: '@redocly/cli available (npx resolves it) and redocly.yaml exists in outDir',
      parseErrors: (output) =>
        output.split('\n')
          .filter(l => /error|Error|\[error\]|✗|warning:/.test(l))
          .map(l => l.trim())
          .filter(Boolean),
    },
  },

  // Fallback entry for any framework not yet registered above. Authors work from current official
  // docs (find-docs / context7) rather than an inline contract. contentRoot/configFiles/validate
  // are null because they are framework-specific and unknown at author time.
  _unfilled: {
    contentRoot: null,
    assetDir: null,
    configFiles: [],
    contract: null,
    // scaffoldMode is plumbed through for consistency; full-project is unsupported for unfilled frameworks.
    assemblePrompt: (outDir, groups, scaffoldMode = 'content-only', opts = {}) => {
      const { basePath, i18n, versioning } = opts
      // For unknown frameworks: pass the values through as plain instructions; the agent consults current docs.
      const baseNote = basePath
        ? `   If the framework has a config key for the serving subpath, set it to '${basePath}'.\n`
        : ''
      const i18nNote = i18n
        ? `   If the framework supports i18n, configure the default locale ("${i18n.defaultLocale}") ` +
          `and additional locales (${i18n.locales.join(', ')}) per current framework docs.\n`
        : ''
      const versioningNote = versioning
        ? `   If the framework supports versioning, set the current version to "${versioning.current}" per current framework docs.\n`
        : ''
      return (
        (scaffoldMode === 'add-to-existing'
          ? `2. UPDATE (do NOT clobber) the primary config — patch nav/sidebar to reflect the page groups: ${groups}; ` +
            `update the title only if missing. Use current framework config syntax.\n`
          : `2. Write or repair the primary config (nav/sidebar reflecting the page groups: ${groups}; title derived from the brief). ` +
            `Use current framework config syntax; if a config already exists, update nav/title rather than clobbering unrelated config.\n`) +
        `3. (no Astro content collection step for this framework.)\n` +
        baseNote + i18nNote + versioningNote
      )
    },
    // _unfilled: no validate config — runBuildRepairLoop returns "skipped: no validate config".
    validate: null,
  },
}

// --- resolveLinksAndAssets (shared helper) -----------------------------------------------------
// Runs after Author, before Quality gate. Scans each written page for local asset references
// (markdown images, HTML img src), copies found files to the framework's assetDir, and rewrites
// the page's src/href to the framework-correct route.
//
// WHY a scripted agent step rather than leaving it to the quality gate:
//   - The quality gate should DROP broken links, not fix them. Fixing before the gate means
//     the gate sees a clean slate and can catch REAL authoring errors, not copy-omissions.
//   - One Haiku agent per batch (all pages together) is cheaper than per-page author ops.
//   - The gate already checks that paths resolve; this step ensures they do.
//
// Returns { copied: [{src, dest}], rewritten: [{page, from, to}], skipped: string[] }.
// Skips cleanly when fwEntry.assetDir is null (API renderers: Scalar, Redocly).
//
// Usage: const linkResult = await resolveLinksAndAssets(written, outDir, fwEntry, framework)
async function resolveLinksAndAssets(writtenNotes, outDir, fwEntry, framework) {
  if (!fwEntry.assetDir) {
    return { copied: [], rewritten: [], skipped: [`${framework} has no assetDir; link resolution skipped`] }
  }
  const assetDir = `${outDir}/${fwEntry.assetDir}`
  const pageList = writtenNotes.map(n => `${outDir}/${n.path}`).join('\n')
  const result = await agent(
    `You are a link-and-asset resolver for a ${framework} docs site at "${outDir}".\n\n` +
    `TASK: For each page listed below, find all local (non-http/https) asset references — ` +
    `markdown image syntax \`![alt](path)\`, HTML \`<img src="path">\`, and \`<source src="path">\` — ` +
    `then for each referenced local file:\n` +
    `1. If the source file EXISTS at the path as written (relative to the page's directory or absolute), ` +
    `   copy it to "${assetDir}/<filename>" using the Bash tool: \`mkdir -p "${assetDir}" && cp "<src>" "${assetDir}/<filename>"\`.\n` +
    `2. Rewrite the reference in the page to the framework-correct route:\n` +
    `   - ${framework === 'starlight' ? 'Starlight: use a relative path from the page to src/assets/, e.g. ../../assets/image.png for a page two levels deep.' :
       framework === 'docusaurus' ? 'Docusaurus: use an absolute path from the site root, e.g. /img/image.png (maps to static/img/).' :
       framework === 'mkdocs' ? 'MkDocs: use a relative path from the page to assets/, e.g. ../assets/image.png.' :
       framework === 'vitepress' ? 'VitePress: use an absolute path, e.g. /image.png (maps to docs/public/).' :
       framework === 'mdbook' ? 'mdBook: use a relative path from the page to images/, e.g. ../images/image.png.' :
       framework === 'docsify' ? 'Docsify: use an absolute path, e.g. /_media/image.png.' :
       framework === 'sphinx' ? 'Sphinx: use a path relative to _static/, e.g. ../_static/image.png.' :
       framework === 'nextra' ? 'Nextra: use an absolute path from public/, e.g. /image.png.' :
       framework === 'mintlify' ? 'Mintlify: use a path under images/, e.g. /images/image.png.' :
       framework === 'docsy' ? 'Hugo/Docsy: use an absolute path, e.g. /images/image.png (maps to static/images/).' :
       `use a path relative to the framework's asset directory.`}\n` +
    `   Use the Edit tool to rewrite the reference in the page file.\n` +
    `3. If the source file does NOT exist at the referenced path, record it in "skipped" with the reason ` +
    `   "source not found" — do not attempt to copy a file that does not exist.\n` +
    `4. External URLs (http/https/ftp) and root-relative paths that already point into the asset dir ` +
    `   are SKIPPED (no action needed).\n\n` +
    `PAGES:\n${pageList}\n\n` +
    `Return: copied (array of {src, dest} for each file copied), ` +
    `rewritten (array of {page, from, to} for each link rewritten), ` +
    `skipped (array of strings explaining what was skipped and why), ` +
    `summary (one sentence).`,
    {
      label: 'resolve-links-assets',
      phase: 'Author',
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
