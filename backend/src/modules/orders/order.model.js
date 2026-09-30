/**
 * Order — a completed or in-flight sale from either channel.
 * ---------------------------------------------------------------------------
 * One model for online orders and POS sales, distinguished by `channel`.
 * Separate collections would make every revenue query a union of two shapes,
 * and the two would inevitably drift apart.
 *
 * Line items are snapshots, not references. A product renamed or re-priced next
 * month must not retroactively rewrite what a customer actually bought and paid.
 */
import mongoose from 'mongoose';

import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD_VALUES,
  ORDER_TYPE_VALUES,
} from '../../core/constants/payments.js';

/**
 * Kitchen progress for one ticket.
 *
 * Timestamps, not a second status. The order's own `status` already says where
 * it is (confirmed → preparing → ready → completed); these record WHEN each
 * step happened and who did it, which is what the Kitchen Display's timers and
 * any "how long do tickets take" question actually need. A parallel kitchen
 * status field would be a second source of truth for the same fact.
 */
/** One station's share of a ticket: its own accept/done, independent of the others. */
const stationWorkSchema = new mongoose.Schema(
  {
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
    name: { type: String, required: true },
    color: { type: String, default: null },
    firedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: String, default: null },
    readyAt: { type: Date, default: null },
    readyBy: { type: String, default: null },
  },
  { _id: false },
);

const kitchenSchema = new mongoose.Schema(
  {
    /** When it reached the kitchen. Null for a ticket never fired. */
    firedAt: { type: Date, default: null },
    /** Who forwarded a website order from the back office. */
    forwardedBy: { type: String, default: null },
    /** The stations preparing this order. The order is ready when all of them are. */
    stations: { type: [stationWorkSchema], default: undefined },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: String, default: null },
    readyAt: { type: Date, default: null },
    readyBy: { type: String, default: null },
    /** Handed over — collected, served to the table, or given to the rider. */
    servedAt: { type: Date, default: null },
    servedBy: { type: String, default: null },
  },
  { _id: false },
);

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    // Snapshotted so history survives catalogue edits.
    name: { type: String, required: true },
    unit: String,
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    /** Where this line is prepared. Null until the order reaches the kitchen, or when it needs no preparing. */
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', default: null },
    stationName: { type: String, default: null },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },

    /** Which side of the business took the money. Drives channel reporting. */
    channel: { type: String, enum: ['online', 'pos'], required: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    customerName: { type: String, default: 'Walk-in Customer' },
    customerPhone: String,

    items: { type: [lineSchema], required: true },

    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },

    /**
     * Snapshot of the tax rate actually applied.
     * Re-deriving it later from current settings would misreport every
     * historical order the moment the GST rate changes.
     */
    taxRate: { type: Number, default: 0 },

    /**
     * How it was paid.
     *
     * Optional in exactly one case: a till ticket sent to the kitchen before
     * payment (dine-in, "pay at the end"). Nobody knows yet whether the table
     * will pay cash or card, and writing a guess would put a fictional method
     * into the payment reports. It is set the moment the ticket is paid.
     */
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHOD_VALUES,
      required: [
        function paymentMethodRequired() {
          return !(this.channel === 'pos' && this.paymentStatus === PAYMENT_STATUS.PENDING);
        },
        'Payment method is required',
      ],
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    paymentReference: String,

    status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING, index: true },

    /**
     * How the customer receives it. Website orders are deliveries; the till
     * chooses dine-in or take-away. Absent on orders written before this field
     * existed — read as delivery (online) or take-away (till).
     */
    orderType: { type: String, enum: [...ORDER_TYPE_VALUES, null], default: null },

    /** Table label for dine-in — free text ("T4", "Terrace 2"). */
    tableNumber: { type: String, trim: true, maxlength: 20 },

    /**
     * The short number the kitchen and the pickup board call out — "#27".
     *
     * A daily sequence, deliberately different from `orderNumber`. The order
     * number is long and random because it is a public key to the tracking
     * page; nobody can shout "FB-20260925-X7K2QP" across a kitchen. This one is
     * short and guessable, which is fine because it opens nothing — it is a
     * name for a plate, not a credential. Issued by an atomic counter so two
     * tills firing at the same instant cannot share one.
     */
    ticketNumber: { type: Number, default: null },
    /** The business day (Asia/Karachi) the ticket number belongs to. */
    ticketDate: { type: String, default: null },

    /** Instructions for the cooks — "no onions", "extra crispy". */
    kitchenNote: { type: String, trim: true, maxlength: 300 },

    kitchen: { type: kitchenSchema, default: () => ({}) },

    /**
     * When this order's stock stops being held.
     *
     * Set only for online orders that are waiting on a payment gateway. Stock is
     * decremented the moment an order is placed — which is correct, because two
     * people must not both buy the last chicken — but a customer who opens the
     * wallet page and closes the tab never comes back to release it. Without a
     * deadline that item is out of stock permanently, and nothing in the system
     * ever notices.
     *
     * A timestamp in the database, not a timer in a process. A `setTimeout` is
     * lost on the next deploy, which is precisely when it is most likely to be
     * needed, and it exists in only one replica. Written down here, the deadline
     * survives restarts and any instance can act on it.
     *
     * Null once the order is settled — see order.service.js.
     */
    reservationExpiresAt: { type: Date, default: null, index: true },

    /**
     * Has this order's stock already been returned to the shelf?
     *
     * The idempotency latch. Stock can be given back by three different paths —
     * the customer cancels, the back office cancels, or the reservation expires
     * — and two of them racing would credit the same items twice, inventing
     * stock that does not exist. Every path flips this flag with a conditional
     * update first and only restores if it was the one that flipped it.
     *
     * Absent on every order written before this field existed, which reads as
     * `false` and is the correct answer for them: their stock has not been
     * restored by this mechanism.
     */
    stockReleased: { type: Boolean, default: false },

    deliveryAddress: { type: mongoose.Schema.Types.Mixed },

    /** Append-only audit of status changes. */
    timeline: {
      type: [{ status: String, at: Date, note: String, _id: false }],
      default: [],
    },

    placedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // --- POS-only fields (null on website orders) --------------------------
    /**
     * Which counter this sale belongs to.
     *
     * Copied from the terminal at the point of sale rather than looked up
     * later: a till can be reassigned to another store, and last month's
     * takings must not move with it.
     */
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true },

    /** Which till rang this up, for per-terminal reconciliation. */
    terminalId: { type: String, index: true },

    /**
     * The cashier shift this sale belongs to.
     * Required in practice for POS sales — see pos.service. A sale with no
     * shift cannot be reconciled against a drawer count, which defeats the
     * purpose of counting.
     */
    shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', index: true },

    /**
     * Idempotency key, generated by the till before it sends the sale.
     *
     * A cashier who taps "Complete Sale" twice, or a request retried after a
     * flaky connection, must not create two sales and decrement stock twice.
     * `sparse` so the thousands of website orders that have no saleRef don't
     * collide with each other on the unique index.
     */
    saleRef: { type: String, unique: true, sparse: true },

    /** Cash tendered, so the drawer can be reconciled at close of shift. */
    tendered: { type: Number, min: 0 },
    changeDue: { type: Number, min: 0 },
  },
  { timestamps: true },
);

/*
 * Which orders contain a given product.
 *
 * Added for the catalogue's delete guard, which asks "does any order reference
 * this?" before choosing between archiving a product and removing it. A
 * multikey index over the line items answers that from the index alone;
 * without it the check is a full collection scan on every delete, and it gets
 * slower for the rest of the shop's life.
 */
orderSchema.index({ 'items.product': 1 });

// Revenue queries always filter by date and status together.
orderSchema.index({ createdAt: -1, status: 1 });
orderSchema.index({ channel: 1, createdAt: -1 });

/*
 * Back-office search.
 *
 * The Orders screen searches by order number, customer name and phone. Without
 * these, each search is a full collection scan — measurable at a thousand orders
 * and painful against a hosted database, where every scanned document crosses
 * the internet. A ten-second wait on a search box is what this fixes.
 *
 * Honest limit: a contains search (`/ali/i`) still cannot use an index, because
 * a leading wildcard has no prefix to seek on. These indexes serve the common
 * cases — someone pasting a full order number, or typing a phone from the start
 * — and the name search remains a scan. Making that one fast would mean a text
 * index, which matches whole words only and would stop "ali" finding "Alina";
 * that is a worse trade for a shop looking up a customer.
 */
orderSchema.index({ customerPhone: 1 });
orderSchema.index({ customerName: 1 });

/*
 * The sweeper's query: "which held reservations are past their deadline?"
 *
 * It runs every minute forever, so it must not be a collection scan — on a
 * year-old orders collection that is the most frequently repeated expensive
 * query in the system. Ordered with the two equality fields first and the range
 * last, which is the shape an index can actually seek on.
 */
orderSchema.index({ paymentStatus: 1, stockReleased: 1, reservationExpiresAt: 1 });

/*
 * The Kitchen Display's query: live tickets, oldest first. It runs every time a
 * ticket moves, on every kitchen screen, so it must never scan the collection.
 */
orderSchema.index({ status: 1, 'kitchen.firedAt': 1 });
/** One station's screen, and the back office's "waiting to be forwarded" list. */
orderSchema.index({ 'kitchen.stations.station': 1, status: 1 });
orderSchema.index({ channel: 1, status: 1, 'kitchen.firedAt': 1 });
/** Per-till reports and the till's own open-ticket list. */
orderSchema.index({ terminalId: 1, createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
export default Order;
