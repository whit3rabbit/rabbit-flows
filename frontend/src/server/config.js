// config.js — path resolution and environment for the Rabbit Flow Designer server.
// Node-only (uses process.env, import.meta.url). No external deps.

import path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to THIS file so the server works from any cwd.
// __dirname here is frontend/src/server; the frontend root is two levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FRONTEND_DIR = path.resolve(__dirname, '..', '..');
// Repo root: one level above frontend/.
export const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');
export const WORKFLOWS_DIR = path.join(REPO_ROOT, '.claude', 'workflows');

// Both roots where SKILL.md files live. Dedupe by name (first wins).
export const SKILL_ROOTS = [
  path.join(REPO_ROOT, '.claude', 'skills'),
  path.join(REPO_ROOT, 'plugins', 'workflow-kit', 'skills'),
];

export const VALIDATE_PY = path.join(
  REPO_ROOT, '.claude', 'skills', 'dynamic-workflow-authoring', 'scripts', 'validate.py',
);

export const PORT = parseInt(process.env.PORT || '3001', 10);

// Bind to loopback by default — this server WRITES executable workflow files and runs
// validate.py, so it must not be reachable from the network. Set HOST=0.0.0.0 to override.
export const HOST = process.env.HOST || '127.0.0.1';

// Token for authorizing mutations from non-loopback peers. Unset => remote mutations refused.
export const AUTH_TOKEN = process.env.RFD_TOKEN || '';
