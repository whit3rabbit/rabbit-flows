#!/usr/bin/env python3
"""Scrape a docs site into a local markdown corpus deterministically (no model tokens).

Run by the docs-scrape workflow's python-acquire lane. The model never sees raw HTML: this
script enumerates, fetches, extracts and converts in code, writes <out>/<slug>.md files plus
<out>/manifest.json, and prints the manifest summary. That is the token win over per-page
WebFetch agents.

Engine:
  - Extraction PRIMARY: trafilatura (readability-based main-content extraction -> markdown). No
    per-platform CSS selectors needed; handles theme variants the selector path could not.
  - Extraction FALLBACK: bs4 + markdownify via --selector, used only when trafilatura returns
    empty/thin. The selector path preserves code-fence language tags precisely.
  - Discovery: trafilatura.sitemaps.sitemap_search (handles robots.txt, sitemap-index, variants).
    Plus llms.txt (curated) and, for MkDocs, search/search_index.json. Raw-.md mode for Docsify.
  - --render (optional, heavy): fetch rendered HTML via Playwright for client-rendered / SPA docs,
    then extract the same way. Also enables rendered sidebar-link discovery when no sitemap exists.

Deps (installed in a venv by setup_venv.sh): trafilatura, beautifulsoup4, markdownify, httpx.
Playwright is installed only with `setup_venv.sh --with-playwright`. All are imported lazily so
`--selftest` runs on a bare stdlib interpreter (CI / validate path).

Usage:
  scrape.py --base-url URL --out DIR [--platform NAME] [--selector "CSS,CSS"] [--strip "CSS,CSS"]
            [--source auto|llms|sitemap] [--max N] [--include GLOB ...] [--exclude GLOB ...]
            [--raw-md-suffix .md] [--body-from-search-index] [--render] [--timeout SECS]
  scrape.py --selftest          # stdlib-only checks of the pure helpers

Exit 0 = wrote >=1 page. Exit 3 = enumeration found nothing (caller should fall back).
Exit 2 = bad usage. Exit 1 = hard error.
"""
import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

ENUM_EMPTY = 3  # distinct code: "nothing to scrape, fall back to WebFetch / Playwright"


# --- pure helpers (stdlib only; covered by --selftest) -----------------------------------------

def norm_url(u):
    """Mirror the workflow's normURL: host without www + path without trailing slash, lowercased."""
    try:
        p = urlparse(u)
        host = p.netloc.replace("www.", "", 1) if p.netloc.startswith("www.") else p.netloc
        return (host + p.path.rstrip("/")).lower()
    except Exception:
        return str(u).lower()


def parse_llms_txt(text, base_url):
    """Extract doc URLs from an llms.txt: markdown links [t](url) plus bare http(s) lines.
    Relative targets resolve against base_url."""
    urls = []
    for m in re.finditer(r"\]\(([^)]+)\)", text):  # markdown link targets
        urls.append(m.group(1).strip())
    for line in text.splitlines():                 # bare URLs on their own line
        s = line.strip()
        if s.startswith(("http://", "https://")):
            urls.append(s.split()[0])
    out, seen = [], set()
    for u in urls:
        if u.startswith(("#", "mailto:")):
            continue
        full = u if u.startswith(("http://", "https://")) else urljoin(base_url, u)
        k = norm_url(full)
        if k not in seen:
            seen.add(k)
            out.append(full)
    return out


def parse_search_index(data, root):
    """MkDocs search/search_index.json -> [{url,title,text}], one entry per page (de-anchored).
    The first record for a page (location without #anchor) carries the full page title+text;
    later #anchor records are per-section subsets, so keeping the first occurrence is correct."""
    docs = (data or {}).get("docs") or []
    out, seen = [], set()
    for d in docs:
        loc = (d.get("location") or "").split("#", 1)[0]
        url = urljoin(root, loc)
        k = norm_url(url)
        if k in seen:
            continue
        seen.add(k)
        out.append({"url": url, "title": d.get("title"), "text": d.get("text")})
    return out


def slug_for(url, out_dir):
    """Map a URL path to a .md file path under out_dir. /a/b/ -> a/b/index.md, /a/b -> a/b.md."""
    path = urlparse(url).path.strip("/")
    if not path:
        rel = "index.md"
    elif url.endswith("/") or "." not in path.rsplit("/", 1)[-1]:
        rel = (path + "/index.md") if url.endswith("/") else (path + ".md")
    else:
        rel = re.sub(r"\.[a-z0-9]+$", ".md", path, flags=re.I)
    rel = re.sub(r"[^A-Za-z0-9_./-]", "-", rel)     # filesystem-safe
    return Path(out_dir) / rel


def keep_url(url, base_url, include, exclude):
    """Same-origin under the base path, not an asset/anchor, passes include/exclude globs."""
    try:
        p, b = urlparse(url), urlparse(base_url)
    except Exception:
        return False
    if p.scheme not in ("http", "https") or p.netloc != b.netloc:
        return False
    if not p.path.startswith(b.path.rstrip("/") or "/") and (b.path.rstrip("/") not in ("", "/")):
        return False
    if re.search(r"\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|zip|pdf|woff2?)$", p.path, re.I):
        return False
    if include and not any(fnmatch.fnmatch(url, g) for g in include):
        return False
    if exclude and any(fnmatch.fnmatch(url, g) for g in exclude):
        return False
    return True


def assess(md):
    """Classify extracted markdown -> (word_count, status, failure). Shared by both engines."""
    words = len(md.split())
    if words < 3:
        return words, "empty", "extracted content was empty"
    links = md.count("](")                          # nav-junk heuristic: mostly links, little prose
    if links * 8 > words and words < 200:
        return words, "empty", "looks like nav, not prose (%d links / %d words)" % (links, words)
    return words, "ok", None


def strip_mdx(text):
    """Conservative MDX -> markdown: drop top-level import/export lines and standalone JSX COMPONENT
    tags (Capitalized: <Tabs>, </Tabs>, <Foo ... />). Keeps prose, headings, tables, lowercase HTML,
    and anything inside fenced code blocks. NOT a full MDX compiler — just removes the lines that are
    pure JSX scaffolding so a git-cloned .mdx reads as markdown."""
    out, in_fence = [], False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        if re.match(r"(?:import|export)\b", s):                    # top-level ESM line
            continue
        if re.fullmatch(r"</?[A-Z][\w.]*(?:\s[^>]*)?/?>", s):      # standalone JSX component tag
            continue
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"


def clean_mdx_dir(d):
    """Rewrite every *.md under d in place via strip_mdx. Returns the number of files changed."""
    n = 0
    for fp in Path(d).rglob("*.md"):
        try:
            t = fp.read_text(encoding="utf-8")
        except Exception:
            continue
        c = strip_mdx(t)
        if c != t:
            fp.write_text(c, encoding="utf-8")
            n += 1
    return n


# --- extraction: trafilatura PRIMARY, bs4+markdownify FALLBACK (both imported lazily) ----------

def trafilatura_markdown(html):
    """Primary engine. Returns cleaned markdown or None. No CSS selectors — readability-based."""
    import trafilatura  # lazy: keep --selftest stdlib-only
    md = trafilatura.extract(html, output_format="markdown", include_tables=True,
                             include_links=True, favor_recall=True)
    if not md:
        return None
    md = re.sub(r"\[\]\(#[^)]*\)", "", md)            # drop empty headerlink anchors: # Heading[](#h)
    md = re.sub(r"\n```\s*```\n", "\n", md)          # drop empty fence pairs (interactive-doc dupes)
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md or None


def extract_markdown(html, selectors, strip_selectors):
    """Fallback engine. Isolate the first matching container, strip chrome, convert to markdown.
    Returns (markdown, word_count, status, failure)."""
    from bs4 import BeautifulSoup  # lazy

    soup = BeautifulSoup(html, "html.parser")
    container = None
    for sel in selectors:
        sel = sel.strip()
        if not sel:
            continue
        try:
            container = soup.select_one(sel)
        except Exception:
            container = None
        if container is not None:
            break
    if container is None:
        return "", 0, "empty", "no content container matched %s" % selectors

    for sel in strip_selectors:                      # strip chrome: explicit selectors...
        sel = sel.strip()
        if not sel:
            continue
        try:
            for el in container.select(sel):
                el.decompose()
        except Exception:
            pass
    for tag in container.find_all(["script", "style", "noscript", "nav", "aside", "footer"]):
        tag.decompose()                              # ...plus always-junk tags
    for el in container.select(".headerlink, .anchor, [aria-hidden='true']"):
        el.decompose()

    md = re.sub(r"\n{3,}", "\n\n", to_markdown(str(container))).strip()
    words, status, failure = assess(md)
    return md, words, status, failure


def to_markdown(html_fragment):
    from markdownify import markdownify as mdify  # lazy

    def lang(el):  # fenced-code language from class="language-xxx" / "lang-xxx"
        # markdownify passes the <pre>; the language class often sits on a <code> child.
        candidates = [el] + el.find_all("code", recursive=True)
        for node in candidates:
            for c in (node.get("class") or []):
                m = re.match(r"(?:language|lang|highlight-source)-(\w+)", c)
                if m:
                    return m.group(1)
        return ""

    return mdify(html_fragment, heading_style="ATX", bullets="-", code_language_callback=lang,
                 escape_asterisks=False, escape_underscores=False)


# --- rendering (Playwright, lazy; only when --render) ------------------------------------------

class Renderer:
    """One headless Chromium for the whole run. Lazy import so the core path never pays for it."""

    def __init__(self, timeout_s):
        from playwright.sync_api import sync_playwright  # lazy + optional dep
        self._timeout = int(timeout_s * 1000)
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self._page = self._browser.new_page()

    def html(self, url):
        self._page.goto(url, wait_until="domcontentloaded", timeout=self._timeout)
        self._page.wait_for_timeout(800)             # let client-side hydration settle
        return self._page.content()

    def links(self, url):
        self.html(url)
        return self._page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)") or []

    def close(self):
        try:
            self._browser.close()
        finally:
            self._pw.stop()


# --- network (httpx, lazy) ---------------------------------------------------------------------

def fetch_text(client, url):
    r = client.get(url, follow_redirects=True)
    r.raise_for_status()
    return r.text


def enumerate_pages(client, args, renderer):
    """Return (pages, source). pages = [{url, title?, text?}]. Priority: llms.txt -> (mkdocs)
    search_index.json -> sitemap_search -> (render) sidebar-nav links."""
    base = args.base_url
    root = base.rstrip("/") + "/"
    src = args.source

    if src in ("auto", "llms"):
        for name in ("llms.txt", "llms-full.txt"):
            try:
                urls = parse_llms_txt(fetch_text(client, urljoin(root, name)), root)
                if urls:
                    return [{"url": u} for u in urls], "llms.txt"
            except Exception:
                pass
        if src == "llms":
            return [], "llms.txt"

    if src in ("auto", "sitemap") and args.platform == "mkdocs":
        try:
            recs = parse_search_index(json.loads(fetch_text(client, urljoin(root, "search/search_index.json"))), root)
            if recs:
                return recs, "search_index.json"
        except Exception:
            pass

    if src in ("auto", "sitemap"):
        try:
            from trafilatura.sitemaps import sitemap_search  # lazy
            urls = sitemap_search(base) or []
        except Exception:
            urls = []
        if urls:
            return [{"url": u} for u in urls], "sitemap"

    if renderer is not None:                          # SPA: no sitemap -> rendered sidebar links
        try:
            urls = renderer.links(base)
            if urls:
                return [{"url": u} for u in urls], "rendered-nav"
        except Exception:
            pass

    return [], src


def get_body(client, renderer, url):
    """Rendered HTML when --render, else a plain HTTP GET."""
    return renderer.html(url) if renderer is not None else fetch_text(client, url)


def run(args):
    import httpx  # lazy

    selectors = [s for s in (args.selector or "").split(",") if s.strip()]
    strip_sel = [s for s in (args.strip or "").split(",") if s.strip()]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "rabbit-flows-docs-scraper/1.0"}

    renderer = Renderer(args.timeout) if args.render else None
    try:
        with httpx.Client(timeout=args.timeout, headers=headers) as client:
            raw_pages, source = enumerate_pages(client, args, renderer)
            # filter + dedup + cap (preserve title/text carried from search_index)
            seen, pages = set(), []
            for pg in raw_pages:
                u = pg["url"]
                if not keep_url(u, args.base_url, args.include, args.exclude):
                    continue
                k = norm_url(u)
                if k in seen:
                    continue
                seen.add(k)
                pages.append(pg)
                if len(pages) >= args.max:
                    break

            if not pages:
                print(json.dumps({"status": "enumeration-empty", "source": source,
                                  "baseUrl": args.base_url}))
                return ENUM_EMPTY

            manifest = []
            for pg in pages:
                url = pg["url"]
                entry = {"url": url, "path": None, "title": pg.get("title"), "section": None,
                         "words": 0, "status": "error", "failure": None}
                try:
                    if args.raw_md_suffix:                                   # already markdown
                        md = fetch_text(client, url.rstrip("/") + args.raw_md_suffix).strip()
                        words, status, failure = assess(md)
                    elif args.body_from_search_index and pg.get("text") is not None:
                        md = pg["text"].strip()                              # mkdocs index text (plain)
                        words, status, failure = assess(md)
                    else:
                        html = get_body(client, renderer, url)
                        md = trafilatura_markdown(html)                      # PRIMARY
                        if md:
                            words, status, failure = assess(md)
                        else:
                            words, status, failure = 0, "empty", "trafilatura found no content"
                        if status != "ok":                                   # FALLBACK
                            md2, w2, s2, f2 = extract_markdown(html, selectors, strip_sel)
                            if s2 == "ok":
                                md, words, status, failure = md2, w2, s2, f2
                    entry.update(status=status, words=words, failure=failure)
                    if status == "ok":
                        fp = slug_for(url, out_dir)
                        fp.parent.mkdir(parents=True, exist_ok=True)
                        fp.write_text(md, encoding="utf-8")
                        entry["path"] = str(fp.relative_to(out_dir))
                        if not entry["title"]:
                            m = re.search(r"^#\s+(.+)$", md, re.M)
                            if m:
                                entry["title"] = m.group(1).strip()
                except Exception as e:
                    entry["failure"] = "%s: %s" % (type(e).__name__, e)
                manifest.append(entry)
    finally:
        if renderer is not None:
            renderer.close()

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    ok = sum(1 for e in manifest if e["status"] == "ok")
    print(json.dumps({"status": "done", "source": source, "enumerated": len(manifest),
                      "ok": ok, "failed": len(manifest) - ok, "outDir": str(out_dir),
                      "manifest": "manifest.json"}))
    return 0 if ok else 1


# --- selftest (stdlib only) --------------------------------------------------------------------

def selftest():
    # normURL parity with the workflow
    assert norm_url("https://www.x.com/a/") == "x.com/a", norm_url("https://www.x.com/a/")
    assert norm_url("HTTPS://X.com/A") == "x.com/a"
    assert norm_url("https://x.com/a/") == norm_url("https://x.com/a")

    # llms.txt: markdown links + bare urls, relative resolved, deduped
    urls = parse_llms_txt("# Docs\n- [Intro](/docs/intro)\nhttps://x.com/docs/api\n[dupe](/docs/intro)\n",
                          "https://x.com/")
    assert urls == ["https://x.com/docs/intro", "https://x.com/docs/api"], urls

    # search_index.json: de-anchor to one entry per page, keep first (full) record
    recs = parse_search_index({"docs": [
        {"location": "intro/", "title": "Intro", "text": "full page text"},
        {"location": "intro/#section", "title": "Section", "text": "subset"},
        {"location": "api/", "title": "API", "text": "api text"},
    ]}, "https://x.com/")
    assert [r["url"] for r in recs] == ["https://x.com/intro/", "https://x.com/api/"], recs
    assert recs[0]["title"] == "Intro" and recs[0]["text"] == "full page text", recs[0]

    # keep_url: same-origin under path, drop assets/external/anchors
    assert keep_url("https://x.com/docs/a", "https://x.com/docs", [], [])
    assert not keep_url("https://other.com/docs/a", "https://x.com/docs", [], [])
    assert not keep_url("https://x.com/docs/a.png", "https://x.com/docs", [], [])
    assert keep_url("https://x.com/docs/a", "https://x.com/docs", ["*/docs/*"], [])
    assert not keep_url("https://x.com/docs/a", "https://x.com/docs", [], ["*/docs/*"])

    # assess: prose ok, nav-junk flagged empty
    assert assess("word " * 50)[1] == "ok"
    assert assess("[a](x) [b](y) [c](z)")[1] == "empty"

    # strip_mdx: drop import/export + standalone JSX components; keep prose, lowercase HTML, code fences
    mdx = ("import Tabs from '@x'\nexport const y = 1\n\n# Title\n\n<Tabs>\n\nReal prose here.\n\n"
           "</Tabs>\n\n<div>kept</div>\n\n```js\nimport keepme from 'z'\n```\n")
    cleaned = strip_mdx(mdx)
    assert "import Tabs" not in cleaned and "export const" not in cleaned, cleaned
    assert "<Tabs>" not in cleaned and "</Tabs>" not in cleaned, cleaned
    assert "# Title" in cleaned and "Real prose here." in cleaned, cleaned
    assert "<div>kept</div>" in cleaned, cleaned                 # lowercase HTML kept
    assert "import keepme from 'z'" in cleaned, cleaned          # inside code fence kept

    # slug_for
    assert slug_for("https://x.com/docs/intro", "/o") == Path("/o/docs/intro.md")
    assert slug_for("https://x.com/docs/", "/o") == Path("/o/docs/index.md")
    assert slug_for("https://x.com/", "/o") == Path("/o/index.md")

    # engine checks (only if deps present; SKIP cleanly otherwise)
    try:
        import bs4  # noqa: F401
        import markdownify  # noqa: F401
    except Exception:
        print("selftest: OK (engine checks SKIPPED — bs4/markdownify not installed)")
        return 0
    html = ('<html><body><nav>menu</nav>'
            '<article class="sl-markdown-content"><h1>Title</h1>'
            '<p>Hello world body text here that is real prose.</p>'
            '<pre><code class="language-js">const x = 1;</code></pre>'
            '</article><footer>foot</footer></body></html>')
    md, words, status, failure = extract_markdown(html, [".sl-markdown-content"], [])
    assert status == "ok", (status, failure)
    assert "# Title" in md and "menu" not in md and "foot" not in md, md
    assert "```js" in md, md
    try:
        import trafilatura  # noqa: F401
    except Exception:
        print("selftest: OK (bs4 fallback verified; trafilatura primary SKIPPED — not installed)")
        return 0
    tmd = trafilatura_markdown('<html><body><article><h1>T</h1><p>' + 'prose ' * 30 + '</p></article></body></html>')
    assert tmd and "prose" in tmd, tmd
    print("selftest: OK (all checks incl. trafilatura primary + bs4 fallback)")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description="Scrape a docs site to a local markdown corpus.")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--clean-mdx", default="", help="strip import/export/JSX-only lines from *.md under DIR, in place")
    ap.add_argument("--base-url")
    ap.add_argument("--out")
    ap.add_argument("--platform", default=None, help="platform hint (drives the mkdocs search_index fast-path)")
    ap.add_argument("--selector", default="", help="bs4 fallback content container(s), comma-separated")
    ap.add_argument("--strip", default="", help="bs4 fallback chrome selectors to remove")
    ap.add_argument("--source", choices=["auto", "llms", "sitemap"], default="auto")
    ap.add_argument("--max", type=int, default=50)
    ap.add_argument("--include", nargs="*", default=[])
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--raw-md-suffix", default="", help="fetch <url><suffix> as raw markdown (Docsify)")
    ap.add_argument("--body-from-search-index", action="store_true",
                    help="MkDocs: write bodies from search_index text (1 request, plain-text fidelity)")
    ap.add_argument("--render", action="store_true", help="fetch via Playwright (client-rendered/SPA docs)")
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args(argv)

    if args.selftest:
        return selftest()
    if args.clean_mdx:
        print(json.dumps({"status": "clean-mdx", "changed": clean_mdx_dir(args.clean_mdx),
                          "dir": args.clean_mdx}))
        return 0
    if not args.base_url or not args.out:
        ap.error("--base-url and --out are required")
    return run(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
