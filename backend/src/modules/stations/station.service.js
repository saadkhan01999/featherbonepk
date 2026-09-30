import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { realtime } from '../../core/realtime/realtime.js';
import { KITCHEN_ACTIVE } from '../../core/constants/payments.js';
import { Category } from '../catalog/category.model.js';
import { Product } from '../catalog/product.model.js';
import { Order } from '../orders/order.model.js';
import { Station, STATION_COLORS } from './station.model.js';

/**
 * Preparation stations and the routing of order lines to them.
 *
 * Routing is by category: a line goes to the station that owns its product's
 * category, otherwise to the catch-all station. There is always exactly one
 * active catch-all, so every line has somewhere to go.
 */

const DEFAULT_STATION = { name: 'Kitchen', color: STATION_COLORS[0], isDefault: true, sortOrder: 0 };

const toStation = (station) => ({
  id: String(station._id),
  name: station.name,
  slug: station.slug,
  color: station.color,
  isDefault: Boolean(station.isDefault),
  isActive: station.isActive !== false,
  sortOrder: station.sortOrder ?? 0,
  categories: (station.categories ?? []).map((c) =>
    c && typeof c === 'object' && c.name
      ? { id: String(c._id), name: c.name }
      : { id: String(c), name: null },
  ),
});

/** A station reduced to what a kitchen screen or an order line needs. */
export const stationRef = (station) =>
  station ? { id: String(station._id ?? station.id), name: station.name, color: station.color } : null;

function toIds(values = []) {
  const ids = [...new Set(values.map(String))];
  const invalid = ids.find((id) => !mongoose.isValidObjectId(id));
  if (invalid) throw ApiError.validation([{ field: 'categories', message: 'Unknown category' }]);
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

async function assertCategoriesExist(ids) {
  if (!ids.length) return;
  const found = await Category.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw ApiError.validation([{ field: 'categories', message: 'Unknown category' }]);
}

function duplicateName(error, name) {
  if (error?.code === 11000) return ApiError.conflict(`There is already a station called "${name}".`);
  return error;
}

export const stationService = {
  /** Create the catch-all "Kitchen" the first time stations are needed. */
  async ensureDefault() {
    if (await Station.exists({})) return;
    try {
      await Station.create(DEFAULT_STATION);
    } catch (error) {
      if (error?.code !== 11000) throw error; // another request created it first
    }
  },

  async list({ activeOnly = false } = {}) {
    await this.ensureDefault();
    const rows = await Station.find(activeOnly ? { isActive: true } : {})
      .populate('categories', 'name')
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return rows.map(toStation);
  },

  /** Active stations as plain documents, catch-all first. */
  async active() {
    await this.ensureDefault();
    return Station.find({ isActive: true }).sort({ isDefault: -1, sortOrder: 1, createdAt: 1 }).lean();
  },

  /** Find an active station by id or slug (the kitchen screen's `?station=`). */
  async resolve(idOrSlug) {
    if (!idOrSlug) return null;
    const key = String(idOrSlug);
    const station = await Station.findOne(
      mongoose.isValidObjectId(key) ? { _id: key } : { slug: key.toLowerCase() },
    ).lean();
    if (!station || !station.isActive) throw ApiError.notFound('Station');
    return station;
  },

  /**
   * Which station prepares each line, by category.
   * @param {Array<{product?: any}>} items
   * @param {Array} [stations] active stations, if the caller already has them
   * @returns {Promise<Array<object>>} one station document per line
   */
  async routeLines(items, stations) {
    const pool = stations ?? (await this.active());
    const fallback = pool.find((s) => s.isDefault) ?? pool[0] ?? null;

    const byCategory = new Map();
    for (const station of pool) {
      for (const category of station.categories ?? []) byCategory.set(String(category), station);
    }

    const productIds = [...new Set(items.map((i) => i.product && String(i.product)).filter(Boolean))];
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } })
          .select('category')
          .lean()
      : [];
    const categoryOf = new Map(products.map((p) => [String(p._id), p.category && String(p.category)]));

    return items.map((item) => byCategory.get(categoryOf.get(String(item.product))) ?? fallback);
  },

  async create(body) {
    const categories = toIds(body.categories);
    await assertCategoriesExist(categories);

    const isDefault = Boolean(body.isDefault);
    let station;
    try {
      station = await Station.create({
        name: body.name,
        color: body.color ?? STATION_COLORS[(await Station.countDocuments()) % STATION_COLORS.length],
        categories: [],
        isDefault: false,
        isActive: isDefault ? true : body.isActive !== false,
        sortOrder: await Station.countDocuments(),
      });
    } catch (error) {
      throw duplicateName(error, body.name);
    }

    await this.assignCategories(station._id, categories);
    if (isDefault) await this.makeDefault(station._id);
    return this.changed(station._id);
  },

  async update(id, body) {
    const station = await Station.findById(id);
    if (!station) throw ApiError.notFound('Station');

    if (station.isDefault && body.isDefault === false) {
      throw ApiError.badRequest('Make another station the catch-all first.');
    }
    if (station.isDefault && body.isActive === false) {
      throw ApiError.badRequest(
        'The catch-all station cannot be switched off. Make another station the catch-all first.',
      );
    }

    if (body.name !== undefined) station.name = body.name;
    if (body.color !== undefined) station.color = body.color;
    if (body.isActive !== undefined) station.isActive = body.isActive;
    if (body.sortOrder !== undefined) station.sortOrder = body.sortOrder;
    try {
      await station.save();
    } catch (error) {
      throw duplicateName(error, body.name);
    }

    if (body.categories !== undefined) {
      const categories = toIds(body.categories);
      await assertCategoriesExist(categories);
      await this.assignCategories(station._id, categories);
    }
    if (body.isDefault === true) await this.makeDefault(station._id);
    return this.changed(station._id);
  },

  async remove(id) {
    const station = await Station.findById(id).lean();
    if (!station) throw ApiError.notFound('Station');
    if (station.isDefault) {
      throw ApiError.badRequest(
        'The catch-all station cannot be deleted. Make another station the catch-all first.',
      );
    }

    const busy = await Order.exists({
      status: { $in: KITCHEN_ACTIVE },
      'kitchen.stations': { $elemMatch: { station: station._id, readyAt: null } },
    });
    if (busy) {
      throw ApiError.conflict(
        `${station.name} still has orders in progress. Finish them first, or switch it off.`,
      );
    }

    await Station.deleteOne({ _id: station._id });
    realtime.settingsChanged(['stations']);
    return { id: String(station._id), message: `${station.name} deleted` };
  },

  /** A category belongs to one station: giving it to this one takes it from any other. */
  async assignCategories(stationId, categories) {
    await Station.updateMany(
      { _id: { $ne: stationId }, categories: { $in: categories } },
      { $pull: { categories: { $in: categories } } },
    );
    await Station.updateOne({ _id: stationId }, { $set: { categories } });
  },

  async makeDefault(stationId) {
    await Station.updateMany({ _id: { $ne: stationId } }, { $set: { isDefault: false } });
    await Station.updateOne({ _id: stationId }, { $set: { isDefault: true, isActive: true } });
  },

  async changed(stationId) {
    realtime.settingsChanged(['stations']);
    const station = await Station.findById(stationId).populate('categories', 'name').lean();
    return toStation(station);
  },
};

export default stationService;
