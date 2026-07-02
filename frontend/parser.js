/**
 * parser.js — workflow .js source -> {meta, nodes, edges, lossy[]}
 *
 * Public entry point. Runnable in the browser (loaded via import('/parser.js') from
 * canvas.js) and importable in Node (test-parser.mjs). The implementation lives in
 * src/parser/*: scan.js (string helpers), meta.js (the meta block), calls.js (the
 * agent/parallel/pipeline/phase scan). This file just composes them.
 *
 * Node schema: {id, kind, label, model, phase, detail, schema, x, y, w, h}
 * Edge schema: {id, from, to, type}  (type: 'flow'|'data'|'skill'|'loop')
 */

import { parseMeta } from './src/parser/meta.js';
import { parseCalls, mapToFlowCanvas } from './src/parser/calls.js';

// Re-export the pieces so callers can reach them directly if needed.
export { parseMeta } from './src/parser/meta.js';
export { parseCalls, mapToFlowCanvas } from './src/parser/calls.js';

/**
 * Parse a workflow .js source string into a graph object.
 *
 * Returns:
 *   {
 *     meta: { name, description, phases, raw, unbalanced },
 *     nodes: Node[],
 *     edges: Edge[],
 *     lossy: [{line: number, reason: string, snippet: string, fix: string}]
 *   }
 *
 * The returned nodes/edges use the flow-canvas internal shape (id/kind/label/…/x/y/w/h).
 */
export function parseWorkflow(src) {
  const meta  = parseMeta(src);
  const calls = parseCalls(src);
  const { nodes, edges } = mapToFlowCanvas(calls.nodes, calls.edges);

  return {
    meta,
    nodes,
    edges,
    lossy: calls.lossy,
  };
}
