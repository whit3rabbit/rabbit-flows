// http-util.js — transport helpers: content-type map, JSON responses, capped body reader.
// Node-only. No external deps.

import path from 'path';

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

export function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  // No CORS header: the SPA is served same-origin, so it needs none. Omitting it stops a
  // cross-origin page from reading API responses (workflow source / skill catalog).
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function notFound(res, msg) {
  json(res, 404, { error: msg || 'Not found' });
}

// Read a request body with a hard size cap (workflow sources are small; reject the rest
// so a multi-GB chunked upload can't exhaust the heap). Calls onDone(body) once, on success.
const MAX_BODY = 2 * 1024 * 1024; // 2 MB
export function readBody(req, res, onDone) {
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
