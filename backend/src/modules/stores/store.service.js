/**
 * Stores (outlets / counters).
 * ---------------------------------------------------------------------------
 * Also the home of `visibleStoreIds` — the single definition of "which stores
 * may this person see". Every scoped query in the system routes through it, so
 * there is one place to audit rather than a filter copied into each module,
 * where the copies drift and one of them quietly shows too much.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { Product } from '../catalog/product.model.js';
import { Order } from '../orders/order.model.js';
import { Terminal } from '../pos/terminal.model.js';
import { User } from '../users/user.model.js';
import { Store, STORE_TYPES } from './store.model.js';

/**
 * Which stores may this user see?
 *
 * @returns {null|string[]} `null` means EVERY store — do not filter. An array
 * means restrict to exactly those ids. An empty array would mean "no stores at
 * all", which is why unassigned staff return `null` rather than `[]`: silently
 * showing an admin nothing is a worse failure than showing them everything.
 */
export function visibleStoreIds(user) {
  if (!user) return null;
  if (user.role === 'super_admin') return null;

  const assigned = user.stores ?? [];
  return assigned.length > 0 ? assigned.map(String) : null;
}

/**
 * Mongo filter fragment scoping a collection to a user's stores.
 *
 * `includeGlobal` matters for products: an item with `store: null` is sold
 * everywhere, so a bakery manager must still see the bottled drinks. It does
 * not apply to sales — a sale always happened at exactly one counter.
 */
export function storeFilter(user, { field = 'store', includeGlobal = false } = {}) {
  const ids = visibleStoreIds(user);
  if (!ids) return {};

  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(String(id)));
  return includeGlobal
    ? { $or: [{ [field]: { $in: objectIds } }, { [field]: null }] }
    : { [field]: { $in: objectIds } };
}

function toPublic(store, extras = {}) {
  return {
    id: String(store._id),
    code: store.code,
    name: store.name,
    type: store.type,
    location: store.location ?? null,
    phone: store.phone ?? null,
    isActive: store.isActive,
    displayOrder: store.displayOrder,
    ...extras,
  };
}

export const storeService = {
  /**
   * Stores this user may see, each with live counts.
   * Counts come from three grouped queries rather than a loop per store — the
   * N+1 version is invisible with three outlets and painful with thirty.
   */
  async list(user, { includeInactive = true } = {}) {
    const filter = { ...(includeInactive ? {} : { isActive: true }) };

    const ids = visibleStoreIds(user);
    if (ids) filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };

    const stores = await Store.find(filter).sort({ displayOrder: 1, code: 1 }).lean();
    if (stores.length === 0) return [];

    const storeIds = stores.map((s) => s._id);

    const [productCounts, terminalCounts, staffCounts] = await Promise.all([
      Product.aggregate([
        { $match: { store: { $in: storeIds }, isActive: true } },
        { $group: { _id: '$store', count: { $sum: 1 } } },
      ]),
      Terminal.aggregate([
        { $match: { store: { $in: storeIds } } },
        { $group: { _id: '$store', count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $match: { stores: { $in: storeIds } } },
        { $unwind: '$stores' },
        { $match: { stores: { $in: storeIds } } },
        { $group: { _id: '$stores', count: { $sum: 1 } } },
      ]),
    ]);

    const byId = (rows) => new Map(rows.map((r) => [String(r._id), r.count]));
    const products = byId(productCounts);
    const terminals = byId(terminalCounts);
    const staff = byId(staffCounts);

    // Global products are shown against every store, because that is where they
    // actually appear on the till.
    const globalProducts = await Product.countDocuments({ store: null, isActive: true });

    return stores.map((store) =>
      toPublic(store, {
        productCount: (products.get(String(store._id)) ?? 0) + globalProducts,
        ownProductCount: products.get(String(store._id)) ?? 0,
        globalProductCount: globalProducts,
        terminalCount: terminals.get(String(store._id)) ?? 0,
        staffCount: staff.get(String(store._id)) ?? 0,
      }),
    );
  },

  /** One store, with the same counts plus recent trading. */
  async detail(id, user) {
    const ids = visibleStoreIds(user);
    if (ids && !ids.includes(String(id))) throw ApiError.forbidden('That store is not assigned to you');

    const store = await Store.findById(id).lean();
    if (!store) throw ApiError.notFound('Store');

    const objectId = new mongoose.Types.ObjectId(String(id));
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [sales, terminals, products] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            store: objectId,
            createdAt: { $gte: since },
            status: { $nin: ['cancelled', 'refunded'] },
          },
        },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
      ]),
      Terminal.find({ store: objectId }).select('code name isActive').lean(),
      Product.countDocuments({ store: objectId, isActive: true }),
    ]);

    return toPublic(store, {
      last30Days: {
        orders: sales[0]?.orders ?? 0,
        revenue: sales[0]?.revenue ?? 0,
      },
      terminals: terminals.map((t) => ({
        id: String(t._id),
        code: t.code,
        name: t.name,
        isActive: t.isActive,
      })),
      ownProductCount: products,
    });
  },

  async create(data, actorId) {
    const code = String(data.code).trim().toUpperCase();
    if (await Store.findOne({ code }).lean()) throw ApiError.conflict(`Store "${code}" already exists`);

    const store = await Store.create({ ...data, code, createdBy: actorId });
    logger.info('Store created', { code, by: actorId });
    return { id: String(store._id), code, message: `${store.name} created` };
  },

  async update(id, data) {
    const store = await Store.findById(id);
    if (!store) throw ApiError.notFound('Store');

    // Same reasoning as terminal codes: sales and reports reference the store,
    // and renaming its code would orphan the history rather than move it.
    if (data.code && String(data.code).toUpperCase() !== store.code) {
      throw ApiError.badRequest(
        'A store code cannot be changed once it has traded. Disable this one and create another.',
      );
    }

    Object.assign(store, { ...data, code: store.code });
    await store.save();

    return { id, message: `${store.name} updated` };
  },

  /** Enable or disable. Refuses to close a store with a till mid-shift. */
  async setActive(id, isActive) {
    const store = await Store.findById(id);
    if (!store) throw ApiError.notFound('Store');

    if (!isActive) {
      const { Shift, SHIFT_STATUS } = await import('../pos/shift.model.js');
      const terminals = await Terminal.find({ store: id }).select('code').lean();
      const open = await Shift.findOne({
        terminalId: { $in: terminals.map((t) => t.code) },
        status: SHIFT_STATUS.OPEN,
      }).lean();

      if (open) {
        throw ApiError.conflict(
          `${store.name} has an open shift on ${open.terminalId} (${open.cashierName}). Close it first.`,
        );
      }
    }

    store.isActive = isActive;
    await store.save({ validateBeforeSave: false });

    logger.info('Store availability changed', { code: store.code, isActive });
    return { id, isActive, message: `${store.name} ${isActive ? 'opened' : 'closed'}` };
  },

  /** Delete — only while nothing references it. */
  async remove(id) {
    const store = await Store.findById(id);
    if (!store) throw ApiError.notFound('Store');

    const [sales, terminals, products] = await Promise.all([
      Order.countDocuments({ store: id }),
      Terminal.countDocuments({ store: id }),
      Product.countDocuments({ store: id }),
    ]);

    if (sales > 0 || terminals > 0 || products > 0) {
      throw ApiError.conflict(
        `${store.name} still has ${sales} sale(s), ${terminals} till(s) and ${products} product(s). Close it instead of deleting it.`,
      );
    }

    await store.deleteOne();
    return { id, message: `${store.name} removed` };
  },

  types: STORE_TYPES,
};

export default storeService;
