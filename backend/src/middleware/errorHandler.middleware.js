/**
 * Global error handler — the only place that converts an error into a response.
 * ---------------------------------------------------------------------------
 * Must be registered last, after all routes.
 *
 * Its second job is translation: Mongoose and JWT throw library-shaped errors
 * with messages written for developers. Leaking those to the client is both a
 * poor experience ("E11000 duplicate key error collection...") and an
 * information disclosure — the raw text names collections and indexes.
 */
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.config.js';
import { ApiError } from '../core/errors/ApiError.js';
import { sendError } from '../core/http/ApiResponse.js';
import { logger } from '../core/utils/logger.js';

/** Map a library error onto our ApiError vocabulary. */
function normalise(error) {
  if (error instanceof ApiError) return error;

  // --- Mongoose: schema validation ---
  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return ApiError.validation(details);
  }

  // --- Mongoose: malformed ObjectId in a path param ---
  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for "${error.path}"`);
  }

  // --- MongoDB: unique index violation ---
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'value';
    // Naming the field is useful; echoing the value back is not — it may be
    // another account's email, which would confirm its existence to an attacker.
    return ApiError.conflict(`That ${field} is already in use`, {
      details: [{ field, message: 'Already in use' }],
    });
  }

  // --- JWT ---
  if (error instanceof jwt.TokenExpiredError) {
    return new ApiError(401, 'Your session has expired, please sign in again', {
      code: 'TOKEN_EXPIRED',
    });
  }
  if (error instanceof jwt.JsonWebTokenError) {
    return new ApiError(401, 'Invalid authentication token', { code: 'TOKEN_INVALID' });
  }

  // --- Multer (file upload) ---
  if (error.code === 'LIMIT_FILE_SIZE') {
    return ApiError.badRequest(`File is too large — the limit is ${env.UPLOAD_MAX_MB}MB`);
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return ApiError.badRequest('Unexpected file field in the upload');
  }

  // --- Body parser ---
  if (error.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON');
  }

  // Anything else is an unexpected bug, not an operational failure.
  const unknown = ApiError.internal(error.message || 'Something went wrong');
  unknown.isOperational = false;
  unknown.cause = error;
  return unknown;
}

/**
 * Client errors that still deserve a warning.
 *
 *   403 — an authenticated account tried something it is not allowed to do.
 *         That is either a permission misconfiguration or someone probing, and
 *         both are worth seeing.
 *   429 — rate limited. By definition, abnormal traffic.
 *
 * Everything else in the 4xx range is a normal outcome of serving the public:
 * anonymous visitors, favicon requests, typos, failed validation. Those log at
 * debug so the warning level keeps meaning something.
 */
const NOTEWORTHY_CLIENT_ERRORS = new Set([403, 429]);

// Note: the fourth parameter is required even though it is unused — Express
// identifies error-handling middleware by arity, and a three-argument function
// is silently treated as ordinary middleware, so errors would bypass it.
export function errorHandler(err, req, res, _next) {
  const error = normalise(err);

  const context = {
    method: req.method,
    path: req.originalUrl,
    status: error.statusCode,
    userId: req.user?.id,
  };

  /*
   * A deliberate 503 is not a crash, and must not log like one.
   *
   * `err instanceof ApiError` is the test that separates them: normalise()
   * returns an ApiError untouched, so this is true only when some code chose to
   * refuse the request — requireDatabase turning away traffic while the database
   * is unreachable, for instance. Nothing about that is unexplained, and its
   * cause was already written out in full, once, at boot.
   *
   * The stack was the problem. Fifteen lines of Express internals per request,
   * for a state that can last hours and that bots keep probing, buries the one
   * message that says what to fix under thousands that say nothing — and on
   * shared hosting it eats the disk quota that the error log lives on. One warn
   * line per refusal says the same thing and stays readable.
   */
  const isDeliberateOutage = error.statusCode === 503 && err instanceof ApiError;

  if (isDeliberateOutage) {
    logger.warn(`503 ${error.code}`, context);
  } else if (error.statusCode >= 500) {
    // Unexpected: log the original stack, which is what actually points at the bug.
    logger.error(error.message, { ...context, stack: (error.cause ?? error).stack });
  } else if (NOTEWORTHY_CLIENT_ERRORS.has(error.statusCode)) {
    logger.warn(`${error.statusCode} ${error.message}`, context);
  } else {
    /*
     * Ordinary client outcomes (a 404 favicon, a visitor's 401 from the session
     * check on page load, a mistyped email's 422) log at debug, so warnings stay
     * meaningful.
     */
    logger.debug(`${error.statusCode} ${error.message}`, context);
  }

  // In production, replace non-operational messages with a generic one. The
  // detail is already in the logs; sending it to the client risks disclosing
  // internals (file paths, driver text, query shapes).
  const message =
    env.isProduction && !error.isOperational ? 'Something went wrong on our end' : error.message;

  return sendError(res, {
    status: error.statusCode,
    message,
    code: error.code,
    details: error.details,
  });
}

export default errorHandler;
