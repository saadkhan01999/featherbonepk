/**
 * Client configuration.
 * ---------------------------------------------------------------------------
 * Reads Vite's `import.meta.env` once, in one place. Components import `config`
 * rather than touching import.meta.env directly, which keeps env-var names out
 * of feature code and makes the full set of knobs discoverable here.
 *
 * Nothing secret goes here. Every VITE_ variable is inlined into the JS bundle
 * and is readable by anyone who opens devtools.
 */

const raw = import.meta.env;

/**
 * The API base, normalised and checked.
 *
 * Trailing slash is stripped. Request paths all begin with "/", so a base
 * ending in one produces "//auth/login". Some servers treat that as a different
 * route and 404; others redirect, which drops the Authorization header on the
 * hop and fails as an inexplicable 401.
 *
 * A bare origin is a configuration error, and this says so loudly. The API
 * mounts every route under a prefix — /api/v1 by default — so a bundle built
 * against "https://host" asks for /auth/login instead of /api/v1/auth/login and
 * every single request 404s: login, register, categories, products,
 * promotions, settings. The page renders perfectly and nothing works, which
 * reads as a broken backend and sends you to investigate the server.
 *
 * Deliberately not auto-corrected by appending "/api/v1". The prefix is
 * configurable on the server, so guessing it would paper over a real mismatch
 * and produce the same 404s with no message at all. One explicit console error
 * naming the fix is worth more than silent magic that is right most of the time.
 */
function resolveApiUrl(value) {
  const fallback = '/api/v1';
  if (value == null) return fallback;

  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!trimmed) return fallback;

  // Only absolute URLs can be missing a path; a relative "/api/v1" is fine.
  if (/^https?:\/\//i.test(trimmed)) {
    const path = trimmed.replace(/^https?:\/\/[^/]+/i, '');
    if (path === '') {
      console.error(
        `[config] VITE_API_URL is "${trimmed}", which has no path. The API lives under a ` +
          'prefix (/api/v1 by default), so every request will return 404. ' +
          `Set VITE_API_URL=${trimmed}/api/v1 and rebuild.`,
      );
    }
  }

  return trimmed;
}

export const config = Object.freeze({
  /** API base, e.g. http://localhost:7000/api/v1 */
  apiUrl: resolveApiUrl(raw.VITE_API_URL),

  appName: raw.VITE_APP_NAME ?? 'Feather & Bone',
  currency: raw.VITE_CURRENCY ?? 'PKR',

  isDevelopment: raw.DEV,
  isProduction: raw.PROD,

  /**
   * Brand strings used before the API answers.
   *
   * Contact details are deliberately not here. Phone, email, address, opening
   * hours and social links live in the database and are edited in
   * Settings → Business Details; the storefront reads them through
   * `features/site/siteContext.jsx` and omits whatever is blank.
   *
   * Name and tagline stay because something must render in the tab title and
   * the header on the very first paint, before settings load. Both are
   * overridden by the owner's values the moment they arrive.
   */
  brand: Object.freeze({
    // `??` not `||`, matching the rest of this file: an intentionally empty
    // VITE_APP_NAME should stay empty rather than silently reverting.
    name: raw.VITE_APP_NAME ?? 'Feather & Bone',
    tagline: 'Roast · Meat · Sweets · Bakery',
  }),

  /** Client-side storage keys, namespaced so they can't collide. */
  storageKeys: Object.freeze({
    theme: 'fb-theme',
    cart: 'fb-cart',
    wishlist: 'fb-wishlist',
    recentlyViewed: 'fb-recently-viewed',
    posTerminal: 'fb-pos-terminal',
  }),
});

export default config;
