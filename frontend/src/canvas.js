// canvas.js — Shell React component: application state and layout.
// Delegates rendering to toolbar/palette/inspector/manager/codepanel/flowpane modules.

import { SANS, MONO, DIMS, EC } from './visual.js';
import { edgeStyle } from './graph.js';
import { edgeTypeFor, connectionAllowed } from './schema.js';
import { genCode }                          from './codegen.js';
import { loadLib, countKinds } from './library.js';
import { fetchWorkflowList, fetchSkillCatalog, downloadBundle } from './api.js';
import { buildInspector }    from './inspector.js';
import { buildManagerOverlay } from './manager.js';
import { buildCodePanel }     from './codepanel.js';
import { buildPalette }       from './palette.js';
import { buildToolbar }       from './toolbar.js';
import { buildFlowPane }      from './flowpane.js';
import { makeLibraryOps }     from './canvas-library-ops.js';

let React, h, RF, addEdge, ReactFlowProvider,
    useNodesState, useEdgesState, useReactFlow, MarkerType;

export function initCanvas(ReactIn, RFIn) {
  React = ReactIn; RF = RFIn; h = React.createElement;
  ({ addEdge, ReactFlowProvider, useNodesState, useEdgesState, useReactFlow, MarkerType } = RF);
}

let UID = 1000;

export function Shell() {
  const rf = useReactFlow();
  const wrapRef = React.useRef(null);
  const initLib  = React.useMemo(loadLib, []);
  const [library,      setLibrary]      = React.useState(initLib);
  const [activeId,     setActiveId]     = React.useState(initLib[0].id);
  const [nodes,        setNodes,        onNodesChange] = useNodesState(initLib[0].nodes);
  const [edges,        setEdges,        onEdgesChange] = useEdgesState(initLib[0].edges);
  const [selId,        setSelId]        = React.useState(null);
  const [codeOpen,     setCodeOpen]     = React.useState(false);
  // basename (no .js) of the last workflow saved this session — gates "Download bundle", which
  // reads the on-disk file, so it only makes sense once a save has written one.
  const [lastSaved,    setLastSaved]    = React.useState(null);
  const [managerOpen,  setManagerOpen]  = React.useState(false);
  const [renaming,     setRenaming]     = React.useState(null);
  const [toast,        setToast]        = React.useState(null);
  const toastT = React.useRef(null);
  // validateResult: null | { ok: bool, output: string } | { pending: true }
  const [validateResult, setValidateResult] = React.useState(null);
  // repoWorkflows: null = not loaded yet; [] = server down or empty
  const [repoWorkflows,  setRepoWorkflows]  = React.useState(null);
  const [lossyCount,     setLossyCount]     = React.useState(null);
  const [repoLoading,    setRepoLoading]    = React.useState(null);
  const [skillCatalog,   setSkillCatalog]   = React.useState([]);

  // ── mount effects ──────────────────────────────────────────────────────
  React.useEffect(() => { fetchWorkflowList().then(setRepoWorkflows); }, []);
  React.useEffect(() => { fetchSkillCatalog().then(setSkillCatalog); }, []);

  // ── viewport helpers ───────────────────────────────────────────────────
  const myFit = React.useCallback(() => {
    const pane = wrapRef.current;
    if (!pane) return false;
    window.dispatchEvent(new Event('resize'));
    const ns = rf.getNodes().filter((n) => n.width);
    if (!ns.length) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ns.forEach((n) => {
      const w = n.width, hh = n.height || 60;
      x0 = Math.min(x0, n.position.x); y0 = Math.min(y0, n.position.y);
      x1 = Math.max(x1, n.position.x + w); y1 = Math.max(y1, n.position.y + hh);
    });
    const cw = pane.clientWidth, ch = pane.clientHeight, bw = x1 - x0, bh = y1 - y0;
    const z = Math.max(0.2, Math.min((cw * 0.86) / bw, (ch * 0.86) / bh, 1.5));
    rf.setViewport({ x: (cw - bw * z) / 2 - x0 * z, y: (ch - bh * z) / 2 - y0 * z, zoom: z });
    return true;
  }, [rf]);

  const zoomBy = React.useCallback((f) => {
    const pane = wrapRef.current; if (!pane) return;
    window.dispatchEvent(new Event('resize'));
    const vp = rf.getViewport();
    const z2 = Math.max(0.2, Math.min(1.8, vp.zoom * f));
    const cx = pane.clientWidth / 2, cy = pane.clientHeight / 2;
    const wx = (cx - vp.x) / vp.zoom, wy = (cy - vp.y) / vp.zoom;
    rf.setViewport({ x: cx - wx * z2, y: cy - wy * z2, zoom: z2 });
  }, [rf]);

  const fitBusy = React.useRef(false);
  const fitRetry = React.useCallback(() => {
    if (fitBusy.current) return;
    fitBusy.current = true;
    let tries = 0;
    const t = () => {
      tries++;
      const before = JSON.stringify(rf.getViewport());
      myFit();
      if (JSON.stringify(rf.getViewport()) !== before) { fitBusy.current = false; return; }
      if (tries < 40) setTimeout(t, 90); else fitBusy.current = false;
    };
    setTimeout(t, 80);
  }, [rf, myFit]);

  React.useEffect(() => { fitRetry(); }, []);

  // Persistent measure loop: RF's ResizeObserver doesn't fire in this embedded context.
  const idSig = nodes.map((n) => n.id).join('|');
  React.useEffect(() => {
    let idle = 0;
    const stamp = () => {
      const root = wrapRef.current && wrapRef.current.querySelector('.react-flow');
      if (!root) return;
      const z = rf.getViewport().zoom || 1;
      const upd = {};
      rf.getNodes().forEach((n) => {
        if (n.width != null) return;
        const el = root.querySelector('.react-flow__node[data-id="' + n.id + '"]');
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width) upd[n.id] = [Math.round(r.width / z), Math.round(r.height / z)];
      });
      if (Object.keys(upd).length) {
        idle = 0;
        setNodes((nds) => nds.map((n) => upd[n.id] ? Object.assign({}, n, { width: upd[n.id][0], height: upd[n.id][1] }) : n));
        return;
      }
      if (rf.getNodes().every((n) => n.width != null) && ++idle > 2) clearInterval(iv);
    };
    const iv = setInterval(stamp, 150);
    return () => clearInterval(iv);
  }, [idSig]);

  const showToast = (m) => { clearTimeout(toastT.current); setToast(m); toastT.current = setTimeout(() => setToast(null), 2600); };

  const active = library.find((w) => w.id === activeId) || library[0];
  const g = { metaName: active.name, metaDesc: active.desc };

  // genCode is otherwise recomputed up to 3x per render (code panel + validate + save). Memoize on
  // the inputs that affect output; key on skillCatalog (stable) not catalogNamesList (new array each
  // render, which would defeat the memo).
  const generatedCode = React.useMemo(
    () => genCode(nodes, edges, active.name, active.desc, skillCatalog.map((s) => s.name)),
    [nodes, edges, active.name, active.desc, skillCatalog],
  );

  // ── library + repo operations — see canvas-library-ops.js ─────────────
  const fileRef = React.useRef(null);
  const {
    openWorkflow, newWorkflow, duplicateWorkflow, deleteWorkflow, commitRename,
    exportActive, importFile, resetLibrary, loadRepoWorkflow, saveToRepo, runValidate,
  } = makeLibraryOps({
    library, activeId, nodes, edges, renaming, generatedCode, metaName: g.metaName,
    setLibrary, setNodes, setEdges, setActiveId, setSelId, setManagerOpen,
    setRenaming, setLastSaved, setLossyCount, setRepoLoading, setValidateResult,
    fitRetry, showToast,
  });

  // ── canvas event handlers ──────────────────────────────────────────────
  // Type the new edge from the connected nodes' kinds (schema.js): skill/knob sources become
  // skill/data attachments, everything else a flow edge. An impossible pair falls back to flow,
  // but isValidConnection below blocks it from being drawn in the first place.
  // Back kindOf with a ref-held Map instead of closing over [nodes], so it (and the
  // onConnect/isValidConnection handlers below) keep a stable identity and stop churning
  // ReactFlow's props on every node change. The ref lags one render behind a kind edit, but
  // both handlers fire only on user connect gestures (async to render), by which time the
  // effect has run.
  const kindMapRef = React.useRef(new Map());
  React.useEffect(() => { kindMapRef.current = new Map(nodes.map((n) => [n.id, n.data.kind])); }, [nodes]);
  const kindOf = React.useCallback((id) => kindMapRef.current.get(id), []);
  const onConnect = React.useCallback((params) => {
    // edgeTypeFor only ever returns skill/data/flow (loop is never auto-assigned), so there is no
    // 'loop' case to handle here.
    const et = edgeTypeFor(kindOf(params.source), kindOf(params.target)) || 'flow';
    setEdges((eds) => addEdge(Object.assign({}, params, {
      type: 'default',
      animated: et === 'flow',
      style: edgeStyle(et),
      markerEnd: { type: MarkerType.ArrowClosed, color: EC[et] || EC.flow, width: 15, height: 15 },
      data: { kind: et },
    }), eds));
  }, [setEdges, kindOf]);
  // Reject a drag whose source/target kinds have no rule (e.g. phase -> agent, agent -> trigger).
  const isValidConnection = React.useCallback(
    (c) => connectionAllowed(kindOf(c.source), kindOf(c.target)), [kindOf]);

  const onNodeClick = React.useCallback((_, n) => setSelId(n.id), []);
  const onPaneClick = React.useCallback(() => setSelId(null), []);

  const patchData = (id, patch) =>
    setNodes((nds) => nds.map((n) => n.id === id ? Object.assign({}, n, { data: Object.assign({}, n.data, patch) }) : n));

  const delNode = (id) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelId(null);
  };

  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/flowkind');
    if (!kind || !wrapRef.current) return;
    const b   = wrapRef.current.getBoundingClientRect();
    const pos = rf.project({ x: e.clientX - b.left, y: e.clientY - b.top });
    const dim = DIMS[kind] || [234, 84];
    // Time-stamped suffix so a dropped node can't collide with ids carried in from an imported
    // or repo-loaded workflow (which may already use 'n1000'-style ids). UID keeps it unique
    // within the same millisecond.
    const id  = 'n' + Date.now().toString(36) + (UID++);
    const defs = { agent: { label: 'New agent', model: 'sonnet', schema: 'OUTPUT_SCHEMA', detail: 'describe the step' }, gate: { label: 'New gate', model: 'opus', schema: 'GATE_SCHEMA', detail: 'admission decision' }, parallel: { label: 'Parallel group' }, loop: { label: 'Loop' }, phase: { label: 'Phase' }, skill: { label: 'new-skill', detail: 'requires-skills · CLI' }, knob: { label: 'Knob', body: 'arg: default' } }[kind] || {};
    const isC = kind === 'loop' || kind === 'parallel';
    const node = { id, type: kind, position: { x: Math.round(pos.x - dim[0] / 2), y: Math.round(pos.y - dim[1] / 2) }, zIndex: isC ? 0 : 1, draggable: true, connectable: !isC, selectable: true, style: { width: dim[0], height: dim[1] }, data: Object.assign({ kind, label: '', model: null, schema: null, phase: null, detail: null, body: null }, defs) };
    setNodes((nds) => nds.concat(node));
    setSelId(id);
  };

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); delNode(selId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selId]);

  // local graph validation (stats + cycle check — does NOT call the server)
  const validate = () => {
    const { agents: ag, gates: ga } = countKinds(nodes);
    const adj = {};
    edges.forEach((e) => { (adj[e.source] = adj[e.source] || []).push(e.target); });
    const state = {}; let cyclic = false;
    const dfs = (id) => { state[id] = 1; for (const nx of (adj[id] || [])) { if (state[nx] === 1) { cyclic = true; return; } if (!state[nx]) { dfs(nx); if (cyclic) return; } } state[id] = 2; };
    for (const n of nodes) { if (!state[n.id]) dfs(n.id); if (cyclic) break; }
    showToast(ag + ' agents · ' + ga + ' gates · ' + edges.length + ' edges — graph ' + (cyclic ? 'has a CYCLE' : 'is acyclic'));
  };

  // ── rendered sections ──────────────────────────────────────────────────
  const sel = selId ? nodes.find((n) => n.id === selId) : null;

  // Toolbar — delegates to toolbar.js
  const toolbar = buildToolbar({
    activeName: active.name,
    onOpenMgr:  () => setManagerOpen(true),
    onFit:      () => myFit(),
    onValidate: validate,
    onZoomIn:   () => zoomBy(1.18),
    onZoomOut:  () => zoomBy(1 / 1.18),
    onGenCode:  () => { setValidateResult(null); setCodeOpen(true); },
  });

  // Palette — delegates to palette.js
  const palette = buildPalette({ skillCount: skillCatalog.length });

  // Inspector (right sidebar) — delegates to inspector.js
  const inspectorContent = buildInspector({ sel, nodes, edges, skillCatalog, g, patchData, delNode });
  const inspectorAside = h('aside', { style: { width: 294, flex: '0 0 294px', background: '#0e1219', borderLeft: '1px solid #1d2530', overflowY: 'auto', zIndex: 20, fontFamily: SANS } }, inspectorContent);

  // Canvas pane — delegates to flowpane.js
  const flow = buildFlowPane({ wrapRef, nodes, edges, onNodesChange, onEdgesChange, onConnect, isValidConnection, onNodeClick, onPaneClick, onDragOver, onDrop, nodeTypes: _nodeTypes, lossyCount });

  // Status bar — one pass instead of two throwaway .filter() arrays per render. nodeCount is
  // non-container nodes (not countKinds().agents, which counts agents only).
  const { nodeCount, gateCount } = nodes.reduce((acc, n) => {
    const k = n.data.kind;
    if (k !== 'loop' && k !== 'parallel') acc.nodeCount++;
    if (k === 'gate') acc.gateCount++;
    return acc;
  }, { nodeCount: 0, gateCount: 0 });
  const status = h('div', { style: { height: 30, flex: '0 0 30px', display: 'flex', alignItems: 'center', gap: 16, padding: '0 14px', background: '#0c1016', borderTop: '1px solid #1d2530', fontSize: 11, color: '#6b7686', fontFamily: MONO, zIndex: 25 } },
    h('div', null, g.metaName + '  ·  ' + nodeCount + ' nodes  ·  ' + gateCount + ' gates  ·  ' + edges.length + ' edges'),
    h('div', { style: { flex: 1 } }),
    h('div', null, 'scroll to zoom · drag canvas to pan · drag handle to connect'));

  // Overlays (toast, code modal, manager modal)
  const overlays = [];
  if (toast) overlays.push(h('div', { key: 'toast', style: { position: 'absolute', bottom: 46, left: '50%', transform: 'translateX(-50%)', background: '#11161e', border: '1px solid #243b30', color: '#bfe9d4', padding: '9px 16px', borderRadius: 9, fontSize: 12, display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 8px 26px rgba(0,0,0,.5)', zIndex: 60, fontFamily: SANS } }, h('span', { style: { color: '#2dd4bf', fontSize: 14 } }, '✓'), toast));

  // Code panel modal — delegates to codepanel.js
  const closeCode = () => { setCodeOpen(false); setValidateResult(null); };
  const codePanel = buildCodePanel({
    codeOpen,
    code: codeOpen ? generatedCode : '',
    validateResult,
    metaName: g.metaName,
    onClose:    closeCode,
    onValidate: () => { setValidateResult(null); runValidate(); },
    onSave:     saveToRepo,
    bundleName: lastSaved, // null until saved this session → button stays disabled
    onExportBundle: () => { if (lastSaved) downloadBundle(lastSaved); },
  });
  if (codePanel) overlays.push(codePanel);

  // Manager modal — delegates to manager.js
  const mgr = buildManagerOverlay({
    managerOpen, library, activeId, renaming, repoWorkflows, repoLoading,
    onClose:        () => { commitRename(); setManagerOpen(false); },
    onOpen:         openWorkflow,
    onNew:          newWorkflow,
    onRename:       setRenaming,
    onCommitRename: commitRename,
    onDuplicate:    duplicateWorkflow,
    onDelete:       deleteWorkflow,
    onImportClick:  () => fileRef.current && fileRef.current.click(),
    onExportActive: exportActive,
    onResetLibrary: resetLibrary,
    onLoadRepo:     loadRepoWorkflow,
  });
  if (mgr) overlays.push(mgr);

  return h('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#0b0e13', color: '#cdd6e2', fontFamily: SANS, fontSize: 13, overflow: 'hidden' } },
    toolbar,
    h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } }, palette, flow, inspectorAside),
    status, overlays,
    h('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', onChange: importFile, style: { display: 'none' } }));
}

let _nodeTypes = {};
export function setNodeTypes(nt) { _nodeTypes = nt; }

export function App() { return h(ReactFlowProvider, null, h(Shell)); }
