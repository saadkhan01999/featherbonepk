/**
 * Order + payment routes — mounted at {API_PREFIX}/orders.
 * ---------------------------------------------------------------------------
 * Checkout is deliberately guest-capable. Most food orders are placed once, in
 * a hurry; forcing account creation before someone can buy dinner is the single
 * biggest avoidable drop-off in this flow. `optionalAuth` attaches the customer
 * when they happen to be signed in, and lets them through when they are not.
 */
import { env } from '../../config/env.config.js';
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import {
  authenticate,
  optionalAuth,
  checkPermission,
  attachPermissions,
} from '../../middleware/auth.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiError } from '../../core/errors/ApiError.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { PAYMENT_METHOD_VALUES, ORDER_STATUS } from '../../core/constants/payments.js';
import { getProvider } from '../payments/payment.registry.js';
import { auditService } from '../audit/audit.service.js';
import { orderService } from './order.service.js';
import { kitchenService } from '../kitchen/kitchen.service.js';

const router = Router();

const cartItemsSchema = z
  .array(
    z.object({
      productId: z.string().min(1),
      quantity: z.coerce.number().positive('Quantity must be greater than zero'),
    }),
  )
  .min(1, 'Your cart is empty')
  // A cap: an unbounded item list is a cheap way to make the server do a lot
  // of work per request.
  .max(50, 'Too many different items in one order');

const placeOrderSchema = z.object({
  items: cartItemsSchema,
  customer: z.object({
    name: z.string().trim().min(2, 'Enter your full name').max(120),
    phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^03\d{9}$/, 'Enter a valid mobile number (03XXXXXXXXX)')),
    email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  }),
  deliveryAddress: z.object({
    line1: z.string().trim().min(4, 'Enter your street address').max(200),
    area: z.string().trim().max(120).optional(),
    city: z.string().trim().min(2, 'Enter your city').max(80),
    notes: z.string().trim().max(300).optional(),
  }),
  paymentMethod: z.enum(PAYMENT_METHOD_VALUES),
  // Only meaningful for bank transfer; validated against the catalogue by the provider.
  bankCode: z.string().trim().max(16).optional(),
});

// --- Pricing preview (no order created) ------------------------------------
router.post(
  '/quote',
  validate({ body: z.object({ items: cartItemsSchema }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await orderService.quote(req.body.items) }),
  ),
);

// --- Available payment methods ---------------------------------------------
router.get(
  '/payment-methods',
  validate({ query: z.object({ total: z.coerce.number().min(0).optional() }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: orderService.paymentMethods(req.query.total) }),
  ),
);

// --- Place an order ---------------------------------------------------------
router.post(
  '/',
  writeLimiter,
  optionalAuth,
  validate({ body: placeOrderSchema }),
  asyncHandler(async (req, res) => {
    const result = await orderService.place({
      ...req.body,
      userId: req.user?.id ?? null,
      // Where the gateway returns the customer after paying.
      returnUrl: `${env.CLIENT_URL}/order/${'{ORDER}'}`,
    });

    return sendCreated(res, result, 'Order placed successfully');
  }),
);

/**
 * Gateway callback.
 *
 * Accepts both GET and POST: JazzCash returns the customer via a POST form,
 * EasyPaisa via a GET redirect. Handling only one silently loses every payment
 * from the other provider.
 *
 * The payload arrives through the customer's browser and is therefore fully
 * attacker-controlled — nothing here is trusted until the provider verifies its
 * signature.
 */
async function handleGatewayCallback(req, res) {
  const payload = { ...req.query, ...req.body };
  const providerKey = req.params.provider;

  const provider = getProvider(providerKey);
  const verified = provider.verifyCallback(payload);

  if (!verified.verified) {
    return sendSuccess(res, {
      status: 400,
      message: verified.reason ?? 'Payment could not be verified',
      data: { verified: false },
    });
  }

  const order = await orderService.applyPaymentResult({
    orderNumber: verified.orderNumber,
    isPaid: verified.isPaid,
    reference: verified.reference,
    amount: verified.amount,
    message: verified.message,
  });

  return sendSuccess(res, {
    message: verified.isPaid ? 'Payment confirmed' : 'Payment was not completed',
    data: { verified: true, isPaid: verified.isPaid, order },
  });
}

router.get('/payments/:provider/callback', asyncHandler(handleGatewayCallback));
router.post('/payments/:provider/callback', asyncHandler(handleGatewayCallback));

// --- Customer order history (auth required) --------------------------------
router.get(
  '/mine',
  authenticate,
  validate({
    query: z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(50).default(10),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await orderService.listForUser(req.user.id, req.query);
    return sendPaginated(res, items, { page, limit, total });
  }),
);

// --- Back office -----------------------------------------------------------
// must be declared before `/:orderNumber`, otherwise Express reads "admin" as
// an order number and this route is never reached.
router.get(
  '/admin/list',
  authenticate,
  checkPermission(PERMISSIONS.ORDER_VIEW),
  validate({
    query: z.object({
      status: z.enum(Object.values(ORDER_STATUS)).optional(),
      paymentStatus: z.string().trim().optional(),
      channel: z.enum(['online', 'pos']).optional(),
      /** One till's orders — the POS Management till report links here. */
      terminal: z.string().trim().max(24).optional(),
      search: z.string().trim().max(80).optional(),
      stage: z.enum(['to-kitchen']).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await orderService.listForAdmin(req.query);
    return sendPaginated(res, items, { page, limit, total });
  }),
);

router.get(
  '/admin/stats',
  authenticate,
  checkPermission(PERMISSIONS.ORDER_VIEW),
  asyncHandler(async (_req, res) =>
    sendSuccess(res, { message: 'OK', data: await orderService.adminStats() }),
  ),
);

/** Website orders waiting to be forwarded to the stations (the dashboard's Incoming panel). */
router.get(
  '/admin/incoming',
  authenticate,
  checkPermission(PERMISSIONS.ORDER_VIEW),
  asyncHandler(async (_req, res) =>
    sendSuccess(res, { message: 'OK', data: await kitchenService.incoming() }),
  ),
);

/** Send a website order to the stations — per line, or by category for lines left out. */
router.post(
  '/:orderNumber/forward',
  authenticate,
  checkPermission(PERMISSIONS.ORDER_MANAGE),
  validate({
    params: z.object({ orderNumber: z.string().trim().min(3).max(40) }),
    body: z.object({
      lines: z
        .array(
          z.object({
            index: z.coerce.number().int().min(0),
            station: z.string().trim().max(40).nullable(),
          }),
        )
        .max(200)
        .optional()
        .default([]),
      kitchenNote: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await kitchenService.forward(req.params.orderNumber, req.body, req.user);
    await auditService.record({
      actor: req.user,
      action: 'order.forwarded',
      module: 'orders',
      summary: `Order ${result.orderNumber} forwarded to ${result.stations.join(' and ')}`,
      targetType: 'order',
      targetId: result.orderNumber,
    });
    return sendSuccess(res, {
      message: `Sent to ${result.stations.join(' and ')} — ticket #${result.ticketNumber}`,
      data: result,
    });
  }),
);

/**
 * Advance an order's status.
 * The permitted transitions live in ORDER_TRANSITIONS — this route only checks
 * that the caller is allowed to ask.
 */
router.patch(
  '/:orderNumber/status',
  authenticate,
  checkPermission(PERMISSIONS.ORDER_MANAGE),
  attachPermissions,
  validate({
    params: z.object({ orderNumber: z.string().trim().min(4) }),
    body: z.object({
      status: z.enum(Object.values(ORDER_STATUS)),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    /*
     * Cancelling is its own grant.
     *
     * `order.cancel` sat in the permission matrix for a long time checking
     * nothing, so unticking it for someone changed nothing. Moving an order on
     * and throwing one away are different decisions — the second returns stock
     * and loses a sale — and a kitchen account that bumps tickets all day has no
     * business doing it.
     */
    if (req.body.status === ORDER_STATUS.CANCELLED && !req.can(PERMISSIONS.ORDER_CANCEL)) {
      throw ApiError.forbidden('You do not have permission to cancel orders.', {
        details: [{ field: 'permission', message: `Requires: ${PERMISSIONS.ORDER_CANCEL}` }],
      });
    }

    return sendSuccess(res, {
      message: `Order marked as ${req.body.status.replace(/_/g, ' ')}`,
      data: await orderService.transition(req.params.orderNumber, req.body.status, {
        note: req.body.note,
        actorId: req.user.id,
        actorName: req.user.fullName,
      }),
    });
  }),
);

/**
 * Record a payment by hand: cash collected on delivery, a bank transfer
 * verified, a till tab settled from the office. See orderService.markPaid.
 */
router.patch(
  '/:orderNumber/payment',
  authenticate,
  checkPermission(PERMISSIONS.ORDER_MANAGE),
  validate({
    params: z.object({ orderNumber: z.string().trim().min(4).max(40) }),
    body: z.object({
      status: z.literal('paid'),
      paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
      reference: z.string().trim().max(80).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const order = await orderService.markPaid(req.params.orderNumber, req.body, req.user);
    await auditService.record({
      actor: req.user,
      action: 'order.payment_recorded',
      module: 'orders',
      // Money marked as received by a person, not a gateway — worth seeing.
      severity: 'warning',
      summary: `Marked ${order.orderNumber} paid (${order.paymentMethod}, Rs ${order.total})${req.body.reference ? ` — ref ${req.body.reference}` : ''}`,
      targetType: 'order',
      targetId: order._id,
    });
    return sendSuccess(res, { message: `${order.orderNumber} marked as paid`, data: order });
  }),
);

/**
 * Single order. Guest-readable by number (see the service for why).
 *
 * `attachPermissions` rather than `checkPermission`: this route serves three
 * different callers and must not reject any of them. A guest tracking their
 * dinner gets a redacted record; the customer who placed it gets their own
 * details back; staff with ORDER_VIEW get the whole thing, because someone
 * packing an order needs the phone number to ring about a missing house number.
 */
router.get(
  '/:orderNumber',
  optionalAuth,
  attachPermissions,
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'OK',
      data: await orderService.byNumber(req.params.orderNumber, {
        userId: req.user?.id,
        isStaff: req.can(PERMISSIONS.ORDER_VIEW),
      }),
    }),
  ),
);

/**
 * Cancel an order.
 *
 * `optionalAuth` because a guest checkout is a first-class flow here — but see
 * cancelByCustomer: an anonymous caller must supply the phone the order was
 * placed with, and an order that belongs to an account can only be cancelled
 * by that account. The order number alone is no longer enough for either.
 *
 * The body is optional so a signed-in customer's request is unchanged.
 */
router.post(
  '/:orderNumber/cancel',
  writeLimiter,
  optionalAuth,
  validate({
    params: z.object({ orderNumber: z.string().trim().min(4).max(40) }),
    body: z
      .object({ phone: z.string().trim().max(20).optional() })
      .optional()
      .default({}),
  }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Order cancelled',
      data: await orderService.cancelByCustomer(req.params.orderNumber, req.user?.id, {
        phone: req.body?.phone,
      }),
    }),
  ),
);

export default router;
