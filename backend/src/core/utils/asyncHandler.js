/**
 * asyncHandler — forwards rejected promises to Express's error pipeline.
 * ---------------------------------------------------------------------------
 * Express 4 does not catch rejections from async handlers: an `await` that
 * throws inside a bare `async (req, res)` produces an unhandled rejection and
 * a request that hangs until it times out. Wrapping every async route in this
 * is what makes `throw ApiError.notFound()` work anywhere in the stack.
 *
 * @param {Function} fn async (req, res, next) => any
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
