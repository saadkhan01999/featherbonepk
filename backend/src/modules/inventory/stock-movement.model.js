/**
 * Stock movement — one line in the inventory ledger.
 * ---------------------------------------------------------------------------
 * `Product.stock` says how many there are. This says how they got there: every
 * sale, every return to the shelf, every stock-take correction, with the date,
 * the balance it left, the order or reason behind it, and who did it.
 *
 * Without it an inventory report can only print today's number. With it, "why
 * do we have 3 chickens when the delivery was 20 this morning" has an answer
 * that does not depend on anyone's memory.
 *
 * Append-only, like the audit log. A ledger you can edit is not a ledger.
 *
 * Names are snapshotted (product, category, actor) so an entry still reads
 * correctly after a product is renamed, recategorised or deleted.
 */
import mongoose from 'mongoose';

export const MOVEMENT_TYPES = Object.freeze({
  /** Stock entered when the product was created. */
  OPENING: 'opening',
  /** Left the shelf on an order or a till sale. */
  SALE: 'sale',
  /** Came back: a cancelled order, an expired unpaid reservation, a void. */
  RETURN: 'return',
  /** A stock-take correction or delivery entered by staff. */
  ADJUSTMENT: 'adjustment',
});

export const MOVEMENT_TYPE_VALUES = Object.freeze(Object.values(MOVEMENT_TYPES));

const stockMovementSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    productName: { type: String, required: true },
    sku: { type: String, default: null },
    unit: { type: String, default: null },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    categoryName: { type: String, default: null },

    type: { type: String, enum: MOVEMENT_TYPE_VALUES, required: true, index: true },

    /** Signed change: −2 for two sold, +20 for a delivery. */
    quantity: { type: Number, required: true },
    /** Stock immediately after this movement, read back from the same atomic write. */
    balanceAfter: { type: Number, default: null },

    /** What caused it — an order number, or null for a manual adjustment. */
    reference: { type: String, default: null },
    channel: { type: String, enum: ['online', 'pos', null], default: null },
    terminalId: { type: String, default: null },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },

    /** Why, in words — required for adjustments, see inventory.service. */
    note: { type: String, trim: true, maxlength: 300, default: null },

    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The movements report: newest first, optionally narrowed by product or type.
stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ product: 1, createdAt: -1 });

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;
