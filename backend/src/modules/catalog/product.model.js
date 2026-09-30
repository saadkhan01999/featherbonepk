/**
 * Product — one menu item, shared by the website and the till.
 * ---------------------------------------------------------------------------
 * One catalogue for both channels, deliberately. Separate POS and web
 * catalogues are how a shop ends up selling an item online that the kitchen
 * retired last week.
 *
 * The unit model is the subtle part.
 * The reference till prices weight items per kilo: "Full Chicken Roast 1.5 Kg
 * × Rs 1,200/kg = Rs 1,800". So `price` is always the price of one unit of
 * `unit`, and a sale line records how many of that unit were sold. For a
 * countable item (Naan) that is a whole number; for a weight item it is a
 * decimal read off the scale. Storing a flat "item price" instead would make it
 * impossible to bill 1.5 kg correctly.
 */
import mongoose from 'mongoose';
import slugify from 'slugify';

/** Units the catalogue supports. `isWeight` decides whether fractional
 *  quantities are legitimate at the till. */
export const UNITS = Object.freeze({
  kg: { label: 'Kg', isWeight: true },
  g: { label: 'g', isWeight: true },
  ltr: { label: 'Ltr', isWeight: true },
  pcs: { label: 'Pcs', isWeight: false },
  pack: { label: 'Pack', isWeight: false },
  box: { label: 'Box', isWeight: false },
  dozen: { label: 'Dozen', isWeight: false },
  plate: { label: 'Plate', isWeight: false },
});

export const UNIT_VALUES = Object.freeze(Object.keys(UNITS));

/**
 * Sales channels an item can appear on.
 * `web` = the customer website, `pos` = the counter till.
 */
export const CHANNELS = Object.freeze({
  web: { label: 'Website', hint: 'Customers can order this online' },
  pos: { label: 'Till (POS)', hint: 'Cashiers can ring this up at the counter' },
});

export const CHANNEL_VALUES = Object.freeze(Object.keys(CHANNELS));

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Product name is required'], trim: true, maxlength: 140 },
    slug: { type: String, unique: true, index: true, lowercase: true },

    description: { type: String, trim: true, maxlength: 2000 },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Every product must belong to a category'],
      index: true,
    },

    /**
     * Which counter sells this.
     *
     * Null means every store, and that is the important case: bottled drinks
     * and packaged goods are genuinely sold at all of them. Duplicating such a
     * product per store would split one physical case of stock into several
     * independent figures, each wrong the moment a bottle is sold.
     *
     * Existing products predate stores and are therefore null — i.e. global —
     * which is the safe default for a migration.
     */
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
      index: true,
    },

    /**
     * Where this appears: the website, the till, or both.
     *
     * One catalogue, one stock count — see the note at the top of this file.
     * This controls *visibility per channel*, not a second catalogue. A tray of
     * fresh naan is rung up at the counter but makes no sense to ship; a bulk
     * party platter may be order-ahead only. Both still draw down the same
     * stock, so the till and the website can never disagree about how many are
     * left — which is exactly what two separate catalogues get wrong.
     *
     * Defaults to both: the safe answer for an existing record and for a new
     * one the owner has not thought about yet. An empty array would hide the
     * item everywhere, so it is rejected by validation rather than silently
     * removing something from sale.
     */
    channels: {
      type: [String],
      enum: {
        values: CHANNEL_VALUES,
        message: 'Channel must be "web" or "pos"',
      },
      default: () => [...CHANNEL_VALUES],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Choose at least one place to sell this — website, till, or both',
      },
      index: true,
    },

    /** Price of one `unit`. For kg items this is the per-kilo rate. */
    price: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [0, 'Price cannot be negative'],
    },

    /**
     * What the item cost us. Powers margin reporting and is never exposed on a
     * customer-facing endpoint — the storefront serialiser omits it.
     */
    costPrice: { type: Number, min: 0, default: 0, select: false },

    unit: { type: String, enum: UNIT_VALUES, default: 'pcs' },

    /**
     * Scanned at the till. Sparse-unique: most items have one, but a
     * kitchen-made item may not, and several such items must not collide on null.
     */
    barcode: {
      type: String,
      trim: true,
      index: { unique: true, sparse: true },
    },

    sku: { type: String, trim: true, uppercase: true, index: { unique: true, sparse: true } },

    image: { type: String, default: null },
    gallery: { type: [String], default: [] },

    /** Percentage off, 0–90. Drives the "15% off" badge in the reference design. */
    discountPercent: { type: Number, min: 0, max: 90, default: 0 },

    /** Denormalised stock projection. The inventory ledger is authoritative;
     *  this copy exists so menu filtering stays a single fast query. */
    stock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },

    isActive: { type: Boolean, default: true, index: true },
    isFeatured: { type: Boolean, default: false },
    isBestSeller: { type: Boolean, default: false },

    /** Rolling aggregates maintained by the review service. */
    ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
    ratingCount: { type: Number, min: 0, default: 0 },

    /** Units sold — feeds "Top Selling Items" without scanning every order. */
    soldCount: { type: Number, default: 0, min: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// --- Indexes ---------------------------------------------------------------
// Text index powers menu search and the POS search box.
productSchema.index({ name: 'text', description: 'text', sku: 'text' });
// The storefront's default menu query.
productSchema.index({ isActive: 1, category: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ soldCount: -1 });

// --- Virtuals --------------------------------------------------------------

/** Price after any discount — what the customer actually pays per unit. */
productSchema.virtual('effectivePrice').get(function effectivePrice() {
  if (!this.discountPercent) return this.price;
  return Math.round(this.price * (1 - this.discountPercent / 100));
});

/** May this item be sold in fractional quantities (1.5 kg)? */
productSchema.virtual('isWeighed').get(function isWeighed() {
  return UNITS[this.unit]?.isWeight ?? false;
});

/**
 * Stock state for the badges in the reference design.
 * Three levels, not two: "Medium" is what gives the owner time to reorder
 * before an item actually runs out.
 */
productSchema.virtual('stockStatus').get(function stockStatus() {
  if (this.stock <= 0) return 'out_of_stock';
  if (this.stock <= this.lowStockThreshold) return 'low';
  if (this.stock <= this.lowStockThreshold * 3) return 'medium';
  return 'in_stock';
});

// --- Hooks -----------------------------------------------------------------

productSchema.pre('validate', function generateSlug(next) {
  if (this.slug && !this.isModified('name')) return next();
  this.slug = slugify(this.name, { lower: true, strict: true });
  return next();
});

export const Product = mongoose.model('Product', productSchema);
export default Product;
