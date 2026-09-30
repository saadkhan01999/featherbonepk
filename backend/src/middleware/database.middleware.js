/**
 * Refuse API traffic honestly while the database is unreachable.
 * ---------------------------------------------------------------------------
 * Why this exists at all. Mongoose buffers commands issued while it is not
 * connected: the query does not fail, it waits, and after bufferTimeoutMS it
 * throws `Operation "users.findOne()" buffering timed out after 10000ms`. Every
 * request therefore hangs for ten seconds and then returns a 500 naming an
 * internal Mongoose timeout — which reads like a bug in this codebase, tells the
 * operator nothing about the actual cause, and, on a login form, looks exactly
 * like "the server is broken".
 *
 * Answering immediately with 503 is both faster and truthful: the code is fine,
 * a dependency is down, and the request is worth retrying later. That is a
 * different HTTP status, a different client message, and a different person to
 * wake up than a 500.
 *
 * What is deliberately not gated. /health and /health/ready are mounted ahead of
 * this in app.js and must stay that way — they are how you find out the database
 * is down, so gating them would hide the very fact they exist to report.
 */
import mongoose from 'mongoose';

import { isDatabaseReady } from '../database/connect.js';
import { settingsService } from '../modules/settings/settings.service.js';
import { ApiError } from '../core/errors/ApiError.js';

/** Mongoose readyState → a word a human can act on. */
const STATE = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/*
 * Both conditions, not just the connection.
 *
 * readyState flips to 1 the instant the driver connects, but the settings cache
 * is filled by an await that resolves a moment later. A request arriving in that
 * gap would pass a connection-only gate and then read an empty cache — and
 * settingsService.get falls back to defaults rather than failing, so the request
 * succeeds while quietly pricing the order with the wrong delivery fee and tax.
 * A silent wrong answer is worse than the 503 it replaced.
 *
 * On a normal boot the cache is warmed before the port is bound, so this is
 * already true by the time any request exists and the gate costs two property
 * reads. It only ever closes during recovery, which is exactly when it matters.
 */
const canServe = () => isDatabaseReady() && settingsService.isWarmed;

export function requireDatabase(_req, _res, next) {
  if (canServe()) return next();

  /*
   * The body says which dependency and what state it is in, and stops there.
   * No connection string, no host, no driver stack trace: this endpoint is
   * reachable by anyone on the internet, and "which database server does this
   * shop use" is not something an anonymous caller needs to learn.
   */
  return next(
    ApiError.serviceUnavailable(
      'The API cannot reach its database, so this request cannot be served yet. It is being retried automatically.',
      {
        code: 'DATABASE_UNAVAILABLE',
        details: {
          database: STATE[mongoose.connection.readyState] ?? 'unknown',
          // Distinguishes "no database" from "connected, still loading" — the
          // second is a second-long blip, the first needs someone to act.
          settings: settingsService.isWarmed ? 'loaded' : 'loading',
        },
      },
    ),
  );
}

export default requireDatabase;
