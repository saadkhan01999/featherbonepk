/**
 * Dashboard routes — mounted at {API_PREFIX}/dashboard.
 * ---------------------------------------------------------------------------
 * Not gated on a single permission. The overview is assembled per caller: each
 * panel requires its own permission, and anything the account may not see is
 * neither computed nor returned. See dashboard.service.js.
 */
import { Router } from 'express';
import { z } from 'zod';

import { authenticate, attachPermissions } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { dashboardService } from './dashboard.service.js';

const router = Router();

router.get(
  '/overview',
  authenticate,
  /*
   * No blanket permission gate.
   *
   * This is the back office's landing page. Requiring `report.view` here made
   * it 403 for anyone without it — an inventory manager signing in was met
   * with an error rather than their own dashboard.
   *
   * `attachPermissions` supplies `req.can`, and the service returns only the
   * panels this account may see. Nothing sensitive is computed, let alone
   * sent, for someone without the permission.
   */
  attachPermissions,
  validate({
    query: z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
      // Granularity switch, driven by the filter in the dashboard header.
      period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    }),
  }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'OK',
      data: await dashboardService.overview(req.query, req.can),
    }),
  ),
);

export default router;
