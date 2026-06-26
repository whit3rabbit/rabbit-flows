// palette.js — left sidebar node palette for the Flow Designer.
// Each draggable item sets application/flowkind on dragstart;
// canvas.js handles the drop.

import { KINDS, SANS } from './visual.js';

let h;

export function initPalette(ReactIn) {
  h = ReactIn.createElement;
}

// buildPalette — returns the palette aside element.
// skillCount is the number of skills from /api/skills (used for the skill item description).
export function buildPalette({ skillCount }) {
  const palItem = (k) => {
    const def = KINDS[k];
    const skillDesc = skillCount > 0 ? skillCount + ' skills available' : 'requires-skills · CLI';
    const desc = {
      knob:     'workflow arg / input',
      agent:    'LLM call · model + prompt',
      gate:     'agent + output schema',
      parallel: 'fan-out lanes',
      loop:     'Ralph while-loop',
      phase:    'stage marker',
      skill:    skillDesc,
    }[k];
    return h('div', {
      key: k, draggable: true,
      onDragStart: (e) => { e.dataTransfer.setData('application/flowkind', k); e.dataTransfer.effectAllowed = 'move'; },
      style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', background: '#11161e', border: '1px solid #1e2733', borderRadius: 9, cursor: 'grab', userSelect: 'none' },
    },
      h('div', { style: { width: 28, height: 28, flex: '0 0 28px', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: def.color, background: def.color + '1a', border: '1px solid ' + def.color + '33' } }, def.icon),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontSize: 12.5, fontWeight: 600, color: '#dbe3ee' } }, def.label),
        h('div', { style: { fontSize: 10.5, color: '#6b7686', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, desc)),
      h('div', { style: { color: '#3c4654', fontSize: 13 } }, '⋮⋮'));
  };

  return h('aside', { style: { width: 236, flex: '0 0 236px', background: '#0e1219', borderRight: '1px solid #1d2530', display: 'flex', flexDirection: 'column', zIndex: 20, fontFamily: SANS } },
    h('div', { style: { padding: '14px 15px 8px', fontSize: 11, letterSpacing: .9, textTransform: 'uppercase', color: '#5d6776', fontWeight: 600 } }, 'Add node'),
    h('div', { style: { flex: 1, overflowY: 'auto', padding: '4px 11px 11px', display: 'flex', flexDirection: 'column', gap: 8 } },
      ['knob', 'agent', 'gate', 'parallel', 'loop', 'phase', 'skill'].map(palItem)),
    h('div', { style: { padding: '11px 14px', borderTop: '1px solid #1d2530', fontSize: 10.5, color: '#5a6573', lineHeight: 1.5 } }, 'Drag a block onto the canvas to add it, then wire it into the flow.'));
}
