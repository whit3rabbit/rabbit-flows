# Acquisition strategy

Pick the cheapest path that can actually get clean markdown. The cost that matters is model tokens:
routing every page's HTML through a model is the expensive last resort. Code does not cost tokens.

## Recon → decide-in-code → acquire → conditional gate

The workflow does NOT spend a strong model on detection. A **Haiku recon** agent gathers facts only —
platform (DETECTION contract), `hasLlms`/`hasSitemap`/`hasSearchIndex` probes, a **gh-verified** source
repo + `sourceFormat`, `jsRendered`, and a fallback page list — then the workflow SCRIPT picks the
strategy with a deterministic rule (no agent):

```
strategyOverride                               -> use it
repoUrl arg                                    -> git
verified repo AND sourceFormat in {md,mdx}     -> git
jsRendered AND no sitemap AND no llms.txt       -> playwright
otherwise                                      -> python   (webfetch only via fallback)
trusted = (git AND sourceFormat == md)          -> skips the admission gate (code filter instead)
```

A wrong pick is cheap: it falls back down the ladder. The strong model is spent only on the **Gate**,
and only when content isn't `trusted` (see "Conditional gate" below).

## The ladder

| Strategy | When | How | Cost |
|---|---|---|---|
| **git** | docs SOURCE is markdown in a repo you can name | shallow clone, copy `.md`/`.mdx` | ~free — already markdown |
| **python** | static/SSR site reachable over HTTP | `scrape.py`: enumerate + trafilatura extract, in code | cheap — model sees only the manifest |
| **playwright** | client-rendered / SPA (Docsify, hydration-only) | `scrape.py --render`: headless Chromium then extract | cheap per page, but heavy browser dep |
| **webfetch** | nothing above fits | one model fetch+extract per page | expensive — raw HTML through a model |

git/python/playwright are **confident-only / curated-source-only**. On any miss they fall back down the
ladder (git → python → playwright → webfetch). The workflow wires this automatically: the playwright
rung is reached only when python comes up empty AND the site is client-rendered (`jsRendered`).

## Choosing git (confident-only, gh-verified)

Recon resolves a repo from these signals, then **verifies it with `gh`** before the git lane is chosen:

- MkDocs `mkdocs.yml` `repo_url`, or a repo icon linking to GitHub/GitLab.
- Docusaurus/Starlight `editUrl` / "Edit this page" → resolves to a repo path.
- An "Edit on GitHub" link in the page chrome.
- Host is `*.github.io` (the repo is usually `<user>.github.io` or the project repo with `/docs`).

Verification: `gh api repos/{owner}/{repo}/contents/{docsSubdir}` for likely dirs (`docs/`,
`content/docs/`, `src/content/docs/`, `website/docs/`). Recon returns `repo:{repoUrl,branch,docsSubdir}`
and `sourceFormat` (the dominant extension there) ONLY when the dir is confirmed. If `gh` is
absent/unauthenticated, the host isn't GitHub, or nothing is confirmed → `sourceFormat:"none"`, no repo,
and the script picks `python` instead. No guessing.

Source format drives handling:
- **`.md`** → copy as-is. This is `trusted` (authored markdown) → the admission gate is skipped.
- **`.mdx`** → copy, then `scrape.py --clean-mdx` strips import/export + standalone JSX-component lines
  so files read as markdown. NOT trusted (cleaned, not authored-md) → still gated.
- **`.rst` / `.asciidoc`** → never git; the script routes to the `python` lane (trafilatura on the built
  HTML is cleaner than converting source).

## Conditional gate (skip steps when already clean)

- **trusted** (git `.md`): a **code filter** replaces the strong gate — drop `status!='ok'`, dedup by
  normalized URL, flag `thin` (`words < THIN_WORDS`). No model call. The gh-verified authored markdown
  IS the verification; there is no nav-junk/extraction risk to catch.
- **everything else** (python/playwright/webfetch, and `.mdx`): the full strong-model admission gate
  runs (FILE mode reads the manifest + spot-reads suspicious files; INLINE mode reads the notes).

## The python scraper — `scripts/scrape.py`

Run it in its venv (`setup_venv.sh` prints the venv python). It enumerates and extracts in code and
writes the corpus + a manifest; the workflow agent only reads back the manifest.

```
scrape.py --base-url URL --out DIR [--platform NAME] [--selector "CSS,CSS"] [--strip "CSS,CSS"]
          [--source auto|llms|sitemap] [--max N] [--include GLOB ...] [--exclude GLOB ...]
          [--raw-md-suffix .md] [--body-from-search-index] [--render] [--timeout SECS]
scrape.py --clean-mdx DIR          # strip import/export + JSX-only lines from *.md under DIR, in place
                                   # (used by the git lane when sourceFormat == mdx)
```

### Engine: trafilatura primary, bs4 fallback

- **Extraction** is `trafilatura.extract(html, output_format="markdown", include_tables=True,
  include_links=True, favor_recall=True)` — readability-based, **no CSS selectors**. It handles theme
  variants the selector path could not (e.g. the MkDocs default/RTD theme, which has no `.md-content`).
  Output is post-cleaned: empty headerlink anchors and empty fence pairs (interactive-doc dupes) removed.
- **Fallback** (`--selector`/`--strip`): when trafilatura returns empty/thin, the script falls back to
  bs4 container isolation + markdownify, which preserves code-fence language tags precisely. Source of
  truth for the selectors is `platform-signatures.md` / `extraction.md`; the workflow's `SELECTORS` map
  mirrors it. The selectors are now a *safety net*, not the primary path.
- `ultimate-sitemap-parser` is deliberately NOT used (GPL-3.0, undistributable in a marketplace plugin).
  Discovery uses `trafilatura.sitemaps.sitemap_search` (Apache-2.0) instead.

### Discovery (`--source`)

`auto` tries, in order:
1. `llms.txt` / `llms-full.txt` (curated page list).
2. **MkDocs only** (`--platform mkdocs`): `search/search_index.json` — the most complete MkDocs page
   list (URL + title + text per page). Used for discovery + titles by default.
3. `trafilatura.sitemaps.sitemap_search(base)` — handles robots.txt, `sitemap.xml`, `sitemap_index.xml`,
   `sitemap-index.xml`, and nested indexes automatically.
4. **`--render` only**: rendered sidebar `<a href>` links from the entry page (SPA discovery).

If none yields pages the script exits `3` and the workflow falls back to the next rung.

### Flags

- `--platform` — platform hint; drives the MkDocs `search_index.json` fast-path.
- `--raw-md-suffix` — fetch `<url><suffix>` as raw markdown and skip HTML parsing (Docsify `/foo.md`;
  Fumadocs per-page `.md` when exposed).
- `--body-from-search-index` — **MkDocs only**: write page bodies straight from `search_index.json`
  `text`. ONE request scrapes the whole site (max token + latency savings) but the text is plain
  (no code fences). Default OFF — discovery still uses the index, content goes through trafilatura.
- `--render` — fetch each page's HTML via headless Chromium (needs `setup_venv.sh --with-playwright`),
  then extract the same way. For client-rendered / SPA docs.

**Exit codes:** `0` wrote ≥1 page · `3` enumeration found nothing (fall back) · `1` hard error ·
`2` bad usage.

## Manifest schema (`<out>/manifest.json`)

The single artifact the model reads back. One entry per enumerated page:

```json
{ "url": "...", "path": "docs/intro.md", "title": "Intro", "section": "docs",
  "words": 451, "status": "ok|empty|error", "failure": null }
```

`path` is relative to `--out` and present only when `status == "ok"`. git/python/playwright all produce
this same shape, so the Gate and Assemble stages treat them identically (FILE mode): content stays on
disk, only this metadata flows through the model.

## v1 limits (ponytail ceilings)

- Static enumeration is curated-source only (llms.txt / sitemap / MkDocs search_index). Sidebar-DOM
  crawl happens only in the `--render` (playwright) lane or the WebFetch fallback.
- trafilatura drops code-fence language tags when the source HTML carries none, and interactive pages
  (Starlight `<Tabs>`, Docusaurus live editors) render every variant in static HTML, so a snippet can
  repeat. The bs4 fallback preserves language tags; the empty-fence cleanup trims the worst dupes.
- File-mode keeps links as-written (no localization to local paths). The `INDEX.md` URL→path table
  covers navigation. Add a link-rewrite stage if cross-references must resolve locally.
- Playwright pulls a ~hundreds-of-MB Chromium into the venv; it is opt-in
  (`setup_venv.sh --with-playwright`) and never installed by the core path.
