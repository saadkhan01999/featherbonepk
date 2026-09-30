/**
 * Catch-all for unmatched routes.
 * ---------------------------------------------------------------------------
 * Registered after every router but before the error handler, so an unknown
 * path produces the same JSON envelope as any other failure. Without it,
 * Express returns its default HTML page and a client parsing JSON gets a
 * confusing syntax error instead of a clean 404.
 */
import { ApiError } from '../core/errors/ApiError.js';

export function notFoundHandler(req, _res, next) {
  next(
    new ApiError(404, `Route ${req.method} ${req.originalUrl} does not exist`, { code: 'ROUTE_NOT_FOUND' }),
  );
}

export default notFoundHandler;
