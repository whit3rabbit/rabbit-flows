// lossy.js — human-readable "fix" hints + source-snippet extraction for parser lossy[] entries.
// Split out of calls.js to keep it under the 400-line file cap (see frontend/CLAUDE.md).

// Map a lossy reason to a human-readable fix suggestion.
const FIX_HINTS = {
  'unbalanced agent() paren': 'Check that every agent() call has a matching closing paren. If a .replace(/"/g, ...) appears inside a template $ expression, pre-compute the value outside the template (see frontend/CLAUDE.md parse limitations).',
  'unbalanced agent() paren inside a container': 'Check that every agent() inside a parallel/pipeline body has a matching closing paren. Same .replace(/"/g, ...) gotcha applies inside template literals.',
  'unbalanced parallel() paren': 'The parallel() call has mismatched parentheses. Look for a .replace(/"/g, ...) or nested template literal ${{...}} in the arguments.',
  'unbalanced pipeline() paren': 'The pipeline() call has mismatched parentheses. Same template-literal gotchas as parallel().',
  'parallel() contains no parseable agent() calls': 'parallel() body has no parseable agent() calls. If using pre-constructed thunks (e.g. parallel(fileStubThunks)), this is expected and harmless. Otherwise put agent() calls inline.',
  'pipeline() contains no parseable agent() calls': 'pipeline() body has no parseable agent() calls. If using pre-constructed stages, this is expected.',
  'parallel() references an unresolved identifier': 'parallel(NAME) points at a NAME with no matching top-level `const NAME = ...` thunk array (or an agent()-free one) in this file. If NAME really has no agent() calls this is harmless; otherwise move the thunk array to a top-level const so it can be resolved.',
  'unbalanced loop header paren': 'The while/for loop header has mismatched parentheses.',
  'unbalanced loop body block': 'The loop body braces are mismatched.',
};

export function fixHint(reason) {
  return FIX_HINTS[reason] || 'Review the construct at the indicated line — the heuristic parser could not map it to a graph node.';
}

/** Extract a short source snippet around position p for error reporting.
 *  Uses the raw source (not stripped) so comments/strings read naturally.
 *  Returns at most ~60 chars, trimmed to a line boundary. */
export function snippetSrc(src, p) {
  let start = Math.max(0, p - 15);
  let end = Math.min(src.length, p + 45);
  // Extend to line boundaries
  while (start > 0 && src[start - 1] !== '\n') start--;
  while (end < src.length && src[end] !== '\n' && end - start < 80) end++;
  return src.slice(start, end).replace(/\n/g, ' ').trim();
}
