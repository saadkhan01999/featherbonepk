/**
 * Wishlist entry — one saved product for one customer.
 * ---------------------------------------------------------------------------
 * A row per save rather than an array on the user document. An array grows
 * unboundedly on a record that is read on every authenticated request, and
 * removing one item means rewriting the whole list. Separate rows make add and
 * remove single-document operations and keep the user document small.
 */
import mongoose from 'mongoose';

const wishlistSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  },
  { timestamps: true },
);

/**
 * One save per product per customer.
 * The unique index is what makes "add" idempotent — a double-tap on the heart
 * cannot create two rows, so no de-duplication is needed on read.
 */
wishlistSchema.index({ customer: 1, product: 1 }, { unique: true });

// The list query: a customer's saves, newest first.
wishlistSchema.index({ customer: 1, createdAt: -1 });

export const WishlistItem = mongoose.model('WishlistItem', wishlistSchema);
export default WishlistItem;
