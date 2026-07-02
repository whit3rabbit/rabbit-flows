// thunks.js — resolves top-level `const NAME = ...` thunk-array identifiers so calls.js can render
// `parallel(NAME)` (a bare identifier, not an inline array/`.map()`) as a real fan-out container instead
// of silently producing zero nodes. Pure functions, no Node or browser APIs. Shared by calls.js.

import { extractBalancedParen, extractBalancedBracket } from './scan.js';

/** String-literal aware check for a real `agent(` call token in `text` — a plain `/\bagent\s*\(/`
 *  regex would also match "agent(" appearing inside a prose string (e.g. a data array of strings
 *  that happens to mention it), misclassifying a plain data array as a thunk source. */
function hasAgentCall(text) {
  let str = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c !== 'a' || !text.startsWith('agent', i)) continue;
    const prev = i > 0 ? text[i - 1] : '';
    if (/[A-Za-z0-9_$]/.test(prev)) continue; // e.g. "subagent"
    let k = i + 5;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === '(') return true;
  }
  return false;
}

const CTRL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch']);

/** Compute, for every position in S, how many FUNCTION bodies (arrow or `function`) it's nested
 *  inside — as opposed to a plain control-flow block (if/for/while/switch/catch) or an object/
 *  destructuring literal. One string-aware linear pass, bounded lookahead only (no backtracking).
 *  Used to scope `NAME.push(...)` folding to true top-level statements: workflow scripts commonly
 *  push lanes from a top-level `if (cond) { thunks.push(...) }` (still depth 0 — no wrapping
 *  function), but a `.push()` inside an unrelated nested function's own local scope must NOT fold
 *  onto a same-named top-level thunk array. */
function functionDepths(S) {
  const depthAt = new Uint16Array(S.length);
  const braceIsFunc = [];
  const parenIsCandidate = [];
  const funcBraceAt = new Set(); // positions of '{' already determined to open a function body
  let str = null, word = '', depth = 0;
  for (let i = 0; i < S.length; i++) {
    depthAt[i] = depth;
    const c = S[i];
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; word = ''; continue; }
    if (c === '(') { parenIsCandidate.push(!CTRL_KEYWORDS.has(word)); word = ''; continue; }
    if (c === ')') {
      const isCandidate = parenIsCandidate.pop();
      let k = i + 1;
      while (k < S.length && /\s/.test(S[k])) k++;
      if (S[k] === '{' && isCandidate) funcBraceAt.add(k);
      else if (S[k] === '=' && S[k + 1] === '>') {
        let k2 = k + 2;
        while (k2 < S.length && /\s/.test(S[k2])) k2++;
        if (S[k2] === '{') funcBraceAt.add(k2);
      }
      word = '';
      continue;
    }
    if (c === '{') {
      const isFunc = funcBraceAt.has(i);
      braceIsFunc.push(isFunc);
      if (isFunc) depth++;
      word = '';
      continue;
    }
    if (c === '}') {
      if (braceIsFunc.pop()) depth--;
      word = '';
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) word += c;
    else if (c !== ' ' && c !== '\t') word = '';
  }
  return depthAt;
}

/** From position `afterEq` (right after `NAME = `), find where an array-literal or call-expression
 *  initializer starts: `[` immediately, or an identifier/property-access chain (`Array.from`,
 *  `foo.map`, `foo.bar.filter`) immediately followed by `(`. Anything else (a plain value like
 *  `args?.board ?? '...'`) is not a thunk-container shape — returns null so the caller skips it
 *  rather than grabbing an unrelated `(` far later in the file. */
function findInitializerStart(S, afterEq) {
  if (S[afterEq] === '[') return { kind: 'bracket', pos: afterEq };
  let k = afterEq;
  while (k < S.length && /[\w$.]/.test(S[k])) k++;
  // Require at least one identifier/property-chain char before the '(' — otherwise `k === afterEq`
  // and `S[k]` is the initializer's OWN leading '(' (a grouped expression like `(a ? b : c)`, not a
  // call), which extractBalancedParen would then extract as if it were the call's argument list.
  if (k > afterEq && S[k] === '(') return { kind: 'paren', pos: k };
  return null;
}

/** Build a `name -> initializer source text` index of top-level `const NAME = ...` declarations
 *  whose initializer contains at least one `agent(` call (an array of thunks or a `.map()`/
 *  `Array.from()` builder of them) — plain consts (strings, numbers, unrelated arrays) are skipped
 *  so the index stays limited to genuine thunk sources. Also folds in `NAME.push(...)` call
 *  arguments (conditional lanes, e.g. `if (x) thunks.push(() => agent(...))`) onto an already-indexed
 *  name, so a bare `parallel(NAME)` resolves the FULL lane set, not just the initial literal.
 *
 *  `S` must be the comment-stripped source (see scan.js stripComments) so a `const` mentioned inside
 *  a comment isn't mistaken for a real declaration. Column-0 anchored: workflow scripts have no
 *  wrapping function, so every genuine top-level declaration starts at the beginning of its line. */
export function indexThunkSources(S) {
  // name -> { text, start } — start is the ABSOLUTE position of the declaration's initializer
  // (not any later `parallel(NAME)` call site), so a lossy entry surfaced while re-scanning the
  // resolved text reports a line/snippet near the declaration, where the source actually is.
  const index = new Map();
  const declRe = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm;
  let m;
  while ((m = declRe.exec(S))) {
    const name = m[1];
    const init = findInitializerStart(S, declRe.lastIndex);
    if (!init) continue;
    const extracted = init.kind === 'bracket'
      ? { text: extractBalancedBracket(S, init.pos), start: init.pos }
      : (() => { const p = extractBalancedParen(S, init.pos); return p ? { text: p.text, start: p.start } : null; })();
    if (extracted?.text && hasAgentCall(extracted.text)) index.set(name, { text: extracted.text, start: extracted.start });
  }

  const depthAt = functionDepths(S);
  const pushRe = /\b([A-Za-z_$][\w$]*)\.push\s*\(/g;
  while ((m = pushRe.exec(S))) {
    const name = m[1];
    if (!index.has(name)) continue; // only fold pushes onto names the decl scan already qualified
    if (depthAt[m.index] > 0) continue; // don't fold a push from inside an unrelated nested function
    const span = extractBalancedParen(S, pushRe.lastIndex - 1);
    if (span) {
      const entry = index.get(name);
      index.set(name, { text: entry.text + '\n' + span.text, start: entry.start });
    }
  }

  return index;
}

/** True if `parenText` (the FULL `(...)` span text of a `parallel(...)`/`pipeline(...)` call,
 *  parens included) is a single bare identifier argument — `(NAME)`, optionally spaced — as opposed
 *  to an inline array/`.map()`/multiple-args form. Returns the identifier or null. */
export function bareIdentifierArg(parenText) {
  const m = /^\(\s*([A-Za-z_$][\w$]*)\s*\)$/.exec(parenText);
  return m ? m[1] : null;
}
