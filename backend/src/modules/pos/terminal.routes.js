/**
 * Terminal registry routes — mounted at {API_PREFIX}/terminals.
 * ---------------------------------------------------------------------------
 * Back office only, and guarded by the website token family, not the POS one.
 * A cashier signed in at a till must not be able to register a new till or
 * re-enable the one an administrator just disabled.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { terminalService } from './terminal.service.js';

const router = Router();

router.use(authenticate);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid terminal');

const terminalBody = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Enter a code')
    .max(24)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  name: z.string().trim().min(2, 'Give the till a name').max(80),
  /**
   * The counter this till stands at.
   *
   * This is the single most consequential field on a terminal: it decides the
   * menu the cashier sees and stamps every sale rung up here. Nullable so a
   * till can be un-assigned (a spare in the back office sells nothing).
   */
  store: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid store')
    .nullable()
    .optional(),
  location: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(300).optional(),
  isActive: z.coerce.boolean().optional(),
  /**
   * What this till sells: everything, some categories, or a hand-picked list.
   * See terminal.model.js — enforced at the menu, the scanner and the sale.
   */
  menuMode: z.enum(['all', 'categories', 'products']).optional(),
  menuCategories: z
    .array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid category'))
    .max(200)
    .optional(),
  menuProducts: z
    .array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product'))
    .max(1000)
    .optional(),
});

router.get(
  '/',
  checkPermission(PERMISSIONS.TERMINAL_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await terminalService.list() })),
);

router.get(
  '/stats',
  checkPermission(PERMISSIONS.TERMINAL_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await terminalService.stats() })),
);

router.post(
  '/',
  checkPermission(PERMISSIONS.TERMINAL_MANAGE),
  validate({ body: terminalBody }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await terminalService.create(req.body, req.user.id), 'Terminal registered'),
  ),
);

router.patch(
  '/:id',
  checkPermission(PERMISSIONS.TERMINAL_MANAGE),
  validate({ params: z.object({ id: objectId }), body: terminalBody.partial() }),
  asyncHandler(async (req, res) => {
    const result = await terminalService.update(req.params.id, req.body, req.user.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.patch(
  '/:id/active',
  checkPermission(PERMISSIONS.TERMINAL_MANAGE),
  validate({ params: z.object({ id: objectId }), body: z.object({ isActive: z.coerce.boolean() }) }),
  asyncHandler(async (req, res) => {
    const result = await terminalService.setActive(req.params.id, req.body.isActive, req.user.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.delete(
  '/:id',
  checkPermission(PERMISSIONS.TERMINAL_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await terminalService.remove(req.params.id);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
