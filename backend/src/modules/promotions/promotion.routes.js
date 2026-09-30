/**
 * Promotion routes — mounted at {API_PREFIX}/promotions.
 * ---------------------------------------------------------------------------
 * Reading live offers is public (the storefront draws them). Seeing scheduled,
 * expired and paused ones — and editing anything — needs the offer permissions.
 * A competitor should not be able to read next month's Eid campaign off a
 * public endpoint before it launches.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { promotionService } from './promotion.service.js';
import { PROMOTION_TYPES, PLACEMENTS } from './promotion.model.js';

const router = Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Accepts an ISO string or an empty string (meaning "open-ended"). */
const optionalDate = z
  .union([z.string().datetime({ offset: true }), z.string().length(0), z.null()])
  .optional()
  .transform((value) => (value ? new Date(value) : null));

const promotionBody = z.object({
  kicker: z.string().trim().min(2, 'Add a short label').max(40),
  title: z.string().trim().min(2, 'Add a title').max(80),
  highlight: z.string().trim().min(2, 'Describe the offer').max(60),
  type: z.enum(PROMOTION_TYPES),
  placement: z.enum(PLACEMENTS).optional(),
  body: z.string().trim().max(300).optional(),
  image: z.string().trim().min(1, 'Choose an image'),
  ctaLabel: z.string().trim().max(30).optional(),
  ctaHref: z.string().trim().max(200).optional(),
  startsAt: optionalDate,
  endsAt: optionalDate,
  isActive: z.coerce.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).max(999).optional(),
});

// --- Public: what is showing right now -------------------------------------
router.get(
  '/',
  validate({ query: z.object({ placement: z.enum(PLACEMENTS).default('offers') }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await promotionService.listLive(req.query.placement) }),
  ),
);

// --- Back office ------------------------------------------------------------
router.get(
  '/admin',
  authenticate,
  checkPermission(PERMISSIONS.OFFER_VIEW),
  validate({
    query: z.object({
      type: z.enum(PROMOTION_TYPES).optional(),
      placement: z.enum(PLACEMENTS).optional(),
      state: z.enum(['live', 'scheduled', 'expired', 'paused']).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await promotionService.listAll(req.query) }),
  ),
);

router.get(
  '/admin/stats',
  authenticate,
  checkPermission(PERMISSIONS.OFFER_VIEW),
  asyncHandler(async (_req, res) =>
    sendSuccess(res, { message: 'OK', data: await promotionService.stats() }),
  ),
);

router.post(
  '/',
  authenticate,
  checkPermission(PERMISSIONS.OFFER_MANAGE),
  validate({ body: promotionBody }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await promotionService.create(req.body, req.user.id), 'Offer created'),
  ),
);

router.patch(
  '/:id',
  authenticate,
  checkPermission(PERMISSIONS.OFFER_MANAGE),
  // `.partial()` so the toggle in the table can send `{isActive}` alone without
  // having to resend the whole record.
  validate({ params: z.object({ id: objectId }), body: promotionBody.partial() }),
  asyncHandler(async (req, res) => {
    const result = await promotionService.update(req.params.id, req.body, req.user.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.delete(
  '/:id',
  authenticate,
  checkPermission(PERMISSIONS.OFFER_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await promotionService.remove(req.params.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
