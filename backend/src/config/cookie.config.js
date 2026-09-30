/**
 * Refresh-token cookie policy.
 * ---------------------------------------------------------------------------
 * Every flag here is a specific defence:
 *
 *   httpOnly  — JavaScript cannot read it, so an XSS payload cannot exfiltrate
 *               the long-lived credential. This is the single most important
 *               reason the refresh token is a cookie and the access token is not.
 *   secure    — HTTPS only in production (off locally, where there is no TLS).
 *   sameSite  — 'strict' when the site and API share a registrable domain, which
 *               neutralises CSRF against the refresh endpoint outright. It cannot
 *               be used when they do not: a Strict cookie is never sent on a
 *               cross-site request, so with the site on featherbonepk.com and the
 *               API on railway.app the browser stores the cookie at login and
 *               then withholds it from every /auth/refresh — the user appears to
 *               sign in, and is signed out again by the next page load, with no
 *               error anywhere to explain it. Detected per request rather than
 *               configured, because a knob for this is a knob to get wrong.
 *   path      — scoped to the auth routes only. A cookie sent on every API call
 *               is a cookie exposed on every API call; the refresh token is
 *               needed by exactly three endpoints.
 */
import { env } from './env.config.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const REFRESH_COOKIE_NAME = 'fb_refresh';

/**
 * @param {object} [options]
 * @param {boolean} [options.persistent] `true` keeps the session across browser
 *   restarts ("remember me"); `false` makes it a session cookie that dies when
 *   the browser closes.
 *
 * A boolean rather than a `maxAge`: a destructuring default would turn an
 * `undefined` max age ("don't remember me") back into seven days.
 */
/**
 * The registrable domain, approximately: the last two labels of a hostname.
 *
 * "backend.featherbonepk.com" and "featherbonepk.com" both reduce to
 * "featherbonepk.com" and are same-site. "featherbonepk-production.up.railway.app"
 * reduces to "railway.app" and is not.
 *
 * A full public-suffix list would be more precise for hosts like example.co.uk,
 * which this shortens to "co.uk". That inaccuracy is deliberately tolerated
 * because of which way it errs: two different .co.uk sites would be judged
 * same-site, giving SameSite=Strict, and the cookie would visibly fail to send —
 * a loud, findable bug. The opposite mistake would silently relax CSRF
 * protection, which is the one outcome not worth risking to save a dependency.
 */
const registrableDomain = (host) =>
  String(host ?? '')
    .toLowerCase()
    .split(':')[0]
    .split('.')
    .slice(-2)
    .join('.');

/**
 * Is the browser's page origin on the same site as this API?
 *
 * Compared against the request's own Host rather than anything configured: it is
 * the only value guaranteed to describe the address the browser actually used,
 * and it stays correct when the API moves hosts without anyone updating a
 * variable.
 */
function isCrossSite(req) {
  if (!req) return false; // No request to judge from — keep the stricter policy.
  try {
    const client = registrableDomain(new URL(env.CLIENT_URL).hostname);
    const api = registrableDomain(req.hostname);
    return Boolean(client) && Boolean(api) && client !== api;
  } catch {
    return false;
  }
}

/**
 * @param {import('express').Request} req Used to decide SameSite; see isCrossSite.
 */
export function refreshCookieOptions(req, { persistent = false } = {}) {
  /*
   * SameSite=None is only honoured together with Secure — browsers reject the
   * pair without it — so a cross-site deployment must be HTTPS. Both the site
   * and Railway are, and development never takes this branch.
   */
  const crossSite = env.isProduction && isCrossSite(req);

  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? (crossSite ? 'none' : 'strict') : 'lax',
    path: `${env.API_PREFIX}/auth`,
    // Omitting maxAge entirely is what makes a session cookie; passing
    // `undefined` explicitly would do the same, but saying so is clearer.
    ...(persistent && { maxAge: SEVEN_DAYS_MS }),
  };
}

/**
 * Clearing must repeat the same path and flags used when setting the cookie —
 * browsers match on those attributes, and a mismatch silently leaves the
 * cookie in place, so "log out" would not actually log the user out.
 */
export function clearRefreshCookie(res, req) {
  const crossSite = env.isProduction && isCrossSite(req);

  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? (crossSite ? 'none' : 'strict') : 'lax',
    path: `${env.API_PREFIX}/auth`,
  });
}
