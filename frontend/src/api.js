// api.js — all fetch calls to the backend (server.js).
// Reads the auth token from localStorage so mutating routes work from non-loopback origins.

const authHeaders = () => {
  try {
    const t = localStorage.getItem('rfd_token');
    return t ? { Authorization: 'Bearer ' + t } : {};
  } catch (_) {
    return {};
  }
};

// fetchWorkflowList — GET /api/workflows → string[] of .js basenames.
// Returns [] on failure (server not running).
export async function fetchWorkflowList() {
  try {
    const r = await fetch('/api/workflows');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const list = await r.json();
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

// fetchWorkflowSource — GET /api/workflows/:name → { name, source }.
export async function fetchWorkflowSource(name) {
  const r = await fetch('/api/workflows/' + encodeURIComponent(name));
  if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + name);
  return r.json();
}

// saveWorkflow — POST /api/workflows/:name with generated source.
// Pass overwrite=true to append ?overwrite=1.
// Returns the parsed JSON response.
export async function saveWorkflow(fname, src, overwrite) {
  const url = '/api/workflows/' + encodeURIComponent(fname) + (overwrite ? '?overwrite=1' : '');
  const r = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'text/plain' }, authHeaders()),
    body: src,
  });
  return r.json().then((data) => ({ data, status: r.status }));
}

// validateSource — POST /api/validate → { ok, output }.
export async function validateSource(src) {
  const r = await fetch('/api/validate', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'text/plain' }, authHeaders()),
    body: src,
  });
  return r.json();
}

// fetchSkillCatalog — GET /api/skills → [{name, description}].
// Returns [] on failure.
export async function fetchSkillCatalog() {
  try {
    const r = await fetch('/api/skills');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const list = await r.json();
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}
