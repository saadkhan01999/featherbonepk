/**
 * Cashier shift — one session at one till, from opening float to final count.
 * ---------------------------------------------------------------------------
 * Why this exists: without a shift, cash sales cannot be reconciled. The drawer
 * holds notes at the end of the day and there is nothing to compare them
 * against, so a shortfall is indistinguishable from a miscount and neither is
 * attributable to anyone.
 *
 * A shift ties every sale to a person, a till and a window of time, and the
 * closing count is checked against what the system says should be there.
 */
import mongoose from 'mongoose';

export const SHIFT_STATUS = Object.freeze({ OPEN: 'open', CLOSED: 'closed' });

/** Money into or out of the drawer that is not a sale. */
export const MOVEMENT_TYPES = Object.freeze(['pay_in', 'pay_out']);

const movementSchema = new mongoose.Schema(
  {
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    amount: { type: Number, required: true, min: 1 },
    /** Required — an unexplained movement is indistinguishable from theft. */
    reason: { type: String, required: true, trim: true, maxlength: 200 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const shiftSchema = new mongoose.Schema(
  {
    terminalId: { type: String, required: true, index: true },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Snapshotted so a closed shift still reads correctly if the account changes. */
    cashierName: { type: String, required: true },

    /** Notes in the drawer at the start. The baseline for everything after. */
    openingFloat: { type: Number, required: true, min: 0 },
    openedAt: { type: Date, default: Date.now },

    movements: { type: [movementSchema], default: [] },

    // --- Set at close --------------------------------------------------------
    closedAt: Date,
    /** What the cashier actually counted. */
    countedCash: { type: Number, min: 0 },
    /** What the system says should be there. Stored, not recomputed on read —
     *  a historical shift must not change when an old sale is corrected. */
    expectedCash: { type: Number, min: 0 },
    /**
     * counted − expected. Negative is short, positive is over.
     * Recorded, never corrected: silently adjusting the figure to zero would
     * destroy the only signal that something went wrong.
     */
    variance: Number,
    closingNote: { type: String, trim: true, maxlength: 300 },

    /** Sales totals frozen at close, so the report never re-queries. */
    summary: {
      salesCount: { type: Number, default: 0 },
      grossRevenue: { type: Number, default: 0 },
      cashRevenue: { type: Number, default: 0 },
      nonCashRevenue: { type: Number, default: 0 },
    },

    status: { type: String, enum: Object.values(SHIFT_STATUS), default: SHIFT_STATUS.OPEN, index: true },
  },
  { timestamps: true },
);

/**
 * One open shift per terminal.
 *
 * `partialFilterExpression` limits the uniqueness to open shifts, so a till can
 * accumulate any number of closed shifts over time while never having two live
 * at once. Two cashiers sharing one open drawer makes the count meaningless.
 */
shiftSchema.index(
  { terminalId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: SHIFT_STATUS.OPEN } },
);

shiftSchema.index({ cashier: 1, openedAt: -1 });

export const Shift = mongoose.model('Shift', shiftSchema);
export default Shift;
