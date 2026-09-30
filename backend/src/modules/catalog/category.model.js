/**
 * Category — the menu's top-level grouping.
 * ---------------------------------------------------------------------------
 * Drives the storefront sidebar, the POS category tabs and the admin category
 * panel, so one edit here is reflected on all three surfaces at once.
 */
import mongoose from 'mongoose';

import { CHANNEL_VALUES } from './product.model.js';
import slugify from 'slugify';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Category name is required'], trim: true, maxlength: 80 },

    // URL key. Unique because it addresses the category publicly (/menu/bakery).
    slug: { type: String, unique: true, index: true, lowercase: true },

    description: { type: String, trim: true, maxlength: 500 },

    /** Thumbnail shown in the sidebar, the POS tab strip and the admin list. */
    image: { type: String, default: null },

    /**
     * Manual ordering. The menu's sequence is a merchandising decision — the
     * owner puts Roast Chicken first because it sells — so it must not be
     * alphabetical or creation-ordered.
     */
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

    displayOrder: { type: Number, default: 0, index: true },

    isActive: { type: Boolean, default: true, index: true },

    /** Surfaced in the storefront's "Top Categories" strip. */
    isFeatured: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// The storefront's default query is "active categories in display order".
categorySchema.index({ isActive: 1, displayOrder: 1 });

/**
 * Derive the slug from the name.
 *
 * Only on create or an explicit rename: regenerating on every save would break
 * links that customers have bookmarked or shared the moment someone fixes a
 * typo in a description.
 */
categorySchema.pre('validate', function generateSlug(next) {
  if (this.slug && !this.isModified('name')) return next();
  this.slug = slugify(this.name, { lower: true, strict: true });
  return next();
});

export const Category = mongoose.model('Category', categorySchema);
export default Category;
