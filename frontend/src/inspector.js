// inspector.js — node inspector panel for the right sidebar.
// Renders the selected node's editable fields (label, model, schema, phase, etc.)
// or a workflow summary when nothing is selected.

import { KINDS, MODELS, MONO, SANS } from './visual.js';
import { countKinds } from './library.js';

// React binding — set by initInspector()
let h, React;

export function initInspector(ReactIn) {
  React = ReactIn;
  h = React.createElement;
}

// buildInspector — returns the inspector React element.
//
// @param {object|null} sel          - selected RF node (null = nothing selected)
// @param {object[]}    nodes        - all RF nodes
// @param {object[]}    edges        - all RF edges
// @param {object[]}    skillCatalog - [{name, description}] from /api/skills
// @param {object}      g            - { metaName, metaDesc }
// @param {function}    patchData    - (id, patch) => void
// @param {function}    delNode      - (id) => void
export function buildInspector({ sel, nodes, edges, skillCatalog, g, patchData, delNode }) {
  if (!sel) {
    return buildSummary({ nodes, edges, g });
  }

  const d = sel.data, def = KINDS[d.kind], col = def.color;
  const isAgentLike = d.kind === 'agent' || d.kind === 'gate';

  // Skills wired into this node via 'skill' edges
  const skillsIn = edges
    .filter((e) => e.data && e.data.kind === 'skill' && e.target === sel.id)
    .map((e) => { const s = nodes.find((n) => n.id === e.source); return s && s.data.label; })
    .filter(Boolean);

  const lbl = (t) => h('label', { style: { display: 'block', fontSize: 10.5, color: '#6b7686', margin: '14px 0 5px', letterSpacing: .3 } }, t);
  const inputStyle = { width: '100%', background: '#0a0d12', border: '1px solid #232c38', color: '#e6edf5', borderRadius: 7, padding: '8px 10px', fontSize: 13, outline: 'none', fontFamily: SANS, boxSizing: 'border-box' };

  const fields = [
    h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
      h('div', { style: { width: 10, height: 10, borderRadius: 3, background: col, boxShadow: '0 0 9px ' + col } }),
      h('div', { style: { fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', fontWeight: 600, color: '#8b97a5' } }, def.label),
      h('div', { style: { flex: 1 } }),
      h('button', { onClick: () => delNode(sel.id), style: { background: '#1a1014', border: '1px solid #3a2229', color: '#e07a8c', borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer' } }, 'Delete')),
    lbl('Label'),
    h('input', { key: 'lab', value: d.label, onChange: (e) => patchData(sel.id, { label: e.target.value }), style: inputStyle }),
  ];

  if (isAgentLike) {
    fields.push(lbl('Model routing'));
    fields.push(h('div', { key: 'mods', style: { display: 'flex', gap: 5 } },
      ['opus', 'sonnet', 'haiku'].map((m) => h('button', { key: m, onClick: () => patchData(sel.id, { model: m }), style: { flex: 1, padding: '7px 0', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontFamily: MONO, border: '1px solid ' + (d.model === m ? MODELS[m] : '#232c38'), background: d.model === m ? MODELS[m] + '22' : '#0a0d12', color: d.model === m ? MODELS[m] : '#7a8594' } }, m))
    ));
    fields.push(lbl(d.kind === 'gate' ? 'Output schema · admission' : 'Output schema'));
    fields.push(h('input', { key: 'sch', value: d.schema || '', placeholder: '(none — free text)', onChange: (e) => patchData(sel.id, { schema: e.target.value }), style: Object.assign({}, inputStyle, { color: '#9fe6d4', fontFamily: MONO, fontSize: 12 }) }));
    fields.push(lbl('Phase'));
    fields.push(h('input', { key: 'ph', value: d.phase || '', placeholder: '(ungrouped)', onChange: (e) => patchData(sel.id, { phase: e.target.value }), style: Object.assign({}, inputStyle, { fontSize: 12 }) }));
  }

  if (d.kind === 'skill' && skillCatalog.length > 0) {
    fields.push(lbl('Skill (from catalog)'));
    const selectStyle = Object.assign({}, inputStyle, { cursor: 'pointer', color: '#34d399', fontFamily: MONO, fontSize: 12 });
    const catalogNames = skillCatalog.map((sk) => sk.name);
    const optionEls = skillCatalog.map((sk) => h('option', { key: sk.name, value: sk.name }, sk.name));
    if (d.label && !catalogNames.includes(d.label)) {
      optionEls.unshift(h('option', { key: '__custom', value: d.label }, d.label + ' (custom)'));
    }
    fields.push(h('select', { key: 'skpick', value: d.label || '', onChange: (e) => patchData(sel.id, { label: e.target.value }), style: selectStyle }, optionEls));
    const selSkill = skillCatalog.find((sk) => sk.name === d.label);
    if (selSkill && selSkill.description) {
      fields.push(h('div', { key: 'skdesc', style: { fontSize: 10.5, color: '#6b7686', marginTop: 4, lineHeight: 1.5 } }, selSkill.description));
    }
  }

  if (d.kind === 'knob') {
    fields.push(lbl('Args / knobs'));
    fields.push(h('textarea', { key: 'bd', value: d.body || '', onChange: (e) => patchData(sel.id, { body: e.target.value }), style: Object.assign({}, inputStyle, { height: 96, resize: 'vertical', color: '#9fb0c4', fontFamily: MONO, fontSize: 11.5, lineHeight: 1.5 }) }));
  }

  if (skillsIn.length) {
    fields.push(lbl('Attached skills (CLI sliced into prompt)'));
    fields.push(h('div', { key: 'sk', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
      skillsIn.map((s, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 5, background: '#0d1a14', border: '1px solid #1d3a2b', color: '#5fd9a6', borderRadius: 6, padding: '4px 9px', fontSize: 11, fontFamily: MONO } }, '◆ ' + s))
    ));
  }

  if (isAgentLike) {
    fields.push(lbl('Prompt preview'));
    const pv = 'You are the "' + d.label + '" ' + (d.kind === 'gate' ? 'admission gate' : 'stage') +
      ' in the ' + g.metaName + ' workflow.' +
      (d.kind === 'gate'
        ? '\nIndependently verify against real evidence and return a ' + (d.schema || 'verdict') + ' — do not rubber-stamp.'
        : '\nDo the work, then return structured output' + (d.schema ? ' as ' + d.schema : '') + '.') +
      '\n[ model: ' + d.model + ' ]';
    fields.push(h('div', { key: 'pv', style: { background: '#0a0d12', border: '1px solid #1e2733', borderRadius: 7, padding: 10, fontSize: 11, color: '#8e99a8', lineHeight: 1.55, fontFamily: MONO, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' } }, pv));
  }

  return h('div', { style: { padding: '16px 16px 30px' } }, fields);
}

function buildSummary({ nodes, edges, g }) {
  const statRow = (label, value) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
    h('div', { style: { fontSize: 12, color: '#8b97a5' } }, label),
    h('div', { style: { fontSize: 13, fontWeight: 600, color: '#dbe3ee', fontFamily: MONO } }, String(value)));
  const { agents: ag, gates: ga } = countKinds(nodes);
  const ph = new Set(nodes.map((n) => n.data.phase).filter(Boolean)).size;
  return h('div', { style: { padding: '18px 16px' } },
    h('div', { style: { fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', fontWeight: 600, color: '#5d6776', marginBottom: 10 } }, 'Workflow'),
    h('div', { style: { fontSize: 15, fontWeight: 600, color: '#e6edf5' } }, g.metaName),
    h('div', { style: { fontSize: 12, color: '#7c8694', marginTop: 8, lineHeight: 1.55 } }, g.metaDesc),
    h('div', { style: { height: 1, background: '#1d2530', margin: '18px 0' } }),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      statRow('Agents', ag), statRow('Gates', ga), statRow('Phases', ph), statRow('Edges', edges.length)),
    h('div', { style: { height: 1, background: '#1d2530', margin: '18px 0' } }),
    h('div', { style: { fontSize: 11.5, color: '#6b7686', lineHeight: 1.6 } }, 'Select a node to inspect its model, schema, phase and attached skills. Drag from a node’s handle to wire the flow.'));
}
