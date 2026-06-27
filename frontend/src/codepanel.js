// codepanel.js — "Generated workflow" overlay (code view, validate, save to repo).
// Shown when the user clicks "Generate code" in the toolbar.

import { SANS, MONO } from './visual.js';

let h;

export function initCodePanel(ReactIn) {
  h = ReactIn.createElement;
}

// buildCodePanel — returns the code-panel overlay element or null.
//
// @param {object}   opts
//   codeOpen       - boolean: is the panel open?
//   code           - string: generated workflow source
//   validateResult - null | {pending:true} | {ok, output}
//   metaName       - workflow name (for the title bar)
//   onClose        - () => void
//   onValidate     - () => void
//   onSave         - () => void
//   bundleName     - string|null: on-disk basename of the saved workflow (null = not saved yet)
//   onExportBundle - () => void: download a .zip bundle of the saved workflow + its skills/agents
export function buildCodePanel({ codeOpen, code, validateResult, metaName, onClose, onValidate, onSave, bundleName, onExportBundle }) {
  if (!codeOpen) return null;

  const vr = validateResult;
  return h('div', { key: 'code', onClick: onClose, style: { position: 'absolute', inset: 0, background: 'rgba(5,7,11,.66)', backdropFilter: 'blur(3px)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 } },
    h('div', { onClick: (e) => e.stopPropagation(), style: { width: 660, maxWidth: '100%', maxHeight: '100%', background: '#0d1117', border: '1px solid #232c38', borderRadius: 13, boxShadow: '0 24px 70px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: SANS } },
      // Header
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #1d2530' } },
        h('div', { style: { fontWeight: 600, color: '#e6edf5' } }, 'Generated workflow'),
        h('div', { style: { fontSize: 11, color: '#5d6776', fontFamily: MONO } }, metaName + '.js'),
        h('div', { style: { flex: 1 } }),
        h('button', { onClick: onClose, style: { background: '#161b22', border: '1px solid #232c38', color: '#aeb9c8', borderRadius: 7, width: 28, height: 28, cursor: 'pointer', fontSize: 15 } }, '✕')),
      // Code area
      h('pre', { style: { margin: 0, flex: 1, overflow: 'auto', padding: '16px 18px', fontFamily: MONO, fontSize: 12, lineHeight: 1.65, color: '#aeb9c8', whiteSpace: 'pre' } }, code),
      // Validation output (when present)
      vr && !vr.pending && h('pre', { style: { margin: 0, maxHeight: 180, overflow: 'auto', padding: '10px 18px', fontFamily: MONO, fontSize: 11, lineHeight: 1.55, color: vr.ok ? '#5fd9a6' : '#e07a8c', background: vr.ok ? '#0a1a12' : '#1a0a0e', borderTop: '1px solid ' + (vr.ok ? '#1d3a2b' : '#3a1d22'), whiteSpace: 'pre-wrap' } }, vr.output || (vr.ok ? 'OK' : 'Failed')),
      // Footer
      h('div', { style: { padding: '10px 16px', borderTop: '1px solid #1d2530', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h('button', {
          onClick: onValidate,
          disabled: vr && vr.pending,
          style: { height: 28, padding: '0 14px', background: vr && vr.pending ? '#1a1e26' : 'linear-gradient(180deg,#2dd4bf,#1ab8a4)', border: 'none', color: vr && vr.pending ? '#5d6776' : '#06101f', fontWeight: 600, borderRadius: 7, cursor: vr && vr.pending ? 'default' : 'pointer', fontSize: 11.5, fontFamily: SANS },
        }, vr && vr.pending ? 'Validating...' : 'Export + Validate'),
        h('button', { onClick: onSave, style: { height: 28, padding: '0 14px', background: '#11161e', border: '1px solid #2b3a52', color: '#9fc2ff', fontWeight: 600, borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontFamily: SANS } }, 'Save to repo'),
        h('button', {
          onClick: onExportBundle,
          disabled: !bundleName,
          title: bundleName ? 'Download a .zip bundle (workflow + its skills/agents)' : 'Save to repo first',
          style: { height: 28, padding: '0 14px', background: '#11161e', border: '1px solid ' + (bundleName ? '#2b3a52' : '#1d2530'), color: bundleName ? '#9fc2ff' : '#5d6776', fontWeight: 600, borderRadius: 7, cursor: bundleName ? 'pointer' : 'default', fontSize: 11.5, fontFamily: SANS },
        }, 'Download bundle'),
        vr && !vr.pending && h('span', { style: { fontSize: 11.5, fontWeight: 600, color: vr.ok ? '#2dd4bf' : '#e07a8c' } }, vr.ok ? '✓ Passed validate.py --strict' : '✕ Failed validate.py --strict'),
        h('div', { style: { flex: 1 } }),
        h('span', { style: { fontSize: 10.5, color: '#5d6776' } },
          h('span', { style: { color: '#5b9dff' } }, 'ℹ'),
          ' edit the graph and re-generate to shape the orchestration.'))));
}
