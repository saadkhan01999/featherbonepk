/**
 * Reviews and moderation.
 * ---------------------------------------------------------------------------
 * Two rules define this module:
 *
 * 1. Only verified buyers may review. Every review must reference a delivered
 *    or completed order containing that product, placed by that customer.
 *    Without this the rating average measures nothing.
 *
 * 2. The product average is recomputed from approved reviews, never incremented.
 *    Running counters drift the moment a review is edited, rejected or deleted,
 *    and a drifted average is invisible until someone checks by hand.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { ORDER_STATUS } from '../../core/constants/payments.js';
import { Order } from '../orders/order.model.js';
import { Product } from '../catalog/product.model.js';
import { Review, REVIEW_STATUS } from './review.model.js';

/**
 * Orders a customer can legitimately review from.
 * The food has to have arrived — rating a dish still in the kitchen is noise.
 */
const REVIEWABLE_ORDER_STATUS = [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED];

/**
 * Recompute a product's rating from its approved reviews.
 * Called after every moderation decision, so the figure on the menu always
 * matches the reviews actually visible beneath it.
 */
/**
 * `aggregate` does not cast strings to ObjectId the way `find` does — a raw
 * string id matches nothing and the pipeline silently returns an empty result.
 * Every $match on an id in this file goes through here.
 */
const asObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));

async function refreshProductRating(productId) {
  const [summary] = await Review.aggregate([
    { $match: { product: asObjectId(productId), status: REVIEW_STATUS.APPROVED } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        ratingAverage: summary ? Math.round(summary.average * 10) / 10 : 0,
        ratingCount: summary?.count ?? 0,
      },
    },
  );
}

export const reviewService = {
  /** Approved reviews for a product — what the storefront shows. */
  async listForProduct(productId, { page = 1, limit = 10 } = {}) {
    const filter = { product: asObjectId(productId), status: REVIEW_STATUS.APPROVED };

    const [items, total, breakdown] = await Promise.all([
      Review.find(filter)
        .select('customerName rating comment createdAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
      // Star distribution for the 5/4/3/2/1 bars.
      Review.aggregate([
        { $match: filter },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
      ]),
    ]);

    return {
      items,
      total,
      page,
      limit,
      breakdown: [5, 4, 3, 2, 1].map((stars) => ({
        stars,
        count: breakdown.find((b) => b._id === stars)?.count ?? 0,
      })),
    };
  },

  /**
   * Submit a review.
   * Verifies the purchase before accepting anything.
   */
  async submit({ productId, orderNumber, rating, comment }, user) {
    const order = await Order.findOne({ orderNumber: String(orderNumber).toUpperCase() }).lean();
    if (!order) throw ApiError.notFound('Order');

    if (!order.customer || String(order.customer) !== String(user.id)) {
      // Deliberately the same wording as an unknown order: confirming that an
      // order exists but belongs to someone else leaks information.
      throw ApiError.notFound('Order');
    }

    if (!REVIEWABLE_ORDER_STATUS.includes(order.status)) {
      throw ApiError.badRequest('You can review an item once your order has been delivered');
    }

    const purchased = order.items.some((item) => String(item.product) === String(productId));
    if (!purchased) throw ApiError.badRequest('That item was not part of this order');

    const duplicate = await Review.findOne({ product: productId, customer: user.id, order: order._id });
    if (duplicate) throw ApiError.conflict('You have already reviewed this item for this order');

    const review = await Review.create({
      product: productId,
      customer: user.id,
      order: order._id,
      customerName: user.fullName,
      rating,
      comment,
      // Held for moderation. Publishing straight to the menu would let abusive
      // or spam content appear on a product page with no human in the loop.
      status: REVIEW_STATUS.PENDING,
    });

    logger.info('Review submitted', { reviewId: String(review._id), product: String(productId) });

    return {
      id: String(review._id),
      status: review.status,
      message: 'Thank you — your review will appear once it has been checked.',
    };
  },

  /** Moderation queue and history. */
  async listForModeration({ status, rating, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (rating) filter.rating = Number(rating);

    const [items, total] = await Promise.all([
      Review.find(filter)
        .populate('product', 'name image slug')
        // Pending first so the queue is actionable, then newest.
        .sort({ status: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);

    return {
      items: items.map((review) => ({
        id: String(review._id),
        productName: review.product?.name ?? 'Deleted product',
        productImage: review.product?.image ?? null,
        customerName: review.customerName,
        rating: review.rating,
        comment: review.comment ?? '',
        status: review.status,
        createdAt: review.createdAt,
        moderatedAt: review.moderatedAt ?? null,
        moderationNote: review.moderationNote ?? null,
      })),
      total,
      page,
      limit,
    };
  },

  /** Counts for the queue summary. */
  async stats() {
    const rows = await Review.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
    ]);

    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    const approved = rows.find((r) => r._id === REVIEW_STATUS.APPROVED);

    return {
      total: rows.reduce((sum, r) => sum + r.count, 0),
      pending: byStatus[REVIEW_STATUS.PENDING] ?? 0,
      approved: byStatus[REVIEW_STATUS.APPROVED] ?? 0,
      rejected: byStatus[REVIEW_STATUS.REJECTED] ?? 0,
      // Only approved reviews count toward the public average.
      averageRating: approved ? Math.round(approved.avgRating * 10) / 10 : 0,
    };
  },

  /** Approve or reject, then recompute the product's rating. */
  async moderate(id, { status, note }, actorId) {
    if (![REVIEW_STATUS.APPROVED, REVIEW_STATUS.REJECTED].includes(status)) {
      throw ApiError.badRequest('A review can only be approved or rejected');
    }

    const review = await Review.findById(id);
    if (!review) throw ApiError.notFound('Review');

    review.status = status;
    review.moderatedBy = actorId;
    review.moderatedAt = new Date();
    review.moderationNote = note;
    await review.save();

    // Rebuild from scratch — see the note at the top of this file.
    await refreshProductRating(review.product);

    logger.info('Review moderated', { reviewId: id, status, by: actorId });
    return { id, status, message: `Review ${status}.` };
  },
};

export { REVIEW_STATUS };
export default reviewService;
