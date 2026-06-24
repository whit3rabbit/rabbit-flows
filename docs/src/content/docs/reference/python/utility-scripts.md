---
title: Utility Scripts — scrape and validate
diataxisType: reference
---

<!-- generated: python lane, signal: 8x .py files (no pyproject.toml/setup.py) -->

# scrape

`plugins/workflow-kit/skills/docs-scraper/scripts/scrape.py`

Scrape a docs site into a local markdown corpus deterministically (no model tokens). Run by the `docs-scrape` workflow's python-acquire lane. The model never sees raw HTML: this script enumerates, fetches, extracts, and converts in code, writes `<out>/<slug>.md` files plus `<out>/manifest.json`, and prints the manifest summary.

**Extraction engines:**

- **Primary:** trafilatura (readability-based main-content extraction to markdown). No per-platform CSS selectors.
- **Fallback:** bs4 + markdownify via `--selector`. Preserves code-fence language tags precisely.

**Discovery:** trafilatura sitemaps, `llms.txt`/`llms-full.txt`, MkDocs `search/search_index.json`, raw `.md` mode for Docsify. `--render` enables Playwright for SPAs.

**Exit codes:** 0 = success, 1 = hard error, 2 = bad usage, 3 = enumeration found nothing (caller should fall back).

**Dependencies** (installed in venv by `setup_venv.sh`): `trafilatura`, `beautifulsoup4`, `markdownify`, `httpx`. All imported lazily so `--selftest` runs on a bare stdlib interpreter.

---

## Pure helpers (stdlib, covered by `--selftest`)

### `norm_url(u)`

```python
norm_url(u) -> str
```

Normalize a URL for deduplication: strip `www.`, remove trailing slash, lowercase. Mirrors the workflow's `normURL`.

### `parse_llms_txt(text, base_url)`

```python
parse_llms_txt(text: str, base_url: str) -> list
```

Extract doc URLs from an `llms.txt` file: markdown link targets `[t](url)` and bare `http(s)` lines. Relative targets resolve against `base_url`. Returns a deduplicated list.

### `parse_search_index(data, root)`

```python
parse_search_index(data: dict, root: str) -> list
```

Convert MkDocs `search/search_index.json` to `[{url, title, text}]`, one entry per page (de-anchored). The first record for a page carries the full title and text; later `#anchor` records are per-section subsets.

### `slug_for(url, out_dir)`

```python
slug_for(url: str, out_dir: str) -> Path
```

Map a URL path to a `.md` file path under `out_dir`. `/a/b/` becomes `a/b/index.md`; `/a/b` becomes `a/b.md`.

### `keep_url(url, base_url, include, exclude)`

```python
keep_url(url: str, base_url: str, include: list, exclude: list) -> bool
```

Return `True` when a URL is same-origin under the base path, is not a binary asset or anchor, and passes the include/exclude glob lists.

### `assess(md)`

```python
assess(md: str) -> tuple
```

Classify extracted markdown as `(word_count, status, failure)`. Status is `"ok"` for usable prose, `"empty"` for blank or nav-junk content (mostly links, little prose).

### `strip_mdx(text)`

```python
strip_mdx(text: str) -> str
```

Conservative MDX to markdown: drop top-level `import`/`export` lines and standalone JSX component tags (`<Tabs>`, `</Tabs>`, `<Foo ... />`). Keeps prose, headings, tables, lowercase HTML, and content inside fenced code blocks.

### `clean_mdx_dir(d)`

```python
clean_mdx_dir(d: str) -> int
```

Rewrite every `*.md` file under `d` in place via `strip_mdx`. Returns the number of files changed.

---

## Extraction engines (lazy imports)

### `trafilatura_markdown(html)`

```python
trafilatura_markdown(html: str) -> Optional[str]
```

Primary extraction engine. Returns cleaned markdown or `None`. Readability-based; no CSS selectors needed. Cleans empty header anchors, empty fence pairs, and trailing whitespace.

### `extract_markdown(html, selectors, strip_selectors)`

```python
extract_markdown(html: str, selectors: list, strip_selectors: list) -> tuple
```

Fallback extraction engine using bs4 + markdownify. Isolates the first matching CSS container, strips chrome, removes always-junk tags (`script`, `style`, `nav`, `aside`, `footer`). Returns `(markdown, word_count, status, failure)`.

### `to_markdown(html_fragment)`

```python
to_markdown(html_fragment: str) -> str
```

Convert an HTML fragment to markdown via markdownify. Preserves fenced-code language tags from `class="language-xxx"` / `class="lang-xxx"` attributes.

---

## Renderer

### `Renderer`

```python
class Renderer:
    def __init__(self, timeout_s: float): ...
    def html(self, url: str) -> str: ...
    def links(self, url: str) -> list: ...
    def close(self) -> None: ...
```

One headless Chromium for the whole scrape run. Lazy import of `playwright.sync_api`. Waits 800ms after navigation for client-side hydration. Used only with `--render`.

- `html(url)`: Return the fully-rendered HTML of a page.
- `links(url)`: Return all `href` values from anchor elements on a page.
- `close()`: Shut down the browser and Playwright.

---

## Network and orchestration

### `fetch_text(client, url)`

```python
fetch_text(client, url: str) -> str
```

Fetch a URL via httpx, following redirects. Raises on HTTP errors.

### `enumerate_pages(client, args, renderer)`

```python
enumerate_pages(client, args, renderer) -> tuple
```

Return `(pages, source)`. `pages` is a list of `{url, title?, text?}` dicts. Priority: `llms.txt` then `llms-full.txt`, then MkDocs `search_index.json`, then sitemap, then rendered sidebar-nav links (if `--render`). `source` names which path succeeded.

### `get_body(client, renderer, url)`

```python
get_body(client, renderer, url: str) -> str
```

Fetch a page's HTML: rendered via Playwright when `--render`, else a plain HTTP GET.

### `run(args)`

```python
run(args) -> int
```

Main scrape loop. Enumerates, deduplicates, caps, fetches, and extracts each page. Writes `<slug>.md` files and `manifest.json`. Returns exit code.

---

## CLI

### `selftest()`

```python
selftest() -> int
```

Stdlib-only checks of all pure helpers. Engine checks (bs4, trafilatura) run only when the deps are installed, and skip cleanly otherwise. Used by `--selftest`.

### `main(argv)`

```python
main(argv: list) -> int
```

CLI entry point. Dispatches `--selftest`, `--clean-mdx`, or the full scrape run.

---

---

# validate

`plugins/workflow-kit/skills/eatahorse/scripts/validate.py`
(also at `.claude/skills/dynamic-workflow-authoring/scripts/validate.py` and
`.agents/skills/dynamic-workflow-authoring/scripts/validate.py` — identical)

Static linter for Claude Code dynamic-workflow scripts. Stdlib only. Checks source-checkable gotchas: runtime API misuse, throws-at-runtime calls, meta-literal rules, and phase/meta drift. Cannot check runtime-only things (item counts vs caps, note schema compactness).

**Exit codes:** 0 = clean (no errors; warnings permitted unless `--strict`), 1 = problems, 2 = bad usage.

---

## Functions

### `find_meta_block(src)`

```python
find_meta_block(src: str) -> Tuple[Optional[str], int]
```

Return `(text, start_index)` of the `export const meta = { ... }` object, or `(None, -1)`. Handles nested braces.

### `strip_comments(src)`

```python
strip_comments(src: str) -> str
```

Strip `//` line comments and `/* */` block comments from JavaScript source so pattern checks don't fire inside prose.

### `line_of(src, idx)`

```python
line_of(src: str, idx: int) -> int
```

Return the 1-based line number for a byte offset in `src`.

### `node_syntax_check(src)`

```python
node_syntax_check(src: str) -> Optional[str]
```

Run `node --check` on the script with `export` stripped and wrapped in an async IIFE to match the real runtime shape. Returns an error string or `None`. Skips silently if Node.js is absent.

### `check(path)`

```python
check(path: Path) -> List[Tuple[str, int, str]]
```

Return a list of `(severity, line, message)` findings for one workflow file. Severity is `"error"` or `"warn"`. Checks:

- `export const meta` block present with `name` and `description` fields.
- Meta is a pure literal (no `${}` interpolation, spreads, or function calls).
- `Date.now()`, `Math.random()`, and argless `new Date()` — throw at runtime in a workflow script (breaks resume).
- `require`/`import` of `fs`, `child_process`, `path` — scripts cannot touch the filesystem; only agents can.
- `skills:` option passed to `agent()` — does not exist; put the contract inline.
- `agentType:` — resolves only session-registered agents; a freshly-copied file won't resolve.
- Missing `.filter(Boolean)` when `parallel()`/`pipeline()` is used — agents return `null` on skip/error.
- Phase/meta drift: `phase()` calls without a matching `title` in `meta.phases`, and declared phases with no `phase()` call.
- JS syntax errors (via Node.js, best effort).

### `iter_files(args)`

```python
iter_files(args: list) -> Iterator[Path]
```

Yield `Path` objects for each argument: directories are globbed for `*.js`; files are yielded directly; missing paths print a warning to stderr.

### `run(paths, strict)`

```python
run(paths: list, strict: bool) -> int
```

Run `check()` on all resolved files, print findings, and print a summary. Returns 1 when there are errors (or warnings with `--strict`), 0 otherwise.

### `selftest()`

```python
selftest() -> int
```

Check the validator itself against a known-bad snippet (asserts all expected checks fire) and a known-clean snippet (asserts no errors). Prints `"selftest passed"` on success.

### `main(argv)`

```python
main(argv: list) -> int
```

CLI entry point. Parses `--strict` and `--selftest` flags, then dispatches to `run()` or `selftest()`.
