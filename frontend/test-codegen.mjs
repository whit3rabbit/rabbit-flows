/**
 * test-codegen.mjs — genCode() self-checks.
 * Run: node frontend/test-codegen.mjs   (exits 0 on pass, 1 on failure)
 *
 * Guards the leaf->container grouping in codegen.js (the cidById/contBounds precompute):
 *   CG1  two agents whose centres fall inside a parallel container are grouped into one
 *        `parallel([...])` fan-out, and a gate outside is emitted as a standalone agent call.
 *   CG2  move the container away so the agents fall OUTSIDE it -> no parallel block, all three
 *        leaves standalone. Proves containment is actually tested, not assumed.
 */

import { genCode } from './src/codegen.js';
import assert from 'assert';

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('  ok  ' + name); } catch (e) { failures++; console.error('FAIL  ' + name + '\n      ' + e.message); } };

// Node factory — mirrors the shape canvas.js produces (style carries stamped dims).
const node = (id, kind, x, y, extra = {}) => ({
  id, type: kind, position: { x, y },
  style: { width: extra.w || 234, height: extra.h || 84 },
  data: { kind, label: extra.label || id, model: extra.model || null, schema: null, phase: null, detail: null, body: null },
});

// parallel container at (100,100), 400x300 -> bounds x:[100,500] y:[100,400].
const container = node('p1', 'parallel', 100, 100, { w: 400, h: 300, label: 'Fan out' });
// two agents whose CENTRES (pos + dim/2) land inside the container.
const agentA = node('a1', 'agent', 200, 150, { label: 'alpha' }); // centre ~317,192
const agentB = node('a2', 'agent', 200, 260, { label: 'beta' });  // centre ~317,302
// a gate whose centre is well to the right -> outside the container.
const gate = node('g1', 'gate', 700, 120, { label: 'check' });    // centre ~817,162

check('CG1 agents inside container -> grouped parallel, gate standalone', () => {
  const code = genCode([container, agentA, agentB, gate], [], 'wf', 'desc', []);
  assert(code.includes('parallel(['), 'expected a parallel([ block for the grouped agents');
  // both grouped agents appear as thunks inside the fan-out
  assert(/\(\)\s*=>\s*agent\(/.test(code), 'expected () => agent( thunks in the parallel block');
  assert(code.includes('alpha') && code.includes('beta'), 'both grouped agent labels should be present');
  // the gate (outside) is emitted as a standalone awaited call, not a thunk
  assert(/const \w+ = await agent\(/.test(code), 'expected a standalone `const X = await agent(` for the gate');
});

check('CG2 container moved away -> no parallel, all leaves standalone', () => {
  const farContainer = node('p1', 'parallel', 2000, 2000, { w: 400, h: 300, label: 'Fan out' });
  const code = genCode([farContainer, agentA, agentB, gate], [], 'wf', 'desc', []);
  assert(!code.includes('parallel(['), 'no agent centre is inside the container, so there should be no parallel block');
  const standalone = (code.match(/const \w+ = await agent\(/g) || []).length;
  assert(standalone >= 3, 'all three leaves should be standalone awaited calls, got ' + standalone);
});

if (failures) { console.error('\n' + failures + ' codegen check(s) failed'); process.exit(1); }
console.log('\nall codegen checks passed');
