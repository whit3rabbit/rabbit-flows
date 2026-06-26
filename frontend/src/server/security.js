// security.js — name sanitisation + mutation authorisation for the server.
// Node-only. No external deps beyond stdlib crypto/path.
//
// The write and validate routes persist executable workflow files and spawn validate.py, so
// a network-reachable peer must not reach them unauthenticated (unauthenticated POST
// /api/workflows/:name is stored code injection once the server is non-loopback). Policy:
// loopback peers are trusted (the default local-dev path, zero config); any other peer must
// present `Authorization: Bearer <RFD_TOKEN>`. If RFD_TOKEN is unset, remote mutations are
// refused outright — there is no token to match, so the server cannot be opened by accident.

import path from 'path';
import crypto from 'crypto';
import { AUTH_TOKEN } from './config.js';

// sanitizeWorkflowName: rejects names with path separators, null bytes, absolute paths,
// non-.js extensions, or any component that is not a plain basename. Returns the basename
// string on success; throws an Error with a reason string on rejection.
export function sanitizeWorkflowName(name) {
  if (!name || typeof name !== 'string') throw new Error('name required');
  if (name.includes('\0')) throw new Error('null byte in name');
  if (name.includes('/') || name.includes('\\')) throw new Error('path separator in name');
  if (path.isAbsolute(name)) throw new Error('absolute path not allowed');
  if (name === '..' || name.startsWith('../') || name.startsWith('..\\')) {
    throw new Error('traversal component ".." not allowed');
  }
  if (!name.endsWith('.js')) throw new Error('name must end with .js');
  // basename must equal the name itself (no directory component slipped through)
  const base = path.basename(name);
  if (base !== name) throw new Error('name must be a plain basename, no directory component');
  if (base.length <= 3) throw new Error('name too short'); // disallow just ".js"
  return base;
}

export function isLoopbackPeer(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

export function tokenMatches(presented) {
  if (!AUTH_TOKEN || !presented) return false;
  const a = Buffer.from(presented), b = Buffer.from(AUTH_TOKEN);
  // Constant-time compare; timingSafeEqual throws on length mismatch, so guard it.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns true if this request may mutate. Loopback always passes; otherwise a valid bearer token.
export function mutationAuthorized(req) {
  if (isLoopbackPeer(req)) return true;
  const m = (req.headers['authorization'] || '').match(/^Bearer\s+(.+)$/);
  return tokenMatches(m && m[1]);
}

// originAllowed: reject a state-changing request whose Origin is a different site. This closes
// the CSRF-to-loopback hole — loopback trust alone is NOT enough, because the victim's own
// browser connects to 127.0.0.1 from loopback, so a malicious page could otherwise forge a
// "trusted" mutation. Browsers always attach Origin to a cross-origin request and a page cannot
// spoof it; non-browser clients (curl, node) send no Origin and are allowed (they still face the
// loopback/token check above). The SPA is same-origin, so its Origin host matches Host.
export function originAllowed(req) {
  const origin = req.headers['origin'];
  if (!origin) return true; // not a browser cross-site request
  let host;
  try { host = new URL(origin).host; } catch (_) { return false; }
  return host === req.headers['host'];
}
