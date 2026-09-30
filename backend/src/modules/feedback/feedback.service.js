import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { escapeRegex } from '../../core/utils/regex.util.js';
import { logger } from '../../core/utils/logger.js';
import { realtime } from '../../core/realtime/realtime.js';
import { Order } from '../orders/order.model.js';
import { Feedback, FEEDBACK_ASPECTS, FEEDBACK_TAGS } from './feedback.model.js';

/**
 * Customer feedback — submit, show on the website, moderate.
 */

/** "Ali Khan" → "Ali K." — enough to feel real, not enough to find someone. */
export function publicName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A customer';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const toPublic = (f) => ({
  id: String(f._id),
  name: publicName(f.name),
  rating: f.rating,
  aspects: f.aspects ?? {},
  tags: f.tags ?? [],
  comment: f.comment ?? '',
  reply: f.reply || null,
  verifiedOrder: Boolean(f.verifiedOrder),
  createdAt: f.createdAt,
});

const toAdmin = (f) => ({
  ...toPublic(f),
  fullName: f.name || 'A customer',
  email: f.email ?? null,
  phone: f.phone ?? null,
  orderNumber: f.orderNumber ?? null,
  allowPublish: f.allowPublish,
  status: f.status,
  repliedAt: f.repliedAt,
  handledByName: f.handledByName,
});

export const feedbackService = {
  async submit(payload, { userId = null, ip } = {}) {
    const orderNumber = payload.orderNumber?.trim().toUpperCase() || undefined;
    const verifiedOrder = orderNumber ? Boolean(await Order.exists({ orderNumber })) : false;

    const aspects = Object.fromEntries(
      FEEDBACK_ASPECTS.filter((key) => payload.aspects?.[key]).map((key) => [key, payload.aspects[key]]),
    );

    const record = await Feedback.create({
      name: payload.name,
      email: payload.email || undefined,
      phone: payload.phone || undefined,
      orderNumber,
      verifiedOrder,
      rating: payload.rating,
      aspects,
      // Unknown tags are refused by the route; duplicates are simply dropped.
      tags: [...new Set(payload.tags ?? [])],
      comment: payload.comment ?? '',
      allowPublish: payload.allowPublish !== false,
      customer: userId && mongoose.isValidObjectId(userId) ? userId : null,
      ip,
    });

    logger.info('Customer feedback received', { id: String(record._id), rating: record.rating });
    // The bell counts new feedback — tell open back offices now.
    realtime.notificationsChanged();

    return { reference: String(record._id).slice(-6).toUpperCase(), verifiedOrder };
  },

  /** Published feedback for the website, with the overall score. */
  async publicList({ limit = 6 } = {}) {
    const visible = { status: 'published', allowPublish: true };
    const [items, [summary]] = await Promise.all([
      Feedback.find(visible).sort({ createdAt: -1 }).limit(limit).lean(),
      Feedback.aggregate([
        { $match: visible },
        {
          $group: {
            _id: null,
            average: { $avg: '$rating' },
            count: { $sum: 1 },
            five: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
            four: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
            three: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
            two: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
            one: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    return {
      items: items.map(toPublic),
      summary: {
        average: summary ? Math.round(summary.average * 10) / 10 : null,
        count: summary?.count ?? 0,
        distribution: summary
          ? { 5: summary.five, 4: summary.four, 3: summary.three, 2: summary.two, 1: summary.one }
          : { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      },
    };
  },

  async adminList({ status, rating, search, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (rating) filter.rating = rating;
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { orderNumber: rx }, { comment: rx }];
    }

    const [items, total] = await Promise.all([
      Feedback.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Feedback.countDocuments(filter),
    ]);
    return { items: items.map(toAdmin), total, page, limit };
  },

  async stats() {
    const [byStatus, [overall], tagCounts] = await Promise.all([
      Feedback.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Feedback.aggregate([{ $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }]),
      Feedback.aggregate([
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 8 },
      ]),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((row) => [row._id, row.count])),
      average: overall ? Math.round(overall.average * 10) / 10 : null,
      total: overall?.count ?? 0,
      // What customers mention most — praise and problems alike.
      topTags: tagCounts
        .filter((row) => FEEDBACK_TAGS[row._id])
        .map((row) => ({ tag: row._id, label: FEEDBACK_TAGS[row._id], count: row.count })),
    };
  },

  async countNew() {
    return Feedback.countDocuments({ status: 'new' });
  },

  /** Publish, hide or reply. */
  async moderate(id, { status, reply }, actor) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid feedback');
    const feedback = await Feedback.findById(id);
    if (!feedback) throw ApiError.notFound('Feedback');

    if (status === 'published' && !feedback.allowPublish) {
      throw ApiError.badRequest('This customer asked for their feedback not to be shown on the website.');
    }
    if (status) feedback.status = status;
    if (reply !== undefined) {
      feedback.reply = reply.trim();
      feedback.repliedAt = feedback.reply ? new Date() : null;
    }
    feedback.handledBy = actor?.id ?? null;
    feedback.handledByName = actor?.fullName ?? null;
    await feedback.save();

    realtime.notificationsChanged();
    return toAdmin(feedback.toObject());
  },

  async remove(id) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid feedback');
    const deleted = await Feedback.findByIdAndDelete(id);
    if (!deleted) throw ApiError.notFound('Feedback');
    realtime.notificationsChanged();
    return { id };
  },
};

export default feedbackService;
