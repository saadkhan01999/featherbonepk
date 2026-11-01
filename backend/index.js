/**
 * Vercel entry point — the API as one Vercel Function.
 * ---------------------------------------------------------------------------
 * Deploy with the Vercel project's Root Directory set to `backend`. See
 * deploy/VERCEL.md for the whole procedure.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS HERE.
 *
 * Vercel's Express preset picks its entry by name, in a fixed order — app,
 * index, server, then src/app, src/index, src/server — taking the first that
 * imports express. Without this file the winner is src/app.js, whose default
 * export is createApp: a factory, not a request handler. Vercel would call it
 * with (req, res) for every request, it would build a fresh app and answer
 * nothing, and every request would hang until the function timed out. A root
 * index.js comes earlier in that order, so it is the one Vercel uses.
 *
 * WHAT IS DIFFERENT FROM src/server.js. A function is not a long-running
 * process, so the three things server.js does around the app change shape:
 *
 *   • Database + settings — opened on the first request an instance receives
 *     (a "cold start") and reused while it stays warm, instead of at boot.
 *     Until both are ready, requireDatabase answers 503 exactly as it does on
 *     a server whose database is down.
 *
 *   • Live updates (Socket.IO) — not started. Vercel Functions cannot hold a
 *     socket open. Every emit in the services is already a no-op without it,
 *     and the web client notices the missing channel on its first attempt and
 *     falls back to polling (frontend services/realtime.js).
 *
 *   • The reservation / stale-ticket sweeper — a setInterval would only tick
 *     while an instance happened to be alive. It becomes the cron route below,
 *     scheduled in vercel.json.
 *
 * Everything else — every route, guard, header and error — is the same
 * createApp() the other deployments run.
 */
import crypto from 'node:crypto';

import express from 'express';

import { env } from './src/config/env.config.js';
import { createApp } from './src/app.js';
import { connectDatabase, isDatabaseReady } from './src/database/connect.js';
import { settingsService } from './src/modules/settings/settings.service.js';
import { expireAbandonedReservations } from './src/modules/orders/order.service.js';
import { kitchenService } from './src/modules/kitchen/kitchen.service.js';
import { mailer } from './src/core/mail/mailer.js';
import { logger } from './src/core/utils/logger.js';

/*
 * At module load, once per instance. In production this throws when SMTP is not
 * configured — the same deliberate refusal server.js makes at boot. On Vercel it
 * surfaces as a failed invocation whose log names the missing variables.
 */
mailer.init();

// --- Database and settings, once per instance ---------------------------------
/*
 * One attempt in flight at a time: a cold instance that receives ten requests
 * at once must open one connection, not ten.
 *
 * Mongoose reconnects by itself once it has connected, so connect() is only
 * ever called until the first success — calling it again on a connection the
 * driver is already recovering would race the driver.
 *
 * After a failure, retries are spaced out. Each attempt can take the full
 * server-selection timeout (10s); without a pause, every request during an
 * Atlas outage would wait those 10s before getting its 503. Inside the pause
 * the request goes straight through and requireDatabase answers at once.
 */
const RETRY_PAUSE_MS = 5_000;
let everConnected = false;
let attempt = null;
let nextAttemptAt = 0;

function ensureReady() {
  if (isDatabaseReady() && settingsService.isWarmed) return Promise.resolve();
  if (attempt) return attempt;
  if (Date.now() < nextAttemptAt) return Promise.resolve();

  attempt = (async () => {
    if (!everConnected) {
      await connectDatabase();
      everConnected = true;
    }
    // Pricing reads the settings cache synchronously; it must be loaded before
    // anything is served. requireDatabase refuses until it is.
    if (isDatabaseReady() && !settingsService.isWarmed) await settingsService.warm();
  })()
    .catch((error) => {
      // connectDatabase has already logged the full diagnosis.
      nextAttemptAt = Date.now() + RETRY_PAUSE_MS;
      logger.warn('Cold start: API not ready yet — answering 503 until it is', { message: error.message });
    })
    .finally(() => {
      attempt = null;
    });

  return attempt;
}

/*
 * Requests that must never wait on the database: the health checks (they exist
 * to report that the database is the problem) and CORS preflights (they carry
 * no data, and a slow preflight stalls the real request behind it).
 */
const HEALTH_PATHS = new Set(['/health', `${env.API_PREFIX}/health`]);
const waitsForDatabase = (req) => req.method !== 'OPTIONS' && !HEALTH_PATHS.has(req.path.replace(/\/+$/, ''));

// --- Scheduled sweep ------------------------------------------------------------
/*
 * What startReservationSweeper does on a server, as one request:
 *   • release stock held by online orders whose payment was abandoned
 *   • close paid till tickets the kitchen forgot to finish
 *
 * Called by Vercel Cron (vercel.json). Vercel sends the project's CRON_SECRET as
 * a bearer token; anything without it is refused, so the route cannot be used
 * to make the API do work on a stranger's schedule. With no CRON_SECRET set the
 * route refuses everything — the safe failure — and says what is missing.
 */
function cronAuthorised(req) {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(String(req.get('authorization') ?? ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  // Constant time, so the response time does not leak how much of a guess was right.
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function sweep(req, res) {
  if (!env.CRON_SECRET?.trim()) {
    return res.status(503).json({
      success: false,
      message: 'CRON_SECRET is not set in this Vercel project, so the scheduled sweep is disabled.',
      code: 'CRON_NOT_CONFIGURED',
    });
  }
  if (!cronAuthorised(req)) {
    return res.status(401).json({ success: false, message: 'Not authorised', code: 'UNAUTHORIZED' });
  }
  if (!isDatabaseReady() || !settingsService.isWarmed) {
    return res
      .status(503)
      .json({ success: false, message: 'Database unavailable', code: 'DATABASE_UNAVAILABLE' });
  }

  const result = { reservationsReleased: 0, reservationsScanned: 0, staleTicketsClosed: 0, errors: [] };

  // Same batching as scripts/expire-reservations.mjs: drain everything that is due.
  try {
    const BATCH = 100;
    for (;;) {
      const { scanned, expired } = await expireAbandonedReservations({ limit: BATCH });
      result.reservationsScanned += scanned;
      result.reservationsReleased += expired;
      if (scanned < BATCH) break;
    }
  } catch (error) {
    logger.error('Cron: reservation sweep failed', { message: error.message });
    result.errors.push(`reservations: ${error.message}`);
  }

  // Separate failure, as in the sweeper: one job failing must not skip the other.
  try {
    result.staleTicketsClosed = (await kitchenService.closeStaleTickets())?.closed ?? 0;
  } catch (error) {
    logger.error('Cron: kitchen ticket sweep failed', { message: error.message });
    result.errors.push(`kitchen: ${error.message}`);
  }

  if (result.reservationsReleased > 0) {
    logger.info(`Cron: released stock from ${result.reservationsReleased} abandoned order(s)`);
  }
  return res
    .status(result.errors.length ? 500 : 200)
    .json({ success: result.errors.length === 0, data: result });
}

// --- The function -----------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

app.use((req, _res, next) => {
  if (!waitsForDatabase(req)) return next();
  // ensureReady never rejects; a failure leaves requireDatabase to answer 503.
  return ensureReady().then(() => next());
});

app.get(`${env.API_PREFIX}/cron/sweep`, sweep);

// Everything else: the same application every other deployment runs.
app.use(createApp());

export default app;
