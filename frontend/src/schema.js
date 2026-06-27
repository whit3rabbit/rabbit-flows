// schema.js — canonical graph schema for the Rabbit Flow Designer.
//
// Single source of truth for the four things the rest of the app and the docs
// were each re-deriving by hand:
//   1. the node-kind / edge-type vocabularies (imported from visual.js so they
//      can never drift from the renderer's colors/dims);
//   2. the per-kind HANDLE inventory (how many connection points, and where) —
//      mirrors what nodes.js actually renders;
//   3. CONNECTION_RULES — which kind may connect to which, per edge type — and
//      edgeTypeFor()/connectionAllowed() that the canvas uses for isValidConnection;
//   4. GRAPH_JSON_SCHEMA (Draft-07) + validateGraph(), a dependency-free validator
//      used by the test harness to prove every real workflow parses to a conformant graph.
//
// The internal node shape is {id,kind,label,model,schema,phase,detail,body,x,y,w,h};
// graph.js projects it to the ReactFlow {id,type,position,style,data} shape. This file
// validates the internal shape — the projection is mechanical and lossless.

import { KINDS, EC, DIMS } from './visual.js';

export const NODE_KINDS = Object.keys(KINDS);  // trigger,knob,agent,gate,parallel,loop,phase,skill,lossy
export const EDGE_TYPES = Object.keys(EC);     // flow,loop,skill,data
export const MODELS = ['opus', 'sonnet', 'haiku'];

// Containers render as bounding boxes; leaf nodes sit inside them by geometry (codegen cidOf).
export const CONTAINER_KINDS = ['parallel', 'loop'];

// HANDLES — connection points per kind, mirroring nodes.js render logic exactly.
//   type: 'source' (outgoing) | 'target' (incoming).  pos: a ReactFlow Position name.
//   hidden: rendered faded/zero-opacity but still a valid attach point.
// Containers are connectable:false interactively (graph.js), but the parser threads flow
// edges through the box (prev -> container -> lane), so the box is modeled with hidden handles.
export const HANDLES = {
  trigger:  [{ id: 's', type: 'source', pos: 'Bottom' }],
  phase:    [{ id: 't', type: 'target', pos: 'Top' }],
  agent:    [{ id: 't', type: 'target', pos: 'Top' }, { id: 's', type: 'source', pos: 'Bottom' }],
  gate:     [{ id: 't', type: 'target', pos: 'Top' }, { id: 's', type: 'source', pos: 'Bottom' }],
  lossy:    [{ id: 't', type: 'target', pos: 'Top' }, { id: 's', type: 'source', pos: 'Bottom' }],
  knob:     [{ id: 's', type: 'source', pos: 'Right' }, { id: 't', type: 'target', pos: 'Left', hidden: true }],
  skill:    [{ id: 's', type: 'source', pos: 'Right' }, { id: 't', type: 'target', pos: 'Left', hidden: true }],
  parallel: [{ id: 't', type: 'target', pos: 'Top', hidden: true }, { id: 's', type: 'source', pos: 'Bottom', hidden: true }],
  loop:     [{ id: 't', type: 'target', pos: 'Top', hidden: true }, { id: 's', type: 'source', pos: 'Bottom', hidden: true }],
};

export const handleCount = (kind) => (HANDLES[kind] || []).length;
export const canSource = (kind) => (HANDLES[kind] || []).some((x) => x.type === 'source');
export const canTarget = (kind) => (HANDLES[kind] || []).some((x) => x.type === 'target');

// CONNECTION_RULES — for each edge type: which source kinds may reach which target kinds.
// An edge is legal iff sourceKind ∈ sources AND targetKind ∈ targets for the edge's type.
//   flow  — execution order (solid, animated): the spine trigger -> agents/gates/phases, plus
//           container <-> lane fan-out (the parser emits parallel -> agent for each lane).
//   skill — a skill node attaches to the agent/gate that invokes it (dashed, side handle).
//   data  — a knob node feeds a config value into an agent/gate/container (dashed, side handle).
//   loop  — a back-edge from a later step to an earlier one inside a loop container (curved).
const FLOW_SRC = ['trigger', 'agent', 'gate', 'parallel', 'loop'];
const FLOW_TGT = ['agent', 'gate', 'parallel', 'loop', 'phase', 'lossy'];
export const CONNECTION_RULES = {
  flow:  { sources: FLOW_SRC, targets: FLOW_TGT },
  skill: { sources: ['skill'], targets: ['agent', 'gate'] },
  data:  { sources: ['knob'],  targets: ['agent', 'gate', 'parallel', 'loop'] },
  loop:  { sources: ['agent', 'gate', 'loop'], targets: ['agent', 'gate', 'loop', 'phase'] },
};

// edgeTypeFor — the edge type a freshly-drawn (sourceKind -> targetKind) connection should be.
// skill/data win by their distinctive source kind; everything else is a flow edge. 'loop' is
// NOT auto-assigned: it shares endpoint kinds with flow and can't be told apart from kind alone,
// so loop-back edges are created deliberately (parser / loop container), not by free-drawing.
// Returns null when no rule permits the pair — isValidConnection uses that to reject the drag.
export function edgeTypeFor(sourceKind, targetKind) {
  for (const t of ['skill', 'data', 'flow']) {
    const r = CONNECTION_RULES[t];
    if (r.sources.includes(sourceKind) && r.targets.includes(targetKind)) return t;
  }
  return null;
}
export const connectionAllowed = (sourceKind, targetKind) => edgeTypeFor(sourceKind, targetKind) !== null;

// validateGraph — dependency-free structural validator for the internal graph shape.
// Returns { ok, errors: [{where, msg}] }. Used by test-schema.mjs against every real workflow.
export function validateGraph(graph) {
  const errors = [];
  const E = (where, msg) => errors.push({ where, msg });
  if (!graph || typeof graph !== 'object') return { ok: false, errors: [{ where: 'graph', msg: 'not an object' }] };
  if (!Array.isArray(graph.nodes)) return { ok: false, errors: [{ where: 'graph.nodes', msg: 'missing or not an array' }] };
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  const ids = new Set();
  const kindById = new Map();
  graph.nodes.forEach((n, i) => {
    const at = `nodes[${i}]`;
    if (!n || typeof n !== 'object') { E(at, 'node not an object'); return; }
    if (typeof n.id !== 'string' || !n.id) E(at, 'id must be a non-empty string');
    else if (ids.has(n.id)) E(at, `duplicate id '${n.id}'`); else ids.add(n.id);
    if (!NODE_KINDS.includes(n.kind)) E(at, `kind '${n.kind}' not in ${NODE_KINDS.join('|')}`);
    if (typeof n.label !== 'string') E(at, 'label must be a string');
    for (const f of ['x', 'y', 'w', 'h']) if (typeof n[f] !== 'number') E(at, `${f} must be a number`);
    if (n.model != null && !MODELS.includes(n.model)) E(at, `model '${n.model}' not ${MODELS.join('|')}`);
    if (typeof n.id === 'string' && n.id) kindById.set(n.id, n.kind);
  });

  edges.forEach((e, i) => {
    const at = `edges[${i}]`;
    if (!e || typeof e !== 'object') { E(at, 'edge not an object'); return; }
    if (typeof e.id !== 'string' || !e.id) E(at, 'id must be a non-empty string');
    if (!EDGE_TYPES.includes(e.type)) E(at, `type '${e.type}' not in ${EDGE_TYPES.join('|')}`);
    if (!kindById.has(e.from)) { E(at, `from '${e.from}' references no node`); return; }
    if (!kindById.has(e.to)) { E(at, `to '${e.to}' references no node`); return; }
    const rule = CONNECTION_RULES[e.type];
    if (rule) {
      const sk = kindById.get(e.from), tk = kindById.get(e.to);
      if (!rule.sources.includes(sk)) E(at, `${e.type} edge cannot start at a '${sk}' node`);
      if (!rule.targets.includes(tk)) E(at, `${e.type} edge cannot end at a '${tk}' node`);
    }
  });

  return { ok: errors.length === 0, errors };
}

// GRAPH_JSON_SCHEMA — Draft-07 document for external tooling / humans. Kept in sync with the
// validator by construction (both read NODE_KINDS / EDGE_TYPES / MODELS). w/h default per kind
// in DIMS, but are required on a concrete node.
export const GRAPH_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://rabbit-flows/flow-graph.schema.json',
  title: 'Rabbit Flow graph',
  type: 'object',
  required: ['nodes', 'edges'],
  properties: {
    meta: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        phases: { type: 'array', items: { type: 'string' } },
      },
    },
    nodes: { type: 'array', items: { $ref: '#/definitions/node' } },
    edges: { type: 'array', items: { $ref: '#/definitions/edge' } },
  },
  definitions: {
    node: {
      type: 'object',
      required: ['id', 'kind', 'label', 'x', 'y', 'w', 'h'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { enum: NODE_KINDS },
        label: { type: 'string' },
        model: { enum: [...MODELS, null] },
        schema: { type: ['string', 'null'] },
        phase: { type: ['string', 'null'] },
        detail: { type: ['string', 'null'] },
        body: { type: ['string', 'null'] },
        x: { type: 'number' }, y: { type: 'number' },
        w: { type: 'number' }, h: { type: 'number' },
      },
    },
    edge: {
      type: 'object',
      required: ['id', 'from', 'to', 'type'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        from: { type: 'string' },
        to: { type: 'string' },
        type: { enum: EDGE_TYPES },
      },
    },
  },
};

// Re-export DIMS so consumers can get the canonical default size for a kind from one import.
export { DIMS };
