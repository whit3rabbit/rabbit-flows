// meta.js — parse the `export const meta = { ... }` block from a workflow source.
// Reliable: balanced-brace extraction (mirrors validate.py find_meta_block).

import { extractBalancedBraces, extractBalancedBracket, extractStringValue } from './scan.js';

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
