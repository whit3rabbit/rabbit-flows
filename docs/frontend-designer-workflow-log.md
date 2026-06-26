# Visual Workflow Designer — build log

Board `.eatahorse-flow-designer`, built via the `eatahorse` execute workflow on 2026-06-25.

**Goal:** React Flow v11 (CDN, no build) web app in `frontend/` that lets a user browse,
edit, and export Claude Code dynamic workflows; export must pass `validate.py --strict`.
Architecture details live in `frontend/CLAUDE.md`.

## Completed (7/7 cards, board cleared in 22 iterations)

- EH-0001: stdlib `http` backend (`frontend/server.js`), static SPA serving, GET workflow list/read.
- EH-0002: Secure write endpoint — path-traversal guard, restrict to `.claude/workflows/`, reject `..`/null-bytes/non-.js names.
- EH-0003: `frontend/parser.js` — balanced-brace meta extraction (reliable), best-effort `agent`/`parallel`/`pipeline`/`phase` call scan, lossy[] for unparseable sections.
- EH-0004: Canvas wired to backend — real workflow list from `/api/workflows`, replaces hand-coded GRAPHS builders, lossy banner shown in UI.
- EH-0005: Code-gen rewrite — `genCode()` emits `// requires-skills:` header + pure-literal `export const meta` + `agent`/`parallel`/`pipeline` bodies; POST `/api/validate` runs `validate.py --strict` server-side; UI shows pass/fail.
- EH-0006: GET `/api/skills` — scans `.claude/skills/` + `plugins/workflow-kit/skills/` for SKILL.md, dedupes, feeds palette requires-skills picker.
- EH-0007: `frontend/Dockerfile` + `docker-compose.yml`; `frontend/CLAUDE.md` rewritten with architecture, local/docker run commands, parse limitations, validation gate.

## Post-build fixes (manual verification round, same day)

The eatahorse completion gate verified the CLI path (`validate.py` on a file written directly)
but not the HTTP/UI paths, which left gaps caught by an independent verification pass:

- **`/api/validate` JSON-body hardening** (`server.js`): the handler wrote the raw POST body to
  the candidate file. The real client posts `text/plain` raw source (worked), but a conventional
  `{"source":...}` JSON POST wrote the JSON wrapper and failed with "no meta block" /
  "Unexpected token ':'". Now parses `{source}` when the body is JSON, falls back to raw text.
- **save-to-repo was never wired** — the secure write endpoint (EH-0002) existed but no UI button
  called it. Added a "Save to repo" button in the code modal (`flow-canvas.js` `saveToRepo`).
- **Overwrite guard** (`server.js` writeWorkflow): the graph→code round-trip is lossy, so a blind
  save could replace a real 52KB workflow with a stub. Write now uses `flag:'wx'` and returns 409
  unless retried with `?overwrite=1`; the client prompts for a filename and confirms before forcing.
- **docker-compose context** was `context: .` / `./.claude`, which under `-f frontend/docker-compose.yml`
  resolves relative to `frontend/` (wrong). Changed to `..` / `../.claude` to match the Dockerfile's
  repo-root build context.

## Verified (independent, not gate-reported)

- `node test-parser.mjs` → exit 0 (meta parsed, lossy flagged with `{line, reason}`).
- Server starts; `/api/workflows` lists all 10 real workflows; `/api/skills` returns real catalog;
  read endpoint round-trips source cleanly; traversal on read+write → 404/400.
- `/api/validate` returns `ok:true` on a real workflow source via both `text/plain` and JSON bodies.
- Write endpoint: new file 200, existing 409, `?overwrite=1` 200, traversal 400.
- `docker build -f frontend/Dockerfile -t rabbit-flow-designer .` → exit 0; container runs,
  `/api/workflows` + `/api/validate` (200) work in-container with python3 present.
- `docker compose -f frontend/docker-compose.yml config` → OK after the context fix.

## Constraints for reruns

- The parser is heuristic (regex + token walk), not a full AST; dynamic `agent()` calls built from
  runtime variables may produce placeholder nodes. Intentional and documented.
- The graph→code round-trip is **lossy** — never blind-save over a real workflow; the overwrite
  guard exists for exactly this. Generated code is a representative scaffold that passes the
  validator, not a faithful reproduction of the source.
- `frontend/index.html` (older DCLogic mockup) requires absent `support.js` — do not use/extend it;
  use `flow.html`.
- Docker build context must be the repo root so `.claude/` is reachable.
- Backend uses Node.js stdlib only — no new deps. Keep it that way.

## Not independently verified

- `genCode()` output passing `validate.py --strict` end-to-end: relies on the eatahorse gate
  (iter 12, reported exit 0) plus the now-proven `/api/validate` plumbing. The in-browser
  "Export + Validate" button exercises the real path, so it is user-checkable.

## Code-review hardening round (2026-06-25, /code-review xhigh)

A recall-mode review (5 finder angles + sweep) found the parser silently dropped the most
common construct and the server was network-exposed. All fixed; tests added.

**Parser (`parser.js`) — the load-bearing bug.** The `parallelRe`/`pipelineRe` regexes required
a literal `[` after `parallel(`/`pipeline(`, and both agent regexes required `await`. So the
idiomatic `parallel(items.map(() => agent(...)))` and `pipeline(items, s1, s2)` forms matched
nothing AND left `lossy[]` empty — `starter.js` (the reference workflow) parsed to 3 nodes with
its entire worker stage gone and NO warning. Fixes:
- `parallel(`/`pipeline(` no longer require `[`; the whole paren span is scanned. Lane scanner
  matches bare `agent(` (thunks aren't awaited). `pipeline(items, s1, s2)` emits each stage as a node.
- `optsOf()` splits on the first TOP-LEVEL comma (was `indexOf(',')`, which broke on commas in the
  prompt) and handles the single-object `agent({...})` form (was dropping the first option/model).
- `stripComments()` is string-literal aware — a `//` or `/*` inside a prompt URL no longer truncates
  the call. Length/newlines preserved 1:1 so line numbers stay correct.
- Phase titles scanned only inside `phases: [ ... ]` (was any `title:` in meta). Concat-aware string
  extraction (`'a' + 'b'`). Parallel lanes now get container→lane edges (were orphaned). Dead
  `lineOf`/`extractBracket`/triple-`pos=` removed. Locked by `test-parser.mjs` AC5/AC6 (27 pass).

**Server (`server.js`) — network exposure.** `server.listen(PORT)` bound all interfaces, so the
unauthenticated POST that writes executable `.js` into `.claude/workflows/` (which the runtime later
runs) was LAN-reachable with CORS:*. Now binds `127.0.0.1` (set `HOST=0.0.0.0` to override); Docker
sets `HOST=0.0.0.0` inside the container and compose publishes to `127.0.0.1:3001` only. Also: 2 MB
request-body cap (was unbounded → heap-DoS), top-level try/catch + `clientError` handler (one throw
no longer kills the process), `parseFrontmatter` handles YAML block scalars, `/` serves `flow.html`
(was the dead `index.html` mockup), dead `notImplemented()` removed.

**Codegen (`flow-canvas.js`).** `genCode` now: emits placeholder `const SCHEMA = {...}` for each
referenced schema (was `ReferenceError` at runtime while validate.py showed "Passed"), only emits
`schema:` for UPPER_SNAKE identifiers, dedupes JS identifiers (`uniqId`, was duplicate-`const`),
gives each loop a unique `iter` var (two loops → duplicate-`let` SyntaxError), uses `args?.maxIterations`
(was `args.` → throws on argless run), and reads container membership from stamped style dims instead
of async-measured width (was dropping container members if generated before the 150ms measure tick).
A representative emission passes `validate.py --strict`. Also: real DFS cycle check in `validate()`
(was claiming "acyclic" unconditionally), import shape-validation (malformed node no longer bricks the
canvas), localStorage errors surfaced via `console.warn`, single-chain `fitRetry`, self-clearing
measure loop keyed on node-id signature, fixed malformed CSS color `'#6b7686, '`.

## Modular refactor round (2026-06-26, eatahorse board `.eatahorse-frontend-refactor`)

Goal: every source file under 400 lines, modules organized for expansion, Vite build added,
npm+pnpm support, dead `index.html` deleted. The `eatahorse` execute workflow ran 6 cards but
**stalled** on the last (worker no-progress, 6×180s retries, ~4h/1M tokens) after completing
EH-0001/2/3 (delete index.html, add Vite + dual-PM baseline, split `flow-canvas.js` 834→14 `src/`
modules). The remaining three cards (split `parser.js`, split `server.js`, doc) were finished
**inline** rather than re-running the heavy workflow.

- **`parser.js` 554 → facade + `src/parser/`**: `scan.js` (109, string-literal-aware helpers),
  `meta.js` (49), `calls.js` (315). `parser.js` (44) re-exports `parseWorkflow`/`parseMeta`/
  `parseCalls`/`mapToFlowCanvas`. The duplicated agent-scan loop in `parallel`/`pipeline` was
  factored into one `scanAgents(inner, offset, labelFor)` helper. **Entry must stay at
  `frontend/parser.js`** — the browser loads it via `import('/parser.js')` (canvas.js) and the
  test via `./parser.js`; both resolve the relative `./src/parser/*` imports, and Vite follows
  the dynamic import to bundle the chain. All 27 `test-parser.mjs` assertions still pass.
- **`server.js` 451 → entry + `src/server/`**: `config.js` (33, paths/env — computes
  `FRONTEND_DIR`/`REPO_ROOT` from its own location two levels up), `http-util.js` (53, MIME/JSON/
  capped body), `security.js` (51, sanitise + loopback/token auth), `handlers.js` (224, the 6 route
  handlers). `server.js` (93) is now just the dispatcher + listen. Behavior preserved: booted on a
  test port, all 5 API routes return correctly, `%2e%2e` traversal → 404, `/api/validate` → `ok:true`
  on real workflows via JSON body.
- **ESLint split**: `src/server/**` is Node, so it is `ignores`d from the browser `src/**` group and
  added to the Node group (`server.js`, `src/server/**`, `parser.js`, tests, configs). Fixed the 3
  pre-existing `no-unused-vars` warnings (`btn` in canvas.js; `DIMS`+`MarkerType` in nodes.js).
- **npm/pnpm**: scripts are package-manager-agnostic (all deps are devDependencies). Verified
  `build`/`test`/`lint` clean under BOTH `npm run` and `pnpm`. No lockfile committed (don't commit
  both — they drift); documented adding one if pinned installs are wanted.

Final state: largest source file `src/canvas.js` 397, then `src/parser/calls.js` 315,
`src/server/handlers.js` 224 — all under 400. Gate green: lint 0 problems, test 27/27, `vite build`
ok (parser bundled), server boots and serves the full API.

### Constraints for the next refactor

- `frontend/parser.js` and `frontend/server.js` are ENTRY files by necessity (browser URL import /
  Node test import / process entry) — keep them at the frontend root; put internals under
  `src/parser/` and `src/server/`. Don't move the entries into `src/`.
- `src/server/**` is Node, not browser. Keep the ESLint `ignores`/files split in sync or Node globals
  (`process`/`Buffer`/`fs`) flag as undefined.
- Vite only bundles what `flow.html` reaches; `src/server/**` is unreferenced and never bundled. The
  parser chain IS bundled via the `import('/parser.js')` dynamic import — verify `vite build` after
  any parser-module move.

## Code-review hardening round 2 (2026-06-26, /code-review xhigh on the modular tree)

A recall-mode review of the split `src/` modules. The refactor itself was byte-faithful (A/B
parse diff over 10 workflows = 0 diffs, 27/27 tests), but it carried standing bugs. The headline
was a CSRF-to-loopback that the prior round's `127.0.0.1` bind did NOT close. All 14 findings fixed
and verified (parser tests 27/27, eslint clean, codegen repros, live server smoke test).

**Server — CSRF-to-loopback → stored RCE (the load-bearing one).** `mutationAuthorized` trusted any
loopback peer, but a malicious page in the victim's browser connects to `127.0.0.1` FROM loopback,
and `Content-Type: text/plain` is a CORS "simple request" (no preflight), so any website could
`POST /api/workflows/<name>.js` and write executable code into `.claude/workflows/` with no token —
which the runtime later runs. `?overwrite=1` let it clobber a trusted workflow. Fixes:
- `originAllowed(req)` in `security.js`: mutations refuse a cross-site `Origin` (browsers always
  attach it and a page can't forge it; non-browser clients send none and still face loopback/token).
  Wired into both mutating routes via `guardMutation` in `server.js`. Loopback trust alone is NOT a
  CSRF defense — the browser is on loopback.
- Removed `Access-Control-Allow-Origin: *` from JSON + static responses and deleted the cross-origin
  OPTIONS preflight handler. The SPA is same-origin, so it needs no CORS; omitting it stops a
  cross-origin page from READING workflow source / skill catalog / the server's own `security.js`,
  `config.js`, `package.json`, `node_modules` (all under `FRONTEND_DIR`, which `serveStatic` serves).
- `readWorkflow` now routes through `sanitizeWorkflowName` (was a weaker inline check that never
  rejected `..`) — single audited validator for both read and write.

**Codegen (`codegen.js`).** `model` was interpolated RAW into the emitted `{ model: '<x>' }`
(unlike `label` via `JSON.stringify` and `schema` via a regex gate), so a crafted `model` (reachable
via imported workflow JSON) broke the output or injected a statement — now whitelisted to
`opus|sonnet|haiku`. `escSQ` didn't escape `\n`/`\r`, so a meta name/description with a newline
(reachable via import) emitted an unterminated literal that fails `validate.py --strict`, the exact
gate codegen exists to pass — now escaped. (Agent labels were already safe via `JSON.stringify`.)

**Parser (`scan.js`).** `stripComments` was not regex-literal aware: a URL regex like
`/https?:\/\//` was read as a `//` line comment and SILENTLY blanked the rest of the line, dropping
any same-line `agent()` with no `lossy[]` flag — now tracks the previous significant token to tell a
regex literal from division and copies the literal verbatim (honouring `\` escapes and `[ ]`
classes). `extractStringValue` was not string-literal aware: a `name:`/`description:` mentioned
inside another value's string matched first and nulled the real `meta.name` — now skips in-string
matches. Both verified with repros; 27/27 still pass.

**SPA (`canvas.js`/`library.js`).** `loadLib` validated only array-shape, so a malformed-but-array
localStorage value (`[{id:'x'}]` with no `nodes`) reached `useNodesState(undefined)` and crashed the
canvas on first render with no recovery — now requires every entry to have `id` + `nodes[]` +
`edges[]`, else falls back to the seed. Drop-target ids gained a `Date.now` suffix and import coerces
ids to strings + dedupes, so a foreign/imported workflow can't collide ids (broke selection/deletion)
or drop edges on a numeric-vs-string id mismatch. `FileReader.onerror` added (read failures were
silent).

**Cleanup.** Removed dead `UID`/`bumpUID` exports + a stale comment in `graph.js` (canvas.js uses a
private shadow). `validate()` and the inspector summary now call the existing `countKinds` helper
instead of re-implementing the agent/gate count. `LossyNode` uses the `dotHandle(col)` helper instead
of two hand-rolled copies.

### Constraints carried forward

- The mutation policy is now **same-origin + Origin-check + loopback/token**, NOT just loopback. Do
  not re-add `Access-Control-Allow-Origin` or a permissive OPTIONS handler without an Origin allowlist
  on the mutating routes — that reopens the CSRF write. (See `frontend/CLAUDE.md` "Same-origin only".)
- `stripComments` regex/division disambiguation uses a prev-significant-token heuristic (regex after
  `( , = : [ ! & | ? { } ; + - * / % < > ^ ~` or start). `return /re/`-style (regex after a keyword)
  falls back to division — acceptable for workflow sources; revisit only if it bites.
- Codegen interpolates `model` raw — keep it whitelisted; any new raw-interpolated field needs the
  same `escSQ`/whitelist treatment.

## Speed/memory round (2026-06-26, Playwright baseline)

Baseline via Playwright (`performance` API, localhost): cold load **387 KB** transferred
(vendor 300 KB + app 74 KB, all uncompressed), 20 requests, FCP 120 ms, JS heap 5.3 MB.

Diagnosis: `serveStatic` sent every asset raw — no gzip, no cache headers. The 300 KB vendor
(React/ReactDOM/ReactFlow UMD) is the whole weight; the app is ~50 KB. Heap was already tiny, so
**there is no realistic client-memory win at this scale** — the work was all transfer/load.

Fixes (server-side, stdlib only, zero new deps):
- **gzip on the fly** in `serveStatic` (`handlers.js`) via stdlib `zlib.gzipSync`, gated on
  `Accept-Encoding: gzip`, `COMPRESSIBLE` ext set, and `>1024` bytes. No compressed-buffer cache
  (`ponytail:` comment marks the upgrade path) — single-user dev tool, per-request compress is cheap.
- **Cache-Control**: `/vendor/*` → `public, max-age=31536000, immutable` (pinned, re-download to
  upgrade); everything else → `no-cache` so live src edits show up.
- **Parallel vendor fetch** (`main.js`): `for...await loadScript` → `Promise.all(LIBS.map(...))` with
  `s.async = false`. Downloads parallel, executes in DOM order so `window.React` is set before
  ReactDOM/ReactFlow run.

Result (Playwright-verified): cold load **387 → 136 KB (-65%)**, FCP 120 → 72 ms; warm load **vendor
0 bytes (cached), 39 KB total**. Gates green: `test-parser.mjs` 27/27, eslint 0, `vite build` ok, no
console errors, app renders. Raw fallback (no `Accept-Encoding`) still serves full uncompressed bytes.

Constraint: do NOT add `Content-Length` of the raw buffer when `Content-Encoding: gzip` is set — the
length must match the gzipped bytes (it does; `Vary: Accept-Encoding` is sent so proxies don't mix
encodings).
