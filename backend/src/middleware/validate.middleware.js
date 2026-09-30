/**
 * Request validation via Zod schemas.
 * ---------------------------------------------------------------------------
 * Controllers receive data that has already been validated and coerced, so they
 * never re-check types. Two properties matter:
 *
 *  1. The parsed result replaces req.body/query/params. Zod strips unknown keys,
 *     so a client cannot smuggle extra fields (`role: 'super_admin'`) into a
 *     handler that spreads the body into a model.
 *  2. Every failing field is reported at once, not just the first, so a form can
 *     highlight all its errors in a single round trip.
 */
import { ZodError } from 'zod';
import { ApiError } from '../core/errors/ApiError.js';

/**
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        // Express 5 makes req.query a getter-only property; assigning to it
        // throws. Defining the parsed value keeps this forward-compatible.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        }));
        return next(ApiError.validation(details));
      }
      return next(error);
    }
  };
}

export default validate;
