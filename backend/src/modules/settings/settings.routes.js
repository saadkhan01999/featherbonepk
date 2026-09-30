/**
 * Settings routes — mounted at {API_PREFIX}/settings.
 * ---------------------------------------------------------------------------
 * Four readers, four doors:
 *
 *   GET /public          anyone — pricing, content, business, theme, footer, contact
 *   GET /pos-config      a signed-in till — adds counter payments, till and kitchen config
 *   GET /kitchen-config  `kitchen.view` — the Kitchen Display and Order Board
 *   GET /                `settings.view` — every section, with field descriptions
 *
 * Note `/pos-config`: it is readable by any authenticated till with no settings
 * permission at all. A cashier must not need permission to manage settings in
 * order for their own till to know the GST rate — gating it would mean the
 * terminal silently bills the wrong tax.
 *
 * Every save is broadcast (`settings:changed`), so an open storefront, till or
 * kitchen screen picks up a new colour, logo or tax rate without a reload.
 */
import { Router } from 'express';
import { z } from 'zod';

import { authenticate, authenticatePos, checkPermission } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { realtime } from '../../core/realtime/realtime.js';
import { auditService } from '../audit/audit.service.js';
import { kitchenAccess } from '../kitchen/kitchen.access.js';
import { stationService } from '../stations/station.service.js';
import {
  settingsService,
  pricingRules,
  siteContent,
  counterPayments,
  businessDetails,
  themeSettings,
  footerSettings,
  contactSettings,
  sliderSettings,
  orderingStatus,
  posSettings,
  kitchenSettings,
} from './settings.service.js';

const router = Router();

// Broadcast every successful save, wherever it came from.
settingsService.onChange((section) => realtime.settingsChanged([section]));

// --- POS terminal configuration (POS session, no settings permission) ---
router.get(
  '/pos-config',
  authenticatePos,
  asyncHandler(async (_req, res) =>
    sendSuccess(res, {
      message: 'OK',
      data: {
        pricing: pricingRules(),
        currency: 'PKR',
        // QR details for counter payments. Safe to send to a till: a Till ID is
        // printed on a poster facing the public. The merchant API credentials
        // are not here and never leave the server.
        counterPayments: counterPayments(),
        // Printed on the slip — see businessDetails().
        business: businessDetails(),
        pos: posSettings(),
        kitchen: kitchenSettings(),
        theme: themeSettings(),
      },
    }),
  ),
);

// --- Kitchen Display and Order Board ---
router.get(
  '/kitchen-config',
  // Same rule as the tickets themselves — open, or a kitchen account.
  kitchenAccess,
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'OK',
      data: {
        kitchen: kitchenSettings(),
        // The screen's station switcher: "All stations", "Kitchen", "Chicken Counter"…
        stations: (await stationService.list({ activeOnly: true })).map(
          ({ id, name, slug, color, isDefault }) => ({
            id,
            name,
            slug,
            color,
            isDefault,
          }),
        ),
        business: businessDetails(),
        theme: themeSettings(),
        // What this screen may do: the buttons are shown from this.
        access: {
          ...req.kitchenAccess,
          name: req.user?.fullName ?? null,
          role: req.user?.role ?? null,
        },
      },
    }),
  ),
);

// --- Public: pricing rules + owner-editable site content ---
// Deliberately unauthenticated: a guest browsing the menu needs the tax and
// delivery rules to see accurate totals, and the homepage needs its hero copy.
router.get(
  '/public',
  asyncHandler(async (_req, res) =>
    sendSuccess(res, {
      message: 'OK',
      data: {
        pricing: pricingRules(),
        content: siteContent(),
        business: businessDetails(),
        theme: themeSettings(),
        footer: footerSettings(),
        contact: contactSettings(),
        slider: sliderSettings(),
        hours: orderingStatus(),
        currency: 'PKR',
      },
    }),
  ),
);

// --- Public: open or closed right now? ---
// Polled by the website every minute, so it is tiny and never cached: a
// customer must not be shown "open" from a copy taken before closing time.
router.get(
  '/ordering-status',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return sendSuccess(res, { message: 'OK', data: orderingStatus() });
  }),
);

// --- Admin ---
router.get(
  '/',
  authenticate,
  checkPermission(PERMISSIONS.SETTINGS_VIEW),
  validate({ query: z.object({ group: z.enum(['operations', 'website']).optional() }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: settingsService.describe({ group: req.query.group }) }),
  ),
);

router.patch(
  '/:section',
  authenticate,
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({
    params: z.object({ section: z.string().min(1).max(40) }),
    // Values are validated against the registry inside the service, which is
    // the single source of truth for types, ranges and allowed links.
    body: z.record(z.unknown()),
  }),
  asyncHandler(async (req, res) => {
    const data = await settingsService.update(req.params.section, req.body, req.user.id);

    await auditService.record({
      actor: req.user,
      action: 'settings.updated',
      module: 'settings',
      // Tax and payment settings change what every customer is charged.
      severity: ['tax', 'delivery', 'payments'].includes(req.params.section) ? 'warning' : 'info',
      summary: `Updated ${req.params.section} settings (${Object.keys(req.body).join(', ')})`,
      targetType: 'settings',
      targetId: req.params.section,
    });

    return sendSuccess(res, { message: 'Settings saved', data });
  }),
);

export default router;
