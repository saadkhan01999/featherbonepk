/**
 * Preparation stations — mounted at {API_PREFIX}/stations.
 *
 *   GET    /stations        settings.view
 *   POST   /stations        settings.manage
 *   PATCH  /stations/:id    settings.manage
 *   DELETE /stations/:id    settings.manage
 *
 * Kitchen screens read the active stations from /settings/kitchen-config.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendCreated, sendSuccess } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { auditService } from '../audit/audit.service.js';
import { stationService } from './station.service.js';

const router = Router();
router.use(authenticate);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid station');

const stationBody = z.object({
  name: z.string().trim().min(2, 'Name the station').max(40),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Choose a colour')
    .optional(),
  categories: z.array(z.string()).max(200).optional().default([]),
  isDefault: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

const record = (req, action, station, summary) =>
  auditService.record({
    actor: req.user,
    action,
    module: 'kitchen',
    summary,
    targetType: 'station',
    targetId: station.id,
  });

router.get(
  '/',
  checkPermission(PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (_req, res) => sendSuccess(res, { message: 'OK', data: await stationService.list() })),
);

router.post(
  '/',
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: stationBody }),
  asyncHandler(async (req, res) => {
    const station = await stationService.create(req.body);
    await record(req, 'station.created', station, `Station "${station.name}" created`);
    return sendCreated(res, station, `${station.name} created`);
  }),
);

router.patch(
  '/:id',
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({
    params: z.object({ id: objectId }),
    body: stationBody.partial().extend({ categories: z.array(z.string()).max(200).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const station = await stationService.update(req.params.id, req.body);
    await record(req, 'station.updated', station, `Station "${station.name}" updated`);
    return sendSuccess(res, { message: `${station.name} saved`, data: station });
  }),
);

router.delete(
  '/:id',
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await stationService.remove(req.params.id);
    await record(req, 'station.deleted', result, result.message);
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
