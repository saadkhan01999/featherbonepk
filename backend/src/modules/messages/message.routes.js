/**
 * Contact messages — mounted at {API_PREFIX}/messages.
 * ---------------------------------------------------------------------------
 * One public endpoint (submit) and a small authenticated inbox.
 *
 * The public POST is rate-limited: an unauthenticated endpoint that writes to
 * the database and sends an email is exactly what a spam script looks for, and
 * without a limit it becomes both a storage problem and a way to get the
 * business's sending domain blacklisted.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { messageService } from './message.service.js';
import { MESSAGE_STATUS } from './message.model.js';

const router = Router();

// --- Public: send a message -------------------------------------------------
router.post(
  '/',
  writeLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(2, 'Enter your name').max(120),
      email: z.string().trim().toLowerCase().email('Enter a valid email'),
      phone: z.string().trim().max(30).optional().or(z.literal('')),
      subject: z.string().trim().max(200).optional().or(z.literal('')),
      message: z.string().trim().min(10, 'Tell us a little more').max(4000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await messageService.submit(req.body, { ip: req.ip });
    return sendCreated(res, result, 'Thanks — we have your message and will be in touch.');
  }),
);

// --- Back office ------------------------------------------------------------
router.use(authenticate);

router.get(
  '/',
  checkPermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({
    query: z.object({
      status: z.enum(MESSAGE_STATUS).optional(),
      search: z.string().trim().max(80).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await messageService.list(req.query);
    return sendSuccess(res, {
      message: 'OK',
      data: result.items,
      meta: { total: result.total, unread: result.unread },
    });
  }),
);

router.patch(
  '/:id/status',
  checkPermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({
    params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid message') }),
    body: z.object({ status: z.enum(MESSAGE_STATUS) }),
  }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Updated',
      data: await messageService.setStatus(req.params.id, req.body.status, req.user),
    }),
  ),
);

export default router;
