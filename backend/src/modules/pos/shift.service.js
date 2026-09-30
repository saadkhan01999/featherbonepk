/**
 * Shift and cash-drawer management.
 * ---------------------------------------------------------------------------
 * The arithmetic that matters:
 *
 *   expected = opening float
 *            + cash taken in sales
 *            + cash paid in
 *            − cash paid out
 *
 *   variance = counted − expected
 *
 * Card and wallet sales are excluded on purpose: that money never enters the
 * drawer, and counting it would make every shift look thousands of rupees
 * short.
 *
 * The variance is recorded, never corrected. A system that quietly adjusts the
 * books to match the count has thrown away the only evidence that anything went
 * wrong.
 */
import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { Order } from '../orders/order.model.js';
import { PAYMENT_METHOD, PAYMENT_STATUS, ORDER_STATUS } from '../../core/constants/payments.js';
import { Shift, SHIFT_STATUS } from './shift.model.js';

/**
 * Sales totals for one shift, split by whether the money hit the drawer.
 *
 * Matched on payment, not on status: with the kitchen on, a paid sale can
 * still be "preparing" while its cash is already in the drawer. Matching on
 * `completed` would leave that cash out of the expected figure and report a
 * surplus that is not there.
 */
async function salesTotals(shift) {
  const [totals] = await Order.aggregate([
    {
      $match: {
        channel: 'pos',
        shift: shift._id,
        paymentStatus: PAYMENT_STATUS.PAID,
        status: { $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED] },
      },
    },
    {
      $group: {
        _id: null,
        salesCount: { $sum: 1 },
        grossRevenue: { $sum: '$total' },
        cashRevenue: {
          $sum: { $cond: [{ $eq: ['$paymentMethod', PAYMENT_METHOD.CASH] }, '$total', 0] },
        },
      },
    },
  ]);

  const gross = totals?.grossRevenue ?? 0;
  const cash = totals?.cashRevenue ?? 0;

  return {
    salesCount: totals?.salesCount ?? 0,
    grossRevenue: gross,
    cashRevenue: cash,
    nonCashRevenue: gross - cash,
  };
}

/** Net effect of manual pay-ins and pay-outs on the drawer. */
function movementTotals(shift) {
  let paidIn = 0;
  let paidOut = 0;
  for (const movement of shift.movements ?? []) {
    if (movement.type === 'pay_in') paidIn += movement.amount;
    else paidOut += movement.amount;
  }
  return { paidIn, paidOut };
}

function toPublic(shift, extras = {}) {
  return {
    id: String(shift._id),
    terminalId: shift.terminalId,
    cashierName: shift.cashierName,
    openingFloat: shift.openingFloat,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt ?? null,
    status: shift.status,
    movements: (shift.movements ?? []).map((m) => ({
      type: m.type,
      amount: m.amount,
      reason: m.reason,
      at: m.at,
    })),
    countedCash: shift.countedCash ?? null,
    expectedCash: shift.expectedCash ?? null,
    variance: shift.variance ?? null,
    closingNote: shift.closingNote ?? null,
    summary: shift.summary,
    ...extras,
  };
}

export const shiftService = {
  /** The open shift on this terminal, or null. */
  async findOpen(terminalId) {
    return Shift.findOne({ terminalId, status: SHIFT_STATUS.OPEN });
  },

  /**
   * The open shift, or a clear refusal.
   * Called before every sale — a sale outside a shift cannot be reconciled, so
   * it must not be possible to make one.
   */
  async requireOpen(terminalId) {
    const shift = await this.findOpen(terminalId);
    if (!shift) {
      throw ApiError.badRequest(
        'No shift is open on this terminal. Open one with the cash in the drawer before selling.',
        { code: 'SHIFT_REQUIRED' },
      );
    }
    return shift;
  },

  /** Open a shift with the cash currently in the drawer. */
  async open({ openingFloat }, pos) {
    const existing = await this.findOpen(pos.terminalId);
    if (existing) {
      throw ApiError.conflict(
        `A shift is already open on ${pos.terminalId} (${existing.cashierName}). Close it first.`,
      );
    }

    try {
      const shift = await Shift.create({
        terminalId: pos.terminalId,
        cashier: pos.cashierId,
        cashierName: pos.cashierName,
        openingFloat,
      });

      logger.info('Shift opened', {
        shift: String(shift._id),
        terminal: pos.terminalId,
        cashier: pos.cashierName,
        float: openingFloat,
      });
      return toPublic(shift);
    } catch (error) {
      // Two tills racing to open. The partial unique index is the real guard;
      // this turns its raw error into something a cashier can act on.
      if (error?.code === 11000) {
        throw ApiError.conflict('A shift was just opened on this terminal by someone else.');
      }
      throw error;
    }
  },

  /** Current shift plus live figures — what the till header shows. */
  async current(pos) {
    const shift = await this.findOpen(pos.terminalId);
    if (!shift) return null;

    const sales = await salesTotals(shift);
    const { paidIn, paidOut } = movementTotals(shift);

    return toPublic(shift, {
      // Live, not stored — an open shift's expected cash changes with every sale.
      liveSummary: sales,
      paidIn,
      paidOut,
      expectedCash: shift.openingFloat + sales.cashRevenue + paidIn - paidOut,
    });
  },

  /** Record cash in or out of the drawer mid-shift. */
  async addMovement({ type, amount, reason }, pos) {
    const shift = await this.requireOpen(pos.terminalId);

    if (type === 'pay_out') {
      const sales = await salesTotals(shift);
      const { paidIn, paidOut } = movementTotals(shift);
      const available = shift.openingFloat + sales.cashRevenue + paidIn - paidOut;

      // Taking out more than the drawer holds is always a mistake, and letting
      // it through would produce a negative expected balance at close.
      if (amount > available) {
        throw ApiError.badRequest(`Only Rs ${available.toLocaleString('en-PK')} is in the drawer.`);
      }
    }

    shift.movements.push({ type, amount, reason, by: pos.cashierId });
    await shift.save();

    logger.info('Cash movement', { shift: String(shift._id), type, amount, by: pos.cashierName });
    return this.current(pos);
  },

  /** Close the shift against a physical count. */
  async close({ countedCash, note }, pos) {
    const shift = await this.requireOpen(pos.terminalId);

    const sales = await salesTotals(shift);
    const { paidIn, paidOut } = movementTotals(shift);
    const expected = shift.openingFloat + sales.cashRevenue + paidIn - paidOut;

    shift.closedAt = new Date();
    shift.countedCash = countedCash;
    shift.expectedCash = expected;
    shift.variance = countedCash - expected;
    shift.closingNote = note;
    shift.summary = sales;
    shift.status = SHIFT_STATUS.CLOSED;
    await shift.save();

    // A discrepancy is worth a louder log line than a clean close.
    const level = shift.variance === 0 ? 'info' : 'warn';
    logger[level]('Shift closed', {
      shift: String(shift._id),
      terminal: pos.terminalId,
      cashier: pos.cashierName,
      expected,
      counted: countedCash,
      variance: shift.variance,
    });

    return toPublic(shift, { paidIn, paidOut });
  },

  /** Past shifts on this terminal. */
  async history({ terminalId, limit = 20 }) {
    const shifts = await Shift.find({ terminalId, status: SHIFT_STATUS.CLOSED })
      .sort({ closedAt: -1 })
      .limit(limit)
      .lean();

    return shifts.map((shift) => ({
      id: String(shift._id),
      cashierName: shift.cashierName,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingFloat: shift.openingFloat,
      expectedCash: shift.expectedCash,
      countedCash: shift.countedCash,
      variance: shift.variance,
      summary: shift.summary,
      closingNote: shift.closingNote ?? null,
    }));
  },
};

export { SHIFT_STATUS };
export default shiftService;
