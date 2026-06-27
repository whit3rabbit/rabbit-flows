// bundle.js — assemble a one-workflow .zip bundle (workflow + its skills/agents) for download.
// Node-only. Uses the VENDORED fflate (frontend/vendor/fflate.module.js) so `node server.js`
// still needs no `npm install` — same "committed on purpose, re-download to upgrade" rule as the
// vendored React/ReactFlow. This is the first server-side vendored import; the reason is to add
// .zip support without breaking the zero-npm-runtime-dep server.
//
// Threat model is lighter than IMPORT: we read files we already expose (GET /api/workflows/:name,
// GET /api/skills) from the trusted local repo. We still confine reads to WORKFLOWS_DIR/SKILL_ROOTS/
// AGENTS_DIR and validate every name, so a crafted workflow header can't pull arbitrary paths.

import fs from 'fs';
import path from 'path';

import { WORKFLOWS_DIR, SKILL_ROOTS, AGENTS_DIR } from './config.js';
import { sanitizeWorkflowName } from './security.js';
import { zipSync } from '../../vendor/fflate.module.js';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
// Don't ship local build/venv noise — it bloats the zip and leaks absolute paths from this machine.
const EXCLUDE = new Set(['.venv', '__pycache__', 'node_modules', '.git', '.DS_Store']);

const enc = (s) => new TextEncoder().encode(s);

// Parse a "// requires-skills: a, b" / "// requires-agents: x" header. [] when absent.
function parseRequires(src, key) {
  const m = src.match(new RegExp(`//\\s*requires-${key}:\\s*(.*)`, 'i'));
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// Recursively collect a directory's regular files into `files` under `prefix`, skipping EXCLUDE.
function walkInto(files, dir, prefix) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    const rel = `${prefix}/${ent.name}`;
    if (ent.isSymbolicLink()) continue; // never follow links out of the skill dir
    if (ent.isDirectory()) walkInto(files, abs, rel);
    else if (ent.isFile()) files[rel] = new Uint8Array(fs.readFileSync(abs));
  }
}

// Resolve a skill directory from the SKILL_ROOTS (first root that has it wins, like listSkills).
function findSkillDir(name) {
  for (const root of SKILL_ROOTS) {
    const dir = path.join(root, name);
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir;
  }
  return null;
}

// gatherBundle(workflowName) -> { buffer, filename }. Throws { status, message } on bad input.
export function gatherBundle(workflowName) {
  let safe;
  try {
    safe = sanitizeWorkflowName(workflowName.endsWith('.js') ? workflowName : workflowName + '.js');
  } catch (e) {
    throw { status: 400, message: `invalid workflow name: ${e.message}` };
  }
  const base = safe.replace(/\.js$/, '');
  if (!NAME_RE.test(base)) throw { status: 400, message: `workflow name must match ${NAME_RE}` };

  const wfPath = path.join(WORKFLOWS_DIR, safe);
  let source;
  try {
    source = fs.readFileSync(wfPath, 'utf8');
  } catch (_) {
    throw { status: 404, message: `workflow not found: ${safe}` };
  }

  const skills = parseRequires(source, 'skills');
  const agents = parseRequires(source, 'agents');
  for (const n of [...skills, ...agents]) {
    if (!NAME_RE.test(n)) throw { status: 400, message: `invalid dependency name in header: "${n}"` };
  }

  const files = {
    [`workflows/${base}.js`]: enc(source),
  };
  for (const s of skills) {
    const dir = findSkillDir(s);
    if (!dir) throw { status: 404, message: `skill "${s}" not found in any skill root` };
    walkInto(files, dir, `skills/${s}`);
  }
  for (const a of agents) {
    const ap = path.join(AGENTS_DIR, `${a}.md`);
    if (!fs.existsSync(ap)) throw { status: 404, message: `agent "${a}" not found` };
    files[`agents/${a}.md`] = new Uint8Array(fs.readFileSync(ap));
  }

  // Recompute the manifest from validated names — the importer recomputes `file` too.
  const description = (source.match(/description:\s*['"]([^'"]*)['"]/) || [])[1] || '';
  const manifest = {
    format: 1,
    workflows: [{ name: base, file: `workflows/${base}.js`, description, skills, agents }],
    skills,
    agents,
  };
  files['bundle.json'] = enc(JSON.stringify(manifest, null, 2));

  return { buffer: Buffer.from(zipSync(files)), filename: `${base}-bundle.zip` };
}
