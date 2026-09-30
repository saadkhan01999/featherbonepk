/**
 * Escape a string for literal use inside a RegExp.
 * ---------------------------------------------------------------------------
 * Must be applied to any user-supplied text used to build a pattern. Two
 * distinct failures otherwise:
 *   • an unbalanced `(` or `[` throws and turns a search box into a 500
 *   • a crafted nested-quantifier pattern can pin the event loop (ReDoS)
 *
 * Search endpoints take arbitrary text, so both are reachable from the public
 * menu search.
 */
export function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default escapeRegex;
