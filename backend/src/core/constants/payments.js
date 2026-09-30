/**
 * Payment constants.
 * ---------------------------------------------------------------------------
 * Methods, statuses and the Pakistani bank list used by the bank-transfer flow.
 */

export const PAYMENT_METHOD = Object.freeze({
  COD: 'cod',
  JAZZCASH: 'jazzcash',
  EASYPAISA: 'easypaisa',
  BANK_TRANSFER: 'bank_transfer',
  CARD: 'card',

  /**
   * Counter cash — POS only.
   *
   * Deliberately not the same as `cod`: "cash on delivery" is money a rider
   * collects at a door and settles later, while this is money already in the
   * drawer. Reusing `cod` here would make every walk-in appear as a pending
   * delivery collection in the payment reports.
   *
   * Has no entry in the payment provider registry, so it can never appear in
   * the website checkout — `availableMethods()` iterates providers, not this
   * enum.
   */
  CASH: 'cash',
});

export const PAYMENT_METHOD_VALUES = Object.freeze(Object.values(PAYMENT_METHOD));

/**
 * Payment lifecycle.
 *
 * AWAITING_VERIFICATION is distinct from pending on purpose: Pending means the
 * gateway hasn't answered yet, while AWAITING_VERIFICATION means money may well
 * have moved but a human must confirm it (bank transfer). Collapsing the two
 * would either release goods against unverified funds or leave real payments
 * looking unpaid.
 */
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  AWAITING_VERIFICATION: 'awaiting_verification',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

/** Methods that settle instantly at the point of sale/delivery. */
export const OFFLINE_METHODS = Object.freeze([PAYMENT_METHOD.COD, PAYMENT_METHOD.BANK_TRANSFER]);

/**
 * Banks offered for the bank-transfer flow, matching the reference design.
 * `code` is stable and stored on the payment; `name` is display-only, so
 * rebranding a bank never orphans historical records.
 */
export const PAKISTANI_BANKS = Object.freeze([
  { code: 'ABL', name: 'Allied Bank' },
  { code: 'MEZN', name: 'Meezan Bank' },
  { code: 'HBL', name: 'Habib Bank Limited (HBL)' },
  { code: 'MCB', name: 'MCB Bank' },
  { code: 'ALFH', name: 'Bank Alfalah' },
  { code: 'FYSL', name: 'Faysal Bank' },
  { code: 'SCB', name: 'Standard Chartered Bank' },
  { code: 'UBL', name: 'United Bank Limited (UBL)' },
  { code: 'SNBL', name: 'Soneri Bank' },
  { code: 'DIBP', name: 'Dubai Islamic Bank Pakistan' },
  { code: 'BOK', name: 'Bank of Khyber' },
  { code: 'AKBL', name: 'Askari Bank' },
  { code: 'SAMBA', name: 'Samba Bank' },
  { code: 'BOP', name: 'Bank of Punjab' },
  { code: 'NBP', name: 'National Bank of Pakistan' },
  { code: 'JS', name: 'JS Bank' },
]);

/** Order lifecycle, per the reference design's timeline. */
export const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY: 'ready',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

/**
 * Permitted status transitions.
 *
 * A whitelist, not a free-for-all: without it an order can jump from `pending`
 * straight to `delivered`, skipping payment capture and stock deduction. Every
 * transition the business actually performs is listed; anything else is a bug
 * and is rejected.
 */
export const ORDER_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY]: [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.COMPLETED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.COMPLETED, ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.COMPLETED]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REFUNDED]: [],
});

/**
 * How the customer receives the order.
 *
 * `delivery` is every website order. The till chooses between the other two —
 * and the choice matters downstream: the kitchen plates dine-in and bags
 * take-away, and only these two appear on the counter pickup board.
 */
export const ORDER_TYPE = Object.freeze({
  DINE_IN: 'dine_in',
  TAKE_AWAY: 'take_away',
  DELIVERY: 'delivery',
});

export const ORDER_TYPE_VALUES = Object.freeze(Object.values(ORDER_TYPE));

/** Statuses the Kitchen Display treats as live work. */
export const KITCHEN_ACTIVE = Object.freeze([
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
]);

/** Statuses a customer may cancel from themselves. */
export const CUSTOMER_CANCELLABLE = Object.freeze([ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED]);
