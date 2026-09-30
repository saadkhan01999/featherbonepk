/**
 * Staff & access routes — mounted at {API_PREFIX}/staff.
 * ---------------------------------------------------------------------------
 * `attachPermissions` runs before every handler so the service can compare the
 * actor's own grants against what they are trying to give away — the check that
 * stops an admin handing out capabilities they don't hold themselves.
 */
import { Router } from 'express';
import { z } from 'zod';

import { passwordSchema } from '../../core/validation/password.schema.js';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission, attachPermissions } from '../../middleware/auth.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS, STAFF_ROLES } from '../../core/constants/roles.js';
import { staffService } from './staff.service.js';

const router = Router();

router.use(authenticate, attachPermissions);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// One shared definition — see core/validation/password.schema.js.
const password = passwordSchema;

const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^03\d{9}$/, 'Enter a valid mobile number'))
    .optional(),
  password,
  role: z.enum(STAFF_ROLES),
  permissions: z.array(z.string()).optional(),
  /**
   * Which counters this person works at. Empty means all — see the User model.
   * Assignment scopes what they see; permissions decide what they may do. The
   * two compose rather than replacing each other.
   */
  stores: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid store')).optional(),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().optional(),
  role: z.enum(STAFF_ROLES).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  permissions: z.array(z.string()).optional(),
  /**
   * Which counters this person works at. Empty means all — see the User model.
   * Assignment scopes what they see; permissions decide what they may do. The
   * two compose rather than replacing each other.
   */
  stores: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid store')).optional(),
});

// --- Role & permission catalogue (drives the matrix UI) --------------------
router.get(
  '/catalogue',
  checkPermission(PERMISSIONS.ROLE_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: staffService.catalogue() })),
);

// --- Staff list -----------------------------------------------------------
router.get(
  '/',
  checkPermission(PERMISSIONS.EMPLOYEE_VIEW),
  validate({
    query: z.object({
      search: z.string().trim().max(120).optional(),
      role: z.enum(STAFF_ROLES).optional(),
      status: z.enum(['active', 'inactive', 'suspended']).optional(),
      // Whitelisted in the service (STAFF_SORTS); an unknown column falls back
      // to the default order rather than erroring.
      sort: z.string().trim().max(40).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await staffService.list(req.query);
    return sendPaginated(res, items, { page, limit, total });
  }),
);

router.get(
  '/stats',
  checkPermission(PERMISSIONS.EMPLOYEE_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await staffService.stats() })),
);

// --- Mutations ------------------------------------------------------------
// The actor is passed through so the service can enforce rank and grant rules.
/*
 * The actor passed into the service.
 *
 * `fullName` and `email` are included for the audit trail. Without them every
 * staff entry recorded "System" as the author — an audit log that cannot say
 * who did something is decoration.
 */
const actorOf = (req) => ({
  id: req.user.id,
  role: req.user.role,
  fullName: req.user.fullName,
  email: req.user.email,
  permissions: req.permissions,
});

router.post(
  '/',
  checkPermission(PERMISSIONS.EMPLOYEE_MANAGE),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await staffService.create(req.body, actorOf(req)), 'Employee added'),
  ),
);

router.patch(
  '/:id',
  checkPermission(PERMISSIONS.EMPLOYEE_MANAGE),
  validate({ params: z.object({ id: objectId }), body: updateSchema }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Employee updated',
      data: await staffService.update(req.params.id, req.body, actorOf(req)),
    }),
  ),
);

/*
 * Reset an employee's password.
 *
 * POST, not PATCH: this is not an edit to a field the caller supplies, it is an
 * action with a side effect — every session for that account ends — and the
 * response carries a one-time secret that must never be replayable by a repeated
 * GET or a cached request.
 *
 * `password` is optional and generating one is the better path: an admin
 * inventing passwords under pressure produces the same three every time.
 * When supplied it still has to satisfy the shared policy — a recovery route
 * that accepts `1234` would be the weakest way into the system.
 *
 * Rate limited because it mints credentials.
 */
router.post(
  '/:id/reset-password',
  checkPermission(PERMISSIONS.EMPLOYEE_MANAGE),
  writeLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ password: password.optional() }),
  }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Password reset',
      data: await staffService.resetPassword(req.params.id, req.body, actorOf(req)),
    }),
  ),
);

router.delete(
  '/:id',
  checkPermission(PERMISSIONS.EMPLOYEE_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await staffService.deactivate(req.params.id, actorOf(req));
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
