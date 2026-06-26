// nodes.js — React node components for the Flow Designer canvas.
// Receives React and ReactFlow bindings via init() so this module is
// framework-agnostic at import time (the UMD bundle loads after boot).

import { KINDS, MODELS, MONO, SANS } from './visual.js';

// Module-level refs populated by init() once the UMD bundles are loaded.
let h, Handle, Position;

export function initNodes(React, RF) {
  h = React.createElement;
  ({ Handle, Position } = RF);
}

const dotHandle = (col) => ({
  width: 9, height: 9, background: col, border: '2px solid #0b0e13', borderRadius: '50%',
});

// LeafNode — renders trigger, knob, agent, gate, skill, phase nodes
export function LeafNode(props) {
  const d = props.data, sel = props.selected, def = KINDS[d.kind], col = def.color;
  const isTrig = d.kind === 'trigger', isPhase = d.kind === 'phase';
  const hasTB = d.kind === 'agent' || d.kind === 'gate';
  const sideSource = d.kind === 'knob' || d.kind === 'skill';
  const bg = isTrig ? '#161019' : isPhase ? '#0f141b' : '#141922';
  const kids = [];

  if (hasTB) {
    kids.push(h(Handle, { key: 't', type: 'target', position: Position.Top,    style: dotHandle(col) }));
    kids.push(h(Handle, { key: 's', type: 'source', position: Position.Bottom, style: dotHandle(col) }));
  } else if (isTrig) {
    kids.push(h(Handle, { key: 's', type: 'source', position: Position.Bottom, style: dotHandle(col) }));
  } else if (sideSource) {
    kids.push(h(Handle, { key: 's', type: 'source', position: Position.Right, style: dotHandle(col) }));
    kids.push(h(Handle, { key: 't', type: 'target', position: Position.Left,  style: Object.assign(dotHandle(col), { opacity: 0 }) }));
  } else {
    // phase / terminal
    kids.push(h(Handle, { key: 't', type: 'target', position: Position.Top, style: dotHandle(col) }));
  }

  const header = h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 } },
    h('div', { style: { width: 9, height: 9, borderRadius: 3, background: col, boxShadow: '0 0 8px ' + col + '88' } }),
    h('div', { style: { fontSize: 9.5, letterSpacing: .7, textTransform: 'uppercase', fontWeight: 600, color: '#6b7686' } }, def.label),
    h('div', { style: { flex: 1 } }),
    d.phase ? h('div', { style: { fontSize: 9, color: '#5d6776', fontFamily: MONO, background: '#0c1016', border: '1px solid #20283366', padding: '1px 5px', borderRadius: 4 } }, d.phase) : null
  );

  const body = [header, h('div', { key: 'ti', style: { fontSize: 13, fontWeight: 600, color: '#e6edf5', lineHeight: 1.25 } }, d.label)];
  if (d.detail) body.push(h('div', { key: 'de', style: { fontSize: 10.5, color: '#7c8694', marginTop: 3, lineHeight: 1.35 } }, d.detail));
  if (d.body)   body.push(h('div', { key: 'bo', style: { fontSize: 10.5, color: '#8e99a8', marginTop: 5, whiteSpace: 'pre-line', fontFamily: MONO, lineHeight: 1.5 } }, d.body));

  if (d.model || d.schema) {
    const f = [];
    if (d.model) f.push(h('div', { key: 'm', style: { fontSize: 9.5, fontWeight: 600, fontFamily: MONO, color: MODELS[d.model], background: MODELS[d.model] + '1a', border: '1px solid ' + MODELS[d.model] + '40', padding: '2px 7px', borderRadius: 5 } }, d.model));
    if (d.schema) f.push(h('div', { key: 's', style: { fontSize: 9.5, color: '#8a94a3', fontFamily: MONO, background: '#0c1016', border: '1px solid #1e2733', padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 } }, d.schema));
    body.push(h('div', { key: 'ft', style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 } }, f));
  }

  kids.push(h('div', { key: 'in', style: { padding: isTrig || isPhase ? '9px 13px' : '11px 13px' } }, body));
  return h('div', {
    style: {
      width: '100%', height: '100%', background: bg,
      border: '1px solid ' + (sel ? col : '#283039'), borderLeft: '3px solid ' + col,
      borderRadius: 10,
      boxShadow: sel ? '0 0 0 1px ' + col + ',0 10px 30px rgba(0,0,0,.45)' : '0 2px 10px rgba(0,0,0,.3)',
      overflow: 'hidden', fontFamily: SANS,
    },
  }, kids);
}

// ContainerNode — renders parallel and loop bounding boxes
export function ContainerNode(props) {
  const d = props.data, sel = props.selected, def = KINDS[d.kind], col = def.color;
  return h('div', {
    style: {
      width: '100%', height: '100%',
      border: '1.5px dashed ' + col + '66', background: col + '0d',
      borderRadius: 14, position: 'relative',
      boxShadow: sel ? '0 0 0 2px ' + col : 'none', fontFamily: SANS,
    },
  },
    h('div', { style: { position: 'absolute', top: -11, left: 14, background: '#0b0e13', padding: '0 8px', fontSize: 10.5, fontWeight: 600, color: col, letterSpacing: .4 } }, def.icon + '  ' + d.label)
  );
}

// LossyNode — placeholder for workflow sections the parser could not parse.
// Rendered with an amber warning style; not connectable in the palette sense
// but the graph may wire flow edges to/from it.
export function LossyNode(props) {
  const d = props.data, sel = props.selected;
  const col = '#f5a524';
  return h('div', {
    style: {
      width: '100%', height: '100%', background: '#1a1200',
      border: '1px solid ' + (sel ? col : '#5a3800'), borderLeft: '3px solid ' + col,
      borderRadius: 10,
      boxShadow: sel ? '0 0 0 1px ' + col : '0 2px 10px rgba(0,0,0,.3)',
      overflow: 'hidden', fontFamily: SANS, display: 'flex', alignItems: 'center', gap: 8, padding: '0 13px',
    },
  },
    h(Handle, { type: 'target', position: Position.Top,    style: dotHandle(col) }),
    h('div', { style: { fontSize: 14, color: col } }, '⚠'),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontSize: 9.5, letterSpacing: .7, textTransform: 'uppercase', fontWeight: 600, color: '#7a5a1a' } }, 'Unparsed section'),
      h('div', { style: { fontSize: 11.5, color: '#c49a30', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, d.label || 'unrecognized construct')
    ),
    h(Handle, { type: 'source', position: Position.Bottom, style: dotHandle(col) })
  );
}

export function makeNodeTypes() {
  return {
    agent: LeafNode, gate: LeafNode, skill: LeafNode, knob: LeafNode,
    trigger: LeafNode, phase: LeafNode,
    parallel: ContainerNode, loop: ContainerNode,
    lossy: LossyNode,
  };
}
