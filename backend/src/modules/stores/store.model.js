/**
 * Store — one outlet or counter of the business.
 * ---------------------------------------------------------------------------
 * The scoping spine of the system.
 *
 * A bakery counter and a chicken counter share one back office but sell
 * different things, take their own money and are judged on their own numbers.
 * The store is what ties those together:
 *
 *   Store ──< Terminal ──< Sale
 *     └────< Product (a product may also be global — see below)
 *     └────< Staff assignment
 *
 * Why a product's store is nullable
 * `store: null` means "sold at every counter". Bottled drinks and packaged
 * goods genuinely are, and forcing them to be duplicated per store would mean
 * one physical case of Coke appearing as several independent stock figures —
 * every one of them wrong the moment a bottle is sold.
 */
import mongoose from 'mongoose';

/**
 * What kind of counter this is. Drives sensible defaults and reporting groups;
 * it deliberately does not restrict what can be sold there, because real shops
 * do not respect their own categories.
 */
export const STORE_TYPES = Object.freeze(['bakery', 'chicken', 'meat', 'grill', 'general']);

const storeSchema = new mongoose.Schema(
  {
    /** Short code used in reports, slips and terminal names, e.g. Bakery. */
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 24,
      match: [/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only'],
    },

    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: STORE_TYPES, default: 'general', index: true },

    location: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 20 },

    /**
     * Disabling a store stops its tills signing in and hides its products from
     * the storefront. It never deletes anything: sales, shifts and stock are
     * financial records and outlive the counter that made them.
     */
    isActive: { type: Boolean, default: true, index: true },

    /** Lower sorts first in pickers and reports. */
    displayOrder: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

storeSchema.index({ isActive: 1, displayOrder: 1 });

export const Store = mongoose.model('Store', storeSchema);
export default Store;
