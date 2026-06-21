# Platform detection

Identify the docs platform from the entry page's HTML before enumerating or extracting. Check signals
in this order; the generator meta tag is the strongest single signal.

## Signals, by strength

1. **Generator meta tag** — `<meta name="generator" content="...">`. Most reliable when present.
2. **Characteristic markup / CSS classes** — framework-specific wrapper classes survive theming.
3. **Asset paths / script names** — bundle names and `_app`/`assets` paths hint at the generator.
4. **URL shape** — trailing-slash style, `/docs/` prefix conventions. Weakest; corroborate only.

## Per-platform signatures

The per-platform identity table (generator tag, markup/class tells, asset/URL shape, content
container, render mode) is the **shared** `references/platform-signatures.md` — one source for both
this skill and `docs-site-builder`. Read it for the signatures, then apply the strength-ordering and
the gotcha below.

## Client-rendered gotcha

Docsify (and some modern GitBook/SPA setups) ship a shell page whose real content is fetched and
rendered by JavaScript. A plain HTTP fetch of such a page returns navigation scaffolding and an empty
content div. Tell: the fetched HTML is tiny, has a single mount div, and a `$docsify`/SPA bootstrap
script.

When detected: the page list usually still lives in a `_sidebar.md` / `summary` markdown file the SPA
loads, OR the underlying `.md` source files are fetchable directly (Docsify maps route `/foo` to
`/foo.md`). Prefer fetching the raw `.md` source over the rendered HTML. If neither works, report the
site as JS-rendered in the gaps section rather than capturing the empty shell.

**Fumadocs is the inverse**: also a JS framework, but Next.js server-renders the article into the HTML,
so a plain fetch *does* return content. Even so, prefer its `/llms.txt` (curated list) and per-page raw
`.md` source when exposed — cleaner than HTML extraction. Treat `.md`-source preference, not JS-render
skipping, as the Fumadocs path.

## Source-repo discovery (feeds the git lane)

Recon also looks for the docs SOURCE repo, because cloning authored markdown beats scraping rendered
HTML. Signals: MkDocs `repo_url`, Docusaurus/Starlight `editUrl` / "Edit this page", an "Edit on GitHub"
link, or a `*.github.io` host. When a GitHub repo is found, **verify it with `gh`** before trusting it:
`gh api repos/{owner}/{repo}/contents/{docsSubdir}` for likely dirs (`docs/`, `content/docs/`,
`src/content/docs/`, `website/docs/`). Report `repo:{repoUrl,branch,docsSubdir}` + `sourceFormat`
(`md`/`mdx`/`rst`/`asciidoc`) ONLY when the dir is confirmed; otherwise `sourceFormat:"none"`. If `gh`
is absent/unauthenticated or the host isn't GitHub, leave the repo unverified — the workflow then scrapes
(python) instead of cloning. Never guess a repo. See `references/acquisition.md` for how this drives strategy.

## Output of this step

`{ platform, baseUrl, jsRendered, hasLlms, hasSitemap, hasSearchIndex, sourceFormat, repo?, pages[] }`
(recon facts only — the workflow script decides the strategy). When no signature matches, return
`platform: 'generic'` with the evidence you did find.
