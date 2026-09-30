/**
 * Express application factory.
 * ---------------------------------------------------------------------------
 * Builds the app without listening on a port. Keeping `listen()` out of here
 * (it lives in server.js) means tests can drive the app in-process and the
 * same object can be mounted behind a different transport later.
 *
 * Middleware order is load-bearing — top to bottom:
 *   1. security      — reject hostile input before anything touches it
 *   2. parsers       — populate req.body / req.cookies
 *   3. observability — log requests once they're parseable
 *   4. static        — serve uploads
 *   5. routes        — the API itself
 *   6. 404           — nothing matched
 *   7. errors        — must be last or thrown errors bypass it
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';

import { env } from './config/env.config.js';
import { applySecurity } from './middleware/security.middleware.js';
import { UPLOAD_ROOT } from './middleware/upload.middleware.js';
import { globalLimiter } from './middleware/rateLimiter.middleware.js';
import { requireDatabase } from './middleware/database.middleware.js';
import { errorHandler } from './middleware/errorHandler.middleware.js';
import { notFoundHandler } from './middleware/notFound.middleware.js';
import { logger } from './core/utils/logger.js';
import { apiRouter } from './routes/index.js';
import sitemapRoutes from './modules/seo/sitemap.routes.js';
import healthRoutes from './modules/health/health.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // --- 1. Security -------------------------------------------------------
  applySecurity(app);

  // --- 2. Body & cookie parsing -----------------------------------------
  // The 1MB cap covers JSON payloads only; file uploads go through multer,
  // which enforces its own (larger) limit. An uncapped parser is a trivial
  // memory-exhaustion vector.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // --- 3. Compression & request logging ---------------------------------
  app.use(compression());

  if (!env.isTest) {
    const format = env.isProduction ? 'combined' : 'dev';
    app.use(
      morgan(format, {
        stream: { write: (line) => logger.debug(line.trim()) },
        // Health checks run every few seconds from the load balancer and would
        // otherwise bury real traffic in the log.
        skip: (req) => req.originalUrl.endsWith('/health'),
      }),
    );
  }

  // --- 4. Uploaded files -------------------------------------------------
  // Served with long-lived immutable caching: stored filenames include a
  // content hash, so a changed image is always a different URL.
  //
  // Mounted even under the Cloudinary driver, deliberately. Switching a live
  // shop to Cloudinary does not rewrite the products that already exist — their
  // rows still hold `/uploads/…` paths, and unmounting this would blank every
  // one of those images the moment the driver changed. New uploads go to
  // Cloudinary; the old ones keep being served from here.
  app.use(
    '/uploads',
    // UPLOAD_ROOT, not a second path built here: when these two disagree the
    // upload succeeds and the image 404s, which looks like a broken database.
    express.static(UPLOAD_ROOT, {
      maxAge: env.isProduction ? '30d' : 0,
      immutable: env.isProduction,
      index: false, // Never expose a directory listing.
    }),
  );

  // --- 5. API ------------------------------------------------------------
  /*
   * At the root, not under the API prefix. Crawlers fetch `/sitemap.xml` and
   * nothing else — `/api/v1/sitemap.xml` would simply never be requested.
   *
   * Mounted before the rate limiter: a crawler hitting this on a schedule must
   * not be able to consume the allowance that real customers share, and a 429
   * teaches Google the site is unreliable.
   */
  app.use('/', sitemapRoutes);

  /*
   * The health check also answers at the bare root, not only under the API
   * prefix — see health.routes.js. Mounted before the rate limiter for the same
   * reason as the sitemap: a platform probing every few seconds must never be
   * throttled, because a 429 reads as "unhealthy" and takes the instance out of
   * rotation.
   */
  app.use('/health', healthRoutes);

  /*
   * And again under the API prefix, above the database gate.
   *
   * routes/index.js already mounts health inside apiRouter, but apiRouter sits
   * behind requireDatabase — so when the database is down, /api/v1/health
   * answered DATABASE_UNAVAILABLE like every other route. That is precisely
   * backwards: this endpoint exists to report that state, and it is the address
   * printed in the boot banner and reached for first during an outage. Mounting
   * it here means Express matches this copy before the gate is ever consulted.
   *
   * The mount inside apiRouter stays: it keeps the route defined in one obvious
   * place, and this line only shadows it while both agree.
   */
  app.use(`${env.API_PREFIX}/health`, healthRoutes);

  /*
   * requireDatabase sits ahead of the limiter, and ahead of every route.
   *
   * Ahead of the routes because a query issued with no connection is buffered,
   * not refused: it hangs for ten seconds and then fails with an internal
   * Mongoose timeout that looks like a bug in this code. Ahead of the limiter
   * because a caller must not spend their rate allowance on requests this
   * service already knows it cannot serve — otherwise a customer who retries
   * during an outage is rate-limited once it ends.
   *
   * /health is mounted above this line on purpose and stays ungated: it is how
   * anyone discovers the database is the problem.
   */
  app.use(env.API_PREFIX, requireDatabase, globalLimiter, apiRouter);

  // Friendly root so hitting the bare host explains where the API lives.
  app.get('/', (_req, res) =>
    res.json({
      service: 'Feather & Bone API',
      version: '1.0.0',
      docs: `${env.API_PREFIX}/health`,
    }),
  );

  /*
   * Browsers request /favicon.ico for any host they are pointed at, including
   * a bare API. Answering 204 costs nothing and keeps a routine browser habit
   * out of the error path — otherwise every developer who opens the API in a
   * tab generates a 404 that looks like a broken route.
   */
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  // --- 6 & 7. Fallbacks --------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
