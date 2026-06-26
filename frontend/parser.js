/**
 * parser.js — workflow .js source -> {meta, nodes, edges, lossy[]}
 *
 * Runnable in the browser (no Node-only APIs) and importable by server.js.
 * Meta block: reliable, via balanced-brace extraction (mirrors validate.py find_meta_block).
 * Call sites: best-effort regex/scan; unrecognised sections go to lossy[] with {line, reason}.
 *
 * Node schema matches what flow-canvas.js's GRAPHS registry consumes:
 *   {id, kind, label, model, phase, detail, schema, x, y, w, h}
 * Edge schema:
 *   {id, from, to, type}  (type: 'flow'|'data'|'skill'|'loop')
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract a balanced-brace block starting at the first '{' at or after startIdx.
 *  Returns {text, start, end} where text is the full {...} substring, or null if unbalanced. */
function extractBalancedBraces(src, startIdx) {
  const i = src.indexOf('{', startIdx);
  if (i === -1) return null;
  let depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { text: src.slice(i, j + 1), start: i, end: j };
    }
    j++;
  }
  return null; // unbalanced
}

/** Extract a balanced-bracket block starting at the first '[' at or after startIdx. */
function extractBalancedBracket(src, startIdx) {
  const i = src.indexOf('[', startIdx);
  if (i === -1) return null;
  let depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return src.slice(i, j + 1); }
    j++;
  }
  return null;
}

/** Read one or more string literals joined by `+` starting at the first quote at/after i.
 *  Returns the concatenated value, or null if no literal there. Handles ', ", `. */
function readConcatString(src, i) {
  let result = '', sawOne = false;
  const n = src.length;
  while (i < n) {
    while (i < n && /\s/.test(src[i])) i++;
    const q = src[i];
    if (q !== "'" && q !== '"' && q !== '`') break;
    i++;
    let chunk = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { chunk += src[i + 1] != null ? src[i + 1] : ''; i += 2; continue; }
      chunk += src[i]; i++;
    }
    i++; // closing quote
    result += chunk; sawOne = true;
    while (i < n && /\s/.test(src[i])) i++;
    if (src[i] === '+') { i++; continue; } // ` + 'next'` continuation
    break;
  }
  return sawOne ? result : null;
}

/** Get the value after a key like `name: 'foo'`. Concatenation-aware (`'a' + 'b'` -> 'ab'). */
function extractStringValue(src, key) {
  const re = new RegExp(String.raw`\b${key}\s*:\s*`);
  const m = re.exec(src);
  if (!m) return null;
  return readConcatString(src, m.index + m[0].length);
}

/** Return the options-object fragment from an agent(...) call's full span text (incl. parens).
 *  Handles BOTH agent(prompt, {opts}) and agent({opts}); splits on the first TOP-LEVEL comma,
 *  not the first comma (which may sit inside the prompt string). */
function optsOf(callText) {
  const lo = callText.indexOf('('), hi = callText.lastIndexOf(')');
  const inner = callText.slice(lo + 1, hi);
  if (inner.trimStart().startsWith('{')) return inner; // single-object form: whole arg is opts
  let depth = 0, str = null;
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (str) { if (c === '\\') { k++; continue; } if (c === str) str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return inner.slice(k + 1);
  }
  return inner; // single arg, no top-level comma
}

/** Blank out // and /* *\/ comments WITHOUT touching string literals (so a `//` or `/*`
 *  inside a prompt URL is preserved). Length and newlines are kept 1:1 for line numbers. */
function stripComments(src) {
  let out = '', i = 0, str = null;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (str) {
      if (c === '\\') { out += c + (c2 != null ? c2 : ''); i += 2; continue; }
      out += c; if (c === str) str = null; i++; continue;
    }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseMeta(src) — bite 1
// ---------------------------------------------------------------------------

/**
 * Parse the `export const meta = { ... }` block from a workflow source string.
 *
 * Returns:
 *   {
 *     name: string|null,
 *     description: string|null,
 *     phases: string[],   // phase titles in declaration order
 *     raw: string|null,   // the raw {...} text (for debugging)
 *     unbalanced: boolean // true when the brace block was not closed
 *   }
 */
export function parseMeta(src) {
  const result = { name: null, description: null, phases: [], raw: null, unbalanced: false };

  // Find `export const meta = {`
  const headerRe = /export\s+const\s+meta\s*=\s*\{/;
  const headerMatch = headerRe.exec(src);
  if (!headerMatch) return result;

  const block = extractBalancedBraces(src, headerMatch.index);
  if (!block) {
    result.unbalanced = true;
    return result;
  }

  result.raw = block.text;
  result.name = extractStringValue(block.text, 'name');
  result.description = extractStringValue(block.text, 'description');

  // Extract phases[].title — scan ONLY inside the `phases: [ ... ]` array so an unrelated
  // `title:` key elsewhere in meta is not mistaken for a phase.
  const phasesIdx = block.text.search(/\bphases\s*:\s*\[/);
  if (phasesIdx !== -1) {
    const arr = extractBalancedBracket(block.text, phasesIdx);
    if (arr) {
      const titleRe = /\btitle\s*:\s*(['"`])((?:\\.|(?!\1)[^])*?)\1/g;
      let m;
      while ((m = titleRe.exec(arr)) !== null) result.phases.push(m[2]);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// parseCalls(src) — bite 2+3
// ---------------------------------------------------------------------------

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
 * Returns:
 *   {
 *     nodes: Node[],
 *     edges: Edge[],
 *     lossy: [{line, reason}]
 *   }
 *
 * Strategy:
 *   - Scan line-by-line for recognizable patterns.
 *   - For agent() calls: emit an agent node.
 *   - For phase() calls: track the current phase label.
 *   - For parallel([...]): emit a parallel container + child agent nodes.
 *   - For pipeline(): emit a phase node (best-effort; pipeline is rare).
 *   - Unrecognised/unbalanced constructs go to lossy[].
 *
 * Layout: a simple top-down linear arrangement (x=470 center, y+=132 per node).
 * Parallel containers get a wider, taller slot; child lanes spread horizontally.
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

  // Strip comments (string-literal aware: a `//` or `/*` inside a prompt URL is preserved).
  // Length/newlines kept 1:1 so line numbers stay correct.
  const stripped = stripComments(src);

  let y = 120;
  let currentPhase = null;
  let lastNodeId = null;

  // Quick-scan patterns. parallel()/pipeline() do NOT require a literal '[' — the idiomatic
  // form is parallel(items.map(() => agent(...))) / pipeline(items, stage1, stage2).
  const phaseCallRe   = /\bphase\s*\(\s*(['"`])((?:\\.|(?!\1)[^])*?)\1\s*\)/;
  const agentCallRe   = /\bawait\s+agent\s*\(/;
  const parallelRe    = /\bawait\s+parallel\s*\(/;
  const pipelineRe    = /\bawait\s+pipeline\s*\(/;

  // We process the full source as a string, tracking position for line numbers.
  // scan() jumps over multi-line constructs.
  let pos = 0;
  const S = stripped;

  function posLine(p) { return S.slice(0, p).split('\n').length; }

  function addNode(node) {
    nodes.push(node);
    if (lastNodeId && node.kind !== 'parallel' && node.kind !== 'loop') {
      edges.push({ id: lastNodeId + '>' + node.id, from: lastNodeId, to: node.id, type: 'flow' });
    }
    lastNodeId = node.id;
    y += VSTEP;
  }

  // Extract a balanced-paren span starting at pos (pos points to the '(').
  function extractParen(startPos) {
    let depth = 0, j = startPos;
    while (j < S.length) {
      const c = S[j];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return { text: S.slice(startPos, j + 1), end: j }; }
      j++;
    }
    return null;
  }

  while (pos < S.length) {
    // Skip whitespace-only gaps quickly
    const rest = S.slice(pos);

    // --- phase() call ---
    const phaseM = phaseCallRe.exec(rest);
    const agentM = agentCallRe.exec(rest);
    const parallelM = parallelRe.exec(rest);
    const pipelineM = pipelineRe.exec(rest);

    // Find the nearest match
    const candidates = [
      phaseM   ? { type: 'phase',    idx: phaseM.index,    m: phaseM    } : null,
      agentM   ? { type: 'agent',    idx: agentM.index,    m: agentM    } : null,
      parallelM? { type: 'parallel', idx: parallelM.index, m: parallelM } : null,
      pipelineM? { type: 'pipeline', idx: pipelineM.index, m: pipelineM } : null,
    ].filter(Boolean).sort((a, b) => a.idx - b.idx);

    if (candidates.length === 0) break;

    const hit = candidates[0];
    const absPos = pos + hit.idx;

    if (hit.type === 'phase') {
      currentPhase = hit.m[2];
      pos = absPos + hit.m[0].length;
      continue;
    }

    if (hit.type === 'agent') {
      // agent( ... ) — extract the paren span
      const parenStart = absPos + hit.m[0].length - 1; // points to '('
      const span = extractParen(parenStart);
      if (!span) {
        lossy.push({ line: posLine(absPos), reason: 'unbalanced agent() paren' });
        pos = absPos + 1;
        continue;
      }
      const optsFrag = optsOf(span.text);
      const model  = extractModel(optsFrag);
      const schema = extractSchema(optsFrag);
      const label  = extractLabel(optsFrag) || 'agent';
      const phase  = extractPhase(optsFrag) || currentPhase;

      // Heuristic: if the label contains 'gate' or schema matches GATE, type it as gate.
      const kind = /gate/i.test(label) ? 'gate' : 'agent';

      const node = makeNode(kind, label, { model, schema, phase, y });
      addNode(node);
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
      const inner = span.text;
      // Find agent calls inside the parallel body (bare or awaited).
      const laneRe = /\bagent\s*\(/g;
      const laneNodes = [];
      let lm;
      while ((lm = laneRe.exec(inner)) !== null) {
        const pStart = lm.index + lm[0].length - 1;
        // Extract paren span relative to inner string
        let depth = 0, j = pStart;
        let laneSpan = null;
        while (j < inner.length) {
          const c = inner[j];
          if (c === '(') depth++;
          else if (c === ')') { depth--; if (depth === 0) { laneSpan = inner.slice(pStart, j + 1); break; } }
          j++;
        }
        if (!laneSpan) {
          // Unbalanced paren inside parallel block — record in lossy.
          // lm.index is relative to inner; inner[0] sits at parenStart in S.
          lossy.push({ line: posLine(parenStart + lm.index), reason: 'unbalanced agent() paren inside parallel()' });
          continue;
        }
        const optsFrag = optsOf(laneSpan);
        const model  = extractModel(optsFrag);
        const schema = extractSchema(optsFrag);
        const label  = extractLabel(optsFrag) || ('worker:' + laneNodes.length);
        const phase  = extractPhase(optsFrag) || currentPhase;
        const kind   = /gate/i.test(label) ? 'gate' : 'agent';
        laneNodes.push({ model, schema, label, phase, kind });
      }

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

      const laneIds = [];
      laneNodes.forEach((ln, i) => {
        const laneId = uid('agent');
        const laneNode = {
          id: laneId, kind: ln.kind,
          label: ln.label, model: ln.model, schema: ln.schema,
          phase: ln.phase || currentPhase, detail: null, body: null,
          x: startX + i * (laneW + laneGap), y: containerY + 52, w: laneW, h: 96,
        };
        nodes.push(laneNode);
        laneIds.push(laneId);
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
      const inner = span.text;
      const stageRe = /\bagent\s*\(/g;
      let sm, found = 0;
      while ((sm = stageRe.exec(inner)) !== null) {
        const pStart = sm.index + sm[0].length - 1;
        let depth = 0, j = pStart, stageSpan = null;
        while (j < inner.length) {
          const c = inner[j];
          if (c === '(') depth++;
          else if (c === ')') { depth--; if (depth === 0) { stageSpan = inner.slice(pStart, j + 1); break; } }
          j++;
        }
        if (!stageSpan) continue;
        const optsFrag = optsOf(stageSpan);
        const model  = extractModel(optsFrag);
        const schema = extractSchema(optsFrag);
        const label  = extractLabel(optsFrag) || ('stage:' + found);
        const phase  = extractPhase(optsFrag) || currentPhase;
        const kind   = /gate/i.test(label) ? 'gate' : 'agent';
        addNode(makeNode(kind, label, { model, schema, phase, y }));
        found++;
      }
      if (!found) lossy.push({ line: posLine(absPos), reason: 'pipeline() contains no parseable agent() calls' });
      pos = span.end + 1;
      continue;
    }

    // Should not reach here
    pos = absPos + 1;
  }

  return { nodes, edges, lossy };
}

// ---------------------------------------------------------------------------
// mapToFlowCanvas(nodes) — bite 4: map to flow-canvas.js node schema
// ---------------------------------------------------------------------------

/**
 * Convert parser output nodes to the exact shape flow-canvas.js consumes via GRAPHS.
 * flow-canvas.js uses: N({id, kind, label, model, schema, phase, detail, body, x, y})
 * and derives w/h from DIMS[kind].  Our nodes already carry all those fields.
 * This function is a pass-through + normaliser — it guarantees no missing fields.
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

// ---------------------------------------------------------------------------
// parseWorkflow(src) — top-level entry point
// ---------------------------------------------------------------------------

/**
 * Parse a workflow .js source string into a graph object.
 *
 * Returns:
 *   {
 *     meta: { name, description, phases, raw, unbalanced },
 *     nodes: Node[],
 *     edges: Edge[],
 *     lossy: [{line, reason}]
 *   }
 *
 * The returned nodes/edges use the flow-canvas.js internal shape (id/kind/label/…/x/y/w/h).
 */
export function parseWorkflow(src) {
  const meta  = parseMeta(src);
  const calls = parseCalls(src);
  const { nodes, edges } = mapToFlowCanvas(calls.nodes, calls.edges);

  return {
    meta,
    nodes,
    edges,
    lossy: calls.lossy,
  };
}
