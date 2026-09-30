/**
 * Kitchen routes — mounted at {API_PREFIX}/kitchen.
 *
 * Access (see kitchen.access.js): open mode (the default) needs no account and
 * records actions as "Kitchen screen"; signed-in mode needs kitchen.view to read
 * and kitchen.manage for Accept / Done / Served.
 *
 *   GET  /tickets?station=&channel=&store=   live tickets for a screen
 *   GET  /board?store=                       the counter Order Board
 *   POST /tickets/:id/accept   { station? }  one station's share, or the whole order
 *   POST /tickets/:id/ready    { station? }
 *   POST /tickets/:id/serve
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { kitchenService } from './kitchen.service.js';
import { kitchenAccess, kitchenManage } from './kitchen.access.js';

const router = Router();

router.use(kitchenAccess);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ticket');
const stationKey = z
  .string()
  .trim()
  .max(80)
  .regex(/^[a-z0-9-]+$/i, 'Unknown station')
  .optional();

const scopeQuery = z.object({
  store: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid store')
    .optional(),
  channel: z.enum(['all', 'pos', 'online']).default('all'),
  station: stationKey,
});

router.get(
  '/tickets',
  validate({ query: scopeQuery }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await kitchenService.listTickets(req.query) }),
  ),
);

router.get(
  '/board',
  validate({ query: z.object({ store: scopeQuery.shape.store }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await kitchenService.board(req.query) }),
  ),
);

const act = (method, message) =>
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message,
      data: await kitchenService[method](req.params.id, req.user, { station: req.body?.station }),
    }),
  );

const actionRequest = {
  params: z.object({ id: objectId }),
  body: z.object({ station: stationKey }).default({}),
};

router.post(
  '/tickets/:id/accept',
  kitchenManage,
  validate(actionRequest),
  act('accept', 'Accepted — now preparing'),
);
router.post(
  '/tickets/:id/ready',
  kitchenManage,
  validate(actionRequest),
  act('markReady', 'Ready for collection'),
);
router.post(
  '/tickets/:id/serve',
  kitchenManage,
  validate({ params: z.object({ id: objectId }) }),
  act('serve', 'Handed over'),
);

export default router;
