/**
 * Notification routes — mounted at {API_PREFIX}/notifications.
 * ---------------------------------------------------------------------------
 * The alerts themselves are derived from live state, so one disappears as soon
 * as the condition it describes is resolved — no cron, nothing to clean up.
 *
 * What is stored is which of them each person has seen, so the bell can stop
 * nagging once it has been read and start again when something changes. See
 * notification.service.js for why that is a signature rather than a flag.
 */
import { Router } from 'express';

import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { notificationService } from './notification.service.js';

const router = Router();

// No permission gate on the route: the service filters each notification by
// what the caller may see, so a cashier gets an empty list rather than a 403.
// A dashboard that 403s on one widget looks broken; one that shows nothing
// relevant is simply quiet.
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await notificationService.list(req.userDoc) }),
  ),
);

router.get(
  '/count',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await notificationService.count(req.userDoc) }),
  ),
);

/**
 * Mark everything currently visible as read.
 *
 * POST, not GET: it changes stored state, and a GET that mutates gets called by
 * every prefetcher and link-preview crawler that touches the page.
 */
router.post(
  '/read',
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Notifications marked as read',
      data: await notificationService.markAllRead(req.userDoc),
    }),
  ),
);

export default router;
