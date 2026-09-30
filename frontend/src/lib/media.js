import { config } from '@/config/env.js';

/**
 * Resolve a media path returned by the API into a URL the browser can load.
 * ---------------------------------------------------------------------------
 * Why this exists:
 *
 * Uploads are stored relative — `/uploads/2026-08/abc.png`. That is deliberate:
 * an absolute URL baked into the database breaks the day the domain changes, or
 * the moment you restore a production dump into staging.
 *
 * But a relative URL in an <img> resolves against the page's origin. In
 * development that happens to work, because the Vite dev server proxies
 * `/uploads` to the API — so the bug is invisible exactly while you are
 * building. In production the site and the API are different origins, and every
 * uploaded image 404s on launch: product photos, category art, the JazzCash QR
 * the cashier is supposed to show the customer.
 *
 * Resolving here keeps storage portable and rendering correct in both places.
 */

/**
 * The API's origin, without the `/api/v1` path.
 * `config.apiUrl` may be absolute (`http://localhost:7000/api/v1`) or relative
 * (`/api/v1`, when the API is served from the same host). Only the first case
 * needs a prefix; the second is already same-origin.
 */
const apiOrigin = (() => {
  try {
    // Second argument handles the relative case without throwing.
    return new URL(config.apiUrl, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
})();

/**
 * @param {string|null|undefined} path A path or URL from the API.
 * @returns {string|undefined} A loadable URL, or undefined so `<img src>` is
 *   omitted entirely rather than set to the empty string — which browsers
 *   resolve to the current page and re-request as an image.
 */
export function mediaUrl(path) {
  if (!path) return undefined;

  // Already absolute (an external CDN, or a full URL someone pasted).
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;

  // Bundled assets under /images or /video ship with the client, so they are
  // correct relative to the page and must not be pointed at the API.
  if (path.startsWith('/images/') || path.startsWith('/video/')) return path;

  // Server-hosted uploads.
  if (path.startsWith('/')) return `${apiOrigin}${path}`;

  return path;
}

export default mediaUrl;
