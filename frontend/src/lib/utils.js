import { useEffect, useState } from 'react';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn — conditional class names with Tailwind conflict resolution.
 * ---------------------------------------------------------------------------
 * `clsx` handles conditionals; `twMerge` resolves conflicts by keeping the last
 * value in the same utility group. That is what makes component overrides work:
 *
 *   cn('px-4 py-2 bg-surface', 'bg-gold')  →  'px-4 py-2 bg-gold'
 *
 * Plain string concatenation would emit both background classes and let CSS
 * source order decide — so a caller's override would silently do nothing.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Stable, human-friendly slug. Used for category/product URLs on the client
 * (the server generates its own authoritative slug on write).
 */
export function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Initials for avatar fallbacks — at most two letters.
 * `getInitials('Ali Hassan')` → 'AH'
 */
export function getInitials(name = '') {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Clamp a number into a range — quantity steppers, discount percentages. */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Escape a string for safe use inside a RegExp.
 * Any user-supplied text used to build a pattern must go through this: an
 * unescaped `(` throws, and a crafted pattern can hang the thread (ReDoS).
 */
export function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Is this value an empty object/array/string/nullish? */
export function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value) || typeof value === 'string') return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * A value that only settles after the user stops changing it.
 * ---------------------------------------------------------------------------
 * For search boxes that drive a request. Typing "chicken" fires seven queries
 * without this — each one a round trip to a database that may be on another
 * continent, and the first six are thrown away before anyone reads them.
 *
 * @param {*} value
 * @param {number} [delay] Milliseconds of quiet before the value updates.
 */
export function useDebouncedValue(value, delay = 400) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    // Cleared on every change, so the timer only completes once typing pauses.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
