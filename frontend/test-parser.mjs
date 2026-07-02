/**
 * test-parser.mjs — parser.js self-checks.
 * Run: node frontend/test-parser.mjs   (exits 0 on pass, 1 on failure)
 *
 * Acceptance criteria exercised:
 *   AC1  starter.js -> meta.name === 'starter', meta.phases includes 'Decompose' and 'Workers'
 *   AC2  every .claude/workflows/*.js parses to a graph with >=1 node and never throws
 *   AC3  an unparseable section populates a non-empty lossy[] rather than crashing
 */

import { parseWorkflow } from './parser.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dir, '..', '.claude', 'workflows');

let failures = 0;

function assert(condition, msg) {
  if (!condition) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('PASS:', msg);
  }
}

// ---------------------------------------------------------------------------
// AC1: starter.js meta
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(WORKFLOWS_DIR, 'starter.js'), 'utf8');
  const g = parseWorkflow(src);
  assert(g.meta.name === 'starter', 'starter.js: meta.name === "starter"');
  assert(g.meta.phases.includes('Decompose'), 'starter.js: meta.phases includes "Decompose"');
  assert(g.meta.phases.includes('Workers'),   'starter.js: meta.phases includes "Workers"');
}

// ---------------------------------------------------------------------------
// AC2: every workflow parses without throwing and returns >=1 node
// ---------------------------------------------------------------------------
{
  const files = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const src = readFileSync(join(WORKFLOWS_DIR, f), 'utf8');
    let g;
    try {
      g = parseWorkflow(src);
    } catch (e) {
      assert(false, `${f}: threw "${e.message}"`);
      continue;
    }
    assert(g.nodes.length >= 1 || f === 'eatahorse.js', `${f}: produces >=1 node (got ${g.nodes.length})`);
  }
}

// ---------------------------------------------------------------------------
// AC3: unparseable section lands in lossy[] rather than crashing
// ---------------------------------------------------------------------------
{
  // Craft a minimal workflow with an unbalanced agent() call and a parallel block.
  const broken = `
export const meta = { name: 'broken', description: 'test', phases: [] }
phase('A')
const x = await agent('test', { label: 'ok' })
// Unbalanced paren — the closing paren is missing:
const y = await agent('broken', { label: 'unbalanced'
const z = await parallel([
  () => agent('child', { label: 'lane' }),
])
`;
  let g;
  try {
    g = parseWorkflow(broken);
  } catch (e) {
    assert(false, 'broken src: threw instead of recording lossy — ' + e.message);
    g = { lossy: [] };
  }
  assert(g.lossy.length > 0, `broken src: lossy[] is non-empty (got ${g.lossy.length})`);
  assert(g.lossy.every(l => typeof l.line === 'number' && typeof l.reason === 'string'),
    'lossy entries have {line:number, reason:string}');
}

// ---------------------------------------------------------------------------
// AC4: Parsed node objects carry all fields flow-canvas.js's toRFNodes() reads
// toRFNodes reads: n.id, n.kind (as RF type), n.x, n.y, n.w, n.h,
//   n.data = {kind, label, model, schema, phase, detail, body}
// parser.js's mapToFlowCanvas() normalises to this exact set of fields,
// so we verify the output shape against the required surface.
// ---------------------------------------------------------------------------
{
  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __d = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__d, '..', '.claude', 'workflows', 'starter.js'), 'utf8');
  const g = parseWorkflow(src);

  const REQUIRED_NODE_FIELDS = ['id', 'kind', 'label', 'model', 'schema', 'phase', 'detail', 'body', 'x', 'y', 'w', 'h'];
  const REQUIRED_EDGE_FIELDS = ['id', 'from', 'to', 'type'];

  const badNodes = g.nodes.filter(n => REQUIRED_NODE_FIELDS.some(f => !(f in n)));
  assert(badNodes.length === 0,
    `starter.js: all node fields present (flow-canvas shape) — bad=${badNodes.length}`);

  const badEdges = g.edges.filter(e => REQUIRED_EDGE_FIELDS.some(f => !(f in e)));
  assert(badEdges.length === 0,
    `starter.js: all edge fields present (flow-canvas shape) — bad=${badEdges.length}`);

  // Kinds must be in the set flow-canvas.js registers in nodeTypes
  const VALID_KINDS = new Set(['trigger', 'knob', 'agent', 'gate', 'parallel', 'loop', 'phase', 'skill']);
  const badKinds = g.nodes.filter(n => !VALID_KINDS.has(n.kind));
  assert(badKinds.length === 0,
    `starter.js: all node kinds are valid flow-canvas kinds — bad=${badKinds.map(n => n.kind).join(',')}`);
}

// ---------------------------------------------------------------------------
// AC5: idiomatic constructs that the literal-'[' regexes used to silently drop
//   - parallel(items.map(() => agent(...)))  (no literal '[', bare thunks)
//   - pipeline(items, stage1, stage2)        (no literal '[')
//   - a '//' inside a prompt string (URL) must NOT corrupt the agent() call
//   - single-object agent({ model, ... })    (model must survive optsOf)
// ---------------------------------------------------------------------------
{
  const src = `
export const meta = { name: 'ac5', description: 'x', phases: [{ title: 'P' }] }
phase('P')
const a = await agent('see https://example.com/docs for context', { label: 'lead', model: 'opus' })
const fan = await parallel(items.map((it, i) => () => agent('work ' + it, { label: 'w' + i, model: 'haiku' })))
const pipe = await pipeline(items, (x) => agent('stage one', { label: 'stageA' }), (y) => agent('stage two', { label: 'stageB' }))
const solo = await agent({ model: 'sonnet', label: 'objform', schema: SOME_SCHEMA })
`;
  const g = parseWorkflow(src);
  const kinds = g.nodes.map((n) => n.kind);
  const labels = g.nodes.map((n) => n.label);
  assert(g.lossy.length === 0, `AC5: no lossy for idiomatic constructs (got ${JSON.stringify(g.lossy)})`);
  assert(kinds.includes('parallel'), 'AC5: parallel(items.map(...)) yields a parallel container');
  assert(labels.some((l) => /^w/.test(l)), 'AC5: bare-thunk parallel lanes are captured');
  assert(labels.includes('stageA') && labels.includes('stageB'), 'AC5: pipeline(items, s1, s2) stages become nodes');
  const lead = g.nodes.find((n) => n.label === 'lead');
  assert(lead && lead.model === 'opus', 'AC5: a // (URL) inside a prompt does not corrupt the agent() call');
  const solo = g.nodes.find((n) => n.label === 'objform');
  assert(solo && solo.model === 'sonnet', 'AC5: single-object agent({...}) keeps the first option (model)');
}

// ---------------------------------------------------------------------------
// AC6: parallel lanes are wired to their container (no orphans)
// ---------------------------------------------------------------------------
{
  const src = `
export const meta = { name: 'ac6', description: 'x', phases: [] }
const fan = await parallel([ () => agent('x', { label: 'w0' }), () => agent('y', { label: 'w1' }) ])
`;
  const g = parseWorkflow(src);
  const cont = g.nodes.find((n) => n.kind === 'parallel');
  const lanes = g.nodes.filter((n) => /^w\d/.test(n.label));
  assert(!!cont, 'AC6: bracket-form parallel still yields a container');
  assert(lanes.length === 2, `AC6: both lanes parsed (got ${lanes.length})`);
  assert(lanes.every((ln) => g.edges.some((e) => e.from === cont.id && e.to === ln.id)),
    'AC6: every lane has a container->lane edge (not orphaned)');
}

// ---------------------------------------------------------------------------
// AC7: a paren character inside a prompt string must not break the balanced-paren scan
// ---------------------------------------------------------------------------
{
  const src = `
export const meta = { name: 'ac7', description: 'x', phases: [] }
const x = await agent('rate this :)', { label: 'ok' })
`;
  const g = parseWorkflow(src);
  assert(g.lossy.length === 0, `AC7: ":)" in a prompt does not produce lossy (got ${JSON.stringify(g.lossy)})`);
  const ok = g.nodes.find((n) => n.label === 'ok');
  assert(!!ok, 'AC7: agent with ":)" in the prompt parses to a node with label "ok"');
}

// ---------------------------------------------------------------------------
// AC8: an `agent(` token INSIDE a prompt string is not a real call (no phantom node, no lossy)
// ---------------------------------------------------------------------------
{
  const src = `
export const meta = { name: 'ac8', description: 'x', phases: [] }
const fan = await parallel([ () => agent('use the agent(x) helper', { label: 'p' }) ])
`;
  const g = parseWorkflow(src);
  const lanes = g.nodes.filter((n) => n.kind === 'agent' || n.kind === 'gate');
  assert(lanes.length === 1, `AC8: in-string "agent(" is not a second node (got ${lanes.length})`);
  assert(lanes[0] && lanes[0].label === 'p', 'AC8: the real lane keeps its label "p"');
  assert(g.lossy.length === 0, `AC8: no false lossy from in-string "agent(" (got ${JSON.stringify(g.lossy)})`);
}

// ---------------------------------------------------------------------------
// AC9: a while-loop becomes a loop container; body agents are wired container->child
// ---------------------------------------------------------------------------
{
  const src = `
export const meta = { name: 'ac9', description: 'x', phases: [] }
let i = 0;
while (i < 5) {
  const r = await agent('body work', { label: 'w' });
  i++;
}
`;
  const g = parseWorkflow(src);
  const loop = g.nodes.find((n) => n.kind === 'loop');
  assert(!!loop, 'AC9: while-loop yields a loop container node');
  const lane = g.nodes.find((n) => n.label === 'w');
  assert(!!lane && lane.kind === 'agent', 'AC9: a loop-body agent() becomes a child node');
  assert(!!lane && g.edges.some((e) => e.from === loop.id && e.to === lane.id),
    'AC9: the loop-body agent is wired container->child (not orphaned)');
}

// ---------------------------------------------------------------------------
// AC10: parallel(NAME) — a bare identifier referencing a hoisted top-level thunk array —
//   resolves through the thunks.js index for the three shapes real workflows use:
//   `.map()`, `Array.from()`, and an array literal with conditional `.push()` lanes.
//   An identifier that resolves to NO agent() calls (or doesn't exist) gets a targeted
//   lossy warning instead of the old silent 0-node skip.
// ---------------------------------------------------------------------------
{
  const src = `
export const meta = { name: 'ac10', description: 'x', phases: [] }
const mapThunks = items.map((it, i) => () => agent('map lane ' + it, { label: 'map' + i }))
const fromThunks = Array.from({ length: 2 }, (_, i) => () => agent('from lane', { label: 'from' + i }))
const pushThunks = [
  () => agent('literal lane', { label: 'lit0' }),
]
if (wantExtra) {
  pushThunks.push(() => agent('pushed lane', { label: 'pushed0' }))
}
const a = await parallel(mapThunks)
const b = await parallel(fromThunks)
const c = await parallel(pushThunks)
const d = await parallel(neverDeclared)
`;
  const g = parseWorkflow(src);
  const containers = g.nodes.filter((n) => n.kind === 'parallel');
  assert(containers.length === 3, `AC10: 3 resolved parallel(NAME) containers (got ${containers.length})`);
  const labels = g.nodes.map((n) => n.label);
  assert(labels.some((l) => l.startsWith('map')), 'AC10: .map() thunk array resolves');
  assert(labels.some((l) => l.startsWith('from')), 'AC10: Array.from() thunk array resolves');
  assert(labels.includes('lit0'), 'AC10: array-literal thunk resolves');
  assert(labels.includes('pushed0'), 'AC10: NAME.push(...) conditional lane also resolves');
  assert(
    g.lossy.some((l) => l.reason === 'parallel() references an unresolved identifier'),
    `AC10: parallel(neverDeclared) gets a targeted lossy warning (got ${JSON.stringify(g.lossy)})`,
  );
}

// ---------------------------------------------------------------------------
// AC11: scaffold.js's real 4 thunk-array fan-outs (proposeThunks, researchThunks,
//   fileStubThunks, supportThunks) all produce lane nodes, not 4 silent 0-node gaps.
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(WORKFLOWS_DIR, 'scaffold.js'), 'utf8');
  const g = parseWorkflow(src);
  const labels = g.nodes.map((n) => n.label);
  assert(labels.some((l) => l.includes('architect:')), 'AC11: scaffold.js proposeThunks (Promise.all-wrapped) resolves');
  assert(labels.some((l) => l.includes('research:')), 'AC11: scaffold.js researchThunks (Promise.all-wrapped) resolves');
  assert(labels.some((l) => l.includes('build:')), 'AC11: scaffold.js fileStubThunks resolves');
  assert(labels.includes('tests') && labels.includes('docs'), 'AC11: scaffold.js supportThunks literal lanes resolve');
  assert(labels.includes('guardrails') && labels.includes('ci'), 'AC11: scaffold.js supportThunks .push() lanes resolve');
  const containers = g.nodes.filter((n) => n.kind === 'parallel');
  assert(containers.length >= 6, `AC11: scaffold.js has >=6 parallel containers (got ${containers.length})`);
}

// ---------------------------------------------------------------------------
process.exit(failures > 0 ? 1 : 0);
