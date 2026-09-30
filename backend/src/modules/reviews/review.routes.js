/**
 * Review routes — mounted at {API_PREFIX}/reviews.
 * ---------------------------------------------------------------------------
 * Reading approved reviews is public (they appear on product pages); writing
 * requires a signed-in customer with a matching order; moderating requires the
 * `review.moderate` permission.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { reviewService, REVIEW_STATUS } from './review.service.js';

const router = Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const pagination = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
};

// --- Public: approved reviews for a product -------------------------------
router.get(
  '/product/:productId',
  validate({ params: z.object({ productId: objectId }), query: z.object(pagination) }),
  asyncHandler(async (req, res) => {
    const result = await reviewService.listForProduct(req.params.productId, req.query);
    return sendSuccess(res, { message: 'OK', data: result });
  }),
);

// --- Customer: submit a review --------------------------------------------
router.post(
  '/',
  authenticate,
  writeLimiter,
  validate({
    body: z.object({
      productId: objectId,
      orderNumber: z.string().trim().min(4, 'Enter the order number from your receipt'),
      rating: z.coerce.number().int().min(1, 'Choose a rating').max(5),
      comment: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await reviewService.submit(req.body, req.user), 'Review submitted'),
  ),
);

// --- Moderation -----------------------------------------------------------
router.get(
  '/',
  authenticate,
  checkPermission(PERMISSIONS.REVIEW_VIEW),
  validate({
    query: z.object({
      status: z.enum(Object.values(REVIEW_STATUS)).optional(),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      ...pagination,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await reviewService.listForModeration(req.query);
    return sendPaginated(res, items, { page, limit, total });
  }),
);

router.get(
  '/stats',
  authenticate,
  checkPermission(PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await reviewService.stats() })),
);

router.patch(
  '/:id/moderate',
  authenticate,
  checkPermission(PERMISSIONS.REVIEW_MODERATE),
  validate({
    params: z.object({ id: objectId }),
    body: z.object({
      status: z.enum([REVIEW_STATUS.APPROVED, REVIEW_STATUS.REJECTED]),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await reviewService.moderate(req.params.id, req.body, req.user.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
