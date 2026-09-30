/**
 * POS sales — and the till's side of the kitchen.
 * ---------------------------------------------------------------------------
 * Counter sales move stock, reach the reports and feed the kitchen.
 *
 * Rules:
 *
 * 1. The server prices the sale. The till sends product ids and quantities;
 *    every rupee is re-read from the database via the same `repriceLines` the
 *    website uses. A till is a machine on a shop floor that staff can reach —
 *    treating its totals as authoritative would make discounting a UI edit.
 *
 * 2. Sales are idempotent. The till generates a `saleRef` before sending. A
 *    double-tap, or a retry after the connection drops mid-request, returns
 *    the original sale rather than ringing it up twice.
 *
 * 3. Stock moves atomically. Same conditional decrement as online checkout, so
 *    a walk-in and a website customer racing for the last chicken cannot both
 *    win.
 *
 * Two ways a till order reaches the kitchen:
 *
 *   Pay now          `recordSale` — paid at the counter. With the kitchen on
 *                    (Settings → Kitchen Display) it is born CONFIRMED and
 *                    appears on the Kitchen Display; with it off, it is born
 *                    completed, exactly as before.
 *
 *   Send to kitchen  `fireOrder` — fired unpaid, for dine-in tables that pay
 *                    at the end. Stock is taken at once (the food is being
 *                    cooked); the money is taken later with `payOrder`.
 *
 * Status and payment are tracked separately, as they already are for cash on
 * delivery: an order can be served and unpaid (the table is still eating), or
 * paid and still cooking. Revenue counts paid orders only, so an open tab is
 * never counted as money the shop has.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { realtime } from '../../core/realtime/realtime.js';
import { Order } from '../orders/order.model.js';
import { UNITS } from '../catalog/product.model.js';
import {
  repriceLines,
  reserveStock,
  releaseStock,
  createOrderWithUniqueNumber,
  recordSaleMovements,
  assignTicket,
  kitchenRules,
  orderService,
} from '../orders/order.service.js';
import { pricingRules, posSettings } from '../settings/settings.service.js';
import { resolveRange } from '../reports/report.service.js';
import { terminalMenuScope } from './terminal.service.js';
import { shiftService } from './shift.service.js';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  ORDER_TYPE,
  KITCHEN_ACTIVE,
} from '../../core/constants/payments.js';

/**
 * Payment methods a physical till can take.
 * Deliberately not `availableMethods()` — bank transfer and cash-on-delivery
 * make no sense at a counter where the customer is standing in front of you.
 */
export const POS_PAYMENT_METHODS = Object.freeze([
  PAYMENT_METHOD.CASH,
  PAYMENT_METHOD.CARD,
  PAYMENT_METHOD.JAZZCASH,
  PAYMENT_METHOD.EASYPAISA,
]);

/** The two order types a counter takes. Delivery is a website thing. */
export const POS_ORDER_TYPES = Object.freeze([ORDER_TYPE.TAKE_AWAY, ORDER_TYPE.DINE_IN]);

/** How far back "open tickets" look. A tab left open for days is not open, it is lost. */
const OPEN_TICKET_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Shape a stored order into the slip the terminal prints.
 * `cashierName` is passed in rather than stored: the order keeps `placedBy`
 * (an id), and denormalising the name onto every sale would go stale the moment
 * someone's record is corrected.
 */
function toSlip(order, cashierName) {
  return {
    id: String(order._id),
    invoiceNumber: order.orderNumber,
    ticketNumber: order.ticketNumber ?? null,
    orderType: order.orderType ?? ORDER_TYPE.TAKE_AWAY,
    tableNumber: order.tableNumber ?? null,
    kitchenNote: order.kitchenNote ?? null,
    status: order.status,
    paymentStatus: order.paymentStatus,
    at: order.createdAt,
    cashierName,
    terminalId: order.terminalId,
    customer: order.customerName,
    customerPhone: order.customerPhone ?? null,
    paymentMethod: order.paymentMethod ?? null,
    tendered: order.tendered ?? null,
    changeDue: order.changeDue ?? null,
    lines: order.items.map((item) => ({
      productId: String(item.product),
      name: item.name,
      unit: item.unit,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      // Presentation hints the slip needs. Derived here rather than on the
      // till so a reprinted slip renders identically to the original, even if
      // the unit definitions have since changed in code.
      isWeighed: UNITS[item.unit]?.isWeight ?? false,
      unitLabel: UNITS[item.unit]?.label ?? item.unit,
    })),
    totals: {
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      taxRate: order.taxRate,
      total: order.total,
    },
  };
}

/** A compact row for the till's "open tickets" strip. */
function toTicket(order) {
  return {
    id: String(order._id),
    invoiceNumber: order.orderNumber,
    ticketNumber: order.ticketNumber ?? null,
    orderType: order.orderType ?? ORDER_TYPE.TAKE_AWAY,
    tableNumber: order.tableNumber ?? null,
    customer: order.customerName,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod ?? null,
    total: order.total,
    itemCount: order.items.length,
    summary: order.items.map((i) => `${i.quantity}× ${i.name}`).join(', '),
    terminalId: order.terminalId,
    firedAt: order.kitchen?.firedAt ?? null,
    readyAt: order.kitchen?.readyAt ?? null,
    createdAt: order.createdAt,
  };
}

/**
 * May this till act on this order?
 *
 * The till that rang it up always may. Another till at the same counter may
 * too — a table fired at the front till is often settled at the one by the
 * door. A till at a different counter may not: the bakery does not close the
 * chicken counter's tabs.
 */
function assertSameCounter(order, pos) {
  if (order.channel !== 'pos') throw ApiError.notFound('Ticket');
  if (order.terminalId === pos.terminalId) return;
  const sameStore = order.store && pos.storeId && String(order.store) === String(pos.storeId);
  if (!sameStore) throw ApiError.forbidden('That ticket belongs to a different counter');
}

/** Cash tendered must cover the bill; returns the change. */
function cashChange(paymentMethod, tendered, total) {
  if (paymentMethod !== PAYMENT_METHOD.CASH || tendered === undefined || tendered === null) return undefined;
  if (tendered < total) {
    throw ApiError.badRequest(
      `Cash tendered (Rs ${tendered.toLocaleString('en-PK')}) is less than the total`,
    );
  }
  return tendered - total;
}

export const posService = {
  /**
   * Price a till basket without recording anything.
   * The terminal computes the same figures locally for instant feedback; this
   * is what the printed slip and the ledger actually use.
   *
   * @param {object} scope `{ store, menu }` — both from the POS TOKEN and the
   *   terminal record, never from the request body.
   */
  async quote({ items, discount = 0 }, { store = null, menu = null } = {}) {
    const lines = await repriceLines(items, { store, menu });
    const rules = pricingRules();

    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    // A discount can never exceed the goods value, or tax would be computed on
    // a negative amount and the sale would pay money out.
    const appliedDiscount = Math.min(Math.max(0, Math.round(discount)), subtotal);
    const taxable = subtotal - appliedDiscount;

    // Tax follows the discount. Taxing the pre-discount figure overcharges the
    // customer and overstates the GST owed.
    const tax = rules.taxInclusive ? 0 : Math.round(taxable * rules.taxRate);

    return {
      lines,
      subtotal,
      discount: appliedDiscount,
      tax,
      // Snapshotted so an old slip still reconciles after the owner changes the
      // GST rate in settings.
      taxRate: rules.taxRate,
      total: taxable + tax,
    };
  },

  /** The till's menu scope, for the routes that read the catalogue. */
  menuScope(pos) {
    return terminalMenuScope(pos.terminalId);
  },

  /**
   * The shared core of "pay now" and "send to kitchen": idempotency, pricing,
   * stock, the order write, the ledger and the broadcast.
   *
   * @param {object} sale  validated request body
   * @param {object} pos   `req.pos`
   * @param {object} mode  `{ paid: boolean, toKitchen: boolean, canDiscount: boolean }`
   * @returns {{ order: object, duplicate: boolean }}
   */
  async createTillOrder(sale, pos, { paid, toKitchen, canDiscount }) {
    const { saleRef, items, discount = 0, paymentMethod, tendered, customer } = sale;
    if (!saleRef) throw ApiError.badRequest('Missing sale reference');

    // --- Idempotency: has this exact sale already landed? ------------------
    // Checked before anything else, so a retry that arrives after the shift
    // closed, or after a permission change, still returns the original.
    const existing = await Order.findOne({ saleRef }).lean();
    if (existing) {
      logger.warn('Duplicate POS sale suppressed', { saleRef, orderNumber: existing.orderNumber });
      return { order: existing, duplicate: true };
    }

    /*
     * Discounting is its own grant.
     *
     * `pos.discount` sat in the permission matrix for a long time checking
     * nothing — an owner could untick it for a cashier and that cashier could
     * still knock any amount off any bill. It is checked here, at the only
     * place a discount becomes money.
     */
    if (discount > 0 && !canDiscount) {
      throw ApiError.forbidden('You do not have permission to give discounts. Ask a manager.', {
        code: 'DISCOUNT_NOT_ALLOWED',
      });
    }

    const orderType = POS_ORDER_TYPES.includes(sale.orderType)
      ? sale.orderType
      : (posSettings().defaultOrderType ?? ORDER_TYPE.TAKE_AWAY);

    const menu = await terminalMenuScope(pos.terminalId);
    const priced = await this.quote({ items, discount }, { store: pos.storeId, menu });

    let changeDue;
    if (paid) {
      if (!POS_PAYMENT_METHODS.includes(paymentMethod)) {
        throw ApiError.badRequest('That payment method is not available at the till');
      }
      // Cash must cover the bill. Anything else and the drawer will not balance.
      changeDue = cashChange(paymentMethod, tendered, priced.total);
    }

    /*
     * Shifts are optional.
     *
     * A sale attaches to a shift if one happens to be open, and proceeds
     * without one otherwise. Attribution does not depend on it: the cashier and
     * terminal come from the POS token and are stored on every sale regardless.
     */
    const shift = paid ? await shiftService.findOpen(pos.terminalId) : null;

    // --- Take the stock ----------------------------------------------------
    const taken = await reserveStock(priced.lines);

    const now = new Date();
    const status = toKitchen ? ORDER_STATUS.CONFIRMED : ORDER_STATUS.COMPLETED;
    const where = `at ${pos.terminalId}`;

    const document = {
      channel: 'pos',
      saleRef,
      terminalId: pos.terminalId,
      /*
       * The counter this sale belongs to, copied from the token rather than
       * looked up now. A till can be reassigned to another store later, and
       * this month's takings must not move with it.
       */
      store: pos.storeId ?? undefined,
      shift: shift?._id,
      placedBy: pos.cashierId,
      customerName: customer?.name?.trim() || 'Walk-in Customer',
      customerPhone: customer?.phone?.trim() || undefined,
      orderType,
      tableNumber: orderType === ORDER_TYPE.DINE_IN ? sale.tableNumber?.trim() || undefined : undefined,
      kitchenNote: sale.kitchenNote?.trim() || undefined,
      items: priced.lines,
      subtotal: priced.subtotal,
      discount: priced.discount,
      deliveryFee: 0,
      tax: priced.tax,
      taxRate: priced.taxRate,
      total: priced.total,
      paymentMethod: paid ? paymentMethod : undefined,
      paymentStatus: paid ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING,
      status,
      tendered: paid ? (tendered ?? undefined) : undefined,
      changeDue,
      timeline: [
        {
          status,
          at: now,
          note: toKitchen
            ? paid
              ? `Paid and sent to the kitchen ${where}`
              : `Sent to the kitchen ${where} — to be paid`
            : `Sold ${where}`,
        },
      ],
    };

    // The kitchen's short number, issued before the write so it is part of it.
    if (toKitchen) await assignTicket(document);

    let order;
    try {
      order = await createOrderWithUniqueNumber(document, { prefix: 'INV' });
    } catch (error) {
      // The goods are still on the shelf — the sale never completed. Without
      // this the stock would silently vanish.
      await releaseStock(taken);

      // A racing retry with the same saleRef trips the unique index. That is
      // the idempotency guard working, not a failure: return the winner.
      if (error?.code === 11000) {
        const winner = await Order.findOne({ saleRef }).lean();
        if (winner) return { order: winner, duplicate: true };
      }
      throw error;
    }

    await recordSaleMovements(order, taken, { id: pos.cashierId, fullName: pos.cashierName });
    realtime.orderChanged(order, 'created');
    if (toKitchen) realtime.notificationsChanged();

    logger.info(paid ? 'POS sale recorded' : 'POS ticket sent to the kitchen', {
      invoice: order.orderNumber,
      ticket: order.ticketNumber,
      total: order.total,
      terminal: pos.terminalId,
      cashier: pos.cashierName,
    });

    return { order: order.toObject(), duplicate: false };
  },

  /**
   * Record a completed, paid counter sale.
   * With the kitchen on, it also goes to the Kitchen Display.
   * @returns {{slip: object, duplicate: boolean}}
   */
  async recordSale(sale, pos, { canDiscount = true } = {}) {
    const kitchen = kitchenRules();
    const { order, duplicate } = await this.createTillOrder(sale, pos, {
      paid: true,
      toKitchen: kitchen.enabled && kitchen.autoFireOnPay,
      canDiscount,
    });
    return { slip: toSlip(order, pos.cashierName), duplicate };
  },

  /**
   * Send to kitchen, pay later — the dine-in table.
   * @returns {{slip: object, duplicate: boolean}} the kitchen ticket
   */
  async fireOrder(sale, pos, { canDiscount = true } = {}) {
    if (!kitchenRules().enabled) {
      throw ApiError.badRequest(
        'The Kitchen Display is switched off. Take payment instead, or turn it on in Settings → Kitchen Display.',
        { code: 'KITCHEN_DISABLED' },
      );
    }
    const { order, duplicate } = await this.createTillOrder(sale, pos, {
      paid: false,
      toKitchen: true,
      canDiscount,
    });
    return { slip: toSlip(order, pos.cashierName), duplicate };
  },

  /**
   * Settle an open ticket — the table asking for the bill.
   *
   * Conditional on it still being unpaid, so two tills settling the same table
   * at once cannot both take the money.
   */
  async payOrder(id, { paymentMethod, tendered }, pos) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid ticket');
    const order = await Order.findById(id).lean();
    if (!order) throw ApiError.notFound('Ticket');
    assertSameCounter(order, pos);

    if (order.status === ORDER_STATUS.CANCELLED) throw ApiError.badRequest('This ticket was cancelled');
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      // Already settled — hand back the slip rather than an error, the same
      // courtesy a retried sale gets.
      return { slip: toSlip(order, pos.cashierName), duplicate: true };
    }
    if (!POS_PAYMENT_METHODS.includes(paymentMethod)) {
      throw ApiError.badRequest('That payment method is not available at the till');
    }

    const changeDue = cashChange(paymentMethod, tendered, order.total);
    const shift = await shiftService.findOpen(pos.terminalId);

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: PAYMENT_STATUS.PENDING },
      {
        $set: {
          paymentStatus: PAYMENT_STATUS.PAID,
          paymentMethod,
          ...(tendered !== undefined && tendered !== null && { tendered }),
          ...(changeDue !== undefined && { changeDue }),
          ...(shift && { shift: shift._id }),
        },
        $push: {
          timeline: {
            status: order.status,
            at: new Date(),
            note: `Paid at ${pos.terminalId} (${paymentMethod})`,
          },
        },
      },
      { new: true },
    ).lean();

    if (!updated) throw ApiError.conflict('This ticket was just settled at another till.');

    realtime.orderChanged(updated, 'payment');
    logger.info('POS ticket paid', {
      invoice: updated.orderNumber,
      method: paymentMethod,
      by: pos.cashierName,
    });
    return { slip: toSlip(updated, pos.cashierName), duplicate: false };
  },

  /**
   * Hand a ready order over — collected at the counter, or served to the table.
   * READY → COMPLETED, through the same whitelisted transition as everything else.
   */
  async serveOrder(id, pos) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid ticket');
    const order = await Order.findById(id).select('orderNumber channel terminalId store status').lean();
    if (!order) throw ApiError.notFound('Ticket');
    assertSameCounter(order, pos);

    if (order.status !== ORDER_STATUS.READY) {
      throw ApiError.badRequest('Only an order the kitchen has marked Ready can be handed over.');
    }

    const updated = await orderService.transition(order.orderNumber, ORDER_STATUS.COMPLETED, {
      note: `Handed over at ${pos.terminalId}`,
      actorId: pos.cashierId,
      actorName: pos.cashierName,
    });
    return toTicket(updated);
  },

  /**
   * Void an unpaid ticket — ordered by mistake, or the table walked out.
   *
   * While the kitchen has not started it, the cashier who can sell can undo it.
   * Once cooking has begun, food has been used and it takes `order.cancel`,
   * which by default a manager holds.
   */
  async voidOrder(id, pos, { canCancel = false } = {}) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid ticket');
    const order = await Order.findById(id)
      .select('orderNumber channel terminalId store status paymentStatus')
      .lean();
    if (!order) throw ApiError.notFound('Ticket');
    assertSameCounter(order, pos);

    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      throw ApiError.badRequest(
        'A paid order cannot be voided at the till. Refunds are handled by a manager.',
      );
    }
    if (order.status !== ORDER_STATUS.CONFIRMED && !canCancel) {
      throw ApiError.forbidden('The kitchen has already started this order. A manager must cancel it.', {
        code: 'CANCEL_NOT_ALLOWED',
      });
    }

    const updated = await orderService.transition(order.orderNumber, ORDER_STATUS.CANCELLED, {
      note: `Voided at ${pos.terminalId} by ${pos.cashierName}`,
      actorId: pos.cashierId,
      actorName: pos.cashierName,
    });
    return toTicket(updated);
  },

  /**
   * This counter's live tickets: still in the kitchen, ready to hand over, or
   * served but not yet paid (an open tab).
   */
  async listOpenOrders(pos) {
    const since = new Date(Date.now() - OPEN_TICKET_WINDOW_MS);
    const where = pos.storeId
      ? { $or: [{ terminalId: pos.terminalId }, { store: new mongoose.Types.ObjectId(String(pos.storeId)) }] }
      : { terminalId: pos.terminalId };

    const orders = await Order.find({
      channel: 'pos',
      createdAt: { $gte: since },
      ...where,
      $and: [
        { status: { $ne: ORDER_STATUS.CANCELLED } },
        {
          $or: [{ status: { $in: KITCHEN_ACTIVE } }, { paymentStatus: PAYMENT_STATUS.PENDING }],
        },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();

    return orders.map(toTicket);
  },

  /** Recent sales for this terminal — the cashier's own history. */
  async listSales({ terminalId, cashierId, limit = 25, mine = false }) {
    const filter = { channel: 'pos' };
    if (terminalId) filter.terminalId = terminalId;
    if (mine && cashierId) filter.placedBy = cashierId;

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return orders.map((order) => ({
      id: String(order._id),
      invoiceNumber: order.orderNumber,
      ticketNumber: order.ticketNumber ?? null,
      at: order.createdAt,
      customer: order.customerName,
      itemCount: order.items.length,
      paymentMethod: order.paymentMethod ?? null,
      paymentStatus: order.paymentStatus,
      status: order.status,
      total: order.total,
    }));
  },

  /** One stored sale, re-shaped for reprinting. */
  async getSale(id, { terminalId, cashierName } = {}) {
    const order = await Order.findOne({ _id: id, channel: 'pos' }).lean();
    if (!order) throw ApiError.notFound('Sale');
    if (terminalId && order.terminalId !== terminalId) {
      throw ApiError.forbidden('That sale belongs to a different terminal');
    }
    return toSlip(order, cashierName);
  },

  /**
   * Today's takings for this terminal — what the cashier reconciles against
   * the drawer at close of shift.
   *
   * Paid, not "completed". A paid order still in the kitchen is money in the
   * drawer; an unpaid tab that has been served is not. Counting by status —
   * which is what this used to do — was right only while every till sale was
   * born completed.
   */
  async todaySummary({ terminalId, cashierId }) {
    // Midnight in Pakistan, not UTC — a UTC boundary falls at 05:00 local and
    // would split an evening's trade across two "days".
    const { from: since } = resolveRange({ preset: 'today' });

    const match = {
      channel: 'pos',
      createdAt: { $gte: since },
      status: { $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED] },
      paymentStatus: PAYMENT_STATUS.PAID,
    };
    if (terminalId) match.terminalId = terminalId;

    const [totals] = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          sales: { $sum: 1 },
          revenue: { $sum: '$total' },
          tax: { $sum: '$tax' },
          discount: { $sum: '$discount' },
        },
      },
    ]);

    const byMethod = await Order.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, amount: { $sum: '$total' } } },
      { $sort: { amount: -1 } },
    ]);

    const mine = cashierId ? await Order.countDocuments({ ...match, placedBy: cashierId }) : 0;

    // Open tabs: food out, money not yet in.
    const [openTabs] = await Order.aggregate([
      {
        $match: {
          channel: 'pos',
          createdAt: { $gte: since },
          ...(terminalId && { terminalId }),
          status: { $ne: ORDER_STATUS.CANCELLED },
          paymentStatus: PAYMENT_STATUS.PENDING,
        },
      },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$total' } } },
    ]);

    return {
      since,
      sales: totals?.sales ?? 0,
      revenue: totals?.revenue ?? 0,
      tax: totals?.tax ?? 0,
      discount: totals?.discount ?? 0,
      mySales: mine,
      openTabs: { count: openTabs?.count ?? 0, amount: openTabs?.amount ?? 0 },
      byMethod: byMethod.map((row) => ({ method: row._id, count: row.count, amount: row.amount })),
    };
  },
};

export default posService;
