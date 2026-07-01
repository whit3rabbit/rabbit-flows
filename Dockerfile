# Dockerfile — Rabbit Flow Designer backend server
#
# Includes python3 so /api/validate can run validate.py --strict inside the container.
# Workflows, skills, and plugins are mounted at runtime (not baked in) so the image
# stays generic and workflows can be edited on the host without rebuilding.
# The `plugins` mount resolves skill symlinks under .claude/skills/.
#
# Build:
#   docker build -t rabbit-flow-designer .
#
# Run (mount workflows, skills, and plugins from the host repo, read-only):
#   docker run --rm -p 3001:3001 \
#     -v "$(pwd)/.claude/workflows:/app/.claude/workflows:ro" \
#     -v "$(pwd)/.claude/skills:/app/.claude/skills:ro" \
#     -v "$(pwd)/plugins:/app/plugins:ro" \
#     rabbit-flow-designer
#
# Then open: http://localhost:3001/flow.html
#
# To allow saving generated workflows back to the host, mount workflows writable:
#   docker run --rm -p 3001:3001 \
#     -v "$(pwd)/.claude/workflows:/app/.claude/workflows" \
#     -v "$(pwd)/.claude/skills:/app/.claude/skills:ro" \
#     -v "$(pwd)/plugins:/app/plugins:ro" \
#     rabbit-flow-designer

FROM node:20-slim

# python3 is needed for POST /api/validate (runs validate.py --strict)
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the frontend directory contents (all static + server files).
# .claude/ is NOT copied here; it is expected as volume mounts at runtime
# so changes to workflows on the host are immediately visible without rebuild.
COPY frontend/ ./frontend/

# The server resolves WORKFLOWS_DIR relative to frontend/server.js two levels up
# to the repo root, then into .claude/workflows/. With the mount at /app/.claude/workflows
# that path becomes /app/.claude/workflows/ — which is correct since WORKDIR is /app.

WORKDIR /app/frontend

# Inside the container the server must bind all interfaces so the published port reaches it;
# the access boundary is the host-side publish (use `-p 127.0.0.1:3001:3001` to keep it local).
ENV HOST=0.0.0.0

EXPOSE 3001

# Drop root (F3): node:20-slim ships a non-root `node` user (UID 1000). Running as root meant
# files written via a writable .claude mount landed root-owned on the host. Copied files are
# world-readable, so the server can still read frontend/ and vendor/. With a writable mount,
# the host .claude/workflows dir must be writable by UID 1000.
USER node

CMD ["node", "server.js"]
