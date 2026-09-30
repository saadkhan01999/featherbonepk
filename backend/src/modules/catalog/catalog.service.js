/**
 * Catalogue service — reads for the storefront and the till.
 * ---------------------------------------------------------------------------
 * Both surfaces share this so the menu can never disagree with the till.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { escapeRegex } from '../../core/utils/regex.util.js';
import { serializeProduct, serializeProducts } from './product.serializer.js';
import { Category } from './category.model.js';
import { Product } from './product.model.js';
import { Order } from '../orders/order.model.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../../core/constants/payments.js';

/** Fields safe to expose publicly. Note the absence of `costPrice`. */
const PUBLIC_FIELDS = '-costPrice';

/**
 * Mongo condition for "sold on this channel".
 * ---------------------------------------------------------------------------
 * A plain `{ channels: 'pos' }` is wrong, and wrong in a way that empties the
 * whole menu.
 *
 * `channels` was added to a schema that already had records in it, and a
 * Mongoose `default` only fires when a document is created — it does not
 * retro-fit anything already stored. So every product and category that existed
 * before the field was introduced has no `channels` key at all, matches no
 * equality test, and vanished from both the website and the till at once.
 *
 * A missing or empty list therefore means "everywhere", which is also the right
 * reading on its own terms: a record that has never been told where it belongs
 * should stay visible rather than silently disappear. `scripts/backfill-channels.mjs`
 * fills them in properly; this keeps a database that has not been migrated yet
 * working rather than blank.
 */
function channelFilter(channel) {
  if (!channel) return {};
  return {
    $or: [{ channels: channel }, { channels: { $exists: false } }, { channels: { $size: 0 } }],
  };
}

export const catalogService = {
  /** Active categories in merchandising order. */
  /**
   * @param {object} [options]
   * @param {boolean} [options.includeInactive]
   * @param {string|null} [options.store] Return only categories this counter
   *   actually sells. Without it the bakery till shows a "Roast Chicken" filter
   *   chip that yields an empty grid — a control that does nothing is worse
   *   than an absent one, because the cashier retries it.
   */
  async listCategories({ includeInactive = false, store = null, channel, menuFilter = {} } = {}) {
    const filter = includeInactive ? {} : { isActive: true };
    Object.assign(filter, channelFilter(channel));

    const hasMenu = Object.keys(menuFilter).length > 0;

    if (store || hasMenu) {
      // Derived from the goods on sale rather than stored on the category:
      // a category is not owned by a counter, it simply has items there.
      /*
       * `$and`, because both conditions already use `$or` — channel-or-legacy
       * and store-or-global. Two bare `$or` keys in one object would silently
       * overwrite each other and widen the query to everything.
       */
      const ids = await Product.distinct('category', {
        isActive: true,
        $and: [
          channelFilter(channel),
          store ? { $or: [{ store: new mongoose.Types.ObjectId(String(store)) }, { store: null }] } : {},
          // A till limited to "Bakery" shows only the Bakery chip.
          menuFilter,
        ].filter((c) => Object.keys(c).length > 0),
      });
      filter._id = { $in: ids };
    }

    return Category.find(filter).sort({ displayOrder: 1, name: 1 }).lean();
  },

  /**
   * Products for a menu or till grid.
   * Pagination is always applied — an unbounded product query is fine with 30
   * items and a problem with 3,000.
   */
  async listProducts({
    category,
    search,
    featured,
    bestSeller,
    page = 1,
    limit = 24,
    sort = 'featured',
    includeInactive = false,
    store,
    channel,
    // A till's own menu scope — see terminalMenuScope. `{}` means unlimited.
    menuFilter = {},
  } = {}) {
    const filter = {};
    if (!includeInactive) filter.isActive = true;

    /*
     * Channel scoping.
     *
     * `web` for the customer site, `pos` for the till. An item carries the
     * channels it is sold on, so the owner can keep an order-ahead platter off
     * the counter grid and a tray of fresh naan off the website — while both
     * still draw down one stock count. Two separate catalogues would be the
     * obvious alternative and the wrong one: that is how a shop ends up selling
     * something online that the kitchen retired last week.
     *
     * Omitting it means "every channel", which is what the back office wants:
     * an admin managing the catalogue must see everything they can edit.
     */
    /*
     * Conditions that each need their own `$or` are collected here and combined
     * under a single `$and` at the end.
     *
     * Why: assigning `filter.$or` more than once silently replaces the previous
     * one — an object cannot have two keys of the same name. Channel, store and
     * search each want an `$or`, so written the obvious way the last one wins
     * and the others evaporate. That is not a hypothetical: searching at a till
     * dropped the store scoping entirely, so a cashier typing a name saw other
     * counters' goods.
     */
    const clauses = [];
    const channelClause = channelFilter(channel);
    if (Object.keys(channelClause).length) clauses.push(channelClause);

    /*
     * Store scoping.
     *
     * A till at the bakery must see bakery items plus anything global
     * (`store: null`) — bottled drinks are sold at every counter and exist once
     * in stock, not once per counter.
     *
     * Omitting `store` means "no scoping", which is what the public website
     * wants: a customer browsing online is buying from the business, not from a
     * particular till.
     */
    if (store) {
      clauses.push({
        $or: [{ store: new mongoose.Types.ObjectId(String(store)) }, { store: null }],
      });
    }

    if (category) {
      // Accept either an id or a slug, so callers don't need a lookup first.
      const categoryDoc = /^[0-9a-fA-F]{24}$/.test(category)
        ? { _id: category }
        : await Category.findOne({ slug: category }).select('_id').lean();
      if (!categoryDoc) throw ApiError.notFound('Category');
      filter.category = categoryDoc._id;
    }

    if (search) {
      // Regex rather than $text: shoppers type partial words ("chick"), which
      // a text index does not match because it searches whole tokens.
      const safe = escapeRegex(search.trim());
      clauses.push({ $or: [{ name: new RegExp(safe, 'i') }, { sku: new RegExp(safe, 'i') }] });
    }

    if (featured) filter.isFeatured = true;
    if (bestSeller) filter.isBestSeller = true;

    if (Object.keys(menuFilter).length) clauses.push(menuFilter);

    if (clauses.length) filter.$and = clauses;

    const SORTS = {
      featured: { isFeatured: -1, soldCount: -1 },
      newest: { createdAt: -1 },
      'price-asc': { price: 1 },
      'price-desc': { price: -1 },
      popular: { soldCount: -1 },
      rating: { ratingAverage: -1 },
      name: { name: 1 },
    };

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Product.find(filter)
        .select(PUBLIC_FIELDS)
        .populate('category', 'name slug')
        .sort(SORTS[sort] ?? SORTS.featured)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    return { items: serializeProducts(items), total, page, limit };
  },

  /**
   * Best sellers for the homepage, decided by what actually sells.
   *
   * Ranking, in order:
   *   1. items the owner pinned as best sellers (a deliberate promotion wins);
   *   2. the most units sold in paid, non-cancelled orders over the last
   *      `days` days — website and tills together, because a dish that flies
   *      off the counter is a best seller whichever door it left by;
   *   3. then all-time popularity, featured items and the newest, so a
   *      brand-new shop still shows a full row rather than a gap.
   *
   * Only items that are on sale on the website are returned — a counter-only
   * line cannot be put in a basket online.
   */
  async bestSellers({ limit = 8, days = 90 } = {}) {
    const visible = { isActive: true, ...channelFilter('web') };
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [pinned, sales] = await Promise.all([
      Product.find({ ...visible, isBestSeller: true })
        .select(PUBLIC_FIELDS)
        .populate('category', 'name slug')
        .sort({ soldCount: -1 })
        .limit(limit)
        .lean(),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: since },
            paymentStatus: PAYMENT_STATUS.PAID,
            status: { $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED] },
          },
        },
        { $unwind: '$items' },
        { $group: { _id: '$items.product', units: { $sum: '$items.quantity' }, orders: { $sum: 1 } } },
        { $sort: { units: -1, orders: -1 } },
        { $limit: 100 },
      ]),
    ]);

    const chosen = new Map(pinned.map((p) => [String(p._id), p]));

    if (chosen.size < limit && sales.length) {
      const ranked = await Product.find({ ...visible, _id: { $in: sales.map((s) => s._id) } })
        .select(PUBLIC_FIELDS)
        .populate('category', 'name slug')
        .lean();
      const byId = new Map(ranked.map((p) => [String(p._id), p]));
      for (const { _id } of sales) {
        const product = byId.get(String(_id));
        if (product && !chosen.has(String(_id))) chosen.set(String(_id), product);
        if (chosen.size >= limit) break;
      }
    }

    if (chosen.size < limit) {
      const fill = await Product.find({
        ...visible,
        _id: { $nin: [...chosen.keys()].map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select(PUBLIC_FIELDS)
        .populate('category', 'name slug')
        .sort({ soldCount: -1, isFeatured: -1, createdAt: -1 })
        .limit(limit - chosen.size)
        .lean();
      for (const product of fill) chosen.set(String(product._id), product);
    }

    const units = new Map(sales.map((s) => [String(s._id), s.units]));
    return serializeProducts([...chosen.values()]).map((product) => ({
      ...product,
      // Why it is here — the card can show "Best seller" for real ones only.
      isBestSeller: Boolean(product.isBestSeller) || (units.get(String(product.id)) ?? 0) > 0,
    }));
  },

  /** One product by slug, for the details page. */
  async getProductBySlug(slug) {
    const product = await Product.findOne({ slug, isActive: true, channels: 'web' })
      .select(PUBLIC_FIELDS)
      .populate('category', 'name slug')
      .lean();

    if (!product) throw ApiError.notFound('Product');
    return serializeProduct(product);
  },

  /**
   * Resolve a scanned code to exactly one product.
   *
   * Exact match only — barcode or SKU, never a fuzzy name search.
   *
   * This is the single most safety-critical read in the POS. A barcode gun
   * types and presses Enter in ~40ms, far faster than any debounced search can
   * settle, so resolving a scan against a stale search result list will
   * silently bill the previous item: wrong money taken, wrong stock
   * decremented, wrong product in every report. A cashier cannot review a
   * candidate list mid-scan, so failing loudly is strictly better than guessing.
   */
  /**
   * @param {string} code
   * @param {object} [options]
   * @param {string|null} [options.store] The counter doing the scanning. Given
   *   by the till so a bakery barcode scanned at the chicken counter is refused
   *   at the scan — the moment the cashier can still react — rather than at
   *   payment, after the customer has been quoted a price.
   */
  async resolveScannedCode(code, { store = null, channel, menuFilter = {} } = {}) {
    const trimmed = String(code ?? '').trim();
    if (!trimmed) throw ApiError.badRequest('No code supplied');

    /*
     * `$or` is spent on barcode-vs-SKU, so every other either/or condition has
     * to live under `$and`. A second top-level `$or` would silently replace the
     * first and turn a code lookup into "any product at this counter".
     */
    const extra = [];
    const scanChannel = channelFilter(channel);
    if (Object.keys(scanChannel).length) extra.push(scanChannel);
    // Goods with no store are sold everywhere, so they must stay scannable.
    if (store) {
      extra.push({
        $or: [{ store: new mongoose.Types.ObjectId(String(store)) }, { store: null }],
      });
    }
    // Refused at the scan, where the cashier can still react — same reasoning
    // as the store check above.
    if (Object.keys(menuFilter).length) extra.push(menuFilter);

    const product = await Product.findOne({
      isActive: true,
      $or: [{ barcode: trimmed }, { sku: trimmed.toUpperCase() }],
      ...(extra.length && { $and: extra }),
    })
      .select(PUBLIC_FIELDS)
      .populate('category', 'name slug')
      .lean();

    if (!product) {
      // Plain 404 rather than ApiError.notFound(), which appends "not found"
      // and would read "No product with code X not found".
      throw new ApiError(404, `No product matches code "${trimmed}"`, { code: 'PRODUCT_NOT_FOUND' });
    }
    return serializeProduct(product);
  },
};

export default catalogService;
