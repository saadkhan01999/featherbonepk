/**
 * Health endpoints — mounted at {API_PREFIX}/health.
 * ---------------------------------------------------------------------------
 * Two distinct checks, because orchestrators need to ask two different
 * questions:
 *
 *   GET /health       "is the process alive?"  (liveness — restart me if not)
 *   GET /health/ready "can it serve traffic?"  (readiness — route to me if so)
 *
 * Collapsing them into one endpoint causes a classic outage: a database blip
 * makes the liveness probe fail, the orchestrator restarts every replica, and
 * the restart storm turns a brief blip into a full outage.
 *
 * Mounted twice — under the API prefix and at the bare root. Hosting platforms
 * ask for a health path when the service is created and default to `/health`;
 * pointing one at `/api/v1/health` is an extra step that is easy to skip, and a
 * probe that 404s marks a perfectly healthy deploy as failed.
 *
 * What it may not say: no connection string, no secrets, no environment dump,
 * no stack traces. `database` is a one-word state, which is what a probe needs
 * and all an anonymous caller learns.
 */
import { Router } from 'express';
import mongoose from 'mongoose';

import { env, isEphemeralDatabase } from '../../config/env.config.js';
import { sendSuccess, sendError } from '../../core/http/ApiResponse.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';

const router = Router();

/** Mongoose readyState → readable label. */
const DB_STATE = ['disconnected', 'connected', 'connecting', 'disconnecting'];

// --- Liveness: intentionally does no I/O -----------------------------------
router.get('/', (_req, res) =>
  sendSuccess(res, {
    message: 'Service is healthy',
    data: {
      status: 'ok',
      /**
       * Driver state, read from memory — this endpoint still does no I/O, so a
       * slow database cannot make the liveness probe time out. `/health/ready`
       * is the one that actually pings.
       */
      database: DB_STATE[mongoose.connection.readyState] ?? 'unknown',
      service: 'feather-and-bone-api',
      version: '1.0.0',
      environment: env.NODE_ENV,
      /**
       * True only under `dev:memdb`, whose database is discarded on exit.
       * A boolean — deliberately not the connection string, which would leak
       * the host and database name to anyone who can reach /health.
       */
      ephemeralDatabase: isEphemeralDatabase(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  }),
);

// --- Readiness: actually exercises the dependencies ------------------------
router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const checks = {};

    // `ping` proves the connection can round-trip a command. readyState alone
    // only reports what the driver believes, which can lag reality.
    const started = Date.now();
    try {
      await mongoose.connection.db.admin().ping();
      checks.database = {
        status: 'up',
        state: DB_STATE[mongoose.connection.readyState],
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      checks.database = {
        status: 'down',
        state: DB_STATE[mongoose.connection.readyState],
        error: error.message,
      };
    }

    const memory = process.memoryUsage();
    checks.memory = {
      status: 'up',
      heapUsedMb: +(memory.heapUsed / 1024 / 1024).toFixed(1),
      rssMb: +(memory.rss / 1024 / 1024).toFixed(1),
    };

    const ready = Object.values(checks).every((c) => c.status === 'up');

    // 503 when not ready: the load balancer reads the status code, not the body.
    // Returning 200 with `{ready:false}` would keep traffic flowing to a
    // replica that cannot serve it.
    if (!ready) {
      return sendError(res, {
        status: 503,
        message: 'Service is not ready',
        code: 'NOT_READY',
        details: checks,
      });
    }

    return sendSuccess(res, { message: 'Service is ready', data: { status: 'ready', checks } });
  }),
);

export default router;
