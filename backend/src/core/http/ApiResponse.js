/**
 * The standard API envelope.
 * ---------------------------------------------------------------------------
 * Every endpoint answers in one of exactly two shapes, so the client can write
 * response handling once:
 *
 *   success → { success: true,  message, data, meta? }
 *   failure → { success: false, message, code, details? }
 *
 * `meta` carries pagination and any other envelope-level context. Keeping it
 * beside `data` rather than mixed into it means a list payload is always a
 * plain array — the client never has to guess whether it got the records or a
 * wrapper around them.
 */

/**
 * Send a success response.
 *
 * @param {import('express').Response} res
 * @param {object}  [options]
 * @param {number}  [options.status=200]
 * @param {string}  [options.message='OK']
 * @param {*}       [options.data=null]
 * @param {object}  [options.meta]
 */
export function sendSuccess(res, { status = 200, message = 'OK', data = null, meta } = {}) {
  const body = { success: true, message, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

/** 201 helper — the created resource is the data. */
export function sendCreated(res, data, message = 'Created successfully') {
  return sendSuccess(res, { status: 201, message, data });
}

/**
 * Send a paginated list.
 * Always emits the full pagination block (including `hasNext`/`hasPrev`) so the
 * UI never has to derive it and can't derive it inconsistently across screens.
 *
 * @param {import('express').Response} res
 * @param {Array}  items
 * @param {object} pagination `{ page, limit, total }`
 */
export function sendPaginated(res, items, { page, limit, total }, message = 'OK') {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return sendSuccess(res, {
    message,
    data: items,
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    },
  });
}

/**
 * Send a failure response. Called by the global error handler only — services
 * throw ApiError instead of formatting responses themselves.
 */
export function sendError(res, { status = 500, message = 'Something went wrong', code, details }) {
  const body = { success: false, message, code: code ?? 'ERROR' };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}
