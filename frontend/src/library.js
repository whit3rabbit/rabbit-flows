// library.js — workflow library persistence (localStorage).
// The library is the list of workflows the user has in their browser.
// Real workflows are loaded from the backend via loadRepoWorkflow (canvas.js).

import { DIMS } from './visual.js';

export const LSKEY = 'rabbitflows:library:v1';

// seedLib — return a single blank starter workflow.
// Real workflows are loaded from the backend via "Load from repo".
export const seedLib = () => {
  const trig = {
    id: 'trigger', type: 'trigger',
    position: { x: 360, y: 60 },
    zIndex: 1, draggable: true, connectable: true, selectable: true,
    style: { width: DIMS.trigger[0], height: DIMS.trigger[1] },
    data: { kind: 'trigger', label: '/new-workflow', detail: 'slash command', model: null, schema: null, phase: null, body: null },
  };
  return [{
    id: 'starter',
    name: 'New workflow',
    desc: 'Use "Load from repo" in the Workflow manager to load a real workflow, or drag blocks from the palette to build one.',
    nodes: [trig],
    edges: [],
  }];
};

export const loadLib = () => {
  try {
    const s = localStorage.getItem(LSKEY);
    if (s) {
      const a = JSON.parse(s);
      // Require every entry to be a well-formed workflow. A malformed-but-array value
      // (e.g. [{id:'x'}] with no nodes) would otherwise reach useNodesState(undefined)
      // and crash the canvas on first render with no recovery — fall back to the seed instead.
      const ok = Array.isArray(a) && a.length &&
        a.every((w) => w && w.id != null && Array.isArray(w.nodes) && Array.isArray(w.edges));
      if (ok) return a;
      if (s) console.warn('[flow-canvas] saved library has malformed entries, using seed');
    }
  } catch (e) {
    console.warn('[flow-canvas] corrupt saved library, using seed:', e && e.message);
  }
  return seedLib();
};

export const persistLib = (lib) => {
  try {
    localStorage.setItem(LSKEY, JSON.stringify(lib));
  } catch (e) {
    console.warn('[flow-canvas] library NOT saved (localStorage quota/disabled):', e && e.message);
  }
};

// wfUid — a short unique id for new workflows.
// Uses Date.now + random suffix; this is fine in UI context (not a security primitive).
export const wfUid = () => 'wf' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

export const countKinds = (ns) => ({
  agents: ns.filter((n) => n.data && n.data.kind === 'agent').length,
  gates:  ns.filter((n) => n.data && n.data.kind === 'gate').length,
});
