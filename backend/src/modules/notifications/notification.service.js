import { Product } from '../catalog/product.model.js';
import { Order } from '../orders/order.model.js';
import { Review } from '../reviews/review.model.js';
import { Feedback } from '../feedback/feedback.model.js';
import { Terminal } from '../pos/terminal.model.js';
import { PERMISSIONS, userCan } from '../../core/constants/roles.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../../core/constants/payments.js';
import { settingsService } from '../settings/settings.service.js';

/**
 * Notifications.
 * ---------------------------------------------------------------------------
 * Derived from live state, not stored.
 *
 * The obvious design is a `notifications` collection that something writes to.
 * It is also the design that rots: a "low stock" message written on Tuesday is
 * still sitting there on Friday after the delivery arrived, and now the owner
 * has to dismiss notices about problems that fixed themselves. Worse, the ones
 * that do still matter are buried among them.
 *
 * These are computed on request from the same data the rest of the system uses,
 * so a notification exists exactly as long as the condition does. Restock an
 * item and the alert is gone on the next load — no cron, no cleanup, nothing to
 * fall out of step.
 *
 * The trade-off, stated honestly: there is no read/unread state and no history.
 * When the business wants "who acknowledged this and when", that needs storage —
 * and by then it is a different feature, closer to a task list than an alert.
 *
 * Every notification is permission-gated. A cashier must not be told the
 * takings are down; a kitchen account has no business seeing pending payouts.
 */

/** Severity drives ordering and colour. */
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

/**
 * Has this alert already been acknowledged at its current level?
 *
 * Directional, and that is the whole point. Signatures are counts, so a plain
 * `seen !== current` treats any movement as new — including improvement. Read
 * "9 items low", restock two of them, and the bell would light up to tell you
 * about the seven that are left. Being nagged for fixing the problem is how a
 * badge trains people to ignore it.
 *
 * So a number that has gone down stays read; only exceeding the level you
 * acknowledged counts as news. The acknowledged level is a high-water mark: if
 * you accepted 9, then 7 and 8 are things you already know about.
 *
 * Non-numeric signatures (should a future alert use one) fall back to plain
 * inequality, which is the safe direction — it errs towards showing.
 */
function hasBeenSeen(seenSignature, currentSignature) {
  if (seenSignature === undefined) return false;
  if (seenSignature === currentSignature) return true;

  const before = Number(seenSignature);
  const now = Number(currentSignature);
  if (Number.isFinite(before) && Number.isFinite(now)) return now <= before;

  return false;
}

export const notificationService = {
  /**
   * @param {object} user The signed-in account (`req.userDoc` or `req.user`).
   * @returns {Promise<Array>} Alerts this person is allowed to see.
   */
  async build(user) {
    const can = (permission) => userCan(user, permission);
    const notifications = [];

    // --- Stock ------------------------------------------------------------
    if (can(PERMISSIONS.INVENTORY_VIEW)) {
      const [outOfStock, lowStock] = await Promise.all([
        Product.countDocuments({ isActive: true, stock: { $lte: 0 } }),
        // `$expr` compares two fields on the same document, which a plain
        // query cannot do — the threshold is per-product, not a constant.
        Product.countDocuments({
          isActive: true,
          stock: { $gt: 0 },
          $expr: { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', 5] }] },
        }),
      ]);

      if (outOfStock > 0) {
        notifications.push({
          id: 'stock:out',
          signature: String(outOfStock),
          severity: 'critical',
          title: `${outOfStock} item${outOfStock === 1 ? '' : 's'} out of stock`,
          body: 'These cannot be sold online or at the till until restocked.',
          action: { label: 'Open inventory', href: '/admin/inventory' },
        });
      }

      if (lowStock > 0) {
        notifications.push({
          id: 'stock:low',
          signature: String(lowStock),
          severity: 'warning',
          title: `${lowStock} item${lowStock === 1 ? '' : 's'} running low`,
          body: 'At or below their reorder threshold.',
          action: { label: 'Open inventory', href: '/admin/inventory' },
        });
      }
    }

    // --- Orders needing a human -------------------------------------------
    if (can(PERMISSIONS.ORDER_VIEW)) {
      const forwarding =
        Boolean(settingsService.get('kitchenEnabled')) &&
        settingsService.get('kitchenWebsiteOrders') !== 'off';
      const [pending, unpaid, toForward] = await Promise.all([
        Order.countDocuments({ status: ORDER_STATUS.PENDING }),
        Order.countDocuments({
          paymentStatus: PAYMENT_STATUS.PENDING,
          status: { $nin: [ORDER_STATUS.CANCELLED] },
        }),
        forwarding
          ? Order.countDocuments({
              channel: 'online',
              status: ORDER_STATUS.CONFIRMED,
              'kitchen.firedAt': null,
            })
          : 0,
      ]);

      if (toForward > 0) {
        notifications.push({
          id: 'orders:to-forward',
          signature: String(toForward),
          severity: 'warning',
          title: `${toForward} website order${toForward === 1 ? '' : 's'} to send to the kitchen`,
          body: 'Choose which station prepares each item.',
          action: { label: 'Open dashboard', href: '/admin' },
        });
      }

      if (pending > 0) {
        notifications.push({
          id: 'orders:pending',
          signature: String(pending),
          severity: 'warning',
          title: `${pending} order${pending === 1 ? '' : 's'} awaiting confirmation`,
          body: 'A customer is waiting to hear back.',
          action: { label: 'Open orders', href: '/admin/orders' },
        });
      }

      if (unpaid > 0) {
        notifications.push({
          id: 'orders:unpaid',
          signature: String(unpaid),
          severity: 'info',
          title: `${unpaid} order${unpaid === 1 ? '' : 's'} unpaid`,
          body: 'Cash on delivery, or a payment that has not landed yet.',
          action: { label: 'Open orders', href: '/admin/orders' },
        });
      }
    }

    // --- Reviews awaiting moderation --------------------------------------
    if (can(PERMISSIONS.REVIEW_MODERATE)) {
      const pending = await Review.countDocuments({ status: 'pending' });
      if (pending > 0) {
        notifications.push({
          id: 'reviews:pending',
          signature: String(pending),
          severity: 'info',
          title: `${pending} review${pending === 1 ? '' : 's'} awaiting moderation`,
          body: 'Not visible to customers until approved.',
          action: { label: 'Open feedback', href: '/admin/feedback' },
        });
      }
    }

    // --- Customer feedback from the website ---------------------------------
    if (can(PERMISSIONS.REVIEW_VIEW)) {
      const fresh = await Feedback.countDocuments({ status: 'new' });
      if (fresh > 0) {
        notifications.push({
          id: 'feedback:new',
          signature: String(fresh),
          severity: 'info',
          title: `${fresh} new customer feedback`,
          body: 'Read it, reply, and publish the best to the website.',
          action: { label: 'Open feedback', href: '/admin/feedback' },
        });
      }
    }

    // --- Configuration gaps that break something quietly ------------------
    if (can(PERMISSIONS.TERMINAL_VIEW)) {
      // A till with no store sells the whole catalogue. That is correct for a
      // single-counter business and almost certainly wrong once counters exist.
      const [unassigned, storeCount] = await Promise.all([
        Terminal.countDocuments({ isActive: true, store: null }),
        (await import('../stores/store.model.js')).Store.countDocuments({ isActive: true }),
      ]);

      if (unassigned > 0 && storeCount > 1) {
        notifications.push({
          id: 'terminals:unassigned',
          signature: String(unassigned),
          severity: 'warning',
          title: `${unassigned} till${unassigned === 1 ? '' : 's'} not assigned to a counter`,
          body: 'An unassigned till sells the entire menu, including other counters’ items.',
          action: { label: 'Open POS management', href: '/admin/pos' },
        });
      }
    }

    if (can(PERMISSIONS.PRODUCT_VIEW)) {
      // Without a cost price the Finance screen reports 100% margin, which is
      // worse than reporting nothing — it looks like a number.
      const noCost = await Product.countDocuments({
        isActive: true,
        $or: [{ costPrice: { $exists: false } }, { costPrice: null }, { costPrice: 0 }],
      });

      if (noCost > 0) {
        notifications.push({
          id: 'products:no-cost',
          signature: String(noCost),
          severity: 'info',
          title: `${noCost} product${noCost === 1 ? '' : 's'} without a cost price`,
          body: 'Profit and margin figures treat these as free, which overstates your profit.',
          action: { label: 'Open products', href: '/admin/products' },
        });
      }
    }

    return notifications.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  },

  /**
   * The alerts this person can see, each tagged read or unread.
   *
   * `notificationsSeen` maps id → the signature that was current when they last
   * marked it read. Unread means the signature has changed since — a brand new
   * condition (no entry at all) or an existing one that has moved.
   */
  async list(user) {
    const notifications = await this.build(user);
    const seen = user?.notificationsSeen;

    // A Mongoose Map on a document, a plain object on a `.lean()` result.
    const seenOf = (id) => (seen instanceof Map ? seen.get(id) : seen?.[id]);

    return notifications.map((n) => ({ ...n, isRead: hasBeenSeen(seenOf(n.id), n.signature) }));
  },

  /**
   * Mark everything currently visible as seen.
   *
   * Stores the signatures as they are now rather than clearing the list, so a
   * condition that later worsens becomes unread again. Only ids the user can
   * actually see are written: marking read must not silence an alert that
   * belongs to somebody else's permissions.
   */
  async markAllRead(userDoc) {
    const notifications = await this.build(userDoc);

    if (!(userDoc.notificationsSeen instanceof Map)) {
      userDoc.notificationsSeen = new Map();
    }
    for (const n of notifications) userDoc.notificationsSeen.set(n.id, n.signature);

    /*
     * Conditions that have since resolved leave dead entries behind. Dropping
     * anything not currently visible keeps the map the size of the alert list
     * rather than growing without limit for the life of the account — and it
     * means a condition that comes back is correctly unread again.
     */
    const live = new Set(notifications.map((n) => n.id));
    for (const id of [...userDoc.notificationsSeen.keys()]) {
      if (!live.has(id)) userDoc.notificationsSeen.delete(id);
    }

    // No validation pass: this touches one map and must not fail because some
    // unrelated field on an older account no longer satisfies a newer rule.
    await userDoc.save({ validateBeforeSave: false });

    return { read: notifications.length };
  },

  /** Just the counts, for the header badge. */
  async count(user) {
    const items = await this.list(user);
    const unread = items.filter((n) => !n.isRead);
    return {
      total: items.length,
      unread: unread.length,
      /*
       * The badge shows unread, and only the ones worth interrupting someone
       * for. Counting read items too would make the badge permanent — it would
       * never reach zero however many times it was clicked, which is precisely
       * the complaint that prompted this.
       */
      urgent: unread.filter((n) => n.severity !== 'info').length,
    };
  },
};

export default notificationService;
