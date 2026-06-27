// meta.js — parse the `export const meta = { ... }` block from a workflow source.
// Reliable: balanced-brace extraction (mirrors validate.py find_meta_block).

import { extractBalancedBraces, extractBalancedBracket, extractStringValue, readConcatString } from './scan.js';

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
      // Collect each `title:` value, string-aware: a literal "title:" sitting INSIDE another value's
      // string (e.g. a phase `detail: 'set the title: foo'`) must not be mistaken for a phase title.
      let str = null;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
        if (c === "'" || c === '"' || c === '`') { str = c; continue; }
        if (c !== 't' || !arr.startsWith('title', i)) continue;
        const prev = i > 0 ? arr[i - 1] : '';
        if (/[A-Za-z0-9_$]/.test(prev)) continue; // word boundary before the key
        let j = i + 5;
        while (j < arr.length && /\s/.test(arr[j])) j++;
        if (arr[j] !== ':') continue;
        const v = readConcatString(arr, j + 1);
        if (v != null) result.phases.push(v);
      }
    }
  }

  return result;
}
