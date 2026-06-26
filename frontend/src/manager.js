// manager.js — Workflow manager modal overlay.
// Shown when the user clicks the workflow name in the toolbar.
// Handles: open/rename/duplicate/delete/import/export + Load from repo.

import { SANS, MONO, btn } from './visual.js';
import { countKinds } from './library.js';

let h, React;

export function initManager(ReactIn) {
  React = ReactIn;
  h = React.createElement;
}

// buildManagerOverlay — returns the manager overlay React element or null.
//
// All operations are callbacks passed in by Shell so this module has no state.
export function buildManagerOverlay({
  managerOpen, library, activeId, renaming, repoWorkflows, repoLoading,
  onClose, onOpen, onNew, onRename, onCommitRename, onDuplicate, onDelete,
  onImportClick, onExportActive, onResetLibrary, onLoadRepo,
}) {
  if (!managerOpen) return null;
  const miniBtn = (color) => ({ background: '#161b22', border: '1px solid #232c38', color: color || '#aeb9c8', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: SANS });

  return h('div', { key: 'mgr', onClick: onClose, style: { position: 'absolute', inset: 0, background: 'rgba(5,7,11,.66)', backdropFilter: 'blur(3px)', zIndex: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, fontFamily: SANS } },
    h('div', { onClick: (e) => e.stopPropagation(), style: { width: 640, maxWidth: '100%', maxHeight: '100%', background: '#0d1117', border: '1px solid #232c38', borderRadius: 13, boxShadow: '0 24px 70px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // Header
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid #1d2530' } },
        h('div', { style: { width: 24, height: 24, borderRadius: 6, background: '#5b9dff1a', border: '1px solid #5b9dff33', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5b9dff', fontSize: 13 } }, '▤'),
        h('div', { style: { fontWeight: 600, color: '#e6edf5', fontSize: 15 } }, 'Workflow manager'),
        h('div', { style: { fontSize: 11.5, color: '#5d6776', fontFamily: MONO } }, library.length + ' saved'),
        h('div', { style: { flex: 1 } }),
        h('button', { onClick: onClose, style: { background: '#161b22', border: '1px solid #232c38', color: '#aeb9c8', borderRadius: 7, width: 28, height: 28, cursor: 'pointer', fontSize: 15 } }, '✕')),
      // Action bar
      h('div', { style: { display: 'flex', gap: 8, padding: '12px 18px', borderBottom: '1px solid #1d2530', flexWrap: 'wrap', alignItems: 'center' } },
        h('button', { onClick: onNew, style: { height: 32, padding: '0 13px', background: 'linear-gradient(180deg,#5b9dff,#4a86ea)', border: 'none', color: '#06101f', fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, fontFamily: SANS } }, h('span', { style: { fontSize: 15 } }, '+'), 'New workflow'),
        h('button', { onClick: onImportClick, style: btn({ height: 32 }) }, 'Import JSON'),
        h('button', { onClick: onExportActive, style: btn({ height: 32 }) }, 'Export current'),
        h('div', { style: { flex: 1 } }),
        h('button', { onClick: onResetLibrary, style: btn({ height: 32, color: '#8b97a5' }) }, 'Reset library')),
      // Workflow list
      h('div', { style: { flex: 1, overflowY: 'auto', padding: '10px 14px 16px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150 } },
        library.map((w) => {
          const isActive = w.id === activeId, c = countKinds(w.nodes), isRen = renaming && renaming.id === w.id;
          return h('div', { key: w.id, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', background: isActive ? '#13202e' : '#11161e', border: '1px solid ' + (isActive ? '#27496b' : '#1e2733'), borderRadius: 10 } },
            h('div', { style: { width: 8, height: 8, borderRadius: '50%', background: isActive ? '#5b9dff' : '#3a4654', flex: '0 0 8px' } }),
            h('div', { style: { flex: 1, minWidth: 0 } },
              isRen
                ? h('input', { autoFocus: true, value: renaming.value, onChange: (e) => onRename({ id: w.id, value: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') onCommitRename(); if (e.key === 'Escape') onRename(null); }, onBlur: onCommitRename, style: { width: '100%', background: '#0a0d12', border: '1px solid #2b3a52', color: '#e6edf5', borderRadius: 6, padding: '5px 8px', fontSize: 13, outline: 'none', fontFamily: SANS } })
                : h('div', { onClick: () => onOpen(w.id), style: { fontSize: 13.5, fontWeight: 600, color: '#e6edf5', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, w.name),
              h('div', { style: { fontSize: 10.5, color: '#6b7686', fontFamily: MONO, marginTop: 2 } }, c.agents + ' agents · ' + c.gates + ' gates · ' + (w.edges ? w.edges.length : 0) + ' edges' + (isActive ? '  ·  open' : ''))),
            h('div', { style: { display: 'flex', gap: 6 } },
              isActive ? null : h('button', { onClick: () => onOpen(w.id), style: miniBtn('#5b9dff') }, 'Open'),
              h('button', { onClick: () => onRename({ id: w.id, value: w.name }), style: miniBtn() }, 'Rename'),
              h('button', { onClick: () => onDuplicate(w.id), style: miniBtn() }, 'Duplicate'),
              h('button', { onClick: () => { if (library.length > 1) onDelete(w.id); }, style: miniBtn(library.length > 1 ? '#e07a8c' : '#4a525e') }, 'Delete')));
        })),
      // Load from repo section
      repoWorkflows !== null && h('div', { style: { borderTop: '1px solid #1d2530', padding: '12px 18px' } },
        h('div', { style: { fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', fontWeight: 600, color: '#5d6776', marginBottom: 8 } },
          repoWorkflows.length === 0 ? 'Load from repo (server not running)' : 'Load from repo (' + repoWorkflows.length + ' files)'),
        repoWorkflows.length === 0
          ? h('div', { style: { fontSize: 11, color: '#5d6776' } }, 'Start the backend: node frontend/server.js — then reload the page.')
          : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              repoWorkflows.map((name) => h('button', { key: name, onClick: () => onLoadRepo(name), disabled: repoLoading === name, style: { height: 26, padding: '0 10px', background: repoLoading === name ? '#1a1e26' : '#0c1016', border: '1px solid #2b3a52', color: repoLoading === name ? '#5d6776' : '#9fe6d4', borderRadius: 6, cursor: repoLoading === name ? 'default' : 'pointer', fontSize: 11, fontFamily: MONO } }, repoLoading === name ? 'Loading...' : name)))),
      h('div', { style: { padding: '11px 18px', borderTop: '1px solid #1d2530', fontSize: 11, color: '#5d6776' } }, 'Workflows are saved in your browser. Use Import / Export to move them as JSON.')));
}
