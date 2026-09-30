/**
 * Turn a `?sort=` string into a Mongo sort object — safely.
 * ---------------------------------------------------------------------------
 * Whitelisted, not passed through. `Model.find().sort(req.query.sort)` looks
 * harmless and is not:
 *
 *  • Mongo will happily sort on a field with no index. On a large collection
 *    that is a blocking in-memory sort, and past 32MB the query does not slow
 *    down — it fails. A stranger can trigger that by editing a URL.
 *  • Sorting by a `select: false` field (costPrice, password metadata) leaks
 *    its ordering: request ascending, request descending, and the two lists
 *    tell you who is at each end.
 *
 * So each endpoint declares the columns it is willing to sort by, mapping the
 * name the client uses to the path the database uses. Anything unrecognised
 * falls back to the endpoint's default rather than erroring: a stale bookmark
 * with an old column name should still render a list.
 *
 * @example
 *   const sorts = { name: 'name', price: 'price', stock: 'stock' };
 *   Product.find(filter).sort(parseSort(query.sort, sorts, { updatedAt: -1 }));
 */

/**
 * @param {string|undefined} value   e.g. "price:desc", "name", "-stock"
 * @param {Record<string,string>} allowed  client name → database path
 * @param {object} fallback          used when `value` is missing or unknown
 * @returns {object} a Mongo sort specification
 */
export function parseSort(value, allowed, fallback = { createdAt: -1 }) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;

  // Accept "field:desc" and the "-field" shorthand, so a URL written either
  // way behaves the same.
  const raw = value.trim();
  const leadingMinus = raw.startsWith('-');
  const [namePart, directionPart] = (leadingMinus ? raw.slice(1) : raw).split(':');

  const path = allowed[namePart];
  if (!path) return fallback;

  const descending = leadingMinus || directionPart?.toLowerCase() === 'desc';

  /*
   * `_id` breaks ties. Without it, two rows with equal values can swap places
   * between requests, and a row that swaps across a page boundary is either
   * shown twice or skipped entirely while paging — records appear to vanish.
   */
  return { [path]: descending ? -1 : 1, _id: 1 };
}

export default parseSort;
