# Frontend — Rabbit Flow Designer

Visual node editor for composing rabbit-flows workflows (agents, gates, parallel/loop
containers, skills) on a canvas. The SPA is backed by a stdlib Node.js HTTP server that
reads real workflow files from `.claude/workflows/` and can validate generated code via
`validate.py --strict`.

## Architecture

- **SPA** (`flow.html` + `src/*.js`): React + ReactFlow served locally from `frontend/vendor/`
  (no CDN). Source is native ES modules under `src/`; the entry is `src/main.js`, mounted as a
  `<flow-canvas>` custom element. Workflow library persists in localStorage; manager modal
  supports new/rename/duplicate/delete + JSON import/export. **Build:** Vite (a devDependency)
  bundles to `dist/` for standalone static hosting; in dev and Docker the server serves `src/`
  directly, so no build is required to run.
- **Backend** (`server.js` + `src/server/*.js`): stdlib `http` server, **zero runtime deps**.
  `server.js` is the request dispatcher + listen; `src/server/` holds the pieces — `config.js`
  (paths/env), `http-util.js` (transport: MIME, JSON, capped body reader), `security.js`
  (name sanitisation + loopback/token auth), `handlers.js` (the route handlers). Serves static
  files from `frontend/` and exposes a JSON API for workflow CRUD and validation.
- **Parser** (`parser.js` + `src/parser/*.js`): best-effort source-to-graph parser. `parser.js`
  is the public entry — loaded in the browser via `import('/parser.js')` and in Node by
  `test-parser.mjs`. `src/parser/` holds `scan.js` (string-literal-aware helpers), `meta.js`
  (the `export const meta` block), `calls.js` (the `agent`/`parallel`/`pipeline`/`phase` scan).
  Extracts those calls from workflow `.js` sources and maps them to canvas nodes. See "Parse
  limitations" below.

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workflows` | List `.js` basenames in `.claude/workflows/` |
| GET | `/api/workflows/:name` | Read one workflow source (`{name, source}`) |
| POST | `/api/workflows/:name` | Write body to `.claude/workflows/:name` (path-traversal-guarded) |
| POST | `/api/validate` | Validate body via `validate.py --strict` (`{ok, output}`) |
| GET | `/api/skills` | List `{name, description}[]` from both skill roots (deduped) |
| GET | `/api/bundle/:name` | Download a `.zip` of the workflow + its declared skills/agents (read-tier) |

The server binds `127.0.0.1` by default (it writes executable workflow files and runs
`validate.py`, so it must not be LAN-reachable). Set `HOST=0.0.0.0` to override. Request
bodies are capped at 2 MB. Mutating routes (`POST /api/workflows/:name`, `POST /api/validate`)
are loopback-open but require an `Authorization: Bearer $RFD_TOKEN` header from any non-loopback
peer; if `RFD_TOKEN` is unset, remote mutations are refused. The SPA reads its token from
`localStorage['rfd_token']`. Keep it loopback-only unless you set `RFD_TOKEN`.

**Same-origin only.** Responses carry NO `Access-Control-Allow-Origin`, and there is no CORS
preflight handler — the SPA is served from the same origin as the API, so it needs neither. This
keeps a cross-origin page from reading workflow source / the skill catalog / the server's own
files. On top of loopback/token auth, mutations also enforce an **Origin check** (`originAllowed`
in `security.js`): a request whose `Origin` is a different site is refused (403), closing the
CSRF-to-loopback hole — loopback trust alone is insufficient because the victim's own browser
connects from loopback. Non-browser clients (curl/node) send no `Origin` and are allowed (they
still face loopback/token). Do NOT re-add `Access-Control-Allow-Origin` or a permissive OPTIONS
handler without restoring an Origin allowlist on the mutating routes.

## Files

- `flow.html` — minimal host page; loads `src/main.js`. Open this to use the app.
- `src/` — browser SPA ES modules. `main.js` (boot), `canvas.js` (shell state/layout), plus
  `toolbar`/`palette`/`inspector`/`manager`/`codepanel`/`flowpane` (UI), `nodes`/`graph`/`visual`
  (rendering), `api` (backend calls), `library` (localStorage), `codegen` (graph→code).
  - `src/parser/` — parser internals: `scan.js`, `meta.js`, `calls.js` (entry is `../parser.js`).
  - `src/server/` — Node server internals: `config.js`, `http-util.js`, `security.js`, `handlers.js`,
    `bundle.js` (assembles the `/api/bundle/:name` export zip).
- `parser.js` — public parser entry (browser + Node); thin facade over `src/parser/`.
- `server.js` — stdlib HTTP server entry (Node 18+): dispatcher + listen over `src/server/`.
- `vendor/` — pinned React 18.3.1, ReactDOM 18.3.1, ReactFlow 11.11.4 (UMD + CSS), served by
  `server.js`. Committed on purpose; re-download to upgrade. Not bundled by Vite. Also
  `fflate.module.js` (vendored zip lib) — the ONE runtime module the server imports
  (`src/server/bundle.js`), kept vendored rather than an npm dep so `node server.js` still needs no
  `npm install`. Upgrade by re-copying `node_modules/fflate/esm/index.mjs`.
- `package.json` — Node engine + the `start`/`build`/`lint`/`test` scripts; **devDependencies only**
  (Vite + ESLint). The server and parser import zero runtime deps.
- `vite.config.js` / `eslint.config.js` — build + lint config. ESLint splits browser (`src/**`,
  minus `src/server/`) from Node (`server.js`, `src/server/**`, `parser.js`, tests, configs).
- `src/schema.js` — canonical graph schema: node-kind/edge-type vocabularies (imported from
  `visual.js`), per-kind handle inventory, connection rules (`CONNECTION_RULES`/`edgeTypeFor`/
  `connectionAllowed`, wired into the canvas `onConnect`+`isValidConnection`), Draft-07
  `GRAPH_JSON_SCHEMA`, and dependency-free `validateGraph()`. Full reference: `docs/flow-schema.md`.
- `test-parser.mjs` — `parser.js` self-checks. Run: `node frontend/test-parser.mjs` (exits 0/1).
- `test-schema.mjs` — `schema.js` self-checks: every `.claude/workflows/*.js` parses to a graph that
  passes `validateGraph()`, plus handle-count / connection-rule / validator checks.
- `test-codegen.mjs` — `codegen.js` self-checks: guards the `genCode()` leaf->container grouping
  (the cidById/contBounds precompute). `npm test` runs all four suites (test-parser.mjs,
  test-schema.mjs, test-bundle.mjs, test-codegen.mjs).
- `Dockerfile` — builds the server image with python3 for `/api/validate`.
- `docker-compose.yml` — convenience compose wrapper (mounts `.claude/` read-only).
- Every source file is kept under 400 lines (tests may exceed); split a module rather than grow it.

## Build / test / lint (npm or pnpm)

Scripts are package-manager-agnostic — every command works under both `npm run …` and `pnpm …`
(all deps are explicit devDependencies, so pnpm's strict `node_modules` is fine). `package-lock.json`
is the committed lockfile (npm); keep exactly one lockfile (npm OR pnpm, not both) to avoid double
dependabot alerts. Regenerate it with `npm install` after changing devDependencies.

```bash
cd frontend
npm install        # or: pnpm install
npm run build      # or: pnpm build   — vite build → dist/
npm run lint       # or: pnpm lint    — eslint .
npm test           # or: pnpm test    — runs test-parser.mjs && test-schema.mjs && test-bundle.mjs && test-codegen.mjs
npm start          # or: pnpm start   — node server.js
```

Running the app needs NO install or build (the server serves `src/` directly); install is only
for `build`/`lint`. Verified clean under both managers after the modular refactor.

## Run locally

```bash
# From repo root:
node frontend/server.js
# Then open: http://localhost:3001/   (serves flow.html)
```

The server resolves `.claude/workflows/` relative to the repo root (two levels above
`frontend/server.js`). It reads `PORT` (default 3001) and `HOST` (default `127.0.0.1`) from
the environment.

## Run via Docker

Build from repo root (context must be the repo root so `.claude/` is reachable):

```bash
docker build -f frontend/Dockerfile -t rabbit-flow-designer .
```

Run with the repo's `.claude/` mounted read-only (validates against real workflows,
no writes to the host):

```bash
docker run --rm -p 3001:3001 \
  -v "$(pwd)/.claude:/app/.claude:ro" \
  rabbit-flow-designer
# Then open: http://localhost:3001/flow.html
```

To allow the canvas to save generated workflows back to the host, mount writable AND set a
token (in Docker the SPA's requests arrive from the bridge, not loopback, so writes need auth):

```bash
docker run --rm -p 127.0.0.1:3001:3001 \
  -e RFD_TOKEN=change-me \
  -v "$(pwd)/.claude:/app/.claude" \
  rabbit-flow-designer
# Then in the browser console once: localStorage.setItem('rfd_token','change-me')
```

Or use docker compose (from repo root):

```bash
docker compose -f frontend/docker-compose.yml up --build
```

## Parse limitations

`parser.js` is a best-effort, heuristic parser — NOT a full JavaScript AST parser.
It uses regex and simple token walks to extract workflow structure. Known limitations:

- **Supported forms**: `await agent(...)`, `phase('...')`, `await parallel([...])` AND
  `await parallel(items.map(() => agent(...)))` (bare thunks), `await pipeline(items, s1, s2)`
  (stages emitted as sequential nodes), and `while`/`for (...) { ... }` loops (a `loop` container
  whose body `agent()` calls become child lanes; a braceless or agent-less loop body is skipped).
  A `//` or `/*` inside a prompt string is preserved, and a paren or `agent(` inside a prompt
  string no longer breaks the scan.
- **Lossy flags**: `model`, `isolation`, and per-agent options inside object literals
  may be silently dropped if they appear in complex expressions.
- **No perfect round-trip**: parsed-then-exported graphs will not reproduce the original
  source exactly. Use export as a scaffold starting point, not a lossless mirror.
- **Dynamic calls**: `agent()` calls built from runtime variables (e.g.
  `agent({prompt: buildPrompt(x)})`) may not be resolved; the node appears with a
  placeholder prompt.
- **Nested parallels**: deeply nested `parallel([parallel([...])])` may be flattened
  to a single level in the canvas representation.

## Validation gate

`validate.py --strict` is the hard success criterion for generated workflows. Before
saving a canvas-generated workflow to `.claude/workflows/`, validate it:

```bash
# Via the API (POST body = workflow source):
curl -s -X POST http://localhost:3001/api/validate \
  --data-binary @.claude/workflows/my-workflow.js | jq '{ok, output}'

# Or directly (from repo root):
python3 .claude/skills/dynamic-workflow-authoring/scripts/validate.py \
  .claude/workflows/my-workflow.js --strict
```

A workflow that fails `validate.py --strict` or `npm run check` is not complete.
The canvas "Generate code" output is a scaffold — review and fix before committing.
