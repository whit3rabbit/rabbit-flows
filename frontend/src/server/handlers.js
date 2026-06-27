// handlers.js — route handlers for the Rabbit Flow Designer API + static serving.
// Node-only. No external deps beyond stdlib.

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';

import { FRONTEND_DIR, WORKFLOWS_DIR, SKILL_ROOTS, VALIDATE_PY } from './config.js';
import { json, notFound, readBody, mimeFor } from './http-util.js';
import { sanitizeWorkflowName } from './security.js';
import { gatherBundle } from './bundle.js';

// GET /api/workflows — list .js basenames
export function listWorkflows(res) {
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
export function readWorkflow(res, name) {
  // Route through the single audited validator (rejects separators, "..", non-.js) so the
  // read path can't drift from the write path's traversal guard.
  let safeName;
  try {
    safeName = sanitizeWorkflowName(name);
  } catch (_) {
    notFound(res, 'Invalid workflow name');
    return;
  }
  const filePath = path.join(WORKFLOWS_DIR, safeName);
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') notFound(res, `Workflow not found: ${safeName}`);
    else json(res, 500, { error: err.message });
    return;
  }
  json(res, 200, { name: safeName, source });
}

// POST /api/workflows/:name — write a workflow file into .claude/workflows/ only.
export function writeWorkflow(req, res, name) {
  // Sanitize — reject traversal/separators/non-.js
  let safeName;
  try {
    safeName = sanitizeWorkflowName(name);
  } catch (err) {
    json(res, 400, { error: `Invalid workflow name: ${err.message}` });
    return;
  }

  const target = path.resolve(WORKFLOWS_DIR, safeName);
  // Assert confinement: target === expected basename path, inside WORKFLOWS_DIR.
  const expected = path.join(WORKFLOWS_DIR, safeName);
  if (target !== expected || !target.startsWith(WORKFLOWS_DIR + path.sep)) {
    // Should never happen after sanitize, but belt-and-suspenders
    json(res, 400, { error: 'Path confinement check failed' });
    return;
  }

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
// return { ok: bool, output: string }. The temp file is always cleaned up.
export function validateWorkflow(req, res) {
  readBody(req, res, (body) => {
    if (!fs.existsSync(VALIDATE_PY)) {
      json(res, 500, { ok: false, output: `validate.py not found at ${VALIDATE_PY}` });
      return;
    }

    // Body is JSON {source}; extract the workflow code. (Fall back to raw body for a
    // bare-text POST.) Writing the JSON wrapper itself made validate.py see `{"source":...`
    // and always fail with "no meta block" / "Unexpected token ':'".
    let source;
    try {
      source = body.trim().startsWith('{') ? JSON.parse(body).source : body;
    } catch (_) { source = body; }
    if (typeof source !== 'string' || !source.trim()) {
      json(res, 400, { ok: false, output: 'POST body must be JSON {"source": "<workflow code>"}' });
      return;
    }

    // Write candidate to a tmp file with a .js extension so validate.py picks it up.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-validate-'));
    const tmpFile = path.join(tmpDir, '_candidate.js');
    try {
      fs.writeFileSync(tmpFile, source, 'utf8');
    } catch (err) {
      json(res, 500, { ok: false, output: `Failed to write temp file: ${err.message}` });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      return;
    }

    const result = spawnSync('python3', [VALIDATE_PY, tmpFile, '--strict'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (result.error) {
      json(res, 500, { ok: false, output: `Failed to run validate.py: ${result.error.message}` });
      return;
    }

    const output = (result.stdout || '') + (result.stderr || '');
    json(res, 200, { ok: result.status === 0, output });
  });
}

// Parse YAML frontmatter: returns {name, description} if name present, else null.
// Handles quoted/unquoted single-line values AND block scalars (`description: |` / `>`).
function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 1) return null;
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

// GET /api/skills — scan SKILL_ROOTS for SKILL.md, dedupe by name (first root wins),
// return sorted JSON array of {name, description}.
export function listSkills(res) {
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
      if (!seen.has(parsed.name)) seen.set(parsed.name, parsed);
    }
  }

  const skills = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  json(res, 200, skills);
}

// GET /api/bundle/:name — stream a .zip bundling the workflow + its declared skills/agents.
// Read-tier (no mutation token): it only reads files already exposed by /api/workflows/:name and
// /api/skills and builds the zip in-process (no child spawn, no write). Same-origin still applies.
export function exportBundle(res, name) {
  let out;
  try {
    out = gatherBundle(name);
  } catch (e) {
    if (e && e.status) json(res, e.status, { error: e.message });
    else json(res, 500, { error: `bundle failed: ${e && e.message ? e.message : e}` });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${out.filename}"`,
    'Content-Length': out.buffer.length,
  });
  res.end(out.buffer);
}

// Text types worth gzipping; binary (png/ico) is already compressed, skip it.
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg', '.txt']);

// Serve a static file from FRONTEND_DIR (with a path-traversal guard).
export function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/flow.html';

  const filePath = path.join(FRONTEND_DIR, urlPath);
  // Path traversal guard: resolved path must stay inside FRONTEND_DIR
  if (!filePath.startsWith(FRONTEND_DIR + path.sep) && filePath !== FRONTEND_DIR) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Allowlist the SPA's real assets only. The traversal guard keeps requests inside FRONTEND_DIR,
  // but that still exposes server.js, src/server/*.js, package.json, configs, and tests over GET.
  // Checked on the RESOLVED relative path so `/src/../server.js` can't sneak past a urlPath prefix.
  const rel = path.relative(FRONTEND_DIR, filePath);
  const srcPrefix = 'src' + path.sep;
  const serverPrefix = path.join('src', 'server') + path.sep;
  const allowed =
    rel === 'flow.html' ||
    rel === 'parser.js' ||
    rel.startsWith('vendor' + path.sep) ||
    (rel.startsWith(srcPrefix) && !rel.startsWith(serverPrefix));
  if (!allowed) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 Not Found'); }
      else { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('500 Internal Server Error'); }
      return;
    }
    // No CORS header: same-origin SPA only. Keeps a cross-origin page from reading the
    // server's own source (security.js/config.js), package.json, or node_modules.
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': mimeFor(filePath) };
    // Vendored deps are pinned + content-immutable (re-download to upgrade), so cache them
    // hard — warm loads then skip ~300 KB of React/ReactFlow. App source must revalidate so
    // live edits show up.
    headers['Cache-Control'] = urlPath.startsWith('/vendor/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';

    // gzip on the fly when the client accepts it. zlib is stdlib (no new dep); the files are
    // small and this is a single-user dev tool, so per-request compression is cheap and the
    // immutable vendor cache means the heavy assets compress at most once per browser.
    // ponytail: gzipSync per request, no compressed-buffer cache — add one if traffic grows.
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && COMPRESSIBLE.has(ext) && data.length > 1024) {
      const gz = zlib.gzipSync(data);
      res.writeHead(200, {
        ...headers,
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
        'Content-Length': gz.length,
      });
      res.end(gz);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    res.end(data);
  });
}
