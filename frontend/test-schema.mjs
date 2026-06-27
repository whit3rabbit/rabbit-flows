/**
 * test-schema.mjs — schema.js self-checks.
 * Run: node frontend/test-schema.mjs   (exits 0 on pass, 1 on failure)
 *
 * Proves:
 *   SC1  every .claude/workflows/*.js parses to a graph that passes validateGraph()
 *   SC2  the handle inventory matches the documented connection-point counts
 *   SC3  connection rules accept the legal pairs and reject the illegal ones
 *   SC4  validateGraph() actually rejects malformed graphs (not a rubber stamp)
 */

import { parseWorkflow } from './parser.js';
import {
  validateGraph, edgeTypeFor, connectionAllowed,
  handleCount, canSource, canTarget, NODE_KINDS, EDGE_TYPES,
} from './src/schema.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dir, '..', '.claude', 'workflows');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('PASS:', msg); }
}

// ── SC1: every real workflow parses to a conformant graph ──────────────────
const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.js')).sort();
assert(files.length >= 10, `found ${files.length} workflow files (expected >= 10)`);
for (const f of files) {
  const g = parseWorkflow(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'));
  const r = validateGraph(g);
  assert(r.ok, `${f}: graph conforms to schema` + (r.ok ? '' : ' -> ' + JSON.stringify(r.errors)));
  // Sanity: the parser only ever emits kinds/edge-types that the schema knows.
  const badKind = g.nodes.find((n) => !NODE_KINDS.includes(n.kind));
  assert(!badKind, `${f}: no node with an unknown kind`);
  const badEdge = g.edges.find((e) => !EDGE_TYPES.includes(e.type));
  assert(!badEdge, `${f}: no edge with an unknown type`);
}

// ── SC2: handle counts (the "number of node points" the request asked for) ──
assert(handleCount('agent') === 2 && canSource('agent') && canTarget('agent'), 'agent has 2 handles (in+out)');
assert(handleCount('gate') === 2, 'gate has 2 handles');
assert(handleCount('trigger') === 1 && canSource('trigger') && !canTarget('trigger'), 'trigger has 1 handle (source only)');
assert(handleCount('phase') === 1 && canTarget('phase') && !canSource('phase'), 'phase has 1 handle (target only)');
assert(handleCount('skill') === 2 && canSource('skill'), 'skill has 2 handles (side source + hidden target)');
assert(handleCount('knob') === 2 && canSource('knob'), 'knob has 2 handles (side source + hidden target)');

// ── SC3: connection rules — legal accepted, illegal rejected ───────────────
assert(edgeTypeFor('agent', 'gate') === 'flow', 'agent -> gate is a flow edge');
assert(edgeTypeFor('trigger', 'agent') === 'flow', 'trigger -> agent is a flow edge');
assert(edgeTypeFor('parallel', 'agent') === 'flow', 'parallel container -> lane is a flow edge');
assert(edgeTypeFor('skill', 'agent') === 'skill', 'skill -> agent is a skill edge');
assert(edgeTypeFor('knob', 'gate') === 'data', 'knob -> gate is a data edge');
assert(!connectionAllowed('agent', 'trigger'), 'agent -> trigger rejected (trigger is target-less)');
assert(!connectionAllowed('phase', 'agent'), 'phase -> agent rejected (phase is source-less)');
assert(!connectionAllowed('skill', 'phase'), 'skill -> phase rejected (skill only attaches to agent/gate)');

// ── SC4: validateGraph is not a rubber stamp ───────────────────────────────
assert(!validateGraph({ nodes: [{ id: 'a', kind: 'bogus', label: 'x', x: 0, y: 0, w: 1, h: 1 }], edges: [] }).ok,
  'unknown node kind rejected');
assert(!validateGraph({
  nodes: [{ id: 'a', kind: 'agent', label: 'x', x: 0, y: 0, w: 1, h: 1 },
          { id: 'b', kind: 'agent', label: 'y', x: 0, y: 0, w: 1, h: 1 }],
  edges: [{ id: 'e', from: 'a', to: 'b', type: 'skill' }],
}).ok, 'skill edge between two agents rejected (skill must start at a skill node)');
assert(!validateGraph({
  nodes: [{ id: 'a', kind: 'agent', label: 'x', x: 0, y: 0, w: 1, h: 1 }],
  edges: [{ id: 'e', from: 'a', to: 'missing', type: 'flow' }],
}).ok, 'edge to a missing node rejected');
assert(validateGraph({
  nodes: [{ id: 'a', kind: 'agent', label: 'x', model: 'sonnet', schema: null, phase: null, detail: null, body: null, x: 0, y: 0, w: 1, h: 1 }],
  edges: [],
}).ok, 'a minimal well-formed graph is accepted');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll schema checks passed.');
process.exit(failures ? 1 : 0);
