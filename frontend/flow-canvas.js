// Flow Designer — real React Flow front end for composing rabbit-flows workflows.
// Loads React + ReactDOM + React Flow (v11 UMD) from CDN, then mounts an isolated React root
// inside a <flow-canvas> custom element (independent of the host DC's React).
(function () {
  // Vendored locally (frontend/vendor/) and served by server.js — no CDN. This removes the
  // supply-chain / MITM surface a CDN <script> without SRI carried (a compromised or
  // MITM'd CDN could inject arbitrary JS with full page privileges). To upgrade, re-pin and
  // re-download the files (react@18.3.1, react-dom@18.3.1, reactflow@11.11.4).
  const CSS = '/vendor/reactflow.style.css';
  const LIBS = [
    '/vendor/react.production.min.js',
    '/vendor/react-dom.production.min.js',
    '/vendor/reactflow.umd.min.js',
  ];
  const loadCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('failed ' + src)); document.head.appendChild(s); });
  // Mutating endpoints are loopback-open; for a network-exposed server (RFD_TOKEN set) the
  // operator stores the token under localStorage 'rfd_token' and it rides as a bearer header.
  const authHeaders = () => { try { const t = localStorage.getItem('rfd_token'); return t ? { Authorization: 'Bearer ' + t } : {}; } catch (_) { return {}; } };

  async function boot() {
    loadCss(CSS);
    for (const src of LIBS) await loadScript(src);
    const React = window.React, ReactDOM = window.ReactDOM, RF = window.ReactFlow;
    const h = React.createElement;
    const ReactFlowComp = RF.ReactFlow || RF.default || RF;
    const { Background, Controls, MiniMap, ReactFlowProvider, useNodesState, useEdgesState, useReactFlow, addEdge, Handle, Position, MarkerType } = RF;

    // ---------- visual system ----------
    const KINDS = {
      trigger:  { color: '#f472b6', icon: '\u25B6', label: 'Trigger' },
      knob:     { color: '#38bdf8', icon: '\u2699', label: 'Knob' },
      agent:    { color: '#5b9dff', icon: '\u25C7', label: 'Agent' },
      gate:     { color: '#f5a524', icon: '\u25C8', label: 'Gate' },
      parallel: { color: '#a855f7', icon: '\u22D4', label: 'Parallel' },
      loop:     { color: '#2dd4bf', icon: '\u21BB', label: 'Loop' },
      phase:    { color: '#94a3b8', icon: '\u25AD', label: 'Phase' },
      skill:    { color: '#34d399', icon: '\u25C6', label: 'Skill' },
      lossy:    { color: '#f5a524', icon: '\u26A0', label: 'Unparsed' },
    };
    const MODELS = { opus: '#c084fc', sonnet: '#5b9dff', haiku: '#5eead4' };
    const EC = { flow: '#5b6675', loop: '#2dd4bf', skill: '#34d399', data: '#38bdf8' };
    const MONO = "'IBM Plex Mono', ui-monospace, monospace";
    const SANS = "'IBM Plex Sans', system-ui, sans-serif";
    const DIMS = { trigger: [196, 48], knob: [200, 96], agent: [234, 84], gate: [234, 84], skill: [184, 60], phase: [240, 44], parallel: [300, 180], loop: [320, 226], lossy: [280, 60] };

    // ---------- custom nodes ----------
    const dotHandle = (col) => ({ width: 9, height: 9, background: col, border: '2px solid #0b0e13', borderRadius: '50%' });

    function LeafNode(props) {
      const d = props.data, sel = props.selected, def = KINDS[d.kind], col = def.color;
      const isTrig = d.kind === 'trigger', isPhase = d.kind === 'phase';
      const hasTB = d.kind === 'agent' || d.kind === 'gate';
      const sideSource = d.kind === 'knob' || d.kind === 'skill';
      const bg = isTrig ? '#161019' : isPhase ? '#0f141b' : '#141922';
      const kids = [];
      if (hasTB) {
        kids.push(h(Handle, { key: 't', type: 'target', position: Position.Top, style: dotHandle(col) }));
        kids.push(h(Handle, { key: 's', type: 'source', position: Position.Bottom, style: dotHandle(col) }));
      } else if (isTrig) {
        kids.push(h(Handle, { key: 's', type: 'source', position: Position.Bottom, style: dotHandle(col) }));
      } else if (sideSource) {
        kids.push(h(Handle, { key: 's', type: 'source', position: Position.Right, style: dotHandle(col) }));
        kids.push(h(Handle, { key: 't', type: 'target', position: Position.Left, style: Object.assign(dotHandle(col), { opacity: 0 }) }));
      } else { // phase / terminal
        kids.push(h(Handle, { key: 't', type: 'target', position: Position.Top, style: dotHandle(col) }));
      }
      // header
      const header = h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 } },
        h('div', { style: { width: 9, height: 9, borderRadius: 3, background: col, boxShadow: '0 0 8px ' + col + '88' } }),
        h('div', { style: { fontSize: 9.5, letterSpacing: .7, textTransform: 'uppercase', fontWeight: 600, color: '#6b7686' } }, def.label),
        h('div', { style: { flex: 1 } }),
        d.phase ? h('div', { style: { fontSize: 9, color: '#5d6776', fontFamily: MONO, background: '#0c1016', border: '1px solid #20283366', padding: '1px 5px', borderRadius: 4 } }, d.phase) : null
      );
      const body = [header, h('div', { key: 'ti', style: { fontSize: 13, fontWeight: 600, color: '#e6edf5', lineHeight: 1.25 } }, d.label)];
      if (d.detail) body.push(h('div', { key: 'de', style: { fontSize: 10.5, color: '#7c8694', marginTop: 3, lineHeight: 1.35 } }, d.detail));
      if (d.body) body.push(h('div', { key: 'bo', style: { fontSize: 10.5, color: '#8e99a8', marginTop: 5, whiteSpace: 'pre-line', fontFamily: MONO, lineHeight: 1.5 } }, d.body));
      if (d.model || d.schema) {
        const f = [];
        if (d.model) f.push(h('div', { key: 'm', style: { fontSize: 9.5, fontWeight: 600, fontFamily: MONO, color: MODELS[d.model], background: MODELS[d.model] + '1a', border: '1px solid ' + MODELS[d.model] + '40', padding: '2px 7px', borderRadius: 5 } }, d.model));
        if (d.schema) f.push(h('div', { key: 's', style: { fontSize: 9.5, color: '#8a94a3', fontFamily: MONO, background: '#0c1016', border: '1px solid #1e2733', padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 } }, d.schema));
        body.push(h('div', { key: 'ft', style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 } }, f));
      }
      kids.push(h('div', { key: 'in', style: { padding: isTrig || isPhase ? '9px 13px' : '11px 13px' } }, body));
      return h('div', { style: { width: '100%', height: '100%', background: bg, border: '1px solid ' + (sel ? col : '#283039'), borderLeft: '3px solid ' + col, borderRadius: 10, boxShadow: sel ? '0 0 0 1px ' + col + ',0 10px 30px rgba(0,0,0,.45)' : '0 2px 10px rgba(0,0,0,.3)', overflow: 'hidden', fontFamily: SANS } }, kids);
    }

    function ContainerNode(props) {
      const d = props.data, sel = props.selected, def = KINDS[d.kind], col = def.color;
      return h('div', { style: { width: '100%', height: '100%', border: '1.5px dashed ' + col + '66', background: col + '0d', borderRadius: 14, position: 'relative', boxShadow: sel ? '0 0 0 2px ' + col : 'none', fontFamily: SANS } },
        h('div', { style: { position: 'absolute', top: -11, left: 14, background: '#0b0e13', padding: '0 8px', fontSize: 10.5, fontWeight: 600, color: col, letterSpacing: .4 } }, def.icon + '  ' + d.label));
    }

    // LossyNode: placeholder for a workflow section the parser could not parse.
    // Rendered with an amber warning style; not connectable in the palette sense
    // but the graph may wire flow edges to/from it.
    function LossyNode(props) {
      const d = props.data, sel = props.selected;
      const col = '#f5a524';
      return h('div', { style: { width: '100%', height: '100%', background: '#1a1200', border: '1px solid ' + (sel ? col : '#5a3800'), borderLeft: '3px solid ' + col, borderRadius: 10, boxShadow: sel ? '0 0 0 1px ' + col : '0 2px 10px rgba(0,0,0,.3)', overflow: 'hidden', fontFamily: SANS, display: 'flex', alignItems: 'center', gap: 8, padding: '0 13px' } },
        h(Handle, { type: 'target', position: Position.Top, style: { width: 9, height: 9, background: col, border: '2px solid #0b0e13', borderRadius: '50%' } }),
        h('div', { style: { fontSize: 14, color: col } }, '⚠'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 9.5, letterSpacing: .7, textTransform: 'uppercase', fontWeight: 600, color: '#7a5a1a' } }, 'Unparsed section'),
          h('div', { style: { fontSize: 11.5, color: '#c49a30', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, d.label || 'unrecognized construct')),
        h(Handle, { type: 'source', position: Position.Bottom, style: { width: 9, height: 9, background: col, border: '2px solid #0b0e13', borderRadius: '50%' } }));
    }

    const nodeTypes = { agent: LeafNode, gate: LeafNode, skill: LeafNode, knob: LeafNode, trigger: LeafNode, phase: LeafNode, parallel: ContainerNode, loop: ContainerNode, lossy: LossyNode };

    // ---------- graph data (internal shape) ----------
    let UID = 1000;
    const N = (o) => Object.assign({ w: (DIMS[o.kind] || [234, 84])[0], h: (DIMS[o.kind] || [234, 84])[1], model: null, schema: null, phase: null, detail: null, body: null }, o);

    // ---------- converters: internal shape -> RF ----------
    const toRFNodes = (g) => g.nodes.map((n) => {
      const isC = n.kind === 'loop' || n.kind === 'parallel';
      return { id: n.id, type: n.kind, position: { x: n.x, y: n.y }, zIndex: isC ? 0 : 1, draggable: true, connectable: !isC, selectable: true, style: { width: n.w, height: n.h }, data: { kind: n.kind, label: n.label, model: n.model, schema: n.schema, phase: n.phase, detail: n.detail, body: n.body } };
    });
    const edgeStyle = (type) => ({ stroke: EC[type] || EC.flow, strokeWidth: type === 'flow' ? 1.7 : 1.5, strokeDasharray: (type === 'skill' || type === 'data') ? '5 5' : undefined, opacity: (type === 'skill' || type === 'data') ? 0.6 : 0.92 });
    const toRFEdges = (g) => g.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, type: e.type === 'loop' ? 'smoothstep' : 'default', animated: e.type === 'flow' || e.type === 'loop', style: edgeStyle(e.type), markerEnd: { type: MarkerType.ArrowClosed, color: EC[e.type] || EC.flow, width: 15, height: 15 }, data: { kind: e.type } }));

    // ---------- code generation ----------
    const camel = (s) => { const w = String(s).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' '); return w.map((x, i) => i ? x.charAt(0).toUpperCase() + x.slice(1) : x.toLowerCase()).join('') || 'step'; };
    // genCode: emit a workflow .js that passes validate.py --strict.
    // Rules (from validate.py): meta must have name+description as pure literals (no ${}, no ..., no
    // function calls); parallel()/pipeline() results need .filter(Boolean); phase() calls must match
    // meta.phases titles exactly; no Date.now/Math.random/new Date; no fs/child_process imports.
    function genCode(nodes, edges, metaName, metaDesc, catalogNames) {
      const conts = nodes.filter((n) => n.data.kind === 'loop' || n.data.kind === 'parallel');
      // Node dims: prefer the stamped style (set at creation) over measured width/height, which
      // RF populates only asynchronously here — so genCode works the instant after load/drop.
      const dimOf = (n) => {
        const fb = DIMS[n.data.kind] || [234, 84];
        const w = (n.style && n.style.width) || n.width || fb[0];
        const hh = (n.style && n.style.height) || n.height || fb[1];
        return [w, hh];
      };
      // Container membership: a leaf is inside a container if its centre falls within the container bounds.
      const cidOf = (n) => {
        const [nw, nh] = dimOf(n);
        const px = n.position.x + nw / 2, py = n.position.y + nh / 2;
        const c = conts.find((c) => { const [cw, ch] = dimOf(c); return px >= c.position.x && px <= c.position.x + cw && py >= c.position.y && py <= c.position.y + ch; });
        return c ? c.id : null;
      };
      // Unique JS identifiers: two labels can camel-collapse to the same name -> duplicate const.
      const usedIds = new Set();
      const uniqId = (base) => { const b = base || 'step'; let id = b, k = 2; while (usedIds.has(id)) id = b + (k++); usedIds.add(id); return id; };
      const validSchema = (s) => /^[A-Z_][A-Z0-9_]*$/.test(s || ''); // emit schema only when it's an UPPER_SNAKE identifier
      const leaves = nodes.filter((n) => n.data.kind === 'agent' || n.data.kind === 'gate').slice().sort((a, b) => a.position.y - b.position.y);

      // 1. requires-skills header: collect skill nodes wired to agents/gates.
      // If catalogNames is provided (non-empty), only emit names that exist in the catalog
      // so the header never references a skill that isn't actually installed.
      const skillNodes = nodes.filter((n) => n.data.kind === 'skill');
      const rawSkillLabels = skillNodes.map((n) => n.data.label).filter(Boolean);
      const filteredSkillLabels = (catalogNames && catalogNames.length)
        ? rawSkillLabels.filter((name) => catalogNames.includes(name))
        : rawSkillLabels;
      const skillNames = filteredSkillLabels.join(', ');
      const out = [];
      // Header comment + requires-skills (always emit even if empty so the line is present).
      out.push('// auto-generated from the graph');
      if (skillNames) out.push('// requires-skills: ' + skillNames);
      out.push('');

      // 2. Pure-literal meta block: name, description, phases (collected in Y order, deduped).
      // metaDesc may contain characters that break single-quoted JS strings; escape them.
      const escSQ = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safeName = escSQ(metaName || 'untitled');
      const safeDesc = escSQ(metaDesc || metaName || 'Generated workflow.');
      // Collect phases in the order they first appear (sorted by Y of first node with that phase).
      const seenPhases = [], phaseOrder = [];
      leaves.forEach((n) => { if (n.data.phase && !seenPhases.includes(n.data.phase)) { seenPhases.push(n.data.phase); phaseOrder.push({ title: n.data.phase }); } });
      let metaLines = ["export const meta = {"];
      metaLines.push("  name: '" + safeName + "',");
      metaLines.push("  description: '" + safeDesc + "',");
      if (phaseOrder.length) {
        metaLines.push('  phases: [');
        phaseOrder.forEach((p) => metaLines.push("    { title: '" + escSQ(p.title) + "' },"));
        metaLines.push('  ],');
      }
      metaLines.push('}');
      out.push(metaLines.join('\n'));
      out.push('');

      // 2b. Placeholder schema consts so `schema: NAME` references actually resolve at runtime
      // (otherwise the generated workflow throws ReferenceError on the first agent call, even
      // though validate.py --strict passes — it only checks syntax). Replace with real schemas.
      const schemaNames = Array.from(new Set(
        nodes.map((n) => n.data.schema).filter(validSchema)
      ));
      if (schemaNames.length) {
        schemaNames.forEach((s) => out.push('const ' + s + " = { type: 'object', properties: {}, required: [] }; // TODO: define this schema"));
        out.push('');
      }

      // 3. Body: phase() calls + agent/parallel/loop lines.
      // emitPhase: emit a phase() call for each new phase we encounter (including phases of nodes
      // inside containers — validate.py requires every meta.phases title to have a matching phase() call).
      const aCall = (n) => "agent(" + JSON.stringify(n.data.label || 'step') + ", { model: '" + (n.data.model || 'haiku') + "'" + (validSchema(n.data.schema) ? ', schema: ' + n.data.schema : '') + " })";
      let curPhase = null, i = 0;
      const emitPhase = (p) => { if (p && p !== curPhase) { curPhase = p; out.push("phase('" + escSQ(p) + "')"); } };
      while (i < leaves.length) {
        const n = leaves[i], cid = cidOf(n);
        if (cid) {
          const c = conts.find((x) => x.id === cid), grp = [];
          while (i < leaves.length && cidOf(leaves[i]) === cid) { grp.push(leaves[i]); i++; }
          // Emit phase() for every unique phase in the group, in order of first appearance.
          const grpPhases = [];
          grp.forEach((x) => { if (x.data.phase && !grpPhases.includes(x.data.phase)) grpPhases.push(x.data.phase); });
          // Emit the first group-phase before the container block, then the rest inside (best effort).
          if (grpPhases.length) emitPhase(grpPhases[0]);
          if (c.data.kind === 'loop') {
            // Loop container: emit a Ralph-style while loop. Vars are suffixed per loop so two
            // loop containers don't redeclare `iter`. Use args?. so an argless run doesn't throw.
            const itv = uniqId('iter');
            out.push('let ' + itv + ' = 0;');
            out.push('// TODO: break when the work converges (e.g. if (result.done) break;)');
            out.push('while (' + itv + ' < (args?.maxIterations || 40)) {');
            grp.forEach((x) => {
              // Emit any additional phases inside the loop block.
              if (x.data.phase && x.data.phase !== curPhase) { out.push("  phase('" + escSQ(x.data.phase) + "');"); curPhase = x.data.phase; }
              out.push('  const ' + uniqId('_r' + camel(x.data.label || 'step')) + ' = await ' + aCall(x) + ';');
            });
            out.push('  ' + itv + '++;');
            out.push('}');
          } else {
            // Parallel container: fan-out, must .filter(Boolean) per validate.py.
            // Additional phases inside a parallel group get their own phase() calls after the block.
            out.push('const ' + uniqId(camel(c.data.label || 'fanOut') + 'Results') + ' = (await parallel([');
            grp.forEach((x) => out.push('  () => ' + aCall(x) + ','));
            out.push('])).filter(Boolean);');
            // Emit any remaining phases from the group so validate.py sees all phase() calls.
            grpPhases.slice(1).forEach((p) => emitPhase(p));
          }
        } else {
          // Non-container leaf: emit phase() then the agent/gate call.
          emitPhase(n.data.phase || null);
          out.push('const ' + uniqId(camel(n.data.label || 'step')) + ' = await ' + aCall(n) + ';');
          i++;
        }
        out.push('');
      }

      // 4. Trailing return (required by the runtime's async wrapper).
      out.push('return;');
      return out.join('\n');
    }

    // ---------- UI bits ----------
    const btn = (extra) => Object.assign({ height: 30, padding: '0 12px', background: '#0c1016', border: '1px solid #1d2530', color: '#aeb9c8', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: SANS }, extra || {});

    // ---------- workflow library (persisted in localStorage) ----------
    const LSKEY = 'rabbitflows:library:v1';
    // seedLib: return a single blank starter workflow. Real workflows are loaded
    // from the backend via "Load from repo" — no static hand-coded graphs.
    const seedLib = () => {
      const trig = { id: 'trigger', type: 'trigger', position: { x: 360, y: 60 }, zIndex: 1, draggable: true, connectable: true, selectable: true, style: { width: DIMS.trigger[0], height: DIMS.trigger[1] }, data: { kind: 'trigger', label: '/new-workflow', detail: 'slash command', model: null, schema: null, phase: null, body: null } };
      return [{ id: 'starter', name: 'New workflow', desc: 'Use "Load from repo" in the Workflow manager to load a real workflow, or drag blocks from the palette to build one.', nodes: [trig], edges: [] }];
    };
    const loadLib = () => { try { const s = localStorage.getItem(LSKEY); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; } } catch (e) { console.warn('[flow-canvas] corrupt saved library, using seed:', e && e.message); } return seedLib(); };
    const persistLib = (lib) => { try { localStorage.setItem(LSKEY, JSON.stringify(lib)); } catch (e) { console.warn('[flow-canvas] library NOT saved (localStorage quota/disabled):', e && e.message); } };
    const wfUid = () => 'wf' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const countKinds = (ns) => ({ agents: ns.filter((n) => n.data && n.data.kind === 'agent').length, gates: ns.filter((n) => n.data && n.data.kind === 'gate').length });

    function Shell() {
      const rf = useReactFlow();
      const wrapRef = React.useRef(null);
      const initLib = React.useMemo(loadLib, []);
      const [library, setLibrary] = React.useState(initLib);
      const [activeId, setActiveId] = React.useState(initLib[0].id);
      const [nodes, setNodes, onNodesChange] = useNodesState(initLib[0].nodes);
      const [edges, setEdges, onEdgesChange] = useEdgesState(initLib[0].edges);
      const [selId, setSelId] = React.useState(null);
      const [codeOpen, setCodeOpen] = React.useState(false);
      const [managerOpen, setManagerOpen] = React.useState(false);
      const [renaming, setRenaming] = React.useState(null);
      const [toast, setToast] = React.useState(null);
      const toastT = React.useRef(null);
      const fileRef = React.useRef(null);
      // validateResult: null | { ok: bool, output: string } | { pending: true }
      const [validateResult, setValidateResult] = React.useState(null);
      // repoWorkflows: list of .js filenames from /api/workflows (null = not loaded, [] = server down)
      const [repoWorkflows, setRepoWorkflows] = React.useState(null);
      // lossyCount: number of unparsed regions in the currently loaded workflow (null = n/a)
      const [lossyCount, setLossyCount] = React.useState(null);
      // repoLoading: name of workflow currently being fetched from the backend
      const [repoLoading, setRepoLoading] = React.useState(null);
      // skillCatalog: [{name, description}] from /api/skills; [] when server down or empty
      const [skillCatalog, setSkillCatalog] = React.useState([]);

      // On mount: probe /api/workflows to see if the backend is running.
      // Fail silently if the server is not up (repoWorkflows stays null).
      React.useEffect(() => {
        fetch('/api/workflows')
          .then((r) => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
          .then((list) => { if (Array.isArray(list)) setRepoWorkflows(list); })
          .catch(() => setRepoWorkflows([]));
      }, []);

      // On mount: fetch skill catalog from /api/skills. Fail silently if server is down.
      React.useEffect(() => {
        fetch('/api/skills')
          .then((r) => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
          .then((list) => { if (Array.isArray(list)) setSkillCatalog(list); })
          .catch(() => {});
      }, []);

      // loadRepoWorkflow: fetch source for `name` from the backend, parse it with
      // parser.js (dynamic import — works in modern browsers from classic scripts when
      // served over http), convert to RF nodes/edges, add to the library and open it.
      const loadRepoWorkflow = async (name) => {
        setRepoLoading(name);
        try {
          // 1. Fetch the source.
          const srcResp = await fetch('/api/workflows/' + encodeURIComponent(name));
          if (!srcResp.ok) throw new Error('HTTP ' + srcResp.status + ' fetching ' + name);
          const { source } = await srcResp.json();

          // 2. Dynamic import of parser.js (ES module, served by the backend at /parser.js).
          const parser = await import('/parser.js');

          // 3. Parse source -> graph.
          const { meta, nodes: pNodes, edges: pEdges, lossy } = parser.parseWorkflow(source);
          const metaName = meta.name || name.replace(/\.js$/, '');
          const metaDesc = meta.description || 'Loaded from repo.';

          // 4. Convert to RF shape (internal graph -> RF nodes/edges).
          // Inject a lossy placeholder node for each unparsed section so the
          // canvas shows a visible per-node warning flag (not just the banner).
          const lossyNodes = lossy.map((l, i) => {
            const lastNode = pNodes[pNodes.length - 1];
            const baseY = lastNode ? lastNode.y + (lastNode.h || 84) + 40 + i * 80 : 200 + i * 80;
            return {
              id: '__lossy_' + i,
              kind: 'lossy',
              label: 'line ' + l.line + ': ' + l.reason,
              model: null, schema: null, phase: null, detail: null, body: null,
              x: (lastNode ? lastNode.x : 353),
              y: baseY,
              w: 280, h: 60,
            };
          });
          const allNodes = pNodes.concat(lossyNodes);
          const internalGraph = { metaName, metaDesc, nodes: allNodes, edges: pEdges };
          const wf = {
            id: name,  // stable id = filename so re-loading replaces rather than duplicates
            name: metaName,
            desc: metaDesc,
            nodes: toRFNodes(internalGraph),
            edges: toRFEdges(internalGraph),
          };

          // 5. Merge into library (replace if same id, else append).
          const lib2 = saveInto(library);
          const existing = lib2.findIndex((w) => w.id === name);
          const nl = existing >= 0 ? lib2.map((w, i) => i === existing ? wf : w) : lib2.concat([wf]);
          setLibrary(nl); persistLib(nl);
          setNodes(wf.nodes); setEdges(wf.edges); setActiveId(wf.id);
          setSelId(null); setManagerOpen(false); fitRetry();
          setLossyCount(lossy.length);
          if (lossy.length) showToast(lossy.length + ' section(s) could not be parsed (see banner)');
          else showToast('Loaded “' + metaName + '” from repo');
        } catch (err) {
          showToast('Load failed: ' + err.message);
        } finally {
          setRepoLoading(null);
        }
      };

      // RF's fitView/zoom rely on its internal nodeInternals dims, which it never measures in this
      // embedded context — so we compute the viewport ourselves from our stamped node.width/height and
      // apply it directly with setViewport (the d3 transform itself works fine).
      const myFit = React.useCallback(() => {
        const pane = wrapRef.current;
        if (!pane) return false;
        // Force RF to (re)measure its container so d3-zoom / setViewport become live.
        window.dispatchEvent(new Event('resize'));
        const ns = rf.getNodes().filter((n) => n.width);
        if (!ns.length) return false;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        ns.forEach((n) => { const w = n.width, hh = n.height || 60; x0 = Math.min(x0, n.position.x); y0 = Math.min(y0, n.position.y); x1 = Math.max(x1, n.position.x + w); y1 = Math.max(y1, n.position.y + hh); });
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
        if (fitBusy.current) return; // don't stack retry chains on rapid switches
        fitBusy.current = true;
        let tries = 0;
        const t = () => {
          tries++;
          const before = JSON.stringify(rf.getViewport());
          myFit();
          if (JSON.stringify(rf.getViewport()) !== before) { fitBusy.current = false; return; } // applied
          if (tries < 40) setTimeout(t, 90); else fitBusy.current = false;
        };
        setTimeout(t, 80);
      }, [rf, myFit]);
      React.useEffect(() => { fitRetry(); }, []);

      // Persistent measure loop: RF's ResizeObserver node-measuring doesn't fire in this embedded context,
      // so nodes stay visibility:hidden. Measure the DOM and stamp width/height into the store ourselves.
      // Re-arm the measure loop only when the SET of node ids changes (load/new/import/drop/delete),
      // not on every width-stamp or drag — so the poll stops once everything is measured.
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
          if (Object.keys(upd).length) { idle = 0; setNodes((nds) => nds.map((n) => upd[n.id] ? Object.assign({}, n, { width: upd[n.id][0], height: upd[n.id][1] }) : n)); return; }
          // Nothing left to measure — stop polling after a couple of idle ticks.
          if (rf.getNodes().every((n) => n.width != null) && ++idle > 2) clearInterval(iv);
        };
        const iv = setInterval(stamp, 150);
        return () => clearInterval(iv);
      }, [idSig]);

      const showToast = (m) => { clearTimeout(toastT.current); setToast(m); toastT.current = setTimeout(() => setToast(null), 2600); };

      // saveToRepo: write the generated workflow into .claude/workflows/ via the backend.
      // Prompts for a filename (the round-trip is lossy, so default to a NEW slug, not the
      // loaded file). Server refuses to overwrite unless we retry with ?overwrite=1.
      const saveToRepo = async () => {
        const src = genCode(nodes, edges, g.metaName, g.metaDesc, skillCatalog.map((s) => s.name));
        const slug = (g.metaName || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
        const fname = window.prompt('Save generated workflow to .claude/workflows/', slug + '.js');
        if (!fname) return;
        const post = (force) => fetch('/api/workflows/' + encodeURIComponent(fname) + (force ? '?overwrite=1' : ''), { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain' }, authHeaders()), body: src });
        try {
          let resp = await post(false);
          if (resp.status === 409) {
            if (!window.confirm(fname + ' already exists. Overwrite it? (the regenerated code is lossy)')) return;
            resp = await post(true);
          }
          const data = await resp.json();
          showToast(data.ok ? 'Saved → .claude/workflows/' + fname : 'Save failed: ' + (data.error || resp.status));
        } catch (err) {
          showToast('Save failed: ' + err.message + ' (is the server running?)');
        }
      };

      // runValidate: POST the generated source to /api/validate and store the result.
      // Requires the server (server.js) to be running; gracefully shows the error if not.
      const runValidate = async () => {
        const src = genCode(nodes, edges, g.metaName, g.metaDesc, skillCatalog.map((s) => s.name));
        setValidateResult({ pending: true });
        try {
          const resp = await fetch('/api/validate', { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain' }, authHeaders()), body: src });
          const data = await resp.json();
          setValidateResult({ ok: data.ok, output: data.output || '' });
        } catch (err) {
          setValidateResult({ ok: false, output: 'Network error: ' + err.message + '\n(Is the server running? node frontend/server.js)' });
        }
      };

      const saveInto = (lib) => lib.map((w) => w.id === activeId ? Object.assign({}, w, { nodes, edges }) : w);
      const openWorkflow = (id) => {
        if (id === activeId) { setManagerOpen(false); return; }
        const lib2 = saveInto(library); const w = lib2.find((x) => x.id === id);
        setLibrary(lib2); persistLib(lib2);
        if (w) { setNodes(w.nodes); setEdges(w.edges); setActiveId(id); }
        setSelId(null); setManagerOpen(false); fitRetry();
        setLossyCount(null); // clear banner when switching workflows
      };
      const newWorkflow = () => {
        const lib2 = saveInto(library); const id = wfUid();
        const trig = { id: 'trigger', type: 'trigger', position: { x: 360, y: 60 }, zIndex: 1, draggable: true, connectable: true, selectable: true, style: { width: DIMS.trigger[0], height: DIMS.trigger[1] }, data: { kind: 'trigger', label: '/new-workflow', detail: 'slash command', model: null, schema: null, phase: null, body: null } };
        const w = { id, name: 'Untitled workflow', desc: 'A new workflow \u2014 drag blocks from the palette to build it out.', nodes: [trig], edges: [] };
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
        if (!renaming) return; const id = renaming.id, value = renaming.value;
        const nl = library.map((w) => w.id === id ? Object.assign({}, w, { name: (value || '').trim() || w.name }) : w);
        setLibrary(nl); persistLib(nl); setRenaming(null);
      };
      const exportActive = () => {
        const w = saveInto(library).find((x) => x.id === activeId); if (!w) return;
        const blob = new Blob([JSON.stringify({ name: w.name, desc: w.desc, nodes: w.nodes, edges: w.edges }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = (w.name || 'workflow').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      };
      const importFile = (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try {
            const o = JSON.parse(r.result); const id = wfUid();
            // Keep only well-formed nodes (must carry data.kind + position) so a malformed import
            // can't brick the canvas with `Cannot read properties of undefined (reading 'kind')`.
            const VALID_KINDS = new Set(['trigger', 'knob', 'agent', 'gate', 'parallel', 'loop', 'phase', 'skill', 'lossy']);
            const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
            const okNodes = rawNodes.filter((n) => n && n.id != null && n.position && n.data && VALID_KINDS.has(n.data.kind));
            const ids = new Set(okNodes.map((n) => n.id));
            const okEdges = (Array.isArray(o.edges) ? o.edges : []).filter((e) => e && ids.has(e.source) && ids.has(e.target));
            const w = { id, name: o.name || f.name.replace(/\.json$/i, '') || 'Imported', desc: o.desc || 'Imported workflow.', nodes: okNodes, edges: okEdges };
            const nl = saveInto(library).concat([w]); setLibrary(nl); persistLib(nl);
            setNodes(w.nodes); setEdges(w.edges); setActiveId(id); setSelId(null); setManagerOpen(false); fitRetry();
            const dropped = rawNodes.length - okNodes.length;
            showToast('Imported \u201c' + w.name + '\u201d' + (dropped > 0 ? ' (' + dropped + ' malformed node(s) skipped)' : ''));
          } catch (err) { showToast('Import failed \u2014 invalid JSON'); }
        };
        r.readAsText(f); e.target.value = '';
      };
      const resetLibrary = () => { const nl = seedLib(); setLibrary(nl); persistLib(nl); const w = nl[0]; setNodes(w.nodes); setEdges(w.edges); setActiveId(w.id); setSelId(null); setManagerOpen(false); fitRetry(); showToast('Library reset'); };

      const onConnect = React.useCallback((params) => {
        setEdges((eds) => addEdge(Object.assign({}, params, { type: 'default', animated: true, style: edgeStyle('flow'), markerEnd: { type: MarkerType.ArrowClosed, color: EC.flow, width: 15, height: 15 }, data: { kind: 'flow' } }), eds));
      }, [setEdges]);

      const onNodeClick = React.useCallback((_, n) => setSelId(n.id), []);
      const onPaneClick = React.useCallback(() => setSelId(null), []);

      const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
      const onDrop = (e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('application/flowkind');
        if (!kind || !wrapRef.current) return;
        const b = wrapRef.current.getBoundingClientRect();
        const pos = rf.project({ x: e.clientX - b.left, y: e.clientY - b.top });
        const dim = DIMS[kind] || [234, 84];
        const id = 'n' + (UID++);
        const defs = {
          agent: { label: 'New agent', model: 'sonnet', schema: 'OUTPUT_SCHEMA', detail: 'describe the step' },
          gate: { label: 'New gate', model: 'opus', schema: 'GATE_SCHEMA', detail: 'admission decision' },
          parallel: { label: 'Parallel group' }, loop: { label: 'Loop' }, phase: { label: 'Phase' },
          skill: { label: 'new-skill', detail: 'requires-skills \u00b7 CLI' }, knob: { label: 'Knob', body: 'arg: default' },
        }[kind] || {};
        const isC = kind === 'loop' || kind === 'parallel';
        const node = { id, type: kind, position: { x: Math.round(pos.x - dim[0] / 2), y: Math.round(pos.y - dim[1] / 2) }, zIndex: isC ? 0 : 1, draggable: true, connectable: !isC, selectable: true, style: { width: dim[0], height: dim[1] }, data: Object.assign({ kind: kind, label: '', model: null, schema: null, phase: null, detail: null, body: null }, defs) };
        setNodes((nds) => nds.concat(node));
        setSelId(id);
      };

      const patchData = (id, patch) => setNodes((nds) => nds.map((n) => n.id === id ? Object.assign({}, n, { data: Object.assign({}, n.data, patch) }) : n));
      const delNode = (id) => { setNodes((nds) => nds.filter((n) => n.id !== id)); setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id)); setSelId(null); };

      React.useEffect(() => {
        const onKey = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
          if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); delNode(selId); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [selId]);

      const validate = () => {
        const ag = nodes.filter((n) => n.data.kind === 'agent').length, ga = nodes.filter((n) => n.data.kind === 'gate').length;
        // Actually detect cycles (white/grey/black DFS) rather than asserting acyclicity blindly.
        const adj = {};
        edges.forEach((e) => { (adj[e.source] = adj[e.source] || []).push(e.target); });
        const state = {}; let cyclic = false;
        const dfs = (id) => {
          state[id] = 1;
          for (const nx of (adj[id] || [])) {
            if (state[nx] === 1) { cyclic = true; return; }
            if (!state[nx]) { dfs(nx); if (cyclic) return; }
          }
          state[id] = 2;
        };
        for (const n of nodes) { if (!state[n.id]) dfs(n.id); if (cyclic) break; }
        showToast(ag + ' agents \u00b7 ' + ga + ' gates \u00b7 ' + edges.length + ' edges \u2014 graph ' + (cyclic ? 'has a CYCLE' : 'is acyclic'));
      };

      const active = library.find((w) => w.id === activeId) || library[0];
      const g = { metaName: active.name, metaDesc: active.desc };
      const sel = selId ? nodes.find((n) => n.id === selId) : null;
      const miniBtn = (color) => ({ background: '#161b22', border: '1px solid #232c38', color: color || '#aeb9c8', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: SANS });

      // ----- toolbar -----
      const toolbar = h('div', { style: { height: 52, flex: '0 0 52px', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', background: '#11151c', borderBottom: '1px solid #1d2530', zIndex: 30 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } },
          h('div', { style: { width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#5b9dff,#2dd4bf)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#0b0e13', fontSize: 15 } }, '\u27FF'),
          h('div', { style: { fontWeight: 600, fontFamily: SANS, color: '#e6edf5' } }, 'Rabbit Flow Designer')),
        h('div', { style: { width: 1, height: 24, background: '#222b36' } }),
        h('button', { onClick: () => setManagerOpen(true), style: { display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', background: '#0c1016', border: '1px solid #1d2530', borderRadius: 8, cursor: 'pointer' } },
          h('span', { style: { color: '#5b9dff', fontSize: 13 } }, '\u25A4'),
          h('span', { style: { color: '#dbe3ee', fontSize: 12.5, fontWeight: 500, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: SANS } }, active.name),
          h('span', { style: { color: '#5d6776', fontSize: 10 } }, '\u25BE')),
        h('div', { style: { flex: 1 } }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 2, background: '#0c1016', border: '1px solid #1d2530', borderRadius: 8, padding: 2 } },
          h('button', { onClick: () => zoomBy(1 / 1.18), style: { width: 28, height: 26, border: 'none', background: 'transparent', color: '#aeb9c8', borderRadius: 6, cursor: 'pointer', fontSize: 16 } }, '\u2212'),
          h('button', { onClick: () => zoomBy(1.18), style: { width: 28, height: 26, border: 'none', background: 'transparent', color: '#aeb9c8', borderRadius: 6, cursor: 'pointer', fontSize: 16 } }, '+')),
        h('button', { onClick: () => myFit(), style: btn() }, 'Fit'),
        h('button', { onClick: validate, style: btn({ display: 'flex', alignItems: 'center', gap: 6 }) }, h('span', { style: { color: '#2dd4bf' } }, '\u2713'), 'Validate'),
        h('button', { onClick: () => { setValidateResult(null); setCodeOpen(true); }, style: { height: 30, padding: '0 14px', background: 'linear-gradient(180deg,#5b9dff,#4a86ea)', border: 'none', color: '#06101f', fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: SANS } }, 'Generate code'));

      // ----- palette -----
      const palItem = (k) => {
        const def = KINDS[k];
        const skillDesc = skillCatalog.length > 0 ? skillCatalog.length + ' skills available' : 'requires-skills \u00b7 CLI';
        const desc = { knob: 'workflow arg / input', agent: 'LLM call \u00b7 model + prompt', gate: 'agent + output schema', parallel: 'fan-out lanes', loop: 'Ralph while-loop', phase: 'stage marker', skill: skillDesc }[k];
        return h('div', { key: k, draggable: true, onDragStart: (e) => { e.dataTransfer.setData('application/flowkind', k); e.dataTransfer.effectAllowed = 'move'; }, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', background: '#11161e', border: '1px solid #1e2733', borderRadius: 9, cursor: 'grab', userSelect: 'none' } },
          h('div', { style: { width: 28, height: 28, flex: '0 0 28px', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: def.color, background: def.color + '1a', border: '1px solid ' + def.color + '33' } }, def.icon),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: '#dbe3ee' } }, def.label),
            h('div', { style: { fontSize: 10.5, color: '#6b7686', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, desc)),
          h('div', { style: { color: '#3c4654', fontSize: 13 } }, '\u22EE\u22EE'));
      };
      const palette = h('aside', { style: { width: 236, flex: '0 0 236px', background: '#0e1219', borderRight: '1px solid #1d2530', display: 'flex', flexDirection: 'column', zIndex: 20, fontFamily: SANS } },
        h('div', { style: { padding: '14px 15px 8px', fontSize: 11, letterSpacing: .9, textTransform: 'uppercase', color: '#5d6776', fontWeight: 600 } }, 'Add node'),
        h('div', { style: { flex: 1, overflowY: 'auto', padding: '4px 11px 11px', display: 'flex', flexDirection: 'column', gap: 8 } }, ['knob', 'agent', 'gate', 'parallel', 'loop', 'phase', 'skill'].map(palItem)),
        h('div', { style: { padding: '11px 14px', borderTop: '1px solid #1d2530', fontSize: 10.5, color: '#5a6573', lineHeight: 1.5 } }, 'Drag a block onto the canvas to add it, then wire it into the flow.'));

      // ----- inspector -----
      let inspector;
      if (sel) {
        const d = sel.data, def = KINDS[d.kind], col = def.color;
        const isAgentLike = d.kind === 'agent' || d.kind === 'gate';
        const skillsIn = edges.filter((e) => e.data && e.data.kind === 'skill' && e.target === sel.id).map((e) => { const s = nodes.find((n) => n.id === e.source); return s && s.data.label; }).filter(Boolean);
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
          fields.push(h('div', { key: 'mods', style: { display: 'flex', gap: 5 } }, ['opus', 'sonnet', 'haiku'].map((m) => h('button', { key: m, onClick: () => patchData(sel.id, { model: m }), style: { flex: 1, padding: '7px 0', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontFamily: MONO, border: '1px solid ' + (d.model === m ? MODELS[m] : '#232c38'), background: d.model === m ? MODELS[m] + '22' : '#0a0d12', color: d.model === m ? MODELS[m] : '#7a8594' } }, m))));
          fields.push(lbl(d.kind === 'gate' ? 'Output schema \u00b7 admission' : 'Output schema'));
          fields.push(h('input', { key: 'sch', value: d.schema || '', placeholder: '(none \u2014 free text)', onChange: (e) => patchData(sel.id, { schema: e.target.value }), style: Object.assign({}, inputStyle, { color: '#9fe6d4', fontFamily: MONO, fontSize: 12 }) }));
          fields.push(lbl('Phase'));
          fields.push(h('input', { key: 'ph', value: d.phase || '', placeholder: '(ungrouped)', onChange: (e) => patchData(sel.id, { phase: e.target.value }), style: Object.assign({}, inputStyle, { fontSize: 12 }) }));
        }
        if (d.kind === 'skill' && skillCatalog.length > 0) {
          // Skill picker: select from the live catalog returned by /api/skills.
          // Changing the select updates d.label (which feeds the requires-skills header in genCode).
          fields.push(lbl('Skill (from catalog)'));
          const selectStyle = Object.assign({}, inputStyle, { cursor: 'pointer', color: '#34d399', fontFamily: MONO, fontSize: 12 });
          const optionEls = skillCatalog.map((sk) => h('option', { key: sk.name, value: sk.name }, sk.name));
          // Prepend a placeholder if current label is not in catalog
          const catalogNames = skillCatalog.map((sk) => sk.name);
          if (d.label && !catalogNames.includes(d.label)) {
            optionEls.unshift(h('option', { key: '__custom', value: d.label }, d.label + ' (custom)'));
          }
          fields.push(h('select', { key: 'skpick', value: d.label || '', onChange: (e) => patchData(sel.id, { label: e.target.value }), style: selectStyle }, optionEls));
          // Show description of selected skill if available
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
          fields.push(h('div', { key: 'sk', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, skillsIn.map((s, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 5, background: '#0d1a14', border: '1px solid #1d3a2b', color: '#5fd9a6', borderRadius: 6, padding: '4px 9px', fontSize: 11, fontFamily: MONO } }, '\u25C6 ' + s))));
        }
        if (isAgentLike) {
          fields.push(lbl('Prompt preview'));
          const pv = 'You are the "' + d.label + '" ' + (d.kind === 'gate' ? 'admission gate' : 'stage') + ' in the ' + g.metaName + ' workflow.' + (d.kind === 'gate' ? '\nIndependently verify against real evidence and return a ' + (d.schema || 'verdict') + ' \u2014 do not rubber-stamp.' : '\nDo the work, then return structured output' + (d.schema ? ' as ' + d.schema : '') + '.') + '\n[ model: ' + d.model + ' ]';
          fields.push(h('div', { key: 'pv', style: { background: '#0a0d12', border: '1px solid #1e2733', borderRadius: 7, padding: 10, fontSize: 11, color: '#8e99a8', lineHeight: 1.55, fontFamily: MONO, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' } }, pv));
        }
        inspector = h('div', { style: { padding: '16px 16px 30px' } }, fields);
      } else {
        const statRow = (label, value) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, h('div', { style: { fontSize: 12, color: '#8b97a5' } }, label), h('div', { style: { fontSize: 13, fontWeight: 600, color: '#dbe3ee', fontFamily: MONO } }, String(value)));
        const ag = nodes.filter((n) => n.data.kind === 'agent').length, ga = nodes.filter((n) => n.data.kind === 'gate').length, ph = new Set(nodes.map((n) => n.data.phase).filter(Boolean)).size;
        inspector = h('div', { style: { padding: '18px 16px' } },
          h('div', { style: { fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', fontWeight: 600, color: '#5d6776', marginBottom: 10 } }, 'Workflow'),
          h('div', { style: { fontSize: 15, fontWeight: 600, color: '#e6edf5' } }, g.metaName),
          h('div', { style: { fontSize: 12, color: '#7c8694', marginTop: 8, lineHeight: 1.55 } }, g.metaDesc),
          h('div', { style: { height: 1, background: '#1d2530', margin: '18px 0' } }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, statRow('Agents', ag), statRow('Gates', ga), statRow('Phases', ph), statRow('Edges', edges.length)),
          h('div', { style: { height: 1, background: '#1d2530', margin: '18px 0' } }),
          h('div', { style: { fontSize: 11.5, color: '#6b7686', lineHeight: 1.6 } }, 'Select a node to inspect its model, schema, phase and attached skills. Drag from a node\u2019s handle to wire the flow.'));
      }
      const inspectorAside = h('aside', { style: { width: 294, flex: '0 0 294px', background: '#0e1219', borderLeft: '1px solid #1d2530', overflowY: 'auto', zIndex: 20, fontFamily: SANS } }, inspector);

      // ----- canvas -----
      const flow = h('div', { ref: wrapRef, onDragOver, onDrop, style: { flex: 1, position: 'relative', minWidth: 0 } },
        h(ReactFlowComp, {
          nodes, edges, onNodesChange, onEdgesChange, onConnect, onNodeClick, onPaneClick,
          nodeTypes, fitView: true, minZoom: 0.2, maxZoom: 1.8, proOptions: { hideAttribution: true }, defaultEdgeOptions: { type: 'default' },
        },
          h(Background, { color: '#1a2230', gap: 26, size: 1.2 }),
          h(Controls, { showInteractive: false }),
          h(MiniMap, { nodeColor: (n) => (KINDS[n.type] ? KINDS[n.type].color : '#888'), nodeStrokeWidth: 2, maskColor: 'rgba(8,11,16,.72)', style: { background: '#0e1219', border: '1px solid #1d2530' } })),
        // Lossy banner: shown when a repo workflow had unparsed regions.
        lossyCount != null && lossyCount > 0 && h('div', { style: { position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: '#1e1506', border: '1px solid #7c5a12', borderRadius: 8, padding: '6px 14px', fontSize: 11.5, color: '#f5c542', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', zIndex: 50, fontFamily: SANS, boxShadow: '0 4px 16px rgba(0,0,0,.5)' } },
          h('span', { style: { fontSize: 14 } }, '⚠️'),
          lossyCount + ' section' + (lossyCount === 1 ? '' : 's') + ' could not be parsed — graph is partial. Non-standard workflow constructs were skipped.'),
        h('div', { style: { position: 'absolute', left: 14, bottom: 14, display: 'flex', gap: 7, flexWrap: 'wrap', maxWidth: 520, pointerEvents: 'none', fontFamily: SANS } },
          [['agent', 'Agent'], ['gate', 'Gate'], ['parallel', 'Parallel'], ['loop', 'Loop'], ['skill', 'Skill'], ['knob', 'Knob']].map(([k, label]) =>
            h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(17,21,28,.8)', backdropFilter: 'blur(4px)', border: '1px solid #1d2530', borderRadius: 6, padding: '3px 8px', fontSize: 10.5, color: '#8b97a5' } },
              h('div', { style: { width: 8, height: 8, borderRadius: 2.5, background: KINDS[k].color } }), label))));

      // ----- status + overlays -----
      const status = h('div', { style: { height: 30, flex: '0 0 30px', display: 'flex', alignItems: 'center', gap: 16, padding: '0 14px', background: '#0c1016', borderTop: '1px solid #1d2530', fontSize: 11, color: '#6b7686', fontFamily: MONO, zIndex: 25 } },
        h('div', null, g.metaName + '  \u00b7  ' + nodes.filter((n) => !['loop', 'parallel'].includes(n.data.kind)).length + ' nodes  \u00b7  ' + nodes.filter((n) => n.data.kind === 'gate').length + ' gates  \u00b7  ' + edges.length + ' edges'),
        h('div', { style: { flex: 1 } }),
        h('div', null, 'scroll to zoom \u00b7 drag canvas to pan \u00b7 drag handle to connect'));

      const overlays = [];
      if (toast) overlays.push(h('div', { key: 'toast', style: { position: 'absolute', bottom: 46, left: '50%', transform: 'translateX(-50%)', background: '#11161e', border: '1px solid #243b30', color: '#bfe9d4', padding: '9px 16px', borderRadius: 9, fontSize: 12, display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 8px 26px rgba(0,0,0,.5)', zIndex: 60, fontFamily: SANS } }, h('span', { style: { color: '#2dd4bf', fontSize: 14 } }, '\u2713'), toast));
      const closeCode = () => { setCodeOpen(false); setValidateResult(null); };
      if (codeOpen) overlays.push(h('div', { key: 'code', onClick: closeCode, style: { position: 'absolute', inset: 0, background: 'rgba(5,7,11,.66)', backdropFilter: 'blur(3px)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 } },
        h('div', { onClick: (e) => e.stopPropagation(), style: { width: 660, maxWidth: '100%', maxHeight: '100%', background: '#0d1117', border: '1px solid #232c38', borderRadius: 13, boxShadow: '0 24px 70px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: SANS } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #1d2530' } },
            h('div', { style: { fontWeight: 600, color: '#e6edf5' } }, 'Generated workflow'),
            h('div', { style: { fontSize: 11, color: '#5d6776', fontFamily: MONO } }, g.metaName + '.js'),
            h('div', { style: { flex: 1 } }),
            h('button', { onClick: closeCode, style: { background: '#161b22', border: '1px solid #232c38', color: '#aeb9c8', borderRadius: 7, width: 28, height: 28, cursor: 'pointer', fontSize: 15 } }, '\u2715')),
          h('pre', { style: { margin: 0, flex: 1, overflow: 'auto', padding: '16px 18px', fontFamily: MONO, fontSize: 12, lineHeight: 1.65, color: '#aeb9c8', whiteSpace: 'pre' } }, genCode(nodes, edges, g.metaName, g.metaDesc, skillCatalog.map((s) => s.name))),
          validateResult && !validateResult.pending && h('pre', { style: { margin: 0, maxHeight: 180, overflow: 'auto', padding: '10px 18px', fontFamily: MONO, fontSize: 11, lineHeight: 1.55, color: validateResult.ok ? '#5fd9a6' : '#e07a8c', background: validateResult.ok ? '#0a1a12' : '#1a0a0e', borderTop: '1px solid ' + (validateResult.ok ? '#1d3a2b' : '#3a1d22'), whiteSpace: 'pre-wrap' } }, validateResult.output || (validateResult.ok ? 'OK' : 'Failed')),
          h('div', { style: { padding: '10px 16px', borderTop: '1px solid #1d2530', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('button', {
              onClick: () => { setValidateResult(null); runValidate(); },
              disabled: validateResult && validateResult.pending,
              style: { height: 28, padding: '0 14px', background: validateResult && validateResult.pending ? '#1a1e26' : 'linear-gradient(180deg,#2dd4bf,#1ab8a4)', border: 'none', color: validateResult && validateResult.pending ? '#5d6776' : '#06101f', fontWeight: 600, borderRadius: 7, cursor: validateResult && validateResult.pending ? 'default' : 'pointer', fontSize: 11.5, fontFamily: SANS },
            }, validateResult && validateResult.pending ? 'Validating...' : 'Export + Validate'),
            h('button', {
              onClick: saveToRepo,
              style: { height: 28, padding: '0 14px', background: '#11161e', border: '1px solid #2b3a52', color: '#9fc2ff', fontWeight: 600, borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontFamily: SANS },
            }, 'Save to repo'),
            validateResult && !validateResult.pending && h('span', { style: { fontSize: 11.5, fontWeight: 600, color: validateResult.ok ? '#2dd4bf' : '#e07a8c' } }, validateResult.ok ? '\u2713 Passed validate.py --strict' : '\u2715 Failed validate.py --strict'),
            h('div', { style: { flex: 1 } }),
            h('span', { style: { fontSize: 10.5, color: '#5d6776' } }, h('span', { style: { color: '#5b9dff' } }, '\u2139'), ' edit the graph and re-generate to shape the orchestration.')))));

      if (managerOpen) overlays.push(h('div', { key: 'mgr', onClick: () => { commitRename(); setManagerOpen(false); }, style: { position: 'absolute', inset: 0, background: 'rgba(5,7,11,.66)', backdropFilter: 'blur(3px)', zIndex: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, fontFamily: SANS } },
        h('div', { onClick: (e) => e.stopPropagation(), style: { width: 640, maxWidth: '100%', maxHeight: '100%', background: '#0d1117', border: '1px solid #232c38', borderRadius: 13, boxShadow: '0 24px 70px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid #1d2530' } },
            h('div', { style: { width: 24, height: 24, borderRadius: 6, background: '#5b9dff1a', border: '1px solid #5b9dff33', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5b9dff', fontSize: 13 } }, '\u25A4'),
            h('div', { style: { fontWeight: 600, color: '#e6edf5', fontSize: 15 } }, 'Workflow manager'),
            h('div', { style: { fontSize: 11.5, color: '#5d6776', fontFamily: MONO } }, library.length + ' saved'),
            h('div', { style: { flex: 1 } }),
            h('button', { onClick: () => { commitRename(); setManagerOpen(false); }, style: { background: '#161b22', border: '1px solid #232c38', color: '#aeb9c8', borderRadius: 7, width: 28, height: 28, cursor: 'pointer', fontSize: 15 } }, '\u2715')),
          h('div', { style: { display: 'flex', gap: 8, padding: '12px 18px', borderBottom: '1px solid #1d2530', flexWrap: 'wrap', alignItems: 'center' } },
            h('button', { onClick: newWorkflow, style: { height: 32, padding: '0 13px', background: 'linear-gradient(180deg,#5b9dff,#4a86ea)', border: 'none', color: '#06101f', fontWeight: 600, borderRadius: 8, cursor: 'pointer', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, fontFamily: SANS } }, h('span', { style: { fontSize: 15 } }, '+'), 'New workflow'),
            h('button', { onClick: () => fileRef.current && fileRef.current.click(), style: btn({ height: 32 }) }, 'Import JSON'),
            h('button', { onClick: exportActive, style: btn({ height: 32 }) }, 'Export current'),
            h('div', { style: { flex: 1 } }),
            h('button', { onClick: resetLibrary, style: btn({ height: 32, color: '#8b97a5' }) }, 'Reset library')),
          h('div', { style: { flex: 1, overflowY: 'auto', padding: '10px 14px 16px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150 } },
            library.map((w) => {
              const isActive = w.id === activeId, c = countKinds(w.nodes), isRen = renaming && renaming.id === w.id;
              return h('div', { key: w.id, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', background: isActive ? '#13202e' : '#11161e', border: '1px solid ' + (isActive ? '#27496b' : '#1e2733'), borderRadius: 10 } },
                h('div', { style: { width: 8, height: 8, borderRadius: '50%', background: isActive ? '#5b9dff' : '#3a4654', flex: '0 0 8px' } }),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  isRen
                    ? h('input', { autoFocus: true, value: renaming.value, onChange: (e) => setRenaming({ id: w.id, value: e.target.value }), onKeyDown: (e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }, onBlur: commitRename, style: { width: '100%', background: '#0a0d12', border: '1px solid #2b3a52', color: '#e6edf5', borderRadius: 6, padding: '5px 8px', fontSize: 13, outline: 'none', fontFamily: SANS } })
                    : h('div', { onClick: () => openWorkflow(w.id), style: { fontSize: 13.5, fontWeight: 600, color: '#e6edf5', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, w.name),
                  h('div', { style: { fontSize: 10.5, color: '#6b7686', fontFamily: MONO, marginTop: 2 } }, c.agents + ' agents \u00b7 ' + c.gates + ' gates \u00b7 ' + (w.edges ? w.edges.length : 0) + ' edges' + (isActive ? '  \u00b7  open' : ''))),
                h('div', { style: { display: 'flex', gap: 6 } },
                  isActive ? null : h('button', { onClick: () => openWorkflow(w.id), style: miniBtn('#5b9dff') }, 'Open'),
                  h('button', { onClick: () => setRenaming({ id: w.id, value: w.name }), style: miniBtn() }, 'Rename'),
                  h('button', { onClick: () => duplicateWorkflow(w.id), style: miniBtn() }, 'Duplicate'),
                  h('button', { onClick: () => { if (library.length > 1) deleteWorkflow(w.id); }, style: miniBtn(library.length > 1 ? '#e07a8c' : '#4a525e') }, 'Delete')));
            })),
          // --- Load from repo section ---
          repoWorkflows !== null && h('div', { style: { borderTop: '1px solid #1d2530', padding: '12px 18px' } },
            h('div', { style: { fontSize: 11, letterSpacing: .8, textTransform: 'uppercase', fontWeight: 600, color: '#5d6776', marginBottom: 8 } },
              repoWorkflows.length === 0 ? 'Load from repo (server not running)' : 'Load from repo (' + repoWorkflows.length + ' files)'),
            repoWorkflows.length === 0
              ? h('div', { style: { fontSize: 11, color: '#5d6776' } }, 'Start the backend: node frontend/server.js \u2014 then reload the page.')
              : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                  repoWorkflows.map((name) => h('button', {
                    key: name,
                    onClick: () => loadRepoWorkflow(name),
                    disabled: repoLoading === name,
                    style: { height: 26, padding: '0 10px', background: repoLoading === name ? '#1a1e26' : '#0c1016', border: '1px solid #2b3a52', color: repoLoading === name ? '#5d6776' : '#9fe6d4', borderRadius: 6, cursor: repoLoading === name ? 'default' : 'pointer', fontSize: 11, fontFamily: MONO },
                  }, repoLoading === name ? 'Loading...' : name)))),
          h('div', { style: { padding: '11px 18px', borderTop: '1px solid #1d2530', fontSize: 11, color: '#5d6776' } }, 'Workflows are saved in your browser. Use Import / Export to move them as JSON.'))));

      return h('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#0b0e13', color: '#cdd6e2', fontFamily: SANS, fontSize: 13, overflow: 'hidden' } },
        toolbar,
        h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } }, palette, flow, inspectorAside),
        status, overlays,
        h('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', onChange: importFile, style: { display: 'none' } }));
    }

    function App() { return h(ReactFlowProvider, null, h(Shell)); }

    class FlowCanvas extends HTMLElement {
      connectedCallback() {
        if (this._mounted) return;
        this._mounted = true;
        this.style.display = 'block'; this.style.width = '100%'; this.style.height = '100%';
        const inner = document.createElement('div');
        inner.style.width = '100%'; inner.style.height = '100%';
        this.appendChild(inner); this._inner = inner;
        if (ReactDOM.createRoot) { this._root = ReactDOM.createRoot(inner); this._root.render(h(App)); }
        else ReactDOM.render(h(App), inner);
      }
      disconnectedCallback() {
        if (this._root) { this._root.unmount(); this._root = null; }
        else if (this._inner) ReactDOM.unmountComponentAtNode(this._inner);
        this._mounted = false;
      }
    }
    if (!customElements.get('flow-canvas')) customElements.define('flow-canvas', FlowCanvas);
  }
  boot().catch((e) => console.error('[flow-canvas] boot error', e));
})();
