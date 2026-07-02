// agent-scan.js — extracts model/schema/label/phase options and scans a source span for agent()
// call tokens. Split out of calls.js to keep it under the 400-line file cap (see frontend/CLAUDE.md).
// Shared by calls.js for both the top-level agent() scan and nested parallel()/pipeline()/loop() bodies.

import { optsOf, extractBalancedParen } from './scan.js';

/** Detect the model hint from an options-like snippet. */
export function extractModel(optSnippet) {
  const m = /model\s*:\s*['"`](opus|sonnet|haiku)['"`]/.exec(optSnippet);
  return m ? m[1] : null;
}

/** Detect the schema name from an options-like snippet. */
export function extractSchema(optSnippet) {
  const m = /schema\s*:\s*([A-Z_][A-Z0-9_]*)/.exec(optSnippet);
  return m ? m[1] : null;
}

/** Detect the label from an options-like snippet (label: '...'). */
export function extractLabel(optSnippet) {
  const m = /label\s*:\s*(['"`])((?:\\.|(?!\1)[^])*?)\1/.exec(optSnippet);
  return m ? m[2] : null;
}

/** Detect the phase from an options-like snippet. */
export function extractPhase(optSnippet) {
  const m = /phase\s*:\s*(['"`])((?:\\.|(?!\1)[^])*?)\1/.exec(optSnippet);
  return m ? m[2] : null;
}

/** Scan inner text for agent() calls; return [{model, schema, label, phase, kind}]. offset is
 *  inner's absolute start in the caller's source (for line numbers); onUnbalanced(absPos) is
 *  called for an unbalanced agent() paren instead of pushing to a shared lossy[] directly, so this
 *  module doesn't need to know about the caller's lossy-entry shape.
 *  String-aware: an `agent(` that appears INSIDE a prompt string (e.g. 'use the agent(x) helper')
 *  is not a call and is skipped, so it neither spawns a phantom node nor a false lossy entry. */
export function scanAgents(inner, offset, labelFor, currentPhase, onUnbalanced) {
  const found = [];
  let str = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (str) {
      if (c === '\\') { i++; continue; }
      // Template-expression awareness, mirroring extractBalancedParen: inside a backtick string,
      // `${...}` may itself contain a nested template literal — skip to the matching `}` with its
      // own string-aware brace tracking so an inner backtick doesn't prematurely close the outer
      // string (which would desync this loop's notion of "inside a string" from the rest of the
      // parser and risk mis-detecting an "agent(" token that's really still inside the string).
      if (str === '`' && c === '$' && i + 1 < inner.length && inner[i + 1] === '{') {
        let exprDepth = 1, exprStr = null, j = i + 2;
        while (j < inner.length && exprDepth > 0) {
          const ec = inner[j];
          if (exprStr) {
            if (ec === '\\') { j += 2; continue; }
            if (ec === exprStr) exprStr = null;
            j++; continue;
          }
          if (ec === "'" || ec === '"' || ec === '`') { exprStr = ec; j++; continue; }
          if (ec === '{') exprDepth++;
          else if (ec === '}') exprDepth--;
          j++;
        }
        i = j - 1; // loop's i++ lands just past the closing }
        continue;
      }
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
      onUnbalanced(offset + i);
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
