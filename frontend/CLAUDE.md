# Frontend — Rabbit Flow Designer

Visual node editor for composing rabbit-flows workflows (agents, gates, parallel/loop
containers, skills) on a canvas. The SPA is backed by a stdlib Node.js HTTP server that
reads real workflow files from `.claude/workflows/` and can validate generated code via
`validate.py --strict`.

## Architecture

- **SPA** (`flow.html` + `flow-canvas.js`): React + ReactFlow served locally from
  `frontend/vendor/` (no CDN, no build step). Mounted as a `<flow-canvas>` custom element. Workflow library persists in
  localStorage; manager modal supports new/rename/duplicate/delete + JSON import/export.
- **Backend** (`server.js`): stdlib `http` server (no npm deps). Serves static files
  from `frontend/` and exposes a JSON API for workflow CRUD and validation.
- **Parser** (`parser.js`): best-effort AST-to-graph parser. Extracts `agent`/`parallel`/
  `pipeline`/`phase` calls from workflow `.js` sources and maps them to canvas nodes.
  See "Parse limitations" below.

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workflows` | List `.js` basenames in `.claude/workflows/` |
| GET | `/api/workflows/:name` | Read one workflow source (`{name, source}`) |
| POST | `/api/workflows/:name` | Write body to `.claude/workflows/:name` (path-traversal-guarded) |
| POST | `/api/validate` | Validate body via `validate.py --strict` (`{ok, output}`) |
| GET | `/api/skills` | List `{name, description}[]` from both skill roots (deduped) |

The server binds `127.0.0.1` by default (it writes executable workflow files and runs
`validate.py`, so it must not be LAN-reachable). Set `HOST=0.0.0.0` to override. Request
bodies are capped at 2 MB. Mutating routes (`POST /api/workflows/:name`, `POST /api/validate`)
are loopback-open but require an `Authorization: Bearer $RFD_TOKEN` header from any non-loopback
peer; if `RFD_TOKEN` is unset, remote mutations are refused. The SPA reads its token from
`localStorage['rfd_token']`. Keep it loopback-only unless you set `RFD_TOKEN`.

## Files

- `flow-canvas.js` — the runnable SPA. Vendored React + ReactFlow (`vendor/`), no build.
- `vendor/` — pinned React 18.3.1, ReactDOM 18.3.1, ReactFlow 11.11.4 (UMD + CSS), served by `server.js`. Committed on purpose; re-download to upgrade.
- `flow.html` — minimal host page. Open this to use the app.
- `server.js` — stdlib HTTP server (Node 20+). No `node_modules` needed.
- `parser.js` — best-effort workflow-JS-to-graph parser (see parse limitations).
- `package.json` — records Node version constraint only; no runtime deps.
- `test-parser.mjs` — `parser.js` self-checks. Run: `node frontend/test-parser.mjs` (exits 0/1).
- `Dockerfile` — builds the server image with python3 for `/api/validate`.
- `docker-compose.yml` — convenience compose wrapper (mounts `.claude/` read-only).
- `index.html` — older DCLogic mockup. Needs `support.js` (absent). Do not use; the server
  serves `flow.html` at `/`, not this file.

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
  `await parallel(items.map(() => agent(...)))` (bare thunks), and `await pipeline(items, s1, s2)`
  (stages emitted as sequential nodes). A `//` or `/*` inside a prompt string is preserved.
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
