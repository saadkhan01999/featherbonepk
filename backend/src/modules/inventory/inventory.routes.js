/**
 * Inventory routes — mounted at {API_PREFIX}/inventory.
 * ---------------------------------------------------------------------------
 * Changing a stock figure needs `inventory.adjust`; reading the ledger needs
 * `inventory.view`.
 *
 * The inventory reports (stock on hand, movements) live with every other report
 * under /reports, so they share one export pipeline (View, CSV, PDF).
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { inventoryService } from './inventory.service.js';

const router = Router();
router.use(authenticate);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product');

router.post(
  '/products/:id/adjust',
  checkPermission(PERMISSIONS.INVENTORY_ADJUST),
  writeLimiter,
  validate({
    params: z.object({ id: objectId }),
    body: z.object({
      mode: z.enum(['set', 'add', 'remove']),
      quantity: z.coerce.number().min(0).max(1_000_000),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await inventoryService.adjustStock(req.params.id, req.body, req.user);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

router.get(
  '/products/:id/history',
  checkPermission(PERMISSIONS.INVENTORY_VIEW),
  validate({
    params: z.object({ id: objectId }),
    query: z.object({ limit: z.coerce.number().int().positive().max(200).default(50) }),
  }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'OK',
      data: await inventoryService.productHistory(req.params.id, req.query),
    }),
  ),
);

export default router;
