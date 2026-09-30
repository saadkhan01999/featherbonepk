/**
 * Rate limiters.
 * ---------------------------------------------------------------------------
 * Different endpoints need very different budgets: browsing a menu is cheap and
 * high-frequency, while attempting a password is expensive and should be rare.
 * A single global limit would either leave auth wide open or throttle shopping.
 *
 * Limits are disabled outside production so development and automated tests
 * aren't throttled — but the middleware is still mounted, so a mistake in how
 * it's wired shows up locally rather than only on deploy.
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.config.js';
import { ApiError } from '../core/errors/ApiError.js';

/** Shared factory so every limiter reports failure through the normal handler. */
function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max: env.isProduction ? max : 0, // 0 = unlimited
    standardHeaders: true, // RateLimit-* headers so clients can back off
    legacyHeaders: false,
    skip: () => !env.isProduction,
    handler: (_req, _res, next) => next(ApiError.tooManyRequests(message)),
  });
}

/** Baseline for the whole API. Generous — this is a DoS backstop, not a quota. */
export const globalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests — please try again shortly',
});

/**
 * Credential endpoints (login, POS login, forgot-password).
 * Tight on purpose: this is the primary defence against online password
 * guessing, alongside per-account lockout in the auth service. Both matter —
 * the limiter caps one IP, lockout caps one account across many IPs.
 */
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts — please wait a few minutes before trying again',
});

/** Account creation — throttled to slow bulk signup abuse. */
export const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many accounts created from this address — please try again later',
});

/** Writes that cost money or storage (orders, uploads). */
export const writeLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'You are doing that too quickly — please slow down',
});
