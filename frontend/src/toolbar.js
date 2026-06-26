// toolbar.js — top application toolbar for the Flow Designer.

import { SANS, btn } from './visual.js';

let h;

export function initToolbar(ReactIn) {
  h = ReactIn.createElement;
}

// buildToolbar — returns the toolbar div element.
//
// @param {object} opts
//   activeName  - current workflow name (shown in the workflow picker button)
//   onOpenMgr   - () => void: open the workflow manager modal
//   onFit       - () => void: fit canvas to viewport
//   onValidate  - () => void: run local graph cycle/stats validation
//   onZoomIn    - () => void
//   onZoomOut   - () => void
//   onGenCode   - () => void: open the code panel
export function buildToolbar({ activeName, onOpenMgr, onFit, onValidate, onZoomIn, onZoomOut, onGenCode }) {
  return h('div', { style: { height: 52, flex: '0 0 52px', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', background: '#11151c', borderBottom: '1px solid #1d2530', zIndex: 30 } },
    // Logo + app name
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } },
      h('div', { style: { width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#5b9dff,#2dd4bf)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#0b0e13', fontSize: 15 } }, '⟿'),
      h('div', { style: { fontWeight: 600, fontFamily: SANS, color: '#e6edf5' } }, 'Rabbit Flow Designer')),
    h('div', { style: { width: 1, height: 24, background: '#222b36' } }),
    // Workflow picker
    h('button', { onClick: onOpenMgr, style: { display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', background: '#0c1016', border: '1px solid #1d2530', borderRadius: 8, cursor: 'pointer' } },
      h('span', { style: { color: '#5b9dff', fontSize: 13 } }, '▤'),
      h('span', { style: { color: '#dbe3ee', fontSize: 12.5, fontWeight: 500, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: SANS } }, activeName),
      h('span', { style: { color: '#5d6776', fontSize: 10 } }, '▾')),
    h('div', { style: { flex: 1 } }),
    // Zoom controls
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 2, background: '#0c1016', border: '1px solid #1d2530', borderRadius: 8, padding: 2 } },
      h('button', { onClick: onZoomOut, style: { width: 28, height: 26, border: 'none', background: 'transparent', color: '#aeb9c8', borderRadius: 6, cursor: 'pointer', fontSize: 16 } }, '−'),
      h('button', { onClick: onZoomIn,  style: { width: 28, height: 26, border: 'none', background: 'transparent', color: '#aeb9c8', borderRadius: 6, cursor: 'pointer', fontSize: 16 } }, '+')),
    h('button', { onClick: onFit,       style: btn() }, 'Fit'),
    h('button', { onClick: onValidate,  style: btn({ display: 'flex', alignItems: 'center', gap: 6 }) },
      h('span', { style: { color: '#2dd4bf' } }, '✓'), 'Validate'),
    h('button', { onClick: onGenCode,   style: { height: 30, padding: '0 14px', background: 'linear-gradient(180deg,#5b9dff,#4a86ea)', border: 'none', color: '#06101f', fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: SANS } }, 'Generate code'));
}
