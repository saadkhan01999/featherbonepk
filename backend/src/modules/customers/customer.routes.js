/**
 * Customer routes (back office) — mounted at {API_PREFIX}/customers.
 * ---------------------------------------------------------------------------
 * Reading needs `customer.view`; suspending and deleting need
 * `customer.manage`. There is deliberately no create and no role field
 * anywhere: customers sign themselves up, and turning one into staff is the
 * staff module's job, where the privilege-escalation guards live.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { customerService } from './customer.service.js';

const router = Router();

router.use(authenticate);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid customer');

router.get(
  '/',
  checkPermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({
    query: z.object({
      search: z.string().trim().max(80).optional(),
      status: z.enum(['active', 'inactive', 'suspended']).optional(),
      sort: z.enum(['recent', 'name', 'spend', 'orders']).default('recent'),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await customerService.list(req.query);
    return sendPaginated(res, items, { page, limit, total });
  }),
);

router.get(
  '/stats',
  checkPermission(PERMISSIONS.CUSTOMER_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await customerService.stats() })),
);

router.get(
  '/:id',
  checkPermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await customerService.detail(req.params.id) }),
  ),
);

router.patch(
  '/:id/status',
  checkPermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ status: z.enum(['active', 'inactive', 'suspended']) }),
  }),
  asyncHandler(async (req, res) => {
    const result = await customerService.setStatus(req.params.id, req.body.status, req.user.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

/*
 * Delete a customer outright.
 *
 * Distinct from the status route above, which is the reversible option and the
 * right one for almost every case. This is for an account that should not exist
 * at all — a duplicate signup, a test account, or someone exercising a right to
 * erasure — and the service refuses it whenever the person has orders, because
 * those are sales records rather than personal data the shop is free to drop.
 */
router.delete(
  '/:id',
  checkPermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await customerService.remove(req.params.id, req.user);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
