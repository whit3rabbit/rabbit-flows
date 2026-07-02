// canvas-library-ops.js — library CRUD + repo-load/save handlers for the canvas Shell.
// Extracted from canvas.js to keep it under the 400-line file cap (see frontend/CLAUDE.md).
//
// A factory, not standalone module functions: each handler closes over the current render's
// state/setters, passed in fresh on every Shell() render — this mirrors the original inline
// closures exactly (React guarantees setState-function identity stability across renders, and
// reading current-render values here is behaviorally identical to reading them via a direct
// closure in Shell() itself).

import { seedLib, persistLib, wfUid } from './library.js';
import { fetchWorkflowSource, saveWorkflow, validateSource } from './api.js';
import { toRFNodes, toRFEdges } from './graph.js';
import { DIMS } from './visual.js';

export function makeLibraryOps(deps) {
  const {
    library, activeId, nodes, edges, renaming, generatedCode, metaName,
    setLibrary, setNodes, setEdges, setActiveId, setSelId, setManagerOpen,
    setRenaming, setLastSaved, setLossyCount, setRepoLoading, setValidateResult,
    fitRetry, showToast,
  } = deps;

  const saveInto = (lib) => lib.map((w) => w.id === activeId ? Object.assign({}, w, { nodes, edges }) : w);

  const openWorkflow = (id) => {
    if (id === activeId) { setManagerOpen(false); return; }
    const lib2 = saveInto(library), w = lib2.find((x) => x.id === id);
    setLibrary(lib2); persistLib(lib2);
    if (w) { setNodes(w.nodes); setEdges(w.edges); setActiveId(id); }
    setSelId(null); setManagerOpen(false); fitRetry(); setLossyCount(null);
  };

  const newWorkflow = () => {
    const lib2 = saveInto(library), id = wfUid();
    const trig = { id: 'trigger', type: 'trigger', position: { x: 360, y: 60 }, zIndex: 1, draggable: true, connectable: true, selectable: true, style: { width: DIMS.trigger[0], height: DIMS.trigger[1] }, data: { kind: 'trigger', label: '/new-workflow', detail: 'slash command', model: null, schema: null, phase: null, body: null } };
    const w = { id, name: 'Untitled workflow', desc: 'A new workflow — drag blocks from the palette to build it out.', nodes: [trig], edges: [] };
    const nl = lib2.concat([w]); setLibrary(nl); persistLib(nl);
    setNodes(w.nodes); setEdges(w.edges); setActiveId(id); setSelId(null); setManagerOpen(false); fitRetry();
  };

  const duplicateWorkflow = (id) => {
    const base = id === activeId ? saveInto(library) : library;
    const src = base.find((w) => w.id === id); if (!src) return;
    const copy = { id: wfUid(), name: src.name + ' copy', desc: src.desc, nodes: JSON.parse(JSON.stringify(src.nodes)), edges: JSON.parse(JSON.stringify(src.edges)) };
    const nl = base.concat([copy]); setLibrary(nl); persistLib(nl);
  };

  const deleteWorkflow = (id) => {
    const nl = library.filter((w) => w.id !== id);
    const finalLib = nl.length ? nl : seedLib();
    setLibrary(finalLib); persistLib(finalLib);
    if (id === activeId) { const w = finalLib[0]; setNodes(w.nodes); setEdges(w.edges); setActiveId(w.id); setSelId(null); fitRetry(); }
  };

  const commitRename = () => {
    if (!renaming) return;
    const { id, value } = renaming;
    const nl = library.map((w) => w.id === id ? Object.assign({}, w, { name: (value || '').trim() || w.name }) : w);
    setLibrary(nl); persistLib(nl); setRenaming(null);
  };

  const exportActive = () => {
    const w = saveInto(library).find((x) => x.id === activeId); if (!w) return;
    const blob = new Blob([JSON.stringify({ name: w.name, desc: w.desc, nodes: w.nodes, edges: w.edges }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (w.name || 'workflow').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const importFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result), id = wfUid();
        const VALID_KINDS = new Set(['trigger', 'knob', 'agent', 'gate', 'parallel', 'loop', 'phase', 'skill', 'lossy']);
        const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
        // Coerce ids to strings and drop duplicates so a hand-authored/foreign file can't make
        // two nodes share an id (breaks selection/deletion). Edges match on the string id set.
        const ids = new Set();
        const okNodes = rawNodes
          .filter((n) => n && n.id != null && n.position && n.data && VALID_KINDS.has(n.data.kind))
          // type drives ReactFlow's nodeTypes lookup; a hand-authored file may set only data.kind.
          .map((n) => Object.assign({}, n, { id: String(n.id), type: n.type || n.data.kind }))
          .filter((n) => !ids.has(n.id) && ids.add(n.id));
        const okEdges = (Array.isArray(o.edges) ? o.edges : [])
          .filter((e) => e && ids.has(String(e.source)) && ids.has(String(e.target)))
          .map((e) => Object.assign({}, e, { source: String(e.source), target: String(e.target) }));
        const w = { id, name: o.name || f.name.replace(/\.json$/i, '') || 'Imported', desc: o.desc || 'Imported workflow.', nodes: okNodes, edges: okEdges };
        const nl = saveInto(library).concat([w]); setLibrary(nl); persistLib(nl);
        setNodes(w.nodes); setEdges(w.edges); setActiveId(id); setSelId(null); setManagerOpen(false); fitRetry();
        const dropped = rawNodes.length - okNodes.length;
        showToast('Imported "' + w.name + '"' + (dropped > 0 ? ' (' + dropped + ' malformed node(s) skipped)' : ''));
      } catch (_) { showToast('Import failed — invalid JSON'); }
    };
    r.onerror = () => showToast('Import failed — could not read file');
    r.readAsText(f); e.target.value = '';
  };

  const resetLibrary = () => {
    const nl = seedLib(); setLibrary(nl); persistLib(nl);
    const w = nl[0]; setNodes(w.nodes); setEdges(w.edges); setActiveId(w.id);
    setSelId(null); setManagerOpen(false); fitRetry(); showToast('Library reset');
  };

  const loadRepoWorkflow = async (name) => {
    setRepoLoading(name);
    try {
      const { source } = await fetchWorkflowSource(name);
      const parser = await import('/parser.js');
      const { meta, nodes: pNodes, edges: pEdges, lossy } = parser.parseWorkflow(source);
      const metaName2 = meta.name || name.replace(/\.js$/, '');
      const metaDesc = meta.description || 'Loaded from repo.';
      const lossyNodes = lossy.map((l, i) => {
        const last = pNodes[pNodes.length - 1];
        const baseY = last ? last.y + (last.h || 84) + 40 + i * 110 : 200 + i * 110;
        return {
          id: '__lossy_' + i, kind: 'lossy',
          label: 'line ' + l.line + ': ' + l.reason,
          snippet: l.snippet, fix: l.fix,
          model: null, schema: null, phase: null, detail: null, body: null,
          x: (last ? last.x : 353), y: baseY, w: 280, h: 88,
        };
      });
      const internalGraph = { metaName: metaName2, metaDesc, nodes: pNodes.concat(lossyNodes), edges: pEdges };
      const wf = { id: name, name: metaName2, desc: metaDesc, nodes: toRFNodes(internalGraph), edges: toRFEdges(internalGraph) };
      const lib2 = saveInto(library);
      const existing = lib2.findIndex((w) => w.id === name);
      const nl = existing >= 0 ? lib2.map((w, i) => i === existing ? wf : w) : lib2.concat([wf]);
      setLibrary(nl); persistLib(nl);
      setNodes(wf.nodes); setEdges(wf.edges); setActiveId(wf.id);
      setSelId(null); setManagerOpen(false); fitRetry();
      setLossyCount(lossy.length);
      if (lossy.length) {
        const first = lossy[0];
        showToast(lossy.length + ' section(s) could not be parsed. First issue at line ' + first.line + ': ' + first.reason + '. Fix: ' + first.fix);
      } else showToast('Loaded "' + metaName2 + '" from repo');
    } catch (err) {
      showToast('Load failed: ' + err.message);
    } finally {
      setRepoLoading(null);
    }
  };

  const saveToRepo = async () => {
    const src  = generatedCode;
    const slug = (metaName || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
    const fname = window.prompt('Save generated workflow to .claude/workflows/', slug + '.js');
    if (!fname) return;
    try {
      let { data, status } = await saveWorkflow(fname, src, false);
      if (status === 409) {
        if (!window.confirm(fname + ' already exists. Overwrite it? (the regenerated code is lossy)')) return;
        ({ data } = await saveWorkflow(fname, src, true));
      }
      if (data.ok) setLastSaved(fname.replace(/\.js$/, '')); // enable bundle download for this file
      showToast(data.ok ? 'Saved → .claude/workflows/' + fname : 'Save failed: ' + (data.error || status));
    } catch (err) {
      showToast('Save failed: ' + err.message + ' (is the server running?)');
    }
  };

  const runValidate = async () => {
    const src = generatedCode;
    setValidateResult({ pending: true });
    try {
      const data = await validateSource(src);
      setValidateResult({ ok: data.ok, output: data.output || '' });
    } catch (err) {
      setValidateResult({ ok: false, output: 'Network error: ' + err.message + '\n(Is the server running? node frontend/server.js)' });
    }
  };

  return {
    saveInto, openWorkflow, newWorkflow, duplicateWorkflow, deleteWorkflow, commitRename,
    exportActive, importFile, resetLibrary, loadRepoWorkflow, saveToRepo, runValidate,
  };
}
