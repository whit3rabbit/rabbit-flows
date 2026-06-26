#!/usr/bin/env node
// frontend/server.js — stdlib HTTP server for the Rabbit Flow Designer SPA.
// No external deps. Serves frontend/ static files + JSON API for .claude/workflows/*.js.
//
// API surface:
//   GET /api/workflows          — list basenames of .claude/workflows/*.js
//   GET /api/workflows/:name    — read one workflow (returns {name, source})
//   POST /api/workflows/:name   — write body to .claude/workflows/:name (path-traversal-guarded)
//   POST /api/validate          — write body to tmp file, run validate.py --strict, return {ok, output}
//   GET /api/skills             — list skills ({name, description}[]) from both skill roots
//   *                           — static files from this directory

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Resolve paths relative to THIS file so the server works from any cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = __dirname;
// Repo root: two levels up from frontend/
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.claude', 'workflows');

// Both roots where SKILL.md files live. Dedupe by name (first wins).
const SKILL_ROOTS = [
  path.join(REPO_ROOT, '.claude', 'skills'),
  path.join(REPO_ROOT, 'plugins', 'workflow-kit', 'skills'),
];

const PORT = parseInt(process.env.PORT || '3001', 10);

// --- content-type map for static serving ---
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// --- JSON helpers ---
function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function notFound(res, msg) {
  json(res, 404, { error: msg || 'Not found' });
}

// Read a request body with a hard size cap (workflow sources are small; reject the rest
// so a multi-GB chunked upload can't exhaust the heap). Calls onDone(body) once, on success.
const MAX_BODY = 2 * 1024 * 1024; // 2 MB
function readBody(req, res, onDone) {
  let body = '', aborted = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (aborted) return;
    body += chunk;
    if (body.length > MAX_BODY) {
      aborted = true;
      json(res, 413, { error: 'Request body too large (max 2 MB)' });
      req.destroy();
    }
  });
  req.on('end', () => { if (!aborted) onDone(body); });
  req.on('error', (err) => { if (!aborted) { aborted = true; json(res, 500, { error: `Request read error: ${err.message}` }); } });
}

// --- security helpers ---

// sanitizeWorkflowName: rejects names with path separators, null bytes, absolute paths,
// non-.js extensions, or any component that is not a plain basename. Returns the basename
// string on success; throws an Error with a reason string on rejection.
function sanitizeWorkflowName(name) {
  if (!name || typeof name !== 'string') throw new Error('name required');
  // Reject null bytes
  if (name.includes('\0')) throw new Error('null byte in name');
  // Reject path separators (both POSIX and Windows)
  if (name.includes('/') || name.includes('\\')) throw new Error('path separator in name');
  // Reject absolute paths (POSIX: starts with '/'; Windows: e.g. 'C:')
  if (path.isAbsolute(name)) throw new Error('absolute path not allowed');
  // Reject '..' traversal component
  if (name === '..' || name.startsWith('../') || name.startsWith('..\\')) {
    throw new Error('traversal component ".." not allowed');
  }
  // Must end in .js
  if (!name.endsWith('.js')) throw new Error('name must end with .js');
  // basename must equal the name itself (no directory component slipped through)
  const base = path.basename(name);
  if (base !== name) throw new Error('name must be a plain basename, no directory component');
  // Disallow empty stem (e.g. just ".js")
  if (base.length <= 3) throw new Error('name too short');
  return base;
}

// --- auth for mutating endpoints ---
// The write and validate routes persist executable workflow files and spawn validate.py, so
// a network-reachable peer must not reach them unauthenticated (the F1 finding: unauthenticated
// POST /api/workflows/:name is stored code injection once the server is non-loopback). Policy:
// loopback peers are trusted (the default local-dev path, zero config); any other peer must
// present `Authorization: Bearer <RFD_TOKEN>`. If RFD_TOKEN is unset, remote mutations are
// refused outright — there is no token to match, so the server cannot be opened by accident.
const AUTH_TOKEN = process.env.RFD_TOKEN || '';

function isLoopbackPeer(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function tokenMatches(presented) {
  if (!AUTH_TOKEN || !presented) return false;
  const a = Buffer.from(presented), b = Buffer.from(AUTH_TOKEN);
  // Constant-time compare; timingSafeEqual throws on length mismatch, so guard it.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns true if this request may mutate. Loopback always passes; otherwise a valid bearer token.
function mutationAuthorized(req) {
  if (isLoopbackPeer(req)) return true;
  const m = (req.headers['authorization'] || '').match(/^Bearer\s+(.+)$/);
  return tokenMatches(m && m[1]);
}

// --- route handlers ---

// GET /api/workflows — list .js basenames
function listWorkflows(res) {
  let files;
  try {
    files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.js'));
  } catch (err) {
    json(res, 500, { error: `Cannot read workflows dir: ${err.message}` });
    return;
  }
  json(res, 200, files.sort());
}

// GET /api/workflows/:name — read one workflow
function readWorkflow(res, name) {
  // Sanitize: only allow bare filenames (no slashes, must end in .js)
  if (!name || name.includes('/') || name.includes('\\') || !name.endsWith('.js')) {
    notFound(res, 'Invalid workflow name');
    return;
  }
  const filePath = path.join(WORKFLOWS_DIR, name);
  // Verify the resolved path stays inside WORKFLOWS_DIR (path traversal guard)
  if (!filePath.startsWith(WORKFLOWS_DIR + path.sep) && filePath !== WORKFLOWS_DIR) {
    notFound(res, 'Invalid workflow name');
    return;
  }
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      notFound(res, `Workflow not found: ${name}`);
    } else {
      json(res, 500, { error: err.message });
    }
    return;
  }
  json(res, 200, { name, source });
}

// POST /api/workflows/:name — write a workflow file into .claude/workflows/ only.
// Bites 2-5: resolve target, assert confinement, write body, return {path, ok:true}.
function writeWorkflow(req, res, name) {
  // Bite 1: sanitize — reject traversal/separators/non-.js
  let safeName;
  try {
    safeName = sanitizeWorkflowName(name);
  } catch (err) {
    json(res, 400, { error: `Invalid workflow name: ${err.message}` });
    return;
  }

  // Bite 2: resolve target = path.resolve(WORKFLOWS_DIR, name)
  const target = path.resolve(WORKFLOWS_DIR, safeName);

  // Bite 3: assert target === path.join(WORKFLOWS_DIR, basename) and startsWith WORKFLOWS_DIR + sep
  const expected = path.join(WORKFLOWS_DIR, safeName);
  if (target !== expected || !target.startsWith(WORKFLOWS_DIR + path.sep)) {
    // Should never happen after sanitize, but belt-and-suspenders
    json(res, 400, { error: 'Path confinement check failed' });
    return;
  }

  // Bite 4: read request body (size-capped) and write
  readBody(req, res, (body) => {
    // Refuse to clobber an existing workflow unless ?overwrite=1. The graph->code
    // round-trip is lossy (heuristic parser), so a blind save over a real file
    // would silently replace it with a stub. 'wx' fails with EEXIST if present.
    const force = /[?&]overwrite=1\b/.test(req.url || '');
    try {
      fs.writeFileSync(target, body, force ? { encoding: 'utf8' } : { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') {
        json(res, 409, { error: `${safeName} already exists; re-save with overwrite to replace it` });
        return;
      }
      json(res, 500, { error: `Write failed: ${err.message}` });
      return;
    }
    json(res, 200, { path: target, ok: true, overwritten: force });
  });
}

// POST /api/validate — write candidate source to a temp file, run validate.py --strict,
// return { ok: bool, output: string (validator stdout+stderr) }.
// The temp file is always cleaned up; it never touches WORKFLOWS_DIR.
const VALIDATE_PY = path.join(REPO_ROOT, '.claude', 'skills', 'dynamic-workflow-authoring', 'scripts', 'validate.py');

function validateWorkflow(req, res) {
  readBody(req, res, (body) => {
    // Validate that the validate.py script exists before proceeding
    if (!fs.existsSync(VALIDATE_PY)) {
      json(res, 500, { ok: false, output: `validate.py not found at ${VALIDATE_PY}` });
      return;
    }

    // Body is JSON {source}; extract the workflow code. (Fall back to raw body
    // for a bare-text POST.) Writing the JSON wrapper itself made validate.py see
    // `{"source":...` and always fail with "no meta block" / "Unexpected token ':'".
    let source;
    try {
      source = body.trim().startsWith('{') ? JSON.parse(body).source : body;
    } catch (_) { source = body; }
    if (typeof source !== 'string' || !source.trim()) {
      json(res, 400, { ok: false, output: 'POST body must be JSON {"source": "<workflow code>"}' });
      return;
    }

    // Write candidate to a tmp file with a .js extension so validate.py picks it up
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-validate-'));
    const tmpFile = path.join(tmpDir, '_candidate.js');
    try {
      fs.writeFileSync(tmpFile, source, 'utf8');
    } catch (err) {
      json(res, 500, { ok: false, output: `Failed to write temp file: ${err.message}` });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      return;
    }

    // Run: python3 validate.py <tmpFile> --strict
    const result = spawnSync('python3', [VALIDATE_PY, tmpFile, '--strict'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    // Clean up temp file
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (result.error) {
      json(res, 500, { ok: false, output: `Failed to run validate.py: ${result.error.message}` });
      return;
    }

    const output = (result.stdout || '') + (result.stderr || '');
    const ok = result.status === 0;
    json(res, 200, { ok, output });
  });
}

// GET /api/skills — scan SKILL_ROOTS for SKILL.md files, extract name+description,
// dedupe by name (first root wins), return sorted JSON array of {name, description}.
function listSkills(res) {
  // Parse YAML frontmatter: returns {name, description} if both present, else null.
  function parseFrontmatter(text) {
    const lines = text.split('\n');
    if (lines[0].trim() !== '---') return null;
    const end = lines.indexOf('---', 1);
    if (end < 1) return null;
    // Key: value extraction — handles quoted/unquoted single-line values AND YAML block
    // scalars (`description: |` / `>` followed by indented continuation lines).
    const fmLines = lines.slice(1, end);
    let name = null, description = null;
    for (let li = 0; li < fmLines.length; li++) {
      const m = fmLines[li].match(/^(name|description):\s*(.*)/);
      if (!m) continue;
      let val = m[2].trim();
      if (/^[|>][+-]?$/.test(val)) {
        // Block scalar: gather following more-indented (or blank) lines.
        const collected = [];
        for (let k = li + 1; k < fmLines.length; k++) {
          if (/^\s+\S/.test(fmLines[k]) || fmLines[k].trim() === '') collected.push(fmLines[k].trim());
          else break;
        }
        val = collected.join(' ').trim();
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
      if (m[1] === 'name') name = val;
      if (m[1] === 'description') description = val;
    }
    if (!name) return null;
    return { name, description: description || '' };
  }

  const seen = new Map(); // name -> skill object; first root wins
  for (const root of SKILL_ROOTS) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (_) {
      continue; // root absent — skip
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(root, entry.name, 'SKILL.md');
      let text;
      try {
        text = fs.readFileSync(skillFile, 'utf8');
      } catch (_) {
        continue; // no SKILL.md — skip
      }
      const parsed = parseFrontmatter(text);
      if (!parsed) continue;
      if (!seen.has(parsed.name)) {
        seen.set(parsed.name, parsed);
      }
    }
  }

  const skills = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  json(res, 200, skills);
}

// Serve a static file from FRONTEND_DIR
function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  // Default to the real app (flow.html). index.html is an older mockup with a missing dep.
  if (urlPath === '/') urlPath = '/flow.html';

  const filePath = path.join(FRONTEND_DIR, urlPath);
  // Path traversal guard: resolved path must stay inside FRONTEND_DIR
  if (!filePath.startsWith(FRONTEND_DIR + path.sep) && filePath !== FRONTEND_DIR) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

// --- main dispatcher ---
const server = http.createServer((req, res) => {
 try {
  const url = req.url.split('?')[0];
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // --- API routes ---
  if (url === '/api/workflows' && method === 'GET') {
    listWorkflows(res);
    return;
  }

  const workflowMatch = url.match(/^\/api\/workflows\/([^/]+)$/);
  if (workflowMatch) {
    const name = decodeURIComponent(workflowMatch[1]);
    if (method === 'GET') {
      readWorkflow(res, name);
      return;
    }
    if (method === 'POST') {
      if (!mutationAuthorized(req)) { json(res, 401, { error: 'Unauthorized: remote mutations require a Bearer RFD_TOKEN' }); return; }
      writeWorkflow(req, res, name);
      return;
    }
  }

  if (url === '/api/validate' && method === 'POST') {
    if (!mutationAuthorized(req)) { json(res, 401, { error: 'Unauthorized: remote mutations require a Bearer RFD_TOKEN' }); return; }
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

// Bind to loopback by default — this server WRITES executable workflow files and runs
// validate.py, so it must not be reachable from the network. Set HOST=0.0.0.0 to override.
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`Rabbit Flow Designer running at http://${HOST}:${PORT}`);
  console.log(`  Static: ${FRONTEND_DIR}`);
  console.log(`  Workflows: ${WORKFLOWS_DIR}`);
});
