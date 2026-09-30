/**
 * Audit routes — mounted at {API_PREFIX}/audit.
 * ---------------------------------------------------------------------------
 * Read only. There is deliberately no POST, PATCH or DELETE: entries are
 * written by the services that perform the actions, and a trail an
 * administrator can edit or erase is not evidence of anything.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { auditService, AUDIT_MODULES } from './audit.service.js';

const router = Router();

router.use(authenticate);
// One gate for the whole surface: a route added later is protected by default
// rather than by remembering.
router.use(checkPermission(PERMISSIONS.ACTIVITY_VIEW));

router.get(
  '/',
  validate({
    query: z.object({
      module: z.enum(AUDIT_MODULES).optional(),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      search: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await auditService.list(req.query);
    return sendSuccess(res, {
      message: 'OK',
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  }),
);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await auditService.stats() })),
);

export default router;
