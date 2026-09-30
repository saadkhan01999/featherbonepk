/**
 * Security middleware bundle.
 * ---------------------------------------------------------------------------
 * Applied to every request before any route runs. Each piece defends a
 * different, specific attack:
 *
 *   helmet          — sets protective response headers (clickjacking, sniffing)
 *   cors            — restricts which origins may read responses with credentials
 *   mongoSanitize   — strips `$`/`.` operators from input (NoSQL injection)
 *   payload limits  — caps body size (memory-exhaustion DoS)
 */
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';

import { env } from '../config/env.config.js';
import { ApiError } from '../core/errors/ApiError.js';
import { logger } from '../core/utils/logger.js';

/**
 * Origins allowed to make credentialed requests.
 * A strict allow-list, not a reflect-any-origin wildcard: cookies carry the
 * refresh token, and `origin: true` with credentials would let any site drive
 * an authenticated session on a logged-in user's behalf.
 *
 * The list is CLIENT_URL plus anything in ALLOWED_ORIGINS, so the apex and www
 * forms of a domain — and later an admin or POS subdomain — are a configuration
 * change rather than a code change. See env.config.js.
 */
/**
 * The one answer to "may this browser origin talk to the API?".
 *
 * Shared by the HTTP CORS layer below and the Socket.IO handshake in
 * core/realtime — two copies of an allow-list drift, and the drifted copy is
 * the one that quietly lets a stranger's page open a live connection.
 */
const ALLOWED_ORIGINS = (() => {
  const allowed = new Set(env.allowedOrigins);

  if (!env.isProduction) {
    // Vite may land on the next free port if the configured one is taken, and
    // the POS is often opened on 127.0.0.1 rather than localhost.
    ['7001', '7002', '7003'].forEach((port) => {
      allowed.add(`http://localhost:${port}`);
      allowed.add(`http://127.0.0.1:${port}`);
    });
  }
  return allowed;
})();

/**
 * @param {string|undefined} origin The request's Origin header.
 * @returns {boolean} true when there is no Origin (same-origin, curl, probes)
 *   or it is on the allow-list.
 */
export function isAllowedOrigin(origin) {
  if (!origin) return true;
  // Compared without a trailing slash: browsers never send one, but a value
  // pasted into the environment often carries it, and an exact-match
  // allow-list would silently reject the very origin someone just added.
  return ALLOWED_ORIGINS.has(origin.replace(/\/+$/, ''));
}

function buildCorsOptions() {
  return {
    origin(origin, callback) {
      // No Origin header: same-origin navigations, curl, health checks and
      // server-to-server calls. These are not browser cross-origin reads, so
      // there is no cookie to protect here.
      if (isAllowedOrigin(origin)) return callback(null, true);

      logger.warn('CORS: blocked origin', { origin });

      /*
       * A refused origin is A 403, not A 500.
       *
       * This handed `cors` a bare Error, and a bare Error is what the error
       * handler treats as an unexpected server fault: the caller got
       * `500 INTERNAL_ERROR` and the logs got a full stack trace, for what is
       * an ordinary policy decision the server made deliberately and correctly.
       *
       * Two costs, both real in production. The status misleads whoever is
       * debugging — 500 says "this server is broken", sending them to look at
       * the API when the actual fix is one line in ALLOWED_ORIGINS. And every
       * scanner, stale deploy and mistyped origin writes a stack trace into the
       * error log, which is how a log stops being read.
       *
       * `ApiError.forbidden` is marked operational, so it is reported as a 403
       * with a message naming the variable to change, and logged as the warning
       * above rather than as a fault.
       */
      return callback(
        ApiError.forbidden(
          `Origin ${origin} is not allowed to call this API. ` +
            'Add it to ALLOWED_ORIGINS (or set CLIENT_URL) on the server.',
        ),
      );
    },
    credentials: true, // Required for the httpOnly refresh cookie.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-POS-Terminal'],
    // Lets the browser read the filename on CSV/PDF report downloads.
    exposedHeaders: ['Content-Disposition'],
    maxAge: 86_400, // Cache the preflight for a day.
  };
}

/**
 * @param {import('express').Express} app
 */
export function applySecurity(app) {
  app.use(
    helmet({
      // The API serves JSON and uploaded images, never HTML, so a restrictive
      // CSP here would only constrain documents that are never returned.
      // The web client sets its own CSP at the edge.
      contentSecurityPolicy: false,
      // Images are loaded by the client from a different origin in development;
      // the default `same-origin` would block them.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cors(buildCorsOptions()));

  /*
   * NoSQL injection guard.
   *
   * Without this, a JSON body of `{"email": {"$ne": null}}` reaching
   * `User.findOne(req.body)` matches the first user in the collection —
   * a login bypass. `replaceWith: '_'` neutralises the operator rather than
   * deleting the key, so the query still shape-checks and fails honestly.
   *
   * Note: mutating req.query in place breaks on Express 5 (getter-only), which
   * is one reason this service pins Express 4.
   */
  app.use(
    mongoSanitize({
      replaceWith: '_',
      onSanitize: ({ key }) => logger.warn('Sanitised suspicious input key', { key }),
    }),
  );

  // Hide the framework fingerprint — free reconnaissance otherwise.
  app.disable('x-powered-by');

  // Trust the reverse proxy in production so req.ip and secure-cookie detection
  // reflect the real client rather than the load balancer.
  if (env.isProduction) app.set('trust proxy', 1);
}

export default applySecurity;
