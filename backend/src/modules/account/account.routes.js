/**
 * Account routes — mounted at {API_PREFIX}/account.
 * ---------------------------------------------------------------------------
 * The signed-in customer's own account. Every handler reads `req.user.id`; no
 * route accepts a customer id from the client.
 */
import { Router } from 'express';
import { z } from 'zod';

import { passwordSchema } from '../../core/validation/password.schema.js';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../core/http/ApiResponse.js';
import { accountService } from './account.service.js';
import { ADDRESS_LABELS } from './address.model.js';

const router = Router();

router.use(authenticate);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/*
 * The shared rule, imported rather than restated.
 *
 * This was the third copy of the password policy — the comment above it claimed
 * "one definition of strong" while being one of three. Change-password is the
 * worst place for a divergent rule: someone signs up successfully, then cannot
 * set the same password again.
 */
const strongPassword = passwordSchema;

const addressBody = z.object({
  label: z.enum(ADDRESS_LABELS).optional(),
  recipientName: z.string().trim().min(2, 'Enter a name').max(120),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^03\d{9}$/, 'Enter a valid mobile number (03XXXXXXXXX)')),
  line1: z.string().trim().min(4, 'Enter the street address').max(200),
  area: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  notes: z.string().trim().max(300).optional(),
  isDefault: z.coerce.boolean().optional(),
});

// --- Profile ----------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await accountService.profile(req.user.id) }),
  ),
);

router.get(
  '/summary',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await accountService.summary(req.user.id) }),
  ),
);

router.patch(
  '/',
  validate({
    body: z.object({
      fullName: z.string().trim().min(2, 'Enter your name').max(120).optional(),
      phone: z
        .string()
        .trim()
        .transform((v) => v.replace(/[\s-]/g, ''))
        .pipe(z.string().regex(/^03\d{9}$/, 'Enter a valid mobile number (03XXXXXXXXX)'))
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const data = await accountService.updateProfile(req.user.id, req.body);
    return sendSuccess(res, { message: 'Profile updated', data });
  }),
);

router.post(
  '/password',
  // Rate limited: this endpoint verifies a password, so it is an oracle for
  // guessing one.
  writeLimiter,
  validate({
    body: z.object({
      currentPassword: z.string().min(1, 'Enter your current password'),
      newPassword: strongPassword,
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await accountService.changePassword(req.user.id, req.body, req.user.sid);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.post(
  '/email',
  // Rate limited for the same reason as the password route: it verifies a
  // password, so it can be used to guess one.
  writeLimiter,
  validate({
    body: z.object({
      newEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
      currentPassword: z.string().min(1, 'Enter your password to confirm'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await accountService.changeEmail(req.user.id, req.body, req.user.sid);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

// --- Addresses --------------------------------------------------------------
router.get(
  '/addresses',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await accountService.listAddresses(req.user.id) }),
  ),
);

router.post(
  '/addresses',
  validate({ body: addressBody }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await accountService.createAddress(req.user.id, req.body), 'Address saved'),
  ),
);

router.patch(
  '/addresses/:id',
  validate({ params: z.object({ id: objectId }), body: addressBody.partial() }),
  asyncHandler(async (req, res) => {
    const result = await accountService.updateAddress(req.user.id, req.params.id, req.body);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.post(
  '/addresses/:id/default',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await accountService.setDefaultAddress(req.user.id, req.params.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.delete(
  '/addresses/:id',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await accountService.deleteAddress(req.user.id, req.params.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

// --- Sessions ---------------------------------------------------------------
router.get(
  '/sessions',
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'OK',
      data: await accountService.sessions(req.user.id, req.user.sid),
    }),
  ),
);

router.post(
  '/sessions/revoke-others',
  asyncHandler(async (req, res) => {
    const result = await accountService.revokeOtherSessions(req.user.id, req.user.sid);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
