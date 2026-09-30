/**
 * Dashboard aggregation.
 * ---------------------------------------------------------------------------
 * Assembles the back-office overview in one round trip. A dozen small endpoints
 * would make the dashboard's load time the sum of a dozen latencies and its
 * correctness dependent on a dozen partial failures.
 */
import { Category } from '../catalog/category.model.js';
import { Product } from '../catalog/product.model.js';
import { User } from '../users/user.model.js';
import { Order } from '../orders/order.model.js';
import { ROLES } from '../../core/constants/roles.js';
import { Terminal } from '../pos/terminal.model.js';
import { settingsService } from '../settings/settings.service.js';

/**
 * Reporting timezone — the single most important line in this file.
 *
 * Mongo buckets dates in UTC unless told otherwise. Pakistan is UTC+5, so a
 * sale at 02:00 Karachi time would be bucketed into the previous day, quietly
 * moving revenue between days, weeks and months. Every date expression below
 * passes this explicitly.
 */
const TZ = 'Asia/Karachi';

/**
 * Bucket formats for the trend chart.
 *
 * Weekly uses `%G-W%V` (ISO year + ISO week), not `%Y-W%V`. In early January
 * the ISO week can belong to the previous ISO year, so pairing an ISO week with
 * a calendar year creates a duplicate or misplaced bucket every New Year.
 */
const BUCKET_FORMAT = { daily: '%Y-%m-%d', weekly: '%G-W%V', monthly: '%Y-%m' };

/** Revenue counts only orders that completed and were actually paid for. */
const COUNTED = { status: { $nin: ['cancelled', 'refunded'] }, paymentStatus: 'paid' };

const sinceDate = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * How far through first-time setup is this business?
 *
 * A brand-new install shows zeroes on every tile and no hint of what to do
 * next; the owner's first screen is a dead end. These four booleans drive the
 * checklist that replaces it, and the whole thing disappears once the shop is
 * running.
 */
async function setupProgress() {
  const [categories, products, terminals, staff] = await Promise.all([
    Category.countDocuments({}),
    Product.countDocuments({}),
    Terminal.countDocuments({}),
    // Beyond the owner, who always exists — counting them would mark this step
    // complete before anyone had been hired.
    User.countDocuments({ role: { $nin: [ROLES.CUSTOMER, ROLES.SUPER_ADMIN] } }),
  ]);

  return {
    categories,
    products,
    terminals,
    staff,
    // The details that appear on a customer's receipt and the contact page.
    // `settingsService.get` is synchronous — it reads the warmed cache.
    businessConfigured: Boolean(
      settingsService.get('businessPhone') && settingsService.get('businessAddress'),
    ),
  };
}

export const dashboardService = {
  /**
   * @param {object}  [options]
   * @param {number}  [options.days=30]        Window size.
   * @param {string}  [options.period='daily'] Trend granularity.
   */
  /**
   * Dashboard, shaped by what the caller may see.
   *
   * `can` is the permission predicate from the request. Panels the account has
   * no permission for are not computed and not returned — so an inventory
   * manager gets stock panels and no revenue, and the money figures never leave
   * the server for someone who may not see them.
   *
   * This also replaces a blanket `report.view` gate on the route, which made
   * the landing page 403 outright for anyone without it. A back office whose
   * front door errors is not a permission model, it is a bug.
   *
   * @param {(permission: string) => boolean} can
   */
  async overview({ days = 30, period = 'daily' } = {}, can = () => true) {
    const wantsRevenue = can('report.view');
    const wantsStock = can('inventory.view') || can('product.view');
    const wantsPeople = can('employee.view');

    // Independent aggregations run concurrently — in series the dashboard would
    // be as slow as their sum. Anything not permitted resolves to null without
    // touching the database.
    const [
      catalogue,
      stock,
      people,
      topSellers,
      lowStock,
      recentProducts,
      revenue,
      trend,
      byCategory,
      byMethod,
    ] = await Promise.all([
      wantsStock ? catalogueStats() : null,
      wantsStock ? stockStats() : null,
      wantsPeople ? peopleStats() : null,
      wantsRevenue ? topSellingProducts() : null,
      wantsStock ? lowStockAlerts() : null,
      wantsStock ? recentlyUpdatedProducts() : null,
      wantsRevenue ? revenueSummary(days) : null,
      wantsRevenue ? revenueTrend(period, days) : null,
      wantsRevenue ? salesByCategory(days) : null,
      wantsRevenue ? salesByPaymentMethod(days) : null,
    ]);

    /*
     * A first-run snapshot, computed here so the dashboard needs one request
     * rather than five. Cheap: three counts and one settings read, all indexed.
     *
     * Returned for everyone, because "is this shop set up yet" is not sensitive
     * — and the checklist that renders it links only to screens the account can
     * already reach.
     */
    const setup = await setupProgress();

    return {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      period,
      timezone: TZ,
      /** What the client should render. Saves it re-deriving the same rules. */
      sections: { revenue: wantsRevenue, stock: wantsStock, people: wantsPeople },
      setup,
      catalogue,
      stock,
      people,
      topSellers,
      lowStock,
      recentProducts,
      revenue,
      trend,
      byCategory,
      byMethod,
    };
  },
};

// --- Catalogue -------------------------------------------------------------

async function catalogueStats() {
  const [totalProducts, activeProducts, featured, totalCategories, activeCategories] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isFeatured: true }),
    Category.countDocuments(),
    Category.countDocuments({ isActive: true }),
  ]);

  return {
    totalProducts,
    activeProducts,
    inactiveProducts: totalProducts - activeProducts,
    featured,
    totalCategories,
    activeCategories,
  };
}

async function stockStats() {
  // One pass computing every bucket, rather than four countDocuments calls.
  const [result] = await Product.aggregate([
    {
      $group: {
        _id: null,
        totalUnits: { $sum: '$stock' },
        outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
        low: {
          $sum: {
            $cond: [{ $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] }, 1, 0],
          },
        },
        // Valued at retail — what it would sell for, not what it cost. The
        // basis is returned alongside so the figure can't be misread.
        retailValue: { $sum: { $multiply: ['$stock', '$price'] } },
      },
    },
  ]);

  return {
    totalUnits: result?.totalUnits ?? 0,
    outOfStock: result?.outOfStock ?? 0,
    lowStock: result?.low ?? 0,
    retailValue: Math.round(result?.retailValue ?? 0),
    valuationBasis: 'retail',
  };
}

async function peopleStats() {
  const [totalCustomers, totalStaff, activeStaff] = await Promise.all([
    User.countDocuments({ role: ROLES.CUSTOMER }),
    User.countDocuments({ role: { $ne: ROLES.CUSTOMER } }),
    User.countDocuments({ role: { $ne: ROLES.CUSTOMER }, status: 'active' }),
  ]);
  return { totalCustomers, totalStaff, activeStaff };
}

// --- Revenue ---------------------------------------------------------------

async function revenueSummary(days) {
  const since = sinceDate(days);
  const previousStart = sinceDate(days * 2);

  const [current, previous] = await Promise.all([
    Order.aggregate([
      { $match: { ...COUNTED, createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
          online: { $sum: { $cond: [{ $eq: ['$channel', 'online'] }, '$total', 0] } },
          pos: { $sum: { $cond: [{ $eq: ['$channel', 'pos'] }, '$total', 0] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...COUNTED, createdAt: { $gte: previousStart, $lt: since } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]),
  ]);

  const now = current[0] ?? { revenue: 0, orders: 0, online: 0, pos: 0 };
  const before = previous[0] ?? { revenue: 0, orders: 0 };

  /**
   * Growth is null with no baseline, never 0%.
   * "0% growth" and "no comparable period" mean entirely different things, and
   * showing the former for the latter misleads on a new or quiet account.
   */
  const growth = (a, b) => (b > 0 ? Number((((a - b) / b) * 100).toFixed(1)) : null);

  return {
    total: Math.round(now.revenue),
    orders: now.orders,
    online: Math.round(now.online),
    pos: Math.round(now.pos),
    averageOrderValue: now.orders > 0 ? Math.round(now.revenue / now.orders) : 0,
    revenueGrowth: growth(now.revenue, before.revenue),
    orderGrowth: growth(now.orders, before.orders),
    comparedToDays: days,
  };
}

/** Time series for the revenue chart, bucketed by the requested period. */
async function revenueTrend(period, days) {
  const format = BUCKET_FORMAT[period] ?? BUCKET_FORMAT.daily;

  const rows = await Order.aggregate([
    { $match: { ...COUNTED, createdAt: { $gte: sinceDate(days) } } },
    {
      $group: {
        _id: { $dateToString: { format, date: '$createdAt', timezone: TZ } },
        revenue: { $sum: '$total' },
        orders: { $sum: 1 },
        online: { $sum: { $cond: [{ $eq: ['$channel', 'online'] }, '$total', 0] } },
        pos: { $sum: { $cond: [{ $eq: ['$channel', 'pos'] }, '$total', 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({
    bucket: row._id,
    revenue: Math.round(row.revenue),
    orders: row.orders,
    online: Math.round(row.online),
    pos: Math.round(row.pos),
  }));
}

/** Revenue split by menu category — the donut in the reference design. */
async function salesByCategory(days) {
  const rows = await Order.aggregate([
    { $match: { ...COUNTED, createdAt: { $gte: sinceDate(days) } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', revenue: { $sum: '$items.lineTotal' } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $group: { _id: '$product.category', revenue: { $sum: '$revenue' } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
    { $unwind: '$category' },
    { $project: { _id: 0, name: '$category.name', revenue: { $round: ['$revenue', 0] } } },
    { $sort: { revenue: -1 } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.revenue, 0);
  return rows.map((row) => ({
    ...row,
    percent: total > 0 ? Number(((row.revenue / total) * 100).toFixed(1)) : 0,
  }));
}

/** How customers paid — drives the payment-mix panel. */
async function salesByPaymentMethod(days) {
  const rows = await Order.aggregate([
    { $match: { ...COUNTED, createdAt: { $gte: sinceDate(days) } } },
    { $group: { _id: '$paymentMethod', revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
    { $sort: { revenue: -1 } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.revenue, 0);
  return rows.map((row) => ({
    method: row._id,
    revenue: Math.round(row.revenue),
    orders: row.orders,
    percent: total > 0 ? Number(((row.revenue / total) * 100).toFixed(1)) : 0,
  }));
}

// --- Catalogue detail panels ----------------------------------------------

async function topSellingProducts(limit = 5) {
  const products = await Product.find({ soldCount: { $gt: 0 } })
    .select('name soldCount price image')
    .sort({ soldCount: -1 })
    .limit(limit)
    .lean();

  return products.map((p) => ({
    id: String(p._id),
    name: p.name,
    soldCount: p.soldCount,
    image: p.image ?? null,
    revenue: Math.round(p.soldCount * p.price),
  }));
}

async function lowStockAlerts(limit = 6) {
  const products = await Product.find({
    isActive: true,
    $expr: { $lte: ['$stock', '$lowStockThreshold'] },
  })
    .select('name stock unit lowStockThreshold')
    .populate('category', 'name')
    .sort({ stock: 1 })
    .limit(limit)
    .lean();

  return products.map((p) => ({
    id: String(p._id),
    name: p.name,
    category: p.category?.name ?? '—',
    stock: p.stock,
    unit: p.unit,
    // Three levels so "reorder soon" is distinguishable from "we are out".
    severity: p.stock <= 0 ? 'out' : p.stock <= p.lowStockThreshold / 2 ? 'critical' : 'low',
  }));
}

async function recentlyUpdatedProducts(limit = 5) {
  const products = await Product.find()
    .select('name updatedAt isActive image')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return products.map((p) => ({
    id: String(p._id),
    name: p.name,
    image: p.image ?? null,
    isActive: p.isActive,
    updatedAt: p.updatedAt,
  }));
}

export default dashboardService;
