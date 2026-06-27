// codegen.js — emit a workflow .js from the ReactFlow canvas state.
// The generated output must pass validate.py --strict.
//
// Rules (from validate.py):
//   - meta must have name+description as pure literals (no ${}, no ..., no function calls)
//   - parallel()/pipeline() results need .filter(Boolean)
//   - phase() calls must match meta.phases titles exactly
//   - no Date.now/Math.random/new Date
//   - no fs/child_process imports

import { DIMS } from './visual.js';

const camel = (s) => {
  const w = String(s).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ');
  const name = w.map((x, i) => i ? x.charAt(0).toUpperCase() + x.slice(1) : x.toLowerCase()).join('');
  // A label like "2nd pass" yields "2ndPass" — an invalid identifier that fails validate.py.
  // Prefix `_` when it starts with a digit. (The loop path already prefixes `_r`.)
  return /^[0-9]/.test(name) ? '_' + name : name || 'step';
};

// Escape for a single-quoted JS literal. Newlines/CRs MUST be escaped too, or a multi-line
// label/name/description emits an unterminated literal that fails validate.py --strict.
const escSQ = (s) => String(s || '')
  .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '\\r').replace(/\n/g, '\\n');

const validSchema = (s) => /^[A-Z_][A-Z0-9_]*$/.test(s || '');

// model is interpolated raw into the emitted source, so it MUST be whitelisted — an arbitrary
// value (e.g. from an imported workflow JSON) would otherwise break the code or inject a statement.
const ALLOWED_MODELS = ['opus', 'sonnet', 'haiku'];
const safeModel = (m) => (ALLOWED_MODELS.includes(m) ? m : 'haiku');

// genCode — emit a workflow .js that passes validate.py --strict.
//
// @param {object[]} nodes  - ReactFlow node objects (with .data and .position)
// @param {object[]} edges  - ReactFlow edge objects
// @param {string}   metaName - workflow name for meta block
// @param {string}   metaDesc - workflow description for meta block
// @param {string[]} catalogNames - skill names from /api/skills; only these are emitted
//                                  in the requires-skills header
export function genCode(nodes, edges, metaName, metaDesc, catalogNames) {
  const conts = nodes.filter((n) => n.data.kind === 'loop' || n.data.kind === 'parallel');

  // dimOf — prefer stamped style (set at creation) over measured width/height, which
  // RF populates only asynchronously — so genCode works the instant after load/drop.
  const dimOf = (n) => {
    const fb = DIMS[n.data.kind] || [234, 84];
    const w  = (n.style && n.style.width)  || n.width  || fb[0];
    const hh = (n.style && n.style.height) || n.height || fb[1];
    return [w, hh];
  };

  // Container bounds + id lookup, computed once. dimOf reads stamped style or measured size,
  // so this stops cidOf from re-running dimOf per container on every containment test.
  const contBounds = conts.map((c) => {
    const [cw, ch] = dimOf(c);
    return { id: c.id, x0: c.position.x, y0: c.position.y, x1: c.position.x + cw, y1: c.position.y + ch };
  });
  const contById = new Map(conts.map((c) => [c.id, c]));

  // cidOf — a leaf is inside a container if its centre falls within the container bounds.
  // Called once per leaf to build cidById below; the grouping loop then reads that map (O(1)).
  const cidOf = (n) => {
    const [nw, nh] = dimOf(n);
    const px = n.position.x + nw / 2, py = n.position.y + nh / 2;
    const b = contBounds.find((b) => px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1);
    return b ? b.id : null;
  };

  // Unique JS identifiers: two labels can camel-collapse to the same name -> duplicate const.
  const usedIds = new Set();
  const uniqId = (base) => {
    const b = base || 'step';
    let id = b, k = 2;
    while (usedIds.has(id)) id = b + (k++);
    usedIds.add(id);
    return id;
  };

  const leaves = nodes
    .filter((n) => n.data.kind === 'agent' || n.data.kind === 'gate')
    .slice()
    .sort((a, b) => a.position.y - b.position.y);

  // Memoize each leaf's container once — the group scan below otherwise recomputes the
  // geometric containment test for the same node on every inner-loop comparison.
  const cidById = new Map(leaves.map((n) => [n.id, cidOf(n)]));

  // 1. requires-skills header
  const skillNodes = nodes.filter((n) => n.data.kind === 'skill');
  const rawSkillLabels = skillNodes.map((n) => n.data.label).filter(Boolean);
  const filteredSkillLabels = (catalogNames && catalogNames.length)
    ? rawSkillLabels.filter((name) => catalogNames.includes(name))
    : rawSkillLabels;
  const skillNames = filteredSkillLabels.join(', ');

  const out = [];
  out.push('// auto-generated from the graph');
  if (skillNames) out.push('// requires-skills: ' + skillNames);
  out.push('');

  // 2. Pure-literal meta block
  const safeName = escSQ(metaName || 'untitled');
  const safeDesc = escSQ(metaDesc || metaName || 'Generated workflow.');
  const seenPhases = [], phaseOrder = [];
  leaves.forEach((n) => {
    if (n.data.phase && !seenPhases.includes(n.data.phase)) {
      seenPhases.push(n.data.phase);
      phaseOrder.push({ title: n.data.phase });
    }
  });
  const metaLines = ["export const meta = {"];
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

  // 2b. Placeholder schema consts so `schema: NAME` references resolve at runtime
  const schemaNames = Array.from(new Set(nodes.map((n) => n.data.schema).filter(validSchema)));
  if (schemaNames.length) {
    schemaNames.forEach((s) => out.push('const ' + s + " = { type: 'object', properties: {}, required: [] }; // TODO: define this schema"));
    out.push('');
  }

  // 3. Body — phase() calls + agent/parallel/loop lines
  const aCall = (n) =>
    "agent(" + JSON.stringify(n.data.label || 'step') +
    ", { model: '" + safeModel(n.data.model) + "'" +
    (validSchema(n.data.schema) ? ', schema: ' + n.data.schema : '') + " })";

  let curPhase = null, i = 0;
  const emitPhase = (p) => {
    if (p && p !== curPhase) { curPhase = p; out.push("phase('" + escSQ(p) + "')"); }
  };

  while (i < leaves.length) {
    const n = leaves[i], cid = cidById.get(n.id);
    if (cid) {
      const c = contById.get(cid);
      const grp = [];
      while (i < leaves.length && cidById.get(leaves[i].id) === cid) { grp.push(leaves[i]); i++; }

      const grpPhases = [];
      grp.forEach((x) => { if (x.data.phase && !grpPhases.includes(x.data.phase)) grpPhases.push(x.data.phase); });
      if (grpPhases.length) emitPhase(grpPhases[0]);

      if (c.data.kind === 'loop') {
        const itv = uniqId('iter');
        out.push('let ' + itv + ' = 0;');
        out.push('// TODO: break when the work converges (e.g. if (result.done) break;)');
        out.push('while (' + itv + ' < (args?.maxIterations || 40)) {');
        grp.forEach((x) => {
          if (x.data.phase && x.data.phase !== curPhase) {
            out.push("  phase('" + escSQ(x.data.phase) + "');");
            curPhase = x.data.phase;
          }
          out.push('  const ' + uniqId('_r' + camel(x.data.label || 'step')) + ' = await ' + aCall(x) + ';');
        });
        out.push('  ' + itv + '++;');
        out.push('}');
      } else {
        // Parallel container: fan-out, must .filter(Boolean) per validate.py
        out.push('const ' + uniqId(camel(c.data.label || 'fanOut') + 'Results') + ' = (await parallel([');
        grp.forEach((x) => out.push('  () => ' + aCall(x) + ','));
        out.push('])).filter(Boolean);');
        grpPhases.slice(1).forEach((p) => emitPhase(p));
      }
    } else {
      emitPhase(n.data.phase || null);
      out.push('const ' + uniqId(camel(n.data.label || 'step')) + ' = await ' + aCall(n) + ';');
      i++;
    }
    out.push('');
  }

  // 4. Trailing return (required by the runtime's async wrapper)
  out.push('return;');
  return out.join('\n');
}
