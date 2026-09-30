/**
 * ApiError — the one error type every layer throws.
 * ---------------------------------------------------------------------------
 * Services throw these; the global error handler is the only place that turns
 * them into responses. That split is what keeps HTTP concerns out of business
 * logic and guarantees one consistent error shape across the whole API.
 *
 * `isOperational` distinguishes "expected" failures (bad input, missing record,
 * insufficient stock) from genuine bugs. Operational messages are safe to show
 * a user; anything else is replaced with a generic message in production so an
 * internal detail never reaches the client.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status.
   * @param {string} message    Human-readable, user-safe message.
   * @param {object} [options]
   * @param {string} [options.code]    Stable machine-readable code for clients.
   * @param {Array}  [options.details] Field-level validation details.
   */
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code ?? ERROR_CODE_BY_STATUS[statusCode] ?? 'ERROR';
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }

  // --- Named constructors -------------------------------------------------
  // Reading `ApiError.notFound('Product')` at a call site is clearer than
  // remembering which number 404 is, and it keeps messages consistent.

  static badRequest(message = 'Invalid request', options) {
    return new ApiError(400, message, { code: 'BAD_REQUEST', ...options });
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, { code: 'UNAUTHORIZED', ...options });
  }

  static forbidden(message = 'You do not have permission to perform this action', options) {
    return new ApiError(403, message, { code: 'FORBIDDEN', ...options });
  }

  static notFound(resource = 'Resource', options) {
    return new ApiError(404, `${resource} not found`, { code: 'NOT_FOUND', ...options });
  }

  static conflict(message = 'That conflicts with existing data', options) {
    return new ApiError(409, message, { code: 'CONFLICT', ...options });
  }

  static validation(details, message = 'Validation failed') {
    return new ApiError(422, message, { code: 'VALIDATION_ERROR', details });
  }

  static tooManyRequests(message = 'Too many requests, please slow down') {
    return new ApiError(429, message, { code: 'RATE_LIMITED' });
  }

  static internal(message = 'Something went wrong') {
    return new ApiError(500, message, { code: 'INTERNAL_ERROR' });
  }

  /*
   * 503, Not 500. A dependency the service needs is down, and the difference
   * matters to whoever is reading it: 500 says "this request hit a bug in the
   * code and will fail again", while 503 says "the code is fine, something it
   * depends on is unavailable, retry later". The client shows a different
   * message for each, and a monitor pages a different person.
   */
  static serviceUnavailable(message = 'The service is temporarily unavailable', options) {
    return new ApiError(503, message, { code: 'SERVICE_UNAVAILABLE', ...options });
  }
}

const ERROR_CODE_BY_STATUS = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
  500: 'INTERNAL_ERROR',
};

export default ApiError;
