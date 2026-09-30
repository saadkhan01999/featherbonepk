/**
 * One-tap feedback tags. The keys match FEEDBACK_TAGS on the server
 * (backend/src/modules/feedback/feedback.model.js) — the server refuses any
 * other key, so a tag added there must be added here too.
 */

export const GOOD_TAGS = Object.freeze([
  ['tasty', 'Tasty food'],
  ['fresh', 'Hot & fresh'],
  ['fast', 'Quick service'],
  ['friendly', 'Friendly staff'],
  ['value', 'Good value'],
  ['portions', 'Generous portions'],
  ['clean', 'Clean & tidy'],
  ['packaging', 'Neat packaging'],
]);

export const FIX_TAGS = Object.freeze([
  ['cold', 'Food was cold'],
  ['slow', 'Took too long'],
  ['wrong', 'Wrong or missing item'],
  ['taste', 'Taste not right'],
  ['pricey', 'Too expensive'],
  ['small', 'Small portions'],
  ['unfriendly', 'Unfriendly service'],
  ['messy', 'Messy packaging'],
]);

export const TAG_LABEL = Object.freeze(Object.fromEntries([...GOOD_TAGS, ...FIX_TAGS]));
const FIX = new Set(FIX_TAGS.map(([key]) => key));

/** Is this tag a problem to fix (shown in a different colour)? */
export const isFixTag = (key) => FIX.has(key);

/** Which tags to offer for a star rating: praise, problems, or both for a middling score. */
export function tagsForRating(rating) {
  if (rating >= 4) return { good: GOOD_TAGS, fix: [] };
  if (rating > 0 && rating <= 2) return { good: [], fix: FIX_TAGS };
  if (rating === 3) return { good: GOOD_TAGS.slice(0, 4), fix: FIX_TAGS.slice(0, 4) };
  return { good: [], fix: [] };
}
