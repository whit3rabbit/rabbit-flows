// calls.js — best-effort scan of agent()/parallel()/pipeline()/phase() calls into
// canvas nodes + edges. Unrecognised/unbalanced constructs go to lossy[] with {line, reason}.

import { optsOf, stripComments, extractBalancedParen, extractBalancedBraces } from './scan.js';

/** Auto-incrementing ID counter for node IDs. */
let _uid = 0;
function uid(prefix) { return prefix + '_' + (++_uid); }

/** Detect the model hint from an options-like snippet. */
function extractModel(optSnippet) {
  const m = /model\s*:\s*['"`](opus|sonnet|haiku)['"`]/.exec(optSnippet);
  return m ? m[1] : null;
}

/** Detect the schema name from an options-like snippet. */
function extractSchema(optSnippet) {
  const m = /schema\s*:\s*([A-Z_][A-Z0-9_]*)/.exec(optSnippet);
  return m ? m[1] : null;
}

/** Detect the label from an options-like snippet (label: '...'). */
function extractLabel(optSnippet) {
  const m = /label\s*:\s*(['"`])((?:\\.|(?!\1)[^])*?)\1/.exec(optSnippet);
  return m ? m[2] : null;
}

/** Detect the phase from an options-like snippet. */
function extractPhase(optSnippet) {
  const m = /phase\s*:\s*(['"`])((?:\\.|(?!\1)[^])*?)\1/.exec(optSnippet);
  return m ? m[2] : null;
}

/**
 * Parse agent()/parallel()/pipeline()/phase() calls from workflow source.
 *
 * Returns { nodes: Node[], edges: Edge[], lossy: [{line, reason}] }.
 *
 * Strategy: scan the source string for recognizable patterns. agent() -> agent node;
 * phase() -> track current phase label; parallel([...]) -> container + child agent nodes;
 * pipeline() -> each stage as a sequential node. Unrecognised constructs go to lossy[].
 *
 * Layout: top-down linear (x=470 center, y+=132 per node). Parallel containers get a
 * wider/taller slot; child lanes spread horizontally.
 */
export function parseCalls(src) {
  _uid = 0; // reset per parse

  const nodes = [];
  const edges = [];
  const lossy = [];

  const CX = 470;   // canvas center x
  const VSTEP = 132; // vertical step between nodes
  const DIMS = {
    trigger:  [196,  48],
    knob:     [200,  96],
    agent:    [234,  84],
    gate:     [234,  84],
    skill:    [184,  60],
    phase:    [240,  44],
    parallel: [300, 180],
    loop:     [320, 226],
  };

  function makeNode(kind, label, opts) {
    const [w, h] = DIMS[kind] || [234, 84];
    return {
      id: opts.id || uid(kind),
      kind,
      label: label || kind,
      model:  opts.model  || null,
      schema: opts.schema || null,
      phase:  opts.phase  || null,
      detail: opts.detail || null,
      body:   opts.body   || null,
      x: opts.x != null ? opts.x : CX - w / 2,
      y: opts.y != null ? opts.y : 0,
      w, h,
    };
  }

  // Strip comments (string-literal aware). Length/newlines kept 1:1 so line numbers stay correct.
  const stripped = stripComments(src);

  let y = 120;
  let currentPhase = null;
  let lastNodeId = null;

  // Quick-scan patterns. parallel()/pipeline() do NOT require a literal '[' — the idiomatic
  // form is parallel(items.map(() => agent(...))) / pipeline(items, stage1, stage2).
  // Global (sticky via lastIndex) so the main loop can search forward from `pos` with no slice.
  const phaseCallRe   = /\bphase\s*\(\s*(['"`])((?:\\.|(?!\1)[^])*?)\1\s*\)/g;
  const agentCallRe   = /\bawait\s+agent\s*\(/g;
  const parallelRe    = /\bawait\s+parallel\s*\(/g;
  const pipelineRe    = /\bawait\s+pipeline\s*\(/g;
  const loopRe        = /\b(?:while|for)\s*\(/g;

  // We process the full source as a string, tracking position for line numbers.
  let pos = 0;
  const S = stripped;

  // Precompute newline offsets once so posLine is a binary search instead of an O(n) slice+split
  // per call (the whole scan was O(n^2)). ponytail: micro-opt — workflow sources are a few KB, but
  // it's a one-line win and keeps the scan linear.
  const nlOffsets = [];
  for (let i = 0; i < S.length; i++) if (S[i] === '\n') nlOffsets.push(i);
  function posLine(p) {
    let lo = 0, hi = nlOffsets.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nlOffsets[mid] < p) lo = mid + 1; else hi = mid; }
    return lo + 1; // 1-based: newlines strictly before p, plus 1
  }

  function addNode(node) {
    nodes.push(node);
    if (lastNodeId && node.kind !== 'parallel' && node.kind !== 'loop') {
      edges.push({ id: lastNodeId + '>' + node.id, from: lastNodeId, to: node.id, type: 'flow' });
    }
    lastNodeId = node.id;
    y += VSTEP;
  }

  // Extract a balanced-paren span starting at startPos (which points to the '('), string-aware
  // (parens inside a prompt string don't change depth). Returns {text, end} or null.
  function extractParen(startPos) {
    return extractBalancedParen(S, startPos);
  }

  // Scan inner text for agent() calls; return [{model, schema, label, phase, kind}] + push
  // any unbalanced span to lossy. offset is inner's absolute start in S (for line numbers).
  // String-aware: an `agent(` that appears INSIDE a prompt string (e.g. 'use the agent(x) helper')
  // is not a call and is skipped, so it neither spawns a phantom node nor a false lossy entry.
  function scanAgents(inner, offset, labelFor) {
    const found = [];
    let str = null;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (str) {
        if (c === '\\') { i++; continue; }
        if (c === str) str = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { str = c; continue; }
      // `agent` at a word boundary, followed by `(` (optional whitespace) — a real call token.
      if (c !== 'a' || !inner.startsWith('agent', i)) continue;
      const prev = i > 0 ? inner[i - 1] : '';
      if (/[A-Za-z0-9_$]/.test(prev)) continue; // e.g. "subagent" — not the agent() helper
      let k = i + 5;
      while (k < inner.length && /\s/.test(inner[k])) k++;
      if (inner[k] !== '(') continue;
      const span = extractBalancedParen(inner, k);
      if (!span) {
        lossy.push({ line: posLine(offset + i), reason: 'unbalanced agent() paren inside a container' });
        i = k; // skip past this token; keep scanning for more
        continue;
      }
      const optsFrag = optsOf(span.text);
      const label = extractLabel(optsFrag) || labelFor(found.length);
      found.push({
        model: extractModel(optsFrag),
        schema: extractSchema(optsFrag),
        label,
        phase: extractPhase(optsFrag) || currentPhase,
        kind: /gate/i.test(label) ? 'gate' : 'agent',
      });
      i = span.end; // continue after the matched call (loop's i++ moves to the next char)
    }
    return found;
  }

  const SCANNERS = [
    ['phase', phaseCallRe], ['agent', agentCallRe], ['parallel', parallelRe],
    ['pipeline', pipelineRe], ['loop', loopRe],
  ];

  while (pos < S.length) {
    // Find the nearest of the five constructs at or after `pos`. Global regexes searched via
    // lastIndex (no per-iteration slice); m.index is already absolute in S.
    let hit = null;
    for (const [type, re] of SCANNERS) {
      re.lastIndex = pos;
      const m = re.exec(S);
      if (m && (hit === null || m.index < hit.idx)) hit = { type, idx: m.index, m };
    }
    if (hit === null) break;

    const absPos = hit.idx;

    if (hit.type === 'phase') {
      currentPhase = hit.m[2];
      pos = absPos + hit.m[0].length;
      continue;
    }

    if (hit.type === 'agent') {
      const parenStart = absPos + hit.m[0].length - 1; // points to '('
      const span = extractParen(parenStart);
      if (!span) {
        lossy.push({ line: posLine(absPos), reason: 'unbalanced agent() paren' });
        pos = absPos + 1;
        continue;
      }
      const optsFrag = optsOf(span.text);
      const label  = extractLabel(optsFrag) || 'agent';
      const kind   = /gate/i.test(label) ? 'gate' : 'agent';
      addNode(makeNode(kind, label, {
        model: extractModel(optsFrag),
        schema: extractSchema(optsFrag),
        phase: extractPhase(optsFrag) || currentPhase,
        y,
      }));
      pos = span.end + 1; // span.end is absolute in S
      continue;
    }

    if (hit.type === 'parallel') {
      // parallel( ... ) — scan the whole paren body for agent() calls. Lanes are usually
      // bare thunks `() => agent(...)` (no await), and the arg may be `[...]` OR `items.map(...)`.
      const parenStart = absPos + hit.m[0].length - 1; // '(' position
      const span = extractParen(parenStart);
      if (!span) {
        lossy.push({ line: posLine(absPos), reason: 'unbalanced parallel() paren' });
        pos = absPos + 1;
        continue;
      }

      const containerY = y;
      const laneNodes = scanAgents(span.text, parenStart, (i) => 'worker:' + i);

      if (laneNodes.length === 0) {
        lossy.push({ line: posLine(absPos), reason: 'parallel() contains no parseable agent() calls' });
        pos = span.end + 1;
        continue;
      }

      // Build container + children
      const laneW = 150, laneGap = 22;
      const totalW = laneNodes.length * laneW + (laneNodes.length - 1) * laneGap;
      const startX = CX - totalW / 2;
      const cH = 180;
      const containerId = uid('parallel');
      const container = makeNode('parallel', 'parallel fan-out', {
        id: containerId, phase: currentPhase,
        x: startX - 24, y: containerY, w: totalW + 48, h: cH,
      });
      nodes.push(container);
      // connect previous node to container
      if (lastNodeId) {
        edges.push({ id: lastNodeId + '>' + containerId, from: lastNodeId, to: containerId, type: 'flow' });
      }

      laneNodes.forEach((ln, i) => {
        const laneId = uid('agent');
        nodes.push({
          id: laneId, kind: ln.kind,
          label: ln.label, model: ln.model, schema: ln.schema,
          phase: ln.phase || currentPhase, detail: null, body: null,
          x: startX + i * (laneW + laneGap), y: containerY + 52, w: laneW, h: 96,
        });
        // Fan-out: container -> each lane (otherwise lanes render orphaned).
        edges.push({ id: containerId + '>' + laneId, from: containerId, to: laneId, type: 'flow' });
      });

      // Onward flow fans in FROM the container (not an arbitrary middle lane).
      lastNodeId = containerId;
      y = containerY + cH + 56;
      pos = span.end + 1;
      continue;
    }

    if (hit.type === 'pipeline') {
      // pipeline(items, stage1, stage2, ...) — emit each stage's agent() as a sequential node.
      const parenStart = absPos + hit.m[0].length - 1; // '(' position
      const span = extractParen(parenStart);
      if (!span) {
        lossy.push({ line: posLine(absPos), reason: 'unbalanced pipeline() paren' });
        pos = absPos + 1;
        continue;
      }
      const stages = scanAgents(span.text, parenStart, (i) => 'stage:' + i);
      if (stages.length === 0) {
        lossy.push({ line: posLine(absPos), reason: 'pipeline() contains no parseable agent() calls' });
      } else {
        stages.forEach((st) => addNode(makeNode(st.kind, st.label, {
          model: st.model, schema: st.schema, phase: st.phase, y,
        })));
      }
      pos = span.end + 1;
      continue;
    }

    if (hit.type === 'loop') {
      // while/for ( header ) { body } — model as a loop container whose body agents are children.
      // The body's agent() calls are bare (e.g. `const r = await agent(...)`), so scanAgents finds
      // them. codegen/nodes/schema all support 'loop'; without this they'd flatten to sequential
      // nodes and the loop container would be lost on a code->graph->code round-trip.
      const headerParenStart = absPos + hit.m[0].length - 1; // '(' of the loop header
      const headerSpan = extractParen(headerParenStart);
      if (!headerSpan) {
        lossy.push({ line: posLine(absPos), reason: 'unbalanced loop header paren' });
        pos = absPos + 1;
        continue;
      }
      // Body must be a `{ ... }` block immediately after the header (only whitespace between).
      // A braceless single-statement loop is left to the normal scan (its agents become sequential).
      const afterHeader = headerSpan.end + 1;
      const braceIdx = S.indexOf('{', afterHeader);
      if (braceIdx === -1 || S.slice(afterHeader, braceIdx).trim() !== '') {
        pos = afterHeader;
        continue;
      }
      const body = extractBalancedBraces(S, braceIdx);
      if (!body) {
        lossy.push({ line: posLine(absPos), reason: 'unbalanced loop body block' });
        pos = braceIdx + 1;
        continue;
      }
      const laneNodes = scanAgents(body.text, body.start, (i) => 'iter:' + i);
      if (laneNodes.length === 0) {
        // Ordinary control-flow loop with no agent() calls — not an unparsed agent construct, so no
        // lossy note; just skip its body.
        pos = body.end + 1;
        continue;
      }

      const laneW = 150, laneGap = 22;
      const totalW = laneNodes.length * laneW + (laneNodes.length - 1) * laneGap;
      const startX = CX - totalW / 2;
      const cH = DIMS.loop[1];
      const containerY = y;
      const containerId = uid('loop');
      const container = makeNode('loop', 'loop', {
        id: containerId, phase: currentPhase,
        x: startX - 24, y: containerY, w: Math.max(totalW + 48, DIMS.loop[0]), h: cH,
      });
      nodes.push(container);
      if (lastNodeId) {
        edges.push({ id: lastNodeId + '>' + containerId, from: lastNodeId, to: containerId, type: 'flow' });
      }
      laneNodes.forEach((ln, i) => {
        const laneId = uid('agent');
        nodes.push({
          id: laneId, kind: ln.kind,
          label: ln.label, model: ln.model, schema: ln.schema,
          phase: ln.phase || currentPhase, detail: null, body: null,
          x: startX + i * (laneW + laneGap), y: containerY + 52, w: laneW, h: 96,
        });
        edges.push({ id: containerId + '>' + laneId, from: containerId, to: laneId, type: 'flow' });
      });
      lastNodeId = containerId;
      y = containerY + cH + 56;
      pos = body.end + 1;
      continue;
    }

    // Should not reach here
    pos = absPos + 1;
  }

  return { nodes, edges, lossy };
}

/**
 * Convert parser output nodes to the exact shape flow-canvas consumes via GRAPHS.
 * A pass-through + normaliser that guarantees no missing fields.
 */
export function mapToFlowCanvas(parserNodes, parserEdges) {
  const nodes = parserNodes.map((n) => ({
    id:     n.id,
    kind:   n.kind,
    label:  n.label  || n.kind,
    model:  n.model  || null,
    schema: n.schema || null,
    phase:  n.phase  || null,
    detail: n.detail || null,
    body:   n.body   || null,
    x:      n.x      || 0,
    y:      n.y      || 0,
    w:      n.w      || 234,
    h:      n.h      || 84,
  }));

  const edges = (parserEdges || []).map((e) => ({
    id:   e.id   || (e.from + '>' + e.to),
    from: e.from,
    to:   e.to,
    type: e.type || 'flow',
  }));

  return { nodes, edges };
}
