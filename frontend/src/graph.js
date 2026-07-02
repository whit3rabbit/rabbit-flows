// graph.js — internal graph shape, converters to ReactFlow format.
// "Internal shape" means the compact node/edge format the library + parser use.
// "RF shape" means the format ReactFlow expects (with position, style, data objects).

import { DIMS, EC } from './visual.js';

// _N — fill defaults for an internal-shape node
export const _N = (o) => Object.assign(
  { w: (DIMS[o.kind] || [234, 84])[0], h: (DIMS[o.kind] || [234, 84])[1],
    model: null, schema: null, phase: null, detail: null, body: null },
  o
);

// toRFNodes — convert internal graph nodes to ReactFlow node objects
export const toRFNodes = (g) => g.nodes.map((n) => {
  const isC = n.kind === 'loop' || n.kind === 'parallel';
  return {
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    zIndex: isC ? 0 : 1,
    draggable: true,
    connectable: !isC,
    selectable: true,
    style: { width: n.w, height: n.h },
    data: { kind: n.kind, label: n.label, model: n.model, schema: n.schema, phase: n.phase, detail: n.detail, body: n.body, snippet: n.snippet, fix: n.fix },
  };
});

// edgeStyle — derive ReactFlow edge style from edge type string
export const edgeStyle = (type) => ({
  stroke: EC[type] || EC.flow,
  strokeWidth: type === 'flow' ? 1.7 : 1.5,
  strokeDasharray: (type === 'skill' || type === 'data') ? '5 5' : undefined,
  opacity: (type === 'skill' || type === 'data') ? 0.6 : 0.92,
});

// toRFEdges — convert internal graph edges to ReactFlow edge objects
export const toRFEdges = (g) => {
  // MarkerType is injected at runtime because it comes from the ReactFlow UMD bundle.
  // We pull it from the module-level ref set by initGraph().
  const MT = _markerType;
  return g.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: e.type === 'loop' ? 'smoothstep' : 'default',
    animated: e.type === 'flow' || e.type === 'loop',
    style: edgeStyle(e.type),
    markerEnd: { type: MT.ArrowClosed, color: EC[e.type] || EC.flow, width: 15, height: 15 },
    data: { kind: e.type },
  }));
};

// MarkerType injected after UMD load
let _markerType = { ArrowClosed: 'arrowclosed' };
export function initGraph(RF) {
  _markerType = RF.MarkerType;
}
