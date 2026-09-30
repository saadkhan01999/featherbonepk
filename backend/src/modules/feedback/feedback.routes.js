/**
 * Customer feedback — mounted at {API_PREFIX}/feedback.
 * ---------------------------------------------------------------------------
 *   POST   /feedback          public (rate limited) — leave feedback
 *   GET    /feedback/public   public — published feedback + overall score
 *   GET    /feedback          review.view      — every submission, filterable
 *   GET    /feedback/stats    review.view
 *   PATCH  /feedback/:id      review.moderate  — publish / hide / reply
 *   DELETE /feedback/:id      review.moderate
 *
 * Nothing reaches the website until staff publish it, and only if the customer
 * allowed it. Emails and phone numbers are never in the public response.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission, optionalAuth } from '../../middleware/auth.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { auditService } from '../audit/audit.service.js';
import { FEEDBACK_STATUS, FEEDBACK_TAG_KEYS } from './feedback.model.js';
import { feedbackService } from './feedback.service.js';

const router = Router();

const star = z.coerce.number().int().min(1, 'Choose 1 to 5 stars').max(5);
const optionalStar = z.coerce.number().int().min(1).max(5).optional();

router.post(
  '/',
  writeLimiter,
  optionalAuth,
  validate({
    body: z.object({
      // Only the stars are required — everything else makes it better, not possible.
      name: z.string().trim().max(80).optional().default(''),
      email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
      phone: z
        .string()
        .trim()
        .transform((v) => v.replace(/[\s-]/g, ''))
        .pipe(z.string().regex(/^(03\d{9})?$/, 'Enter a valid mobile number (03XXXXXXXXX)'))
        .optional(),
      orderNumber: z.string().trim().max(40).optional().or(z.literal('')),
      rating: star,
      aspects: z
        .object({ food: optionalStar, service: optionalStar, delivery: optionalStar, value: optionalStar })
        .optional(),
      tags: z.array(z.enum(FEEDBACK_TAG_KEYS)).max(8, 'Choose up to 8').optional().default([]),
      comment: z.string().trim().max(1000, 'Please keep it under 1000 characters').optional().default(''),
      allowPublish: z.coerce.boolean().default(true),
      // Honeypot: a real visitor never sees or fills this field.
      website: z.string().max(0, 'Something went wrong').optional().or(z.literal('')),
    }),
  }),
  asyncHandler(async (req, res) =>
    sendCreated(
      res,
      await feedbackService.submit(req.body, { userId: req.user?.id, ip: req.ip }),
      'Thank you — your feedback has reached the team.',
    ),
  ),
);

router.get(
  '/public',
  validate({ query: z.object({ limit: z.coerce.number().int().positive().max(24).default(6) }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await feedbackService.publicList(req.query) }),
  ),
);

// --- Back office ------------------------------------------------------------
router.get(
  '/stats',
  authenticate,
  checkPermission(PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await feedbackService.stats() })),
);

router.get(
  '/',
  authenticate,
  checkPermission(PERMISSIONS.REVIEW_VIEW),
  validate({
    query: z.object({
      status: z.enum(FEEDBACK_STATUS).optional(),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      search: z.string().trim().max(80).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await feedbackService.adminList(req.query);
    return sendPaginated(res, items, { page, limit, total });
  }),
);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid feedback');

router.patch(
  '/:id',
  authenticate,
  checkPermission(PERMISSIONS.REVIEW_MODERATE),
  validate({
    params: z.object({ id: objectId }),
    body: z
      .object({
        status: z.enum(FEEDBACK_STATUS).optional(),
        reply: z.string().max(600).optional(),
      })
      .refine((b) => b.status !== undefined || b.reply !== undefined, 'Nothing to change'),
  }),
  asyncHandler(async (req, res) => {
    const data = await feedbackService.moderate(req.params.id, req.body, req.user);
    await auditService.record({
      actor: req.user,
      action: 'feedback.moderated',
      module: 'reviews',
      summary: `Feedback from ${data.fullName}: ${[req.body.status && `marked ${req.body.status}`, req.body.reply !== undefined && 'reply updated'].filter(Boolean).join(', ')}`,
      targetType: 'feedback',
      targetId: data.id,
    });
    return sendSuccess(res, { message: 'Feedback updated', data });
  }),
);

router.delete(
  '/:id',
  authenticate,
  checkPermission(PERMISSIONS.REVIEW_MODERATE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'Feedback deleted', data: await feedbackService.remove(req.params.id) }),
  ),
);

export default router;
