# Rabbit Flow Designer

Visual node editor for composing rabbit-flows workflows (agents, gates, parallel/loop containers, skills) on a canvas. React + ReactFlow SPA backed by a stdlib Node.js HTTP server with zero runtime dependencies.

Open `flow.html` to use the app. The server reads workflows from `.claude/workflows/` and can validate generated code against `validate.py --strict`.

## Prerequisites

- Node.js 18+ (local dev) or Docker (containerized)

## Quick start

```bash
# From repo root:
node frontend/server.js
# Open http://localhost:3001/flow.html
```

No install needed — the server serves `src/` directly. `npm install` is only needed for lint or build.

## Run with Docker

Build from repo root, mount workflows and skills as volumes so the container reads live files:

```bash
# Build:
docker build -t rabbit-flow-designer .

# Run (read-only — view, validate, no writes):
docker run --rm -p 3001:3001 \
  -v "$(pwd)/.claude/workflows:/app/.claude/workflows:ro" \
  -v "$(pwd)/.claude/skills:/app/.claude/skills:ro" \
  -v "$(pwd)/plugins:/app/plugins:ro" \
  rabbit-flow-designer

# Run (writable workflows for saving generated code):
docker run --rm -p 127.0.0.1:3001:3001 \
  -e RFD_TOKEN=change-me \
  -v "$(pwd)/.claude/workflows:/app/.claude/workflows" \
  -v "$(pwd)/.claude/skills:/app/.claude/skills:ro" \
  -v "$(pwd)/plugins:/app/plugins:ro" \
  rabbit-flow-designer
```

Or with compose:

```bash
docker compose -f frontend/docker-compose.yml up --build
```

Open http://localhost:3001/flow.html. The container runs as UID 1000 (`node`); writable mounts need host dirs owned by that user.

Pre-built images on Docker Hub:

```bash
docker pull followthewhit3rabbit/rabbit-flow-designer:latest
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workflows` | List workflow files |
| GET | `/api/workflows/:name` | Read one workflow |
| POST | `/api/workflows/:name` | Write a workflow (auth required from non-loopback) |
| POST | `/api/validate` | Validate code via `validate.py --strict` |
| GET | `/api/skills` | List skill catalog |
| GET | `/api/bundle/:name` | Download workflow bundle (.zip) |

## Build / test / lint

```bash
cd frontend
npm install
npm run build     # Vite build -> dist/
npm run lint      # ESLint
npm test          # Parser, schema, bundle, and codegen self-checks
```

## Key files

- `server.js` — stdlib HTTP server, zero external deps
- `flow.html` — host page; open this to use the app
- `src/` — SPA ES modules (React + ReactFlow via `vendor/`)
- `src/server/` — server internals (config, handlers, auth, bundle zip)
- `src/parser/` — workflow source-to-graph parser
- `src/schema.js` — graph schema, connection rules, validation
- `vendor/` — pinned React, ReactFlow, and fflate (vendored deps)

See `CLAUDE.md` for architecture details and parse limitations.
