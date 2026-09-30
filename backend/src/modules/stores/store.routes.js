/**
 * Store routes — mounted at {API_PREFIX}/stores.
 * ---------------------------------------------------------------------------
 * Reading is scoped: a manager assigned to the bakery sees the bakery. Creating,
 * closing and deleting a store is `store.manage`, which by default only the
 * owner holds — opening a counter is a business decision, not an operational one.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { storeService } from './store.service.js';
import { STORE_TYPES } from './store.model.js';

const router = Router();

router.use(authenticate);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid store');

const storeBody = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Enter a code')
    .max(24)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  name: z.string().trim().min(2, 'Name the store').max(80),
  type: z.enum(STORE_TYPES).optional(),
  location: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(20).optional(),
  isActive: z.coerce.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).max(999).optional(),
});

router.get(
  '/',
  checkPermission(PERMISSIONS.STORE_VIEW),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await storeService.list(req.userDoc) }),
  ),
);

router.get(
  '/:id',
  checkPermission(PERMISSIONS.STORE_VIEW),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await storeService.detail(req.params.id, req.userDoc) }),
  ),
);

router.post(
  '/',
  checkPermission(PERMISSIONS.STORE_MANAGE),
  validate({ body: storeBody }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await storeService.create(req.body, req.user.id), 'Store created'),
  ),
);

router.patch(
  '/:id',
  checkPermission(PERMISSIONS.STORE_MANAGE),
  validate({ params: z.object({ id: objectId }), body: storeBody.partial() }),
  asyncHandler(async (req, res) => {
    const result = await storeService.update(req.params.id, req.body);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.patch(
  '/:id/active',
  checkPermission(PERMISSIONS.STORE_MANAGE),
  validate({ params: z.object({ id: objectId }), body: z.object({ isActive: z.coerce.boolean() }) }),
  asyncHandler(async (req, res) => {
    const result = await storeService.setActive(req.params.id, req.body.isActive);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.delete(
  '/:id',
  checkPermission(PERMISSIONS.STORE_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await storeService.remove(req.params.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
