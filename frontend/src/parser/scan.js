// scan.js — low-level, string-literal-aware scanning helpers for the workflow parser.
// Pure functions, no Node or browser APIs. Shared by meta.js and calls.js.

/** Extract a balanced-brace block starting at the first '{' at or after startIdx.
 *  Returns {text, start, end} where text is the full {...} substring, or null if unbalanced. */
export function extractBalancedBraces(src, startIdx) {
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
export function extractBalancedBracket(src, startIdx) {
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

/** Extract a balanced-paren block starting at the first '(' at or after startIdx.
 *  String-literal aware: a `(` or `)` inside a quoted string does NOT change depth (so a prompt
 *  like 'rate this :)' or one mentioning 'agent(x)' is handled correctly). Honors `\` escapes
 *  and all three quote chars. Returns {text, start, end} or null if unbalanced. */
export function extractBalancedParen(src, startIdx) {
  const i = src.indexOf('(', startIdx);
  if (i === -1) return null;
  let depth = 0, j = i, str = null;
  while (j < src.length) {
    const c = src[j];
    if (str) {
      if (c === '\\') { j += 2; continue; }
      if (c === str) str = null;
      j++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; j++; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return { text: src.slice(i, j + 1), start: i, end: j }; }
    j++;
  }
  return null; // unbalanced
}

/** Read one or more string literals joined by `+` starting at the first quote at/after i.
 *  Returns the concatenated value, or null if no literal there. Handles ', ", `. */
export function readConcatString(src, i) {
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

/** Get the value after a key like `name: 'foo'`. Concatenation-aware (`'a' + 'b'` -> 'ab').
 *  String-literal aware: a `key:` mentioned INSIDE another value's string (e.g. a description
 *  that says "the name:") is skipped, so the real top-level key is the one that matches. */
export function extractStringValue(src, key) {
  const n = src.length;
  let str = null;
  for (let i = 0; i < n; i++) {
    const c = src[i];
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === key[0] && src.startsWith(key, i)) {
      const prev = i > 0 ? src[i - 1] : '';
      if (/[A-Za-z0-9_$]/.test(prev)) continue; // word boundary before the key
      let j = i + key.length;
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === ':') return readConcatString(src, j + 1);
    }
  }
  return null;
}

/** Return the options-object fragment from an agent(...) call's full span text (incl. parens).
 *  Handles BOTH agent(prompt, {opts}) and agent({opts}); splits on the first TOP-LEVEL comma,
 *  not the first comma (which may sit inside the prompt string). */
export function optsOf(callText) {
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

/** Blank out // and block comments WITHOUT touching string literals (so a `//` or a block-comment
 *  opener inside a prompt URL is preserved). Length and newlines are kept 1:1 for line numbers. */
export function stripComments(src) {
  let out = '', i = 0, str = null, prevSig = '';
  const n = src.length;
  // A `/` opens a regex literal (not division) when the previous significant char expects a
  // value. Without this, a regex like /https?:\/\// is mis-read as a `//` line comment and the
  // rest of that line — including any agent() call after it — is silently blanked.
  const regexAllowed = () => prevSig === '' || '(,=:[!&|?{};+-*/%<>^~'.includes(prevSig);
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (str) {
      if (c === '\\') { out += c + (c2 != null ? c2 : ''); i += 2; continue; }
      out += c;
      if (c === str) { str = null; prevSig = c; } // a closed string is a value -> division next
      i++; continue;
    }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '/' && regexAllowed()) {
      // Copy a regex literal verbatim: honour \ escapes and [ ] char classes (a `/` inside a
      // class doesn't close it). Bail at EOL on an unterminated literal.
      out += c; i++; let inClass = false;
      while (i < n) {
        const rc = src[i];
        if (rc === '\n') break;
        out += rc;
        if (rc === '\\') { if (i + 1 < n && src[i + 1] !== '\n') { out += src[i + 1]; i += 2; continue; } i++; break; }
        i++;
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '/' && !inClass) break;
      }
      prevSig = 'x'; // a regex result is a value -> division (not regex) follows
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; out += c; i++; continue; }
    out += c;
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out;
}
