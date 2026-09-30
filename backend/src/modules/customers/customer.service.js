/**
 * Customer management (back office).
 * ---------------------------------------------------------------------------
 * Deliberately separate from `staff.service.js`. Staff management is about
 * roles and permissions and carries privilege-escalation guards; this is about
 * people who buy things and carries none of that, because a customer has no
 * permissions to escalate. Merging the two would mean every customer query ran
 * through code written to stop an admin promoting themselves.
 *
 * Nothing here can change a role. A customer cannot be turned into staff from
 * this screen — that is what the staff module is for, with its own guards.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { ROLES } from '../../core/constants/roles.js';
import { User } from '../users/user.model.js';
import { Order } from '../orders/order.model.js';
import { Address } from '../account/address.model.js';
import { WishlistItem } from '../wishlist/wishlist.model.js';
import { Review } from '../reviews/review.model.js';

/** Only ever customers. Every query in this file starts from here. */
const CUSTOMER_FILTER = { role: ROLES.CUSTOMER };

export const customerService = {
  /**
   * Customer list with lifetime spend.
   *
   * Spend is joined via aggregation rather than an N+1 loop — one query for the
   * page instead of one per customer, which matters the moment the list is
   * longer than a handful.
   */
  async list({ search, status, sort = 'recent', page = 1, limit = 20 } = {}) {
    const match = { ...CUSTOMER_FILTER };
    if (status) match.status = status;

    if (search) {
      // Escaped — an unescaped search box is a regex-injection and ReDoS hole.
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      match.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
    }

    const SORTS = {
      recent: { createdAt: -1 },
      name: { fullName: 1 },
      spend: { totalSpent: -1 },
      orders: { orderCount: -1 },
    };

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: 'customer',
          as: 'orders',
          // Cancelled and refunded orders are excluded from spend — money that
          // came back is not money the customer spent.
          pipeline: [
            { $match: { status: { $nin: ['cancelled', 'refunded'] } } },
            { $project: { total: 1, createdAt: 1 } },
          ],
        },
      },
      {
        $addFields: {
          orderCount: { $size: '$orders' },
          totalSpent: { $sum: '$orders.total' },
          lastOrderAt: { $max: '$orders.createdAt' },
        },
      },
      { $sort: SORTS[sort] ?? SORTS.recent },
      {
        $facet: {
          rows: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              // Explicit projection: never $project-away a password field by
              // omission alone, list it out so the intent is auditable.
              $project: {
                fullName: 1,
                email: 1,
                phone: 1,
                status: 1,
                avatarUrl: 1,
                emailVerified: 1,
                createdAt: 1,
                lastLoginAt: 1,
                orderCount: 1,
                totalSpent: 1,
                lastOrderAt: 1,
              },
            },
          ],
          total: [{ $count: 'value' }],
        },
      },
    ];

    const [result] = await User.aggregate(pipeline);

    return {
      items: (result?.rows ?? []).map((customer) => ({
        id: String(customer._id),
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        avatarUrl: customer.avatarUrl ?? null,
        emailVerified: customer.emailVerified,
        joinedAt: customer.createdAt,
        lastLoginAt: customer.lastLoginAt ?? null,
        orderCount: customer.orderCount,
        totalSpent: customer.totalSpent,
        lastOrderAt: customer.lastOrderAt ?? null,
      })),
      total: result?.total?.[0]?.value ?? 0,
      page,
      limit,
    };
  },

  /** One customer, with everything the detail drawer shows. */
  async detail(id) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid customer');

    const customer = await User.findOne({ _id: id, ...CUSTOMER_FILTER }).lean();
    if (!customer) throw ApiError.notFound('Customer');

    const objectId = new mongoose.Types.ObjectId(String(id));

    const [orders, spendRows, addresses, wishlistCount, reviewCount] = await Promise.all([
      Order.find({ customer: id })
        .select('orderNumber status paymentStatus paymentMethod total createdAt items')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Order.aggregate([
        // `aggregate` does not cast strings to ObjectId — a raw string here
        // matches nothing and reports a spend of zero.
        { $match: { customer: objectId, status: { $nin: ['cancelled', 'refunded'] } } },
        { $group: { _id: null, orders: { $sum: 1 }, spent: { $sum: '$total' } } },
      ]),
      Address.find({ customer: id }).lean(),
      WishlistItem.countDocuments({ customer: id }),
      Review.countDocuments({ customer: id }),
    ]);

    const spend = spendRows[0] ?? { orders: 0, spent: 0 };

    return {
      id: String(customer._id),
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      avatarUrl: customer.avatarUrl ?? null,
      emailVerified: customer.emailVerified,
      joinedAt: customer.createdAt,
      lastLoginAt: customer.lastLoginAt ?? null,

      stats: {
        orders: spend.orders,
        totalSpent: spend.spent,
        // A useful signal on its own: a high average order value is a different
        // customer from a frequent small spender.
        averageOrder: spend.orders > 0 ? Math.round(spend.spent / spend.orders) : 0,
        wishlist: wishlistCount,
        reviews: reviewCount,
      },

      addresses: addresses.map((address) => ({
        id: String(address._id),
        label: address.label,
        recipientName: address.recipientName,
        phone: address.phone,
        line1: address.line1,
        area: address.area ?? null,
        city: address.city,
        isDefault: address.isDefault,
      })),

      recentOrders: orders.map((order) => ({
        id: String(order._id),
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        total: order.total,
        itemCount: order.items?.length ?? 0,
        createdAt: order.createdAt,
      })),
    };
  },

  /** Headline counters. */
  async stats() {
    const [byStatus, newThisMonth, withOrders] = await Promise.all([
      User.aggregate([{ $match: CUSTOMER_FILTER }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      User.countDocuments({
        ...CUSTOMER_FILTER,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      }),
      Order.distinct('customer', { customer: { $ne: null } }),
    ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row._id, row.count]));

    return {
      total: byStatus.reduce((sum, row) => sum + row.count, 0),
      active: counts.active ?? 0,
      suspended: counts.suspended ?? 0,
      inactive: counts.inactive ?? 0,
      newLast30Days: newThisMonth,
      haveOrdered: withOrders.length,
    };
  },

  /**
   * Suspend or restore a customer.
   *
   * Suspending revokes every session immediately. Without that the person stays
   * signed in on whatever device they are holding, and "suspended" means
   * nothing until their token happens to expire.
   */
  async setStatus(id, status, actorId) {
    const customer = await User.findOne({ _id: id, ...CUSTOMER_FILTER }).select('+sessions');
    if (!customer) throw ApiError.notFound('Customer');

    customer.status = status;
    if (status !== 'active') customer.sessions = [];
    await customer.save({ validateBeforeSave: false });

    logger.info('Customer status changed', { customer: id, status, by: actorId });

    return {
      id,
      status,
      message:
        status === 'active'
          ? `${customer.fullName} can sign in again`
          : `${customer.fullName} has been ${status} and signed out`,
    };
  },

  /**
   * Delete a customer account for good.
   *
   * Refused while they have orders, and that is not a limitation to work
   * around. An order records what a business sold, to whom, for how much, and
   * how much tax it collected. Deleting the customer would leave those orders
   * pointing at nothing — the takings reports still count the money but can no
   * longer say whose it was, and a receipt reprint has no name to put on it.
   * That is a book-keeping record the shop is required to keep, so the answer
   * is to say so plainly and offer suspension, which ends their access without
   * rewriting history.
   *
   * What is deleted when there are no orders: the account, and the things that
   * belong only to it — saved addresses, wishlist and reviews. Those are the
   * person's own content and nothing else refers to them, so leaving them
   * behind would be an orphan, not a record.
   *
   * Not deleted: audit entries. That log is append-only by design; a customer
   * who appears in it appears as something that happened, and an audit trail
   * that can be erased by deleting its subject is not an audit trail.
   */
  async remove(id, actor) {
    const customer = await User.findOne({ _id: id, ...CUSTOMER_FILTER });
    if (!customer) throw ApiError.notFound('Customer');

    // Scoped to this file's CUSTOMER_FILTER, so a staff account can never be
    // reached through this route even with a valid staff id — staff are removed
    // in the staff module, which has the rank guards this one deliberately lacks.
    const orderCount = await Order.countDocuments({ customer: id });

    if (orderCount > 0) {
      throw ApiError.conflict(
        `${customer.fullName} has ${orderCount} order${orderCount === 1 ? '' : 's'} on record and cannot be deleted — ` +
          'those orders are part of your sales history. Suspend the account instead to stop them signing in.',
        { details: [{ field: 'orders', message: `${orderCount} order(s) attached` }] },
      );
    }

    /*
     * The person's own content goes with them. Run before the account is
     * removed: if the account went first and one of these failed, the rows left
     * behind would reference an id nothing can resolve, and no screen would
     * ever show them again to make the problem visible.
     */
    const [addresses, wishlist, reviews] = await Promise.all([
      Address.deleteMany({ customer: id }),
      WishlistItem.deleteMany({ customer: id }),
      Review.deleteMany({ customer: id }),
    ]);

    await customer.deleteOne();

    logger.info('Customer deleted', {
      customer: id,
      by: actor?.id,
      addresses: addresses.deletedCount,
      wishlist: wishlist.deletedCount,
      reviews: reviews.deletedCount,
    });

    return {
      id,
      name: customer.fullName,
      removed: {
        addresses: addresses.deletedCount ?? 0,
        wishlist: wishlist.deletedCount ?? 0,
        reviews: reviews.deletedCount ?? 0,
      },
      message: `${customer.fullName} and their saved addresses, wishlist and reviews were deleted.`,
    };
  },
};

export default customerService;
