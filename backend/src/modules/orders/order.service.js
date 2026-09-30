/**
 * Order placement.
 * ---------------------------------------------------------------------------
 * The two rules that matter most in this file:
 *
 * 1. Never trust the client's prices. The cart arrives as a list of product ids
 *    and quantities; every price, tax figure and total is re-read from the
 *    database and recomputed here. A client-supplied total is a total the
 *    customer can edit in devtools, and "why did this Rs 4,000 order pay Rs 1?"
 *    is not a bug you want to find in a ledger.
 *
 * 2. Stock is decremented conditionally and rolled back on failure. Two
 *    customers hitting the last chicken at the same moment must not both
 *    succeed. The update matches only while `stock >= quantity`, so the loser
 *    of the race fails cleanly, and anything already taken is put back.
 */
import { randomBytes } from 'node:crypto';

import mongoose from 'mongoose';

import { env } from '../../config/env.config.js';
import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { realtime } from '../../core/realtime/realtime.js';
import { Product } from '../catalog/product.model.js';
import { orderingStatus, pricingRules, settingsService } from '../settings/settings.service.js';
import { getProvider, availableMethods } from '../payments/payment.registry.js';
import { recordMovements } from '../inventory/inventory.service.js';
import { MOVEMENT_TYPES } from '../inventory/stock-movement.model.js';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  ORDER_TRANSITIONS,
  CUSTOMER_CANCELLABLE,
  ORDER_TYPE,
} from '../../core/constants/payments.js';
import { Order } from './order.model.js';
import { nextSequence, businessDate } from './counter.model.js';
import { stationService } from '../stations/station.service.js';

/**
 * Order number: FB-YYYYMMDD-XXXXXX.
 * Date-prefixed so a human can read when it was placed, with a random suffix
 * rather than a sequence — a guessable order number lets anyone enumerate other
 * people's orders through the public tracking page.
 *
 * Six characters, from crypto. It was four, from `Math.random()`, and both
 * halves of that were wrong:
 *
 *  • 36⁴ is 1.68 million values per day, and `orderNumber` is uniquely indexed
 *    with no retry. By the birthday bound a shop taking 500 orders a day had
 *    roughly a 7% chance each day of a checkout dying on a duplicate key —
 *    after the customer had already paid. 36⁶ is 2.2 billion, which moves that
 *    to the far side of negligible.
 *  • `Math.random()` is not unpredictable. The whole point of a random suffix
 *    is that a stranger cannot guess the next one; V8's generator is seeded and
 *    its output is recoverable from a handful of samples, which a public
 *    tracking page hands out freely.
 */
function generateOrderNumber(prefix = 'FB') {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).replace(/-/g, '');

  /*
   * Reduce into the 36⁶ space, then pad — do not slice a base36 string.
   *
   * Slicing was my first attempt and it was wrong twice over: a value below 36⁵
   * renders as five characters, so `slice(0, 6)` silently produced a short
   * suffix (about 1 in 12,000, which a hand-written test would never see), and
   * on longer values it discarded the low-order digits — throwing away the very
   * entropy that stops the number being guessable.
   *
   * 48 random bits reduced modulo 2.18 billion leaves a bias of roughly one
   * part in 129,000, far below anything that matters here.
   */
  const SPACE = 36n ** 6n;
  const suffix = (BigInt(`0x${randomBytes(6).toString('hex')}`) % SPACE)
    .toString(36)
    .toUpperCase()
    .padStart(6, '0');

  return `${prefix}-${today}-${suffix}`;
}

/**
 * Create an order, regenerating the number if it collides.
 *
 * Belt as well as braces. Widening the suffix makes a clash vanishingly
 * unlikely; it does not make it impossible, and the failure mode is the worst
 * one in the system — the customer's money has moved and the order record does
 * not exist. Three attempts turn a 1-in-a-billion event into one nobody will
 * ever meet.
 *
 * Shared with the POS (`prefix: 'INV'`), which had its own four-character copy
 * of the same mistake — and a worse consequence, because the cash is already
 * in the drawer by the time the write runs.
 *
 * Narrow on purpose: it retries only a duplicate `orderNumber` (E11000 naming
 * that key). Any other write error is a real fault and is rethrown immediately,
 * because retrying those would just mean failing three times as slowly.
 */
export async function createOrderWithUniqueNumber(document, { prefix = 'FB', attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await Order.create({ ...document, orderNumber: generateOrderNumber(prefix) });
    } catch (error) {
      const duplicateNumber = error?.code === 11000 && 'orderNumber' in (error.keyPattern ?? {});
      if (!duplicateNumber || attempt >= attempts) throw error;
      logger.warn(`Order number collided (attempt ${attempt}/${attempts}) — regenerating.`);
    }
  }
}

/**
 * Re-price a list of {productId, quantity} from the database.
 *
 * Returns only the priced lines — no delivery fee, no tax, no minimum-order
 * rule. Those differ per channel (a walk-in customer is not charged delivery),
 * so each channel layers its own rules on top of this one implementation.
 * Exported for the POS, which must price by exactly the same rules as the
 * website or the two ledgers disagree.
 */
/**
 * @param {Array} items                     `{ productId, quantity }`
 * @param {object} [options]
 * @param {string|null} [options.store]     Restrict to goods sold at this
 *   counter. Omitted by the website, which sells the whole catalogue; passed by
 *   the till, which must not be able to ring up another counter's stock.
 */
export async function repriceLines(items, { store = null, menu = null } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Your cart is empty');
  }

  const ids = items.map((item) => item.productId);
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    throw ApiError.badRequest('Your cart contains an invalid item');
  }

  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const problems = [];

  for (const item of items) {
    const product = byId.get(String(item.productId));

    // An item removed or archived between browsing and checkout.
    if (!product) {
      problems.push({ field: 'items', message: 'An item in your cart is no longer available' });
      continue;
    }

    /*
     * Store membership is checked here, not only in the menu query.
     *
     * Scoping `/pos/products` hides another counter's goods from the screen —
     * it does not stop the till POSTing an id it obtained some other way. A
     * verification run proved it: the chicken till successfully sold a Naan,
     * which would have depleted bakery stock and put bakery money in the
     * chicken counter's takings.
     *
     * A null `product.store` means the item is sold everywhere (drinks, sides),
     * so it passes at any counter.
     */
    if (store && product.store && String(product.store) !== String(store)) {
      problems.push({ field: 'items', message: `${product.name} is not sold at this counter` });
      continue;
    }

    /*
     * The till's own menu, checked at the point that takes money — same
     * reasoning as the store check above. Hiding an item from the till's grid
     * does not stop the till POSTing its id.
     */
    const outsideMenu =
      (menu?.mode === 'categories' && !menu.categories.includes(String(product.category))) ||
      (menu?.mode === 'products' && !menu.products.includes(String(product._id)));
    if (outsideMenu) {
      problems.push({ field: 'items', message: `${product.name} is not on this till's menu` });
      continue;
    }

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      problems.push({ field: 'items', message: `Invalid quantity for ${product.name}` });
      continue;
    }

    // Countable goods cannot be sold in fractions. Weighed goods can.
    const isWeighed = ['kg', 'g', 'ltr', 'ml'].includes(product.unit);
    if (!isWeighed && !Number.isInteger(quantity)) {
      problems.push({ field: 'items', message: `${product.name} must be a whole number` });
      continue;
    }

    if (product.stock < quantity) {
      problems.push({
        field: 'items',
        message:
          product.stock <= 0
            ? `${product.name} is out of stock`
            : `Only ${product.stock} ${product.unit} of ${product.name} left`,
      });
      continue;
    }

    // The price the server holds, after any discount — never the client's.
    const unitPrice = product.discountPercent
      ? Math.round(product.price * (1 - product.discountPercent / 100))
      : product.price;

    lines.push({
      product: product._id,
      name: product.name,
      unit: product.unit,
      unitPrice,
      quantity,
      lineTotal: Math.round(unitPrice * quantity),
    });
  }

  if (problems.length > 0) {
    throw ApiError.validation(problems, 'Some items need your attention before checkout');
  }

  return lines;
}

/**
 * Online cart pricing: priced lines plus delivery, tax and the minimum-order
 * rule. The POS has its own equivalent — see pos.service.js.
 */
async function repriceCart(items) {
  const lines = await repriceLines(items);

  const rules = pricingRules();
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  if (rules.minimumOrderValue > 0 && subtotal < rules.minimumOrderValue) {
    throw ApiError.badRequest(
      `Minimum order is Rs ${rules.minimumOrderValue.toLocaleString('en-PK')}. Please add a little more.`,
    );
  }

  const qualifiesFree = rules.freeDeliveryThreshold > 0 && subtotal >= rules.freeDeliveryThreshold;
  const deliveryFee = qualifiesFree ? 0 : rules.deliveryFee;

  // Tax follows the discount and is computed on goods only — charging GST on a
  // delivery fee would overstate the tax due.
  const tax = rules.taxInclusive ? 0 : Math.round(subtotal * rules.taxRate);

  return {
    lines,
    subtotal,
    deliveryFee,
    tax,
    taxRate: rules.taxRate,
    total: subtotal + deliveryFee + tax,
  };
}

/**
 * Reserve stock for every line.
 *
 * Each decrement is conditional on sufficient stock, which is what makes this
 * safe without a transaction (and therefore safe on a standalone MongoDB with
 * no replica set). If any line fails, everything already taken is restored
 * before the error propagates — a half-decremented order would silently lose
 * inventory.
 */
export async function reserveStock(lines) {
  const taken = [];

  try {
    for (const line of lines) {
      /*
       * findOneAndUpdate rather than updateOne: the document it hands back is
       * the stock after this decrement, read from the same atomic write. That is
       * the only race-free way to know the balance for the ledger — a separate
       * read afterwards could already include another till's sale.
       */
      const after = await Product.findOneAndUpdate(
        { _id: line.product, stock: { $gte: line.quantity } },
        { $inc: { stock: -line.quantity, soldCount: line.quantity } },
        { new: true, projection: { stock: 1 } },
      ).lean();

      if (!after) {
        // Someone else took it between repricing and now.
        throw ApiError.conflict(`${line.name} just sold out — please adjust your cart`);
      }
      taken.push({ ...line, balanceAfter: after.stock });
    }
  } catch (error) {
    await releaseStock(taken);
    throw error;
  }

  // Every till showing these items is now showing a stale count.
  realtime.stockChanged(taken.map((line) => line.product));
  return taken;
}

/**
 * The ledger lines for stock that has left the shelf on a saved order.
 *
 * Written only once the order exists — never inside reserveStock — so a sale
 * that was rolled back leaves no trace in the ledger, rather than a sale and a
 * matching return that never really happened.
 */
export async function recordSaleMovements(order, taken, actor = null) {
  await recordMovements(
    taken.map((line) => ({
      product: line.product,
      name: line.name,
      unit: line.unit,
      quantity: -line.quantity,
      balanceAfter: line.balanceAfter,
    })),
    {
      type: MOVEMENT_TYPES.SALE,
      reference: order.orderNumber,
      channel: order.channel,
      terminalId: order.terminalId ?? null,
      store: order.store ?? null,
      actor,
    },
  );
}

const plainLine = (item) => (typeof item?.toObject === 'function' ? item.toObject() : { ...item });

/**
 * Send an order to the kitchen: issue its ticket number, decide which station
 * prepares each line, and open a piece of work for each of those stations.
 *
 * `assignments` (one entry per line: a station document, or null for "needs no
 * preparing") comes from the back office forwarding a website order; without
 * it every line is routed by its category. Idempotent for the ticket number: an
 * order that already has one keeps it.
 *
 * Mutates the order (a document or a plain object) in memory; the caller saves it.
 */
export async function assignTicket(order, { assignments } = {}) {
  const routed = assignments ?? (await stationService.routeLines(order.items ?? []));
  const now = new Date();

  if (!order.ticketNumber) {
    const day = businessDate();
    order.ticketNumber = await nextSequence(`ticket:${day}`);
    order.ticketDate = day;
  }

  order.items = (order.items ?? []).map((item, index) => ({
    ...plainLine(item),
    station: routed[index]?._id ?? null,
    stationName: routed[index]?.name ?? null,
  }));

  const stations = [];
  for (const station of routed) {
    if (station && !stations.some((s) => String(s.station) === String(station._id))) {
      stations.push({ station: station._id, name: station.name, color: station.color ?? null, firedAt: now });
    }
  }

  const kitchen =
    typeof order.kitchen?.toObject === 'function' ? order.kitchen.toObject() : { ...order.kitchen };
  order.kitchen = { ...kitchen, firedAt: kitchen.firedAt ?? now, stations };
  return order;
}

/** The fields assignTicket set, for callers that write with a conditional update. */
export function kitchenFields(order) {
  return {
    ticketNumber: order.ticketNumber,
    ticketDate: order.ticketDate,
    items: order.items,
    'kitchen.firedAt': order.kitchen.firedAt,
    'kitchen.stations': order.kitchen.stations,
  };
}

/** Kitchen switches, read from the warmed settings cache (synchronous). */
export function kitchenRules() {
  return {
    enabled: Boolean(settingsService.get('kitchenEnabled')),
    autoFireOnPay: Boolean(settingsService.get('kitchenAutoFireOnPay')),
    /** review: staff forward website orders · auto: straight to the stations · off: never */
    websiteOrders: settingsService.get('kitchenWebsiteOrders') ?? 'review',
  };
}

/**
 * Does confirming this order send it to the kitchen by itself? Till orders
 * always do (the till decided); website orders only when the owner chose
 * automatic forwarding — otherwise they wait on the dashboard for a person.
 */
export function firesOnConfirm(order) {
  const rules = kitchenRules();
  if (!rules.enabled || order.kitchen?.firedAt) return false;
  return order.channel === 'pos' || rules.websiteOrders === 'auto';
}

/**
 * Put a saved order's stock back, at most once, ever.
 *
 * The only route by which a persisted order returns stock. Three callers want
 * this — customer cancellation, back-office cancellation, and reservation
 * expiry — and any two of them arriving together would otherwise each add the
 * quantity back, leaving the shop believing it has stock it never had. Over-
 * selling the last chicken is a phone call and an apology; silently inventing a
 * second one is a customer who paid for food that does not exist.
 *
 * The claim is a conditional update, so the winner is decided by the database
 * rather than by whichever process happened to read first. Only the caller that
 * flips the latch performs the restore.
 *
 * @returns {Promise<boolean>} true if THIS call restored the stock
 */
export async function releaseOrderStock(order) {
  const claimed = await Order.updateOne(
    { _id: order._id, stockReleased: { $ne: true } },
    { $set: { stockReleased: true } },
  );

  if (claimed.modifiedCount !== 1) return false;

  /*
   * Keep the caller's in-memory copy honest.
   *
   * The latch was flipped by a direct update, so the document the caller is
   * holding still says `false` — and callers return that document to the
   * client. Worse, a later `order.save()` on that stale copy would write the
   * false back and re-arm a latch that has already fired.
   */
  if (typeof order.set === 'function') order.set('stockReleased', true);
  else order.stockReleased = true;

  const returned = await releaseStock(
    order.items.map((item) => ({
      product: item.product,
      quantity: item.quantity,
      name: item.name,
    })),
  );

  await recordMovements(returned, {
    type: MOVEMENT_TYPES.RETURN,
    reference: order.orderNumber,
    channel: order.channel,
    terminalId: order.terminalId ?? null,
    store: order.store ?? null,
    note: 'Order cancelled — returned to stock',
  });

  return true;
}

/**
 * Return stock held by online orders whose payment never arrived.
 *
 * Idempotent and safe to run anywhere. The filter selects only orders that are
 * still both `pending` and unpaid with a deadline in the past, and the claim
 * that follows is atomic — so two schedulers, or a scheduler racing a customer
 * who is paying at that exact moment, cannot both act on one order.
 *
 * A paid order is never touched. `paymentStatus: PENDING` is part of the filter
 * and the claim, so an order that settles a second before the sweep runs simply
 * fails to match, and one that settles a second after has already had its
 * deadline cleared by applyPaymentResult.
 *
 * @param {object}  [options]
 * @param {Date}    [options.now]   Injectable clock, for tests.
 * @param {number}  [options.limit] Ceiling per run, so a long outage's backlog
 *   is worked through in batches instead of one enormous query.
 */
export async function expireAbandonedReservations({ now = new Date(), limit = 100 } = {}) {
  const due = await Order.find({
    channel: 'online',
    status: ORDER_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.PENDING,
    stockReleased: { $ne: true },
    reservationExpiresAt: { $ne: null, $lte: now },
  })
    .limit(limit)
    .lean();

  let expired = 0;

  for (const order of due) {
    /*
     * Claim first, restore second.
     *
     * The same conditions appear again here, and that repetition is the point:
     * between the find above and this update, the customer's payment may have
     * landed. Re-asserting them inside the atomic write is what stops a paid
     * order being cancelled out from under a customer who has already been
     * charged — the worst outcome this whole mechanism could produce.
     */
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        status: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.PENDING,
        stockReleased: { $ne: true },
      },
      {
        $set: {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.CANCELLED,
          stockReleased: true,
          reservationExpiresAt: null,
        },
        $push: {
          timeline: {
            status: ORDER_STATUS.CANCELLED,
            at: now,
            note: 'Payment was not completed in time — items returned to stock',
          },
        },
      },
      { new: true },
    ).lean();

    if (!claimed) continue; // Someone paid, or another sweeper got there first.

    const returned = await releaseStock(
      claimed.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        name: item.name,
      })),
    );

    await recordMovements(returned, {
      type: MOVEMENT_TYPES.RETURN,
      reference: claimed.orderNumber,
      channel: claimed.channel,
      note: 'Payment not completed in time — reservation released',
    });
    realtime.orderChanged(claimed, 'expired');

    expired += 1;
    logger.info('Reservation expired — stock returned', {
      orderNumber: claimed.orderNumber,
      total: claimed.total,
    });
  }

  return { scanned: due.length, expired };
}

/**
 * Put stock back — used on rollback and on cancellation.
 * @returns {Promise<Array<{product, quantity, name, balanceAfter}>>} what was
 *   actually restored, with the balance each line left, for the ledger.
 */
export async function releaseStock(lines) {
  const results = await Promise.all(
    lines.map((line) =>
      Product.findOneAndUpdate(
        { _id: line.product },
        { $inc: { stock: line.quantity, soldCount: -line.quantity } },
        { new: true, projection: { stock: 1 } },
      )
        .lean()
        .then((after) =>
          after
            ? { product: line.product, quantity: line.quantity, name: line.name, balanceAfter: after.stock }
            : null,
        )
        .catch((error) => {
          // Never let a rollback failure mask the original error — log and move on.
          logger.error('Failed to restore stock', { product: String(line.product), message: error.message });
          return null;
        }),
    ),
  );

  const restored = results.filter(Boolean);
  if (restored.length) realtime.stockChanged(restored.map((line) => line.product));
  return restored;
}

/**
 * Normalise a phone number for comparison.
 * Customers type `0300 123 4567`, `0300-1234567` and `+92 300 1234567` for the
 * same number; comparing the raw strings would reject the person who actually
 * placed the order because they used a space this time.
 */
function normalisePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  // Pakistani mobiles are stored as 03XXXXXXXXX. Fold the +92 / 0092 forms onto
  // that so all three spellings compare equal.
  if (digits.startsWith('92') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('0092') && digits.length === 14) return `0${digits.slice(4)}`;
  return digits;
}

/**
 * The view of an order handed to someone who is not its signed-in owner.
 *
 * Anyone holding the number can read this, which is exactly what guest tracking
 * is for — but the phone number is now the thing that authorises cancellation,
 * so returning it in full would hand over the credential along with the record
 * and make the check below decorative.
 *
 * Enough is left visible to recognise your own order: the last three digits,
 * which confirm "yes, that is my number" without disclosing it to a stranger.
 */
function redactForGuest(order) {
  const phone = order.customerPhone ?? null;

  return {
    ...order,
    customerPhone: phone ? `${'•'.repeat(Math.max(phone.length - 3, 0))}${phone.slice(-3)}` : null,
    // Internal identifiers are of no use to a customer and would confirm which
    // account an order belongs to.
    customer: undefined,
    placedBy: undefined,
  };
}

/** The sentence a refused customer reads. */
function closedMessage(ordering) {
  if (ordering.reason === 'temporarily-closed') {
    return "Sorry — we're not taking orders right now. Please check back a little later.";
  }
  if (ordering.reason === 'last-orders') {
    return `Sorry — we've stopped taking orders for today${
      ordering.opensAtText ? `. Ordering opens again ${ordering.opensAtText}` : ''
    }.`;
  }
  return `Sorry — we're closed right now${ordering.opensAtText ? ` and open ${ordering.opensAtText}` : ''}.`;
}

export const orderService = {
  /** Payment methods offerable for a given basket value. */
  paymentMethods(orderTotal) {
    return availableMethods({ orderTotal });
  },

  /**
   * Price a cart without placing an order.
   * The checkout screen calls this so the customer sees server totals before
   * committing — the figures they confirm are the figures they will be charged.
   */
  async quote(items) {
    const priced = await repriceCart(items);
    return {
      // Checkout shows "we're closed" before the customer fills in anything.
      ordering: orderingStatus(),
      items: priced.lines,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      tax: priced.tax,
      taxRate: priced.taxRate,
      total: priced.total,
      paymentMethods: availableMethods({ orderTotal: priced.total }),
    };
  },

  /**
   * Place an order.
   *
   * Order of operations is deliberate:
   *   reprice → reserve stock → create order → initiate payment
   * Reserving before creating means we never persist an order we cannot fulfil;
   * initiating payment last means a gateway failure leaves a recoverable
   * pending order rather than a paid order with no stock behind it.
   */
  async place({ items, customer, deliveryAddress, paymentMethod, bankCode, userId, returnUrl }) {
    /*
     * Opening hours, first. Outside the owner's hours (or with "closed right
     * now" switched on) the order is refused before anything happens — no
     * stock is held, no payment is started and no order number is used — so
     * there is nothing to cancel afterwards. The website shows the reason
     * and when ordering opens again.
     */
    const ordering = orderingStatus();
    if (!ordering.canOrder) {
      throw new ApiError(409, closedMessage(ordering), {
        code: 'SHOP_CLOSED',
        details: [
          {
            field: 'ordering',
            reason: ordering.reason,
            title: ordering.title,
            message: ordering.message,
            opensAt: ordering.opensAt,
            opensAtText: ordering.opensAtText,
          },
        ],
      });
    }

    const priced = await repriceCart(items);

    // Validate the method before touching stock, so an unsupported method
    // doesn't leave inventory decremented for an order that cannot proceed.
    const provider = getProvider(paymentMethod);

    const reserved = await reserveStock(priced.lines);

    let order;
    try {
      order = await createOrderWithUniqueNumber({
        channel: 'online',
        customer: userId ?? undefined,
        customerName: customer.name,
        customerPhone: customer.phone,
        items: priced.lines,
        subtotal: priced.subtotal,
        deliveryFee: priced.deliveryFee,
        tax: priced.tax,
        taxRate: priced.taxRate,
        total: priced.total,
        paymentMethod,
        paymentStatus: PAYMENT_STATUS.PENDING,
        status: ORDER_STATUS.PENDING,
        orderType: ORDER_TYPE.DELIVERY,
        deliveryAddress,
        placedBy: userId ?? undefined,
        timeline: [{ status: ORDER_STATUS.PENDING, at: new Date(), note: 'Order placed' }],
      });
    } catch (error) {
      await releaseStock(reserved);
      throw error;
    }

    // --- Payment initiation ---
    let payment;
    try {
      payment = provider.createPayment({
        order: {
          orderNumber: order.orderNumber,
          total: order.total,
          customerPhone: order.customerPhone,
        },
        returnUrl,
        bankCode,
      });
    } catch (error) {
      // The order exists but cannot be paid — cancel it and restore stock
      // rather than leaving an unpayable order holding inventory.
      await releaseStock(reserved);
      order.status = ORDER_STATUS.CANCELLED;
      order.paymentStatus = PAYMENT_STATUS.FAILED;
      order.timeline.push({
        status: ORDER_STATUS.CANCELLED,
        at: new Date(),
        note: 'Payment could not be started',
      });
      await order.save();
      throw ApiError.badRequest(error.message);
    }

    // Offline methods settle later; the provider decides whether the order is
    // confirmed now (COD → kitchen starts) or held (bank transfer → verify first).
    if (payment.paymentStatus) order.paymentStatus = payment.paymentStatus;

    /*
     * Start the clock on the held stock — but only for an order that is waiting
     * on a customer to finish paying at a gateway.
     *
     * The condition is what keeps this safe. Cash on delivery confirms the order
     * outright and the rider collects later; bank transfer sits in
     * `awaiting_verification` until a human matches the receipt, which can
     * legitimately take a day. Neither is abandoned, and expiring either would
     * cancel real orders — so both fall outside this branch, which fires only
     * for `pending` payment on an unconfirmed order.
     */
    if (!payment.confirmOrder && order.paymentStatus === PAYMENT_STATUS.PENDING) {
      order.reservationExpiresAt = new Date(Date.now() + env.reservationMs);
    }

    if (payment.confirmOrder) {
      order.status = ORDER_STATUS.CONFIRMED;
      order.timeline.push({
        status: ORDER_STATUS.CONFIRMED,
        at: new Date(),
        note: 'Confirmed — cash on delivery',
      });
      // Straight to the kitchen only if the owner chose automatic forwarding;
      // otherwise it waits on the dashboard for staff to forward it.
      if (firesOnConfirm(order)) await assignTicket(order);
    }

    if (payment.reference) order.paymentReference = payment.reference;
    await order.save();

    await recordSaleMovements(order, reserved);
    realtime.orderChanged(order, 'created');
    realtime.notificationsChanged();

    logger.info('Order placed', {
      orderNumber: order.orderNumber,
      total: order.total,
      method: paymentMethod,
    });

    return {
      order: order.toObject(),
      // Present for gateway methods: the client renders these as a
      // self-submitting form to hand the customer to the provider.
      payment: {
        provider: payment.provider,
        method: payment.method,
        endpoint: payment.endpoint ?? null,
        fields: payment.fields ?? null,
        instructions: payment.instructions ?? null,
        account: payment.account ?? null,
      },
    };
  },

  /**
   * Look up an order by its number — powers the confirmation and tracking pages.
   *
   * @param {object}  [options]
   * @param {string}  [options.userId]  The signed-in customer, if any.
   * @param {boolean} [options.isStaff] True when the caller holds ORDER_VIEW.
   *   Staff see the unredacted record: the phone number is how the kitchen
   *   chases a missing flat number, and masking it would break the job rather
   *   than protect anyone — they can already read every order in the back
   *   office list.
   */
  async byNumber(orderNumber, { userId, isStaff = false } = {}) {
    const order = await Order.findOne({ orderNumber: orderNumber.toUpperCase() }).lean();
    if (!order) throw ApiError.notFound('Order');

    // A signed-in customer may only read their own orders. Guests can read by
    // order number alone — that is the point of guest tracking, and the random
    // suffix is what stops the numbers being enumerable.
    if (userId && order.customer && String(order.customer) !== String(userId)) {
      throw ApiError.forbidden('That order belongs to a different account');
    }

    const isOwner = Boolean(userId && order.customer && String(order.customer) === String(userId));
    return isOwner || isStaff ? order : redactForGuest(order);
  },

  /** Orders for the signed-in customer, newest first. */
  async listForUser(userId, { page = 1, limit = 10 } = {}) {
    const [items, total] = await Promise.all([
      Order.find({ customer: userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments({ customer: userId }),
    ]);
    return { items, total, page, limit };
  },

  /**
   * Back-office order list.
   * Separate from `listForUser` because the filters differ and, more
   * importantly, because this one is not scoped to a customer — mixing the two
   * behind a flag is how "any user can read any order" bugs get written.
   */
  async listForAdmin({ status, paymentStatus, channel, terminal, search, stage, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    // Website orders waiting for staff to send them to the kitchen.
    if (stage === 'to-kitchen') {
      Object.assign(filter, { channel: 'online', status: ORDER_STATUS.CONFIRMED, 'kitchen.firedAt': null });
    }
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (terminal) filter.terminalId = String(terminal).toUpperCase();
    // Filtered on the server so paging and totals match what is shown.
    if (channel && stage !== 'to-kitchen') filter.channel = channel;

    if (search) {
      // Escaped — an unescaped search box is a regex-injection (and ReDoS) hole.
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ orderNumber: rx }, { customerName: rx }, { customerPhone: rx }];
    }

    const [rows, total] = await Promise.all([
      Order.find(filter)
        // Only the columns the table draws. Shipping the full item array for
        // every row turns a 50-order page into a payload of hundreds of lines
        // that nothing on screen reads.
        .select(
          'orderNumber channel customerName customerPhone items status paymentMethod paymentStatus total createdAt ' +
            'ticketNumber orderType tableNumber terminalId kitchen.firedAt',
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    const rules = kitchenRules();
    const forwarding = rules.enabled && rules.websiteOrders !== 'off';
    const items = rows.map((order) => ({
      id: String(order._id),
      orderNumber: order.orderNumber,
      channel: order.channel,
      customerName: order.customerName,
      customerPhone: order.customerPhone ?? null,
      itemCount: order.items?.length ?? 0,
      // A one-line summary so the row is readable without opening it.
      summary: (order.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(', '),
      status: order.status,
      paymentMethod: order.paymentMethod ?? null,
      paymentStatus: order.paymentStatus,
      total: order.total,
      createdAt: order.createdAt,
      ticketNumber: order.ticketNumber ?? null,
      orderType: order.orderType ?? (order.channel === 'pos' ? ORDER_TYPE.TAKE_AWAY : ORDER_TYPE.DELIVERY),
      tableNumber: order.tableNumber ?? null,
      terminalId: order.terminalId ?? null,
      /** A website order waiting for staff to send it to the stations. */
      awaitingKitchen:
        forwarding &&
        order.channel === 'online' &&
        order.status === ORDER_STATUS.CONFIRMED &&
        !order.kitchen?.firedAt,
      /** What this order may move to next — drives the row's action menu. */
      nextStatuses: ORDER_TRANSITIONS[order.status] ?? [],
      /** Can the back office record this payment by hand (cash collected, transfer verified)? */
      canMarkPaid:
        [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.AWAITING_VERIFICATION].includes(order.paymentStatus) &&
        order.status !== ORDER_STATUS.CANCELLED,
    }));

    return { items, total, page, limit };
  },

  /** Counts per status, for the queue tabs. */
  async adminStats() {
    const rows = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$total' } } },
    ]);

    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    const toKitchen = await Order.countDocuments({
      channel: 'online',
      status: ORDER_STATUS.CONFIRMED,
      'kitchen.firedAt': null,
    });
    return {
      byStatus,
      toKitchen,
      total: rows.reduce((sum, r) => sum + r.count, 0),
      // "Needs attention" — anything not yet finished or written off.
      open: [
        ORDER_STATUS.PENDING,
        ORDER_STATUS.CONFIRMED,
        ORDER_STATUS.PREPARING,
        ORDER_STATUS.READY,
        ORDER_STATUS.OUT_FOR_DELIVERY,
      ].reduce((sum, status) => sum + (byStatus[status] ?? 0), 0),
    };
  },

  /**
   * Move an order along its lifecycle.
   * Transitions are whitelisted, so an order can never jump from `pending`
   * straight to `delivered`, skipping payment capture entirely.
   */
  async transition(orderNumber, nextStatus, { note, actorId, actorName, moveStations = true } = {}) {
    const order = await Order.findOne({ orderNumber: String(orderNumber).toUpperCase() });
    if (!order) throw ApiError.notFound('Order');

    const allowed = ORDER_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw ApiError.badRequest(`Cannot move an order from "${order.status}" to "${nextStatus}"`, {
        details: [{ field: 'status', message: `Allowed: ${allowed.join(', ') || 'none'}` }],
      });
    }

    const now = new Date();
    const set = { status: nextStatus };
    const timeline = [{ status: nextStatus, at: now, note }];

    // A cancelled order is no longer waiting on anything, so it leaves the
    // sweeper's queue whether or not it was ever holding a deadline.
    if (nextStatus === ORDER_STATUS.CANCELLED) set.reservationExpiresAt = null;

    /*
     * Kitchen timestamps follow the status, whoever moved it.
     *
     * Set here rather than in the kitchen module so that a manager moving an
     * order from the back office leaves the same trail as a cook tapping the
     * Kitchen Display — the timers on the screen and the "how long do tickets
     * take" figures must not depend on which button was used.
     */
    const by = actorName ?? null;
    if (nextStatus === ORDER_STATUS.CONFIRMED && firesOnConfirm(order)) {
      await assignTicket(order);
      Object.assign(set, kitchenFields(order));
    }
    if (nextStatus === ORDER_STATUS.PREPARING && !order.kitchen?.acceptedAt) {
      set['kitchen.acceptedAt'] = now;
      set['kitchen.acceptedBy'] = by;
    }
    if (nextStatus === ORDER_STATUS.READY && !order.kitchen?.readyAt) {
      set['kitchen.readyAt'] = now;
      set['kitchen.readyBy'] = by;
    }
    // Moving the whole order moves every station's share with it — unless one
    // station starting its own share is what moved the order.
    const work = order.kitchen?.stations ?? [];
    if (moveStations && work.length && [ORDER_STATUS.PREPARING, ORDER_STATUS.READY].includes(nextStatus)) {
      set['kitchen.stations'] = work.map((entry) => {
        const next = typeof entry.toObject === 'function' ? entry.toObject() : { ...entry };
        if (!next.acceptedAt) Object.assign(next, { acceptedAt: now, acceptedBy: by });
        if (nextStatus === ORDER_STATUS.READY && !next.readyAt)
          Object.assign(next, { readyAt: now, readyBy: by });
        return next;
      });
    }
    if (
      [ORDER_STATUS.COMPLETED, ORDER_STATUS.OUT_FOR_DELIVERY].includes(nextStatus) &&
      !order.kitchen?.servedAt
    ) {
      set['kitchen.servedAt'] = now;
      set['kitchen.servedBy'] = by;
    }

    /*
     * Cash on delivery is paid once delivered (revenue counts paid orders only).
     * The owner can switch this off and mark payments by hand instead.
     */
    const collectsCash =
      order.paymentMethod === PAYMENT_METHOD.COD &&
      order.paymentStatus === PAYMENT_STATUS.PENDING &&
      [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED].includes(nextStatus) &&
      Boolean(settingsService.get('codPaidOnDelivery'));
    if (collectsCash) {
      set.paymentStatus = PAYMENT_STATUS.PAID;
      timeline.push({ status: nextStatus, at: now, note: 'Cash collected on delivery' });
    }

    /*
     * Conditional on the status we read.
     *
     * Two kitchen screens, or a cook and a manager, can tap the same ticket in
     * the same second. A read-modify-save would let both "win" and write the
     * timeline twice; matching on the old status means exactly one update lands
     * and the other is told plainly that the order has already moved.
     */
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status },
      { $set: set, $push: { timeline: { $each: timeline } } },
      { new: true },
    );

    if (!updated) {
      throw ApiError.conflict('Someone else just updated this order. Refresh to see where it is now.', {
        code: 'ORDER_CHANGED',
      });
    }

    /*
     * Cancelling returns the goods to stock; nothing else does.
     *
     * After the write, and through the latch rather than releaseStock directly:
     * an order whose reservation already expired has had its stock credited
     * once, and a second credit here would conjure inventory out of nothing.
     */
    if (nextStatus === ORDER_STATUS.CANCELLED) await releaseOrderStock(updated);

    realtime.orderChanged(updated, 'status');
    realtime.notificationsChanged();

    logger.info('Order status changed', { orderNumber, to: nextStatus, by: actorId });
    return updated.toObject();
  },

  /**
   * Record a payment by hand — cash collected by a rider, a bank transfer
   * matched against the statement, a till tab settled from the back office.
   *
   * The missing half of cash on delivery and bank transfer. Gateways confirm
   * themselves through their callback; these two have nobody to call back, so
   * without this a paid order stayed "unpaid" forever and never reached a
   * revenue report.
   *
   * A verified bank transfer that was still waiting (`pending` order) is
   * confirmed in the same step — verifying the money is the go-ahead to cook.
   *
   * @param {object} [options]
   * @param {string} [options.paymentMethod] Required only when the order has none
   *   yet (a till ticket fired before payment).
   */
  async markPaid(orderNumber, { paymentMethod, reference, note } = {}, actor = null) {
    const order = await Order.findOne({ orderNumber: String(orderNumber).toUpperCase() });
    if (!order) throw ApiError.notFound('Order');

    if (order.status === ORDER_STATUS.CANCELLED) {
      throw ApiError.badRequest('A cancelled order cannot be marked paid.');
    }
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      throw ApiError.conflict('This order is already paid.');
    }
    if (![PAYMENT_STATUS.PENDING, PAYMENT_STATUS.AWAITING_VERIFICATION].includes(order.paymentStatus)) {
      throw ApiError.badRequest(`A payment that is "${order.paymentStatus}" cannot be marked paid here.`);
    }

    const method = order.paymentMethod ?? paymentMethod;
    if (!method) throw ApiError.badRequest('Choose how this order was paid.');

    const now = new Date();
    const set = {
      paymentStatus: PAYMENT_STATUS.PAID,
      paymentMethod: method,
      reservationExpiresAt: null,
      ...(reference && { paymentReference: reference }),
    };
    const timeline = [
      {
        status: order.status,
        at: now,
        note: note || `Payment recorded by ${actor?.fullName ?? 'staff'}`,
      },
    ];

    if (order.status === ORDER_STATUS.PENDING) {
      set.status = ORDER_STATUS.CONFIRMED;
      if (firesOnConfirm(order)) {
        await assignTicket(order);
        Object.assign(set, kitchenFields(order));
      }
      timeline.push({ status: ORDER_STATUS.CONFIRMED, at: now, note: 'Confirmed — payment verified' });
    }

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: order.paymentStatus },
      { $set: set, $push: { timeline: { $each: timeline } } },
      { new: true },
    );
    if (!updated) {
      throw ApiError.conflict('This payment was just updated by someone else. Refresh and try again.');
    }

    realtime.orderChanged(updated, 'payment');
    realtime.notificationsChanged();
    logger.info('Payment recorded by hand', { orderNumber: updated.orderNumber, by: actor?.id });

    return updated.toObject();
  },

  /**
   * Customer-initiated cancellation, allowed only in early states.
   *
   * The order number alone allows tracking but not cancelling — it is printed
   * on receipts and shared with riders. An account's order can be cancelled
   * only by that account, signed in; a guest order also needs the phone number
   * it was placed with.
   *
   * @param {object}  [verification]
   * @param {string}  [verification.phone] Supplied by a guest cancelling.
   */
  async cancelByCustomer(orderNumber, userId, { phone } = {}) {
    const order = await Order.findOne({ orderNumber: String(orderNumber).toUpperCase() });
    if (!order) throw ApiError.notFound('Order');

    /*
     * One message for every failed check, and deliberately vague.
     *
     * "That phone number does not match" tells someone probing with a stolen
     * order number that they have the right order and only need the number;
     * "no such order" versus "wrong details" tells them which order numbers are
     * real. Neither is worth the marginal clarity for the rare legitimate user
     * who mistypes their own phone number — and the guidance to sign in or use
     * the phone from the confirmation covers that case honestly.
     */
    const refuse = () =>
      ApiError.forbidden(
        'We could not verify that this order is yours. Sign in with the account that placed it, ' +
          'or enter the mobile number from your order confirmation.',
      );

    if (order.customer) {
      // Placed while signed in: only that account may cancel it.
      if (!userId || String(order.customer) !== String(userId)) throw refuse();
    } else {
      // Guest order: the phone it was placed with is the proof.
      const supplied = normalisePhone(phone);
      const expected = normalisePhone(order.customerPhone);
      if (!supplied || !expected || supplied !== expected) throw refuse();
    }

    if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
      throw ApiError.badRequest(
        'This order is already being prepared and can no longer be cancelled online. Please call us.',
      );
    }

    return this.transition(orderNumber, ORDER_STATUS.CANCELLED, {
      note: 'Cancelled by customer',
      actorId: userId,
    });
  },

  /**
   * Apply a verified gateway result.
   * Called only after the provider has confirmed the callback's signature —
   * this function trusts its input, so its callers must not.
   */
  async applyPaymentResult({ orderNumber, isPaid, reference, amount, message }) {
    const order = await Order.findOne({ orderNumber });
    if (!order) throw ApiError.notFound('Order');

    // Idempotency: gateways retry callbacks, and a customer can refresh the
    // return URL. Re-applying a success must not double-confirm the order.
    if (order.paymentStatus === PAYMENT_STATUS.PAID) return order.toObject();

    /*
     * A cancelled order's stock is already back on the shelf.
     *
     * A customer can abandon a payment, have the reservation expire, and then
     * complete it on a stale gateway tab twenty minutes later — or the gateway
     * can retry a slow callback after the sweep has run. Confirming here would
     * re-open an order whose items have been resold, promising food that no
     * longer exists.
     *
     * Held for a human instead of being silently confirmed or silently
     * discarded: real money may have moved, so somebody has to refund it or
     * re-place the order, and neither decision belongs to this function.
     */
    if (isPaid && order.stockReleased) {
      logger.error('Payment arrived for an order whose stock was already released', {
        orderNumber,
        status: order.status,
        amount,
      });
      order.paymentStatus = PAYMENT_STATUS.AWAITING_VERIFICATION;
      order.paymentReference = reference ?? order.paymentReference;
      order.timeline.push({
        status: order.status,
        at: new Date(),
        note: 'Payment received after the reservation expired — needs manual review',
      });
      await order.save();
      return order.toObject();
    }

    if (isPaid) {
      // Amount check: a signature proves the message came from the gateway, not
      // that it is for the right sum. Mismatches are held for a human.
      if (amount != null && Math.abs(Number(amount) - order.total) > 1) {
        logger.error('Payment amount mismatch', { orderNumber, expected: order.total, received: amount });
        order.paymentStatus = PAYMENT_STATUS.AWAITING_VERIFICATION;
        // The sum is wrong but the customer has paid something and a human is
        // now involved, so the stock must stay held rather than be swept away
        // underneath them.
        order.reservationExpiresAt = null;
        order.timeline.push({
          status: order.status,
          at: new Date(),
          note: `Amount mismatch: expected ${order.total}, received ${amount}`,
        });
        await order.save();
        return order.toObject();
      }

      order.paymentStatus = PAYMENT_STATUS.PAID;
      order.paymentReference = reference ?? order.paymentReference;
      order.status = ORDER_STATUS.CONFIRMED;
      // Paid: the goods are the customer's. Clearing the deadline is what takes
      // this order out of the sweeper's reach for good.
      order.reservationExpiresAt = null;
      order.timeline.push({ status: ORDER_STATUS.CONFIRMED, at: new Date(), note: 'Payment received' });
      if (firesOnConfirm(order)) await assignTicket(order);
      await order.save();
      realtime.orderChanged(order, 'payment');
      realtime.notificationsChanged();
      return order.toObject();
    }

    /*
     * A declined payment releases the stock now, rather than waiting out the
     * reservation window. The gateway has told us this attempt is over, so there
     * is nothing left to wait for, and the item should be back on sale for the
     * next customer immediately.
     *
     * Via releaseOrderStock, so a decline arriving twice — gateways do retry —
     * credits the stock exactly once.
     */
    order.paymentStatus = PAYMENT_STATUS.FAILED;
    order.reservationExpiresAt = null;
    order.timeline.push({ status: order.status, at: new Date(), note: message || 'Payment failed' });

    if (order.status === ORDER_STATUS.PENDING) {
      order.status = ORDER_STATUS.CANCELLED;
      order.timeline.push({
        status: ORDER_STATUS.CANCELLED,
        at: new Date(),
        note: 'Cancelled — payment did not go through',
      });
    }

    await order.save();
    await releaseOrderStock(order);
    realtime.orderChanged(order, 'payment');

    return order.toObject();
  },

  /** Exposed for the scheduler and the standalone cron script. */
  expireAbandonedReservations,
};

export { PAYMENT_METHOD };
export default orderService;
