#!/usr/bin/env node
// frontend/server.js — stdlib HTTP server for the Rabbit Flow Designer SPA.
// No external deps. Serves frontend/ static files + a JSON API for .claude/workflows/*.js.
// The implementation lives in src/server/*: config.js (paths/env), http-util.js (transport),
// security.js (name sanitisation + auth), handlers.js (the route handlers). This file is
// just the request dispatcher + listen.
//
// API surface:
//   GET  /api/workflows        — list basenames of .claude/workflows/*.js
//   GET  /api/workflows/:name  — read one workflow (returns {name, source})
//   POST /api/workflows/:name  — write body to .claude/workflows/:name (path-traversal-guarded)
//   POST /api/validate         — run validate.py --strict on the body, return {ok, output}
//   GET  /api/skills           — list skills ({name, description}[]) from both skill roots
//   *                          — static files from frontend/

import http from 'http';

import { PORT, HOST, FRONTEND_DIR, WORKFLOWS_DIR } from './src/server/config.js';
import { json } from './src/server/http-util.js';
import { mutationAuthorized, originAllowed } from './src/server/security.js';
import {
  listWorkflows, readWorkflow, writeWorkflow, validateWorkflow, listSkills, serveStatic,
} from './src/server/handlers.js';

const UNAUTHORIZED = { error: 'Unauthorized: remote mutations require a Bearer RFD_TOKEN' };
const CROSS_ORIGIN = { error: 'Forbidden: cross-origin mutation refused' };

// Guard a mutating route: reject cross-site Origin (CSRF) then check loopback/token auth.
// Returns true if the handler should proceed; otherwise it has already written the response.
function guardMutation(req, res) {
  if (!originAllowed(req)) { json(res, 403, CROSS_ORIGIN); return false; }
  if (!mutationAuthorized(req)) { json(res, 401, UNAUTHORIZED); return false; }
  return true;
}

const server = http.createServer((req, res) => {
 try {
  const url = req.url.split('?')[0];
  const method = req.method.toUpperCase();

  // No CORS preflight handler: the app is same-origin and we deliberately do NOT advertise
  // cross-origin access. A stray OPTIONS just falls through to 404 below.

  // --- API routes ---
  if (url === '/api/workflows' && method === 'GET') {
    listWorkflows(res);
    return;
  }

  const workflowMatch = url.match(/^\/api\/workflows\/([^/]+)$/);
  if (workflowMatch) {
    const name = decodeURIComponent(workflowMatch[1]);
    if (method === 'GET') { readWorkflow(res, name); return; }
    if (method === 'POST') {
      if (!guardMutation(req, res)) return;
      writeWorkflow(req, res, name);
      return;
    }
  }

  if (url === '/api/validate' && method === 'POST') {
    if (!guardMutation(req, res)) return;
    validateWorkflow(req, res);
    return;
  }

  if (url === '/api/skills' && method === 'GET') {
    listSkills(res);
    return;
  }

  // --- static fallback ---
  if (method === 'GET') {
    serveStatic(req, res);
    return;
  }

  json(res, 404, { error: 'Not found' });
 } catch (err) {
  // A throw in any handler must not crash the process — one bad request != full outage.
  try { json(res, 500, { error: `Internal error: ${err.message}` }); } catch (_) {}
 }
});

// Malformed HTTP (bad request line/headers) must not crash the server either.
server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) {}
});

server.listen(PORT, HOST, () => {
  console.log(`Rabbit Flow Designer running at http://${HOST}:${PORT}`);
  console.log(`  Static: ${FRONTEND_DIR}`);
  console.log(`  Workflows: ${WORKFLOWS_DIR}`);
});
