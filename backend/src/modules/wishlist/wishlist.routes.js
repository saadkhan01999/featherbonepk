/**
 * Wishlist routes — mounted at {API_PREFIX}/wishlist.
 * ---------------------------------------------------------------------------
 * Every route is scoped to `req.user.id`. There is deliberately no way to read
 * or write another customer's wishlist — no id is ever accepted from the
 * client, so the usual "can I pass someone else's id?" hole cannot exist.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { wishlistService } from './wishlist.service.js';

const router = Router();

// Saved products belong to an account, so the whole surface requires one.
router.use(authenticate);

const productParam = z.object({
  productId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product'),
});

router.get(
  '/',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await wishlistService.list(req.user.id) }),
  ),
);

/** Ids only — loaded on app start so every heart renders in the right state. */
router.get(
  '/ids',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await wishlistService.ids(req.user.id) }),
  ),
);

router.post(
  '/toggle/:productId',
  validate({ params: productParam }),
  asyncHandler(async (req, res) => {
    const result = await wishlistService.toggle(req.user.id, req.params.productId);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.delete(
  '/:productId',
  validate({ params: productParam }),
  asyncHandler(async (req, res) => {
    const result = await wishlistService.remove(req.user.id, req.params.productId);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const result = await wishlistService.clear(req.user.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
