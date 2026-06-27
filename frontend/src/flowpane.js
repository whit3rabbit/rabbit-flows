// flowpane.js — the ReactFlow canvas pane, lossy banner, and node-kind legend.
// The pane is the draggable/droppable middle section of the layout.

import { KINDS, SANS } from './visual.js';

let h, RF, Background, Controls, MiniMap;

export function initFlowPane(ReactIn, RFIn) {
  h = ReactIn.createElement;
  RF = RFIn;
  ({ Background, Controls, MiniMap } = RF);
}

// buildFlowPane — returns the flow div element.
//
// @param {object} opts
//   wrapRef       - React ref for the pane DOM node
//   nodes, edges  - ReactFlow state
//   onNodesChange, onEdgesChange, onConnect, isValidConnection, onNodeClick, onPaneClick
//   onDragOver, onDrop
//   nodeTypes     - ReactFlow node type map
//   lossyCount    - null | number of unparsed sections
export function buildFlowPane({ wrapRef, nodes, edges, onNodesChange, onEdgesChange, onConnect, isValidConnection, onNodeClick, onPaneClick, onDragOver, onDrop, nodeTypes, lossyCount }) {
  const ReactFlowComp = RF.ReactFlow || RF.default || RF;
  const LEGEND = [['agent', 'Agent'], ['gate', 'Gate'], ['parallel', 'Parallel'], ['loop', 'Loop'], ['skill', 'Skill'], ['knob', 'Knob']];

  return h('div', { ref: wrapRef, onDragOver, onDrop, style: { flex: 1, position: 'relative', minWidth: 0 } },
    h(ReactFlowComp, {
      nodes, edges, onNodesChange, onEdgesChange, onConnect, isValidConnection, onNodeClick, onPaneClick, nodeTypes,
      fitView: true, minZoom: 0.2, maxZoom: 1.8, proOptions: { hideAttribution: true }, defaultEdgeOptions: { type: 'default' },
    },
      h(Background, { color: '#1a2230', gap: 26, size: 1.2 }),
      h(Controls,   { showInteractive: false }),
      h(MiniMap,    { nodeColor: (n) => (KINDS[n.type] ? KINDS[n.type].color : '#888'), nodeStrokeWidth: 2, maskColor: 'rgba(8,11,16,.72)', style: { background: '#0e1219', border: '1px solid #1d2530' } })),
    lossyCount != null && lossyCount > 0 && h('div', {
      style: { position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: '#1e1506', border: '1px solid #7c5a12', borderRadius: 8, padding: '6px 14px', fontSize: 11.5, color: '#f5c542', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', zIndex: 50, fontFamily: SANS, boxShadow: '0 4px 16px rgba(0,0,0,.5)' },
    },
      h('span', { style: { fontSize: 14 } }, '⚠️'),
      lossyCount + ' section' + (lossyCount === 1 ? '' : 's') + ' could not be parsed — graph is partial. Non-standard workflow constructs were skipped.'),
    h('div', { style: { position: 'absolute', left: 14, bottom: 14, display: 'flex', gap: 7, flexWrap: 'wrap', maxWidth: 520, pointerEvents: 'none', fontFamily: SANS } },
      LEGEND.map(([k, label]) => h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(17,21,28,.8)', backdropFilter: 'blur(4px)', border: '1px solid #1d2530', borderRadius: 6, padding: '3px 8px', fontSize: 10.5, color: '#8b97a5' } },
        h('div', { style: { width: 8, height: 8, borderRadius: 2.5, background: KINDS[k].color } }), label))));
}
