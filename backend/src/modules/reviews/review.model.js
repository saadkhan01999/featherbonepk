/**
 * Review — a customer's rating of a product they actually bought.
 * ---------------------------------------------------------------------------
 * The `order` reference is what makes a review verifiable. Without it, anyone
 * with an account can rate anything, and the star average stops meaning
 * "customers who ate this liked it" — which is the only thing it is for.
 */
import mongoose from 'mongoose';

export const REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** Proof of purchase. Required — see the note above. */
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },

    // Snapshotted so a display name change doesn't rewrite historical reviews,
    // and so the review still renders if the account is later deactivated.
    customerName: { type: String, required: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },

    status: { type: String, enum: Object.values(REVIEW_STATUS), default: REVIEW_STATUS.PENDING, index: true },

    /** Moderation audit — who acted, when, and why. */
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderatedAt: Date,
    moderationNote: String,
  },
  { timestamps: true },
);

/**
 * One review per product per order.
 *
 * Not per product per customer — a regular who orders the same dish monthly
 * should be able to say it slipped. But the same order cannot be used twice,
 * which is what stops one purchase becoming ten five-star ratings.
 */
reviewSchema.index({ product: 1, customer: 1, order: 1 }, { unique: true });

// Moderation queue: pending first, oldest first.
reviewSchema.index({ status: 1, createdAt: -1 });

export const Review = mongoose.model('Review', reviewSchema);
export default Review;
