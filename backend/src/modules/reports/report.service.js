/**
 * Reports.
 * ---------------------------------------------------------------------------
 * One report document, three renderings.
 *
 * Every report builds the same shape:
 *
 *   { kpis: [...], sections: [{ title, columns, rows, totals }] }
 *
 * and that one document is what the screen shows (View), what the CSV
 * contains and what the PDF prints. Nothing is computed twice, so the figure on
 * the screen, the figure in the spreadsheet and the figure on paper cannot
 * disagree — which is the first thing an accountant checks.
 *
 * Scope — whose sales. Every sales report takes the same scope:
 *
 *   all        the whole business (website + every till)
 *   online     the website only
 *   pos        every till together
 *   terminal   one till (`terminal=TILL-01`)
 *
 * plus the existing counter (`store`) filter, which a store-assigned manager
 * cannot widen.
 *
 * Timezone: every date expression passes `Asia/Karachi` explicitly. Mongo
 * buckets in UTC otherwise, and a 02:00 Karachi sale would be counted on the
 * previous day — silently shifting revenue between periods.
 *
 * Date ranges are half-open: `[from, to)`. Using `$lte: endOfDay` invites the
 * classic off-by-a-millisecond bug where a 23:59:59.999 sale is included or
 * excluded depending on how the boundary was constructed.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { Order } from '../orders/order.model.js';
import { Product } from '../catalog/product.model.js';
import { Terminal } from '../pos/terminal.model.js';
import { User } from '../users/user.model.js';
import { StockMovement, MOVEMENT_TYPE_VALUES } from '../inventory/stock-movement.model.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { visibleStoreIds } from '../stores/store.service.js';
import { formatCell } from './report.pdf.js';

const TZ = 'Asia/Karachi';

/** Orders that count as trade: not cancelled or refunded, and actually paid. */
const COUNTED = { status: { $nin: ['cancelled', 'refunded'] }, paymentStatus: 'paid' };

/** Row ceilings — generous for files, bounded for the screen and for paper. */
const LIMITS = {
  view: { register: 300, movements: 500 },
  csv: { register: 50_000, movements: 50_000 },
  pdf: { register: 3_000, movements: 3_000 },
};

const METHOD_LABEL = {
  cash: 'Cash',
  card: 'Card',
  cod: 'Cash on Delivery',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
  bank_transfer: 'Bank Transfer',
};

const TYPE_LABEL = { dine_in: 'Dine In', take_away: 'Take Away', delivery: 'Delivery' };

/* ------------------------------------------------------------------------ */
/* Dates                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Parse a calendar date (YYYY-MM-DD) as local midnight in the business zone.
 *
 * `new Date('2026-07-27')` parses as UTC midnight — which is 05:00 in Karachi,
 * so a custom range would silently include five hours of the wrong day. This
 * derives the offset from Intl rather than hard-coding +5, so it stays correct
 * if the zone ever observes DST.
 */
function localMidnightUtc(dateString, endOfDay = false) {
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) throw ApiError.badRequest(`Invalid date: ${dateString}`);

  // Probe the zone's offset on that date.
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const local = new Date(probe.toLocaleString('en-US', { timeZone: TZ }));
  const offsetMs = probe.getTime() - local.getTime();

  const base = Date.UTC(year, month - 1, day + (endOfDay ? 1 : 0));
  return new Date(base + offsetMs);
}

const PRESET_LABEL = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
  quarter: 'Last 90 days',
  year: 'Last 365 days',
};

/** Resolve a preset or custom range into `{ from, to }` (to is exclusive). */
export function resolveRange({ preset = 'month', from, to } = {}) {
  const now = new Date();
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);

  if (preset === 'custom') {
    if (!from || !to) throw ApiError.badRequest('A custom range needs both a start and an end date');
    const start = localMidnightUtc(from);
    const end = localMidnightUtc(to, true);
    if (start >= end) throw ApiError.badRequest('The start date must be before the end date');
    return { from: start, to: end, label: `${from} → ${to}`, display: `${from} to ${to}` };
  }

  const DAYS = { today: 0, week: 6, month: 29, quarter: 89, year: 364 };
  const back = DAYS[preset];
  if (back === undefined) throw ApiError.badRequest(`Unknown range: ${preset}`);

  const end = localMidnightUtc(todayLocal, true);
  const startDate = new Date(localMidnightUtc(todayLocal).getTime() - back * 86_400_000);
  const startLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(startDate);
  return {
    from: startDate,
    to: end,
    label: preset,
    display: `${PRESET_LABEL[preset]} (${startLocal} to ${todayLocal})`,
  };
}

/* ------------------------------------------------------------------------ */
/* Context                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * The `$match` every sales aggregation opens with.
 *
 * Centralised so the store and scope filters cannot be forgotten in one report
 * and applied in the others — which is exactly how a counter manager ends up
 * reading another counter's takings.
 *
 * Filtering by store necessarily excludes online orders: a web order is placed
 * with the business, not at a counter, so it carries no store.
 */
function orderMatch(ctx, extra = {}) {
  const match = { ...extra, createdAt: { $gte: ctx.from, $lt: ctx.to } };
  if (ctx.store) match.store = new mongoose.Types.ObjectId(String(ctx.store));
  if (ctx.channel) match.channel = ctx.channel;
  if (ctx.terminal) match.terminalId = ctx.terminal;
  return match;
}

/** `code → name` for every till, for readable rows. */
async function terminalNames() {
  const terminals = await Terminal.find().select('code name').lean();
  return new Map(terminals.map((t) => [t.code, t.name]));
}

/** Resolve the requested scope into filters and a sentence for the header. */
async function resolveScope({ scope = 'all', terminal } = {}) {
  if (scope === 'online')
    return { key: 'online', channel: 'online', terminal: null, label: 'Website orders' };
  if (scope === 'pos')
    return { key: 'pos', channel: 'pos', terminal: null, label: 'All tills (counter sales)' };
  if (scope === 'terminal') {
    if (!terminal) throw ApiError.badRequest('Choose which till to report on');
    const code = String(terminal).toUpperCase();
    const record = await Terminal.findOne({ code }).select('code name store').lean();
    if (!record) throw ApiError.notFound(`Till ${code}`);
    return {
      key: `terminal:${code}`,
      channel: 'pos',
      terminal: code,
      terminalStore: record.store ? String(record.store) : null,
      label: `Till ${code} — ${record.name}`,
    };
  }
  return { key: 'all', channel: null, terminal: null, label: 'Whole business (website + all tills)' };
}

/* ------------------------------------------------------------------------ */
/* Column sets                                                               */
/* ------------------------------------------------------------------------ */

const COLUMNS = {
  daily: [
    { key: 'bucket', label: 'Date' },
    { key: 'orders', label: 'Orders', numeric: true },
    { key: 'items', label: 'Items Sold', numeric: true },
    { key: 'online', label: 'Website', money: true },
    { key: 'pos', label: 'Tills', money: true },
    { key: 'discount', label: 'Discounts', money: true },
    { key: 'tax', label: 'Tax', money: true },
    { key: 'revenue', label: 'Total Revenue', money: true },
  ],
  products: [
    { key: 'name', label: 'Product', width: 2 },
    { key: 'category', label: 'Category' },
    { key: 'quantity', label: 'Units Sold', numeric: true },
    { key: 'orders', label: 'Orders', numeric: true },
    { key: 'avgPrice', label: 'Avg Price', money: true, noTotal: true },
    { key: 'revenue', label: 'Revenue', money: true },
    {
      key: 'share',
      label: 'Share %',
      numeric: true,
      // Shares of one whole — recomputed rather than summed.
      totalFrom: (t) => (t.revenue ? 100 : 0),
    },
  ],
  categories: [
    { key: 'name', label: 'Category', width: 2 },
    { key: 'quantity', label: 'Units', numeric: true },
    { key: 'revenue', label: 'Revenue', money: true },
    // Shares of one whole, so they legitimately sum to 100.
    { key: 'percent', label: 'Share %', numeric: true },
  ],
  payments: [
    { key: 'method', label: 'Method' },
    { key: 'orders', label: 'Orders', numeric: true },
    { key: 'revenue', label: 'Revenue', money: true },
    { key: 'percent', label: 'Share %', numeric: true },
  ],
  tills: [
    { key: 'till', label: 'Till / Channel', width: 2 },
    { key: 'orders', label: 'Orders', numeric: true },
    { key: 'items', label: 'Items', numeric: true },
    { key: 'cash', label: 'Cash', money: true },
    { key: 'card', label: 'Card', money: true },
    { key: 'wallet', label: 'Wallets', money: true },
    { key: 'other', label: 'Other', money: true },
    { key: 'discount', label: 'Discounts', money: true },
    { key: 'revenue', label: 'Revenue', money: true },
    {
      key: 'averageTicket',
      label: 'Avg Ticket',
      money: true,
      totalFrom: (t) => (t.orders ? Math.round(t.revenue / t.orders) : 0),
    },
  ],
  hourly: [
    { key: 'hour', label: 'Hour' },
    { key: 'orders', label: 'Orders', numeric: true },
    { key: 'revenue', label: 'Revenue', money: true },
  ],
  register: [
    { key: 'at', label: 'Date & Time', datetime: true },
    { key: 'orderNumber', label: 'Order / Invoice', width: 1.7 },
    { key: 'ticket', label: 'Ticket', width: 0.6 },
    { key: 'source', label: 'Till / Channel', width: 1.4 },
    { key: 'cashier', label: 'Cashier', width: 1.2 },
    { key: 'customer', label: 'Customer', width: 1.3 },
    { key: 'type', label: 'Type', width: 0.9 },
    { key: 'method', label: 'Payment', width: 1 },
    { key: 'items', label: 'Items', width: 2.6 },
    { key: 'discount', label: 'Discount', money: true },
    { key: 'tax', label: 'Tax', money: true },
    { key: 'total', label: 'Total', money: true },
  ],
};

/* ------------------------------------------------------------------------ */
/* Aggregations (each returns rows)                                          */
/* ------------------------------------------------------------------------ */

async function dailyRows(ctx) {
  return Order.aggregate([
    { $match: orderMatch(ctx, COUNTED) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
        orders: { $sum: 1 },
        items: { $sum: { $sum: '$items.quantity' } },
        revenue: { $sum: '$total' },
        discount: { $sum: '$discount' },
        tax: { $sum: '$tax' },
        online: { $sum: { $cond: [{ $eq: ['$channel', 'online'] }, '$total', 0] } },
        pos: { $sum: { $cond: [{ $eq: ['$channel', 'pos'] }, '$total', 0] } },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        bucket: '$_id',
        orders: 1,
        items: { $round: ['$items', 2] },
        revenue: { $round: ['$revenue', 0] },
        discount: { $round: ['$discount', 0] },
        tax: { $round: ['$tax', 0] },
        online: { $round: ['$online', 0] },
        pos: { $round: ['$pos', 0] },
      },
    },
  ]);
}

async function productRows(ctx) {
  const rows = await Order.aggregate([
    { $match: orderMatch(ctx, COUNTED) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        name: { $first: '$items.name' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal' },
        orders: { $sum: 1 },
      },
    },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
    { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
    ...(ctx.category
      ? [{ $match: { 'p.category': new mongoose.Types.ObjectId(String(ctx.category)) } }]
      : []),
    { $lookup: { from: 'categories', localField: 'p.category', foreignField: '_id', as: 'c' } },
    { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        name: 1,
        orders: 1,
        category: { $ifNull: ['$c.name', '—'] },
        quantity: { $round: ['$quantity', 2] },
        revenue: { $round: ['$revenue', 0] },
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  return rows.map((r) => ({
    ...r,
    avgPrice: r.quantity ? Math.round(r.revenue / r.quantity) : 0,
    share: total ? Number(((r.revenue / total) * 100).toFixed(1)) : 0,
  }));
}

async function categoryRows(ctx) {
  const rows = await Order.aggregate([
    { $match: orderMatch(ctx, COUNTED) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal' },
      },
    },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    { $group: { _id: '$p.category', quantity: { $sum: '$quantity' }, revenue: { $sum: '$revenue' } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
    { $unwind: '$c' },
    {
      $project: {
        _id: 0,
        name: '$c.name',
        quantity: { $round: ['$quantity', 2] },
        revenue: { $round: ['$revenue', 0] },
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  return rows.map((r) => ({ ...r, percent: total ? Number(((r.revenue / total) * 100).toFixed(1)) : 0 }));
}

async function paymentRows(ctx) {
  const rows = await Order.aggregate([
    { $match: orderMatch(ctx, COUNTED) },
    { $group: { _id: '$paymentMethod', orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
    { $project: { _id: 0, method: '$_id', orders: 1, revenue: { $round: ['$revenue', 0] } } },
    { $sort: { revenue: -1 } },
  ]);
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  return rows.map((r) => ({
    ...r,
    method: METHOD_LABEL[r.method] ?? r.method ?? '—',
    percent: total ? Number(((r.revenue / total) * 100).toFixed(1)) : 0,
  }));
}

/** One row per till, plus one for the website — the business side by side. */
async function tillRows(ctx) {
  const [rows, names] = await Promise.all([
    Order.aggregate([
      { $match: orderMatch(ctx, COUNTED) },
      {
        $group: {
          _id: { $cond: [{ $eq: ['$channel', 'online'] }, '__online__', '$terminalId'] },
          orders: { $sum: 1 },
          items: { $sum: { $sum: '$items.quantity' } },
          revenue: { $sum: '$total' },
          discount: { $sum: '$discount' },
          cash: { $sum: { $cond: [{ $in: ['$paymentMethod', ['cash', 'cod']] }, '$total', 0] } },
          card: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card'] }, '$total', 0] } },
          wallet: { $sum: { $cond: [{ $in: ['$paymentMethod', ['jazzcash', 'easypaisa']] }, '$total', 0] } },
          other: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'bank_transfer'] }, '$total', 0] } },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    terminalNames(),
  ]);

  return rows.map((row) => ({
    // Not a column — lets a screen match a row to a till card.
    code: row._id === '__online__' ? null : row._id,
    till:
      row._id === '__online__'
        ? 'Website (online orders)'
        : `${row._id ?? 'Unknown till'}${names.get(row._id) ? ` — ${names.get(row._id)}` : ''}`,
    orders: row.orders,
    items: Number(row.items.toFixed(2)),
    cash: Math.round(row.cash),
    card: Math.round(row.card),
    wallet: Math.round(row.wallet),
    other: Math.round(row.other),
    discount: Math.round(row.discount),
    revenue: Math.round(row.revenue),
    averageTicket: row.orders ? Math.round(row.revenue / row.orders) : 0,
  }));
}

async function hourlyRows(ctx) {
  const rows = await Order.aggregate([
    { $match: orderMatch(ctx, COUNTED) },
    {
      $group: {
        _id: { $toInt: { $dateToString: { format: '%H', date: '$createdAt', timezone: TZ } } },
        orders: { $sum: 1 },
        revenue: { $sum: '$total' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const pad = (h) => String(h).padStart(2, '0');
  return rows.map((r) => ({
    hour: `${pad(r._id)}:00 – ${pad((r._id + 1) % 24)}:00`,
    orders: r.orders,
    revenue: Math.round(r.revenue),
  }));
}

/** Every counted sale, newest first — the sales record. */
async function registerRows(ctx, limit) {
  const match = orderMatch(ctx, COUNTED);
  const [orders, totalRows, names] = await Promise.all([
    Order.find(match).sort({ createdAt: -1 }).limit(limit).lean(),
    Order.countDocuments(match),
    terminalNames(),
  ]);

  // Cashier names for till sales, in one query.
  const cashierIds = [
    ...new Set(orders.filter((o) => o.channel === 'pos' && o.placedBy).map((o) => String(o.placedBy))),
  ];
  const cashiers = cashierIds.length
    ? new Map(
        (
          await User.find({ _id: { $in: cashierIds } })
            .select('fullName')
            .lean()
        ).map((u) => [String(u._id), u.fullName]),
      )
    : new Map();

  const rows = orders.map((order) => ({
    at: order.createdAt,
    orderNumber: order.orderNumber,
    ticket: order.ticketNumber ? `#${order.ticketNumber}` : '',
    source:
      order.channel === 'online'
        ? 'Website'
        : `${order.terminalId ?? ''}${names.get(order.terminalId) ? ` ${names.get(order.terminalId)}` : ''}`,
    cashier: order.channel === 'pos' ? (cashiers.get(String(order.placedBy)) ?? '') : '',
    customer: order.customerName ?? '',
    type: TYPE_LABEL[order.orderType ?? (order.channel === 'pos' ? 'take_away' : 'delivery')] ?? '',
    method: METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod ?? '',
    items: (order.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(', '),
    discount: order.discount ?? 0,
    tax: order.tax ?? 0,
    total: order.total,
  }));

  return { rows, totalRows };
}

/** Headline figures for a scope. */
async function salesKpis(ctx) {
  const [row] = await Order.aggregate([
    { $match: orderMatch(ctx, COUNTED) },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        revenue: { $sum: '$total' },
        items: { $sum: { $sum: '$items.quantity' } },
        discount: { $sum: '$discount' },
        tax: { $sum: '$tax' },
        delivery: { $sum: '$deliveryFee' },
        online: { $sum: { $cond: [{ $eq: ['$channel', 'online'] }, '$total', 0] } },
        pos: { $sum: { $cond: [{ $eq: ['$channel', 'pos'] }, '$total', 0] } },
      },
    },
  ]);

  const r = row ?? { orders: 0, revenue: 0, items: 0, discount: 0, tax: 0, delivery: 0, online: 0, pos: 0 };
  const kpis = [
    { key: 'revenue', label: 'Total Revenue', value: Math.round(r.revenue), money: true },
    { key: 'orders', label: 'Orders', value: r.orders, numeric: true },
    {
      key: 'averageOrder',
      label: 'Average Order',
      value: r.orders ? Math.round(r.revenue / r.orders) : 0,
      money: true,
    },
    { key: 'items', label: 'Items Sold', value: Number(r.items.toFixed(2)), numeric: true },
    { key: 'discount', label: 'Discounts Given', value: Math.round(r.discount), money: true },
    { key: 'tax', label: 'Tax Collected', value: Math.round(r.tax), money: true },
  ];

  // The channel split only means something when both channels are in scope.
  if (!ctx.channel) {
    kpis.push(
      { key: 'online', label: 'Website Sales', value: Math.round(r.online), money: true },
      { key: 'pos', label: 'Till Sales', value: Math.round(r.pos), money: true },
    );
  } else if (ctx.channel === 'online') {
    kpis.push({ key: 'delivery', label: 'Delivery Fees', value: Math.round(r.delivery), money: true });
  }

  return kpis;
}

/* ------------------------------------------------------------------------ */
/* The catalogue                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Filters a report understands — the screen shows only these controls.
 *   range    date range           scope     whole business / website / tills / one till
 *   store    one counter          category  one menu category
 *   stock    stock status         movement  ledger movement type
 */
const SALES_FILTERS = ['range', 'scope', 'store'];

/**
 * The report catalogue — the single source of truth for what exists, who may
 * see it, and which columns it has. The API, the UI menu and the exports all
 * read from here, so a report can never appear in the menu and then 403 on click.
 */
export const REPORTS = Object.freeze({
  'sales-overview': {
    label: 'Full Sales Report',
    group: 'sales',
    description:
      'Everything in one document: headline figures, daily sales, every product sold, categories, payment methods, till comparison, busy hours and the full sales record.',
    permission: PERMISSIONS.REPORT_VIEW,
    filters: [...SALES_FILTERS, 'category'],
    build: async (ctx) => {
      const [kpis, daily, products, categories, payments, hourly, register] = await Promise.all([
        salesKpis(ctx),
        dailyRows(ctx),
        productRows(ctx),
        categoryRows(ctx),
        paymentRows(ctx),
        hourlyRows(ctx),
        registerRows(ctx, LIMITS[ctx.mode].register),
      ]);
      // A comparison of one till against itself says nothing.
      const tills = ctx.terminal || ctx.channel === 'online' ? null : await tillRows(ctx);

      return {
        kpis,
        sections: [
          { key: 'daily', title: 'Daily Sales', columns: COLUMNS.daily, rows: daily, chart: true },
          {
            key: 'products',
            title: 'Products Sold',
            columns: COLUMNS.products,
            rows: products,
            ...(ctx.category && { note: 'Filtered to one category.' }),
          },
          { key: 'categories', title: 'Sales by Category', columns: COLUMNS.categories, rows: categories },
          { key: 'payments', title: 'Payment Methods', columns: COLUMNS.payments, rows: payments },
          ...(tills
            ? [{ key: 'tills', title: 'Tills & Website Compared', columns: COLUMNS.tills, rows: tills }]
            : []),
          { key: 'hourly', title: 'Sales by Hour', columns: COLUMNS.hourly, rows: hourly },
          {
            key: 'register',
            title: 'Sales Record',
            columns: COLUMNS.register,
            rows: register.rows,
            totalRows: register.totalRows,
            note: 'Every paid sale in the period, newest first. Cancelled and refunded orders are excluded.',
          },
        ],
      };
    },
  },

  'sales-summary': {
    label: 'Sales Summary',
    group: 'sales',
    description: 'Revenue and orders per day, split by channel.',
    permission: PERMISSIONS.REPORT_VIEW,
    filters: SALES_FILTERS,
    columns: [
      { key: 'bucket', label: 'Date' },
      { key: 'orders', label: 'Orders', numeric: true },
      { key: 'online', label: 'Online', money: true },
      { key: 'pos', label: 'In-store', money: true },
      { key: 'revenue', label: 'Total Revenue', money: true },
    ],
    run: async (ctx) =>
      (await dailyRows(ctx)).map(({ bucket, orders, online, pos, revenue }) => ({
        bucket,
        orders,
        online,
        pos,
        revenue,
      })),
  },

  'sales-register': {
    label: 'Sales Record',
    group: 'sales',
    description: 'Every paid sale, one line each: when, where, who, how it was paid and what was bought.',
    permission: PERMISSIONS.REPORT_VIEW,
    filters: SALES_FILTERS,
    build: async (ctx) => {
      const [kpis, register] = await Promise.all([
        salesKpis(ctx),
        registerRows(ctx, LIMITS[ctx.mode].register),
      ]);
      return {
        kpis,
        sections: [
          {
            key: 'register',
            title: 'Sales Record',
            columns: COLUMNS.register,
            rows: register.rows,
            totalRows: register.totalRows,
          },
        ],
      };
    },
  },

  'till-summary': {
    label: 'Till Comparison',
    group: 'sales',
    description:
      'Each till and the website side by side: orders, takings by payment type, discounts, average ticket.',
    permission: PERMISSIONS.REPORT_VIEW,
    filters: ['range', 'store'],
    columns: COLUMNS.tills,
    run: (ctx) => tillRows(ctx),
  },

  'product-performance': {
    label: 'Product Performance',
    group: 'sales',
    description: 'Units sold and revenue per menu item.',
    permission: PERMISSIONS.REPORT_VIEW,
    filters: [...SALES_FILTERS, 'category'],
    columns: [
      { key: 'name', label: 'Product' },
      { key: 'category', label: 'Category' },
      { key: 'quantity', label: 'Units Sold', numeric: true },
      { key: 'orders', label: 'Orders', numeric: true },
      { key: 'revenue', label: 'Revenue', money: true },
    ],
    run: async (ctx) =>
      (await productRows(ctx)).map(({ name, category, quantity, orders, revenue }) => ({
        name,
        category,
        quantity,
        orders,
        revenue,
      })),
  },

  'category-breakdown': {
    label: 'Category Breakdown',
    group: 'sales',
    description: 'Revenue share by menu category.',
    permission: PERMISSIONS.REPORT_VIEW,
    filters: SALES_FILTERS,
    columns: COLUMNS.categories,
    run: (ctx) => categoryRows(ctx),
  },

  'payment-methods': {
    label: 'Payment Methods',
    group: 'sales',
    description: 'How customers paid, by value and count.',
    permission: PERMISSIONS.REPORT_VIEW,
    filters: SALES_FILTERS,
    columns: COLUMNS.payments,
    run: (ctx) => paymentRows(ctx),
  },

  /*
   * Profit & loss — the only report gated on `report.financial`.
   *
   * Cost is read from the product, not the order, because orders deliberately
   * do not snapshot cost price: it is commercially sensitive and has no place
   * in a record a customer can be shown. The consequence is stated plainly on
   * the screen — margin is calculated against today's cost, so it drifts if a
   * supplier's price has changed since the sale.
   */
  'profit-and-loss': {
    label: 'Profit & Loss',
    group: 'sales',
    description: 'Revenue against cost of goods, by day. Margin uses current cost prices.',
    permission: PERMISSIONS.REPORT_FINANCIAL,
    filters: SALES_FILTERS,
    columns: [
      { key: 'bucket', label: 'Date' },
      { key: 'revenue', label: 'Revenue', money: true },
      { key: 'cost', label: 'Cost of Goods', money: true },
      { key: 'grossProfit', label: 'Gross Profit', money: true },
      { key: 'tax', label: 'Tax Collected', money: true },
      { key: 'discount', label: 'Discounts Given', money: true },
      {
        key: 'margin',
        label: 'Margin %',
        numeric: true,
        // A margin is a ratio. Summing the daily figures produced a footer of
        // "1048.5%"; the real total margin is profit over revenue for the
        // whole period.
        totalFrom: (t) => (t.revenue ? Number((((t.revenue - t.cost) / t.revenue) * 100).toFixed(1)) : 0),
      },
    ],
    run: async (ctx) =>
      Order.aggregate([
        { $match: orderMatch(ctx, COUNTED) },
        { $unwind: '$items' },
        { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p' } },
        { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
        /*
         * Per order first, then per day.
         *
         * Tax and discount belong to the order, and after $unwind they are
         * repeated on every line. The previous version averaged them across
         * lines and multiplied by the order count — which weights each order by
         * how many lines it had: a 1-line order taxed 100 and a 3-line order
         * taxed 50 came out at 125 instead of 150. Collapsing back to one row
         * per order before summing is exact.
         */
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
              order: '$_id',
            },
            revenue: { $sum: '$items.lineTotal' },
            // A missing cost contributes zero rather than breaking the sum — an
            // archived product still has to appear in last month's figures.
            cost: { $sum: { $multiply: [{ $ifNull: ['$p.costPrice', 0] }, '$items.quantity'] } },
            tax: { $first: '$tax' },
            discount: { $first: '$discount' },
          },
        },
        {
          $group: {
            _id: '$_id.day',
            revenue: { $sum: '$revenue' },
            cost: { $sum: '$cost' },
            tax: { $sum: '$tax' },
            discount: { $sum: '$discount' },
          },
        },
        {
          $project: {
            _id: 0,
            bucket: '$_id',
            revenue: { $round: ['$revenue', 0] },
            cost: { $round: ['$cost', 0] },
            grossProfit: { $round: [{ $subtract: ['$revenue', '$cost'] }, 0] },
            tax: { $round: ['$tax', 0] },
            discount: { $round: ['$discount', 0] },
            margin: {
              $cond: [
                { $gt: ['$revenue', 0] },
                {
                  $round: [
                    { $multiply: [{ $divide: [{ $subtract: ['$revenue', '$cost'] }, '$revenue'] }, 100] },
                    1,
                  ],
                },
                0,
              ],
            },
          },
        },
        { $sort: { bucket: 1 } },
      ]),
  },

  'order-status': {
    label: 'Order Status',
    group: 'sales',
    description: 'Every order by outcome — including cancellations.',
    permission: PERMISSIONS.ORDER_VIEW,
    filters: SALES_FILTERS,
    columns: [
      { key: 'status', label: 'Status' },
      { key: 'orders', label: 'Orders', numeric: true },
      { key: 'value', label: 'Value', money: true },
    ],
    // Deliberately not filtered by counted — the point of this report is to
    // show cancellations and refunds, which the revenue reports exclude.
    run: async (ctx) =>
      Order.aggregate([
        { $match: orderMatch(ctx) },
        { $group: { _id: '$status', orders: { $sum: 1 }, value: { $sum: '$total' } } },
        { $project: { _id: 0, status: '$_id', orders: 1, value: { $round: ['$value', 0] } } },
        { $sort: { orders: -1 } },
      ]),
  },

  /* ---------------------------------------------------------------------- */
  /* Inventory                                                              */
  /* ---------------------------------------------------------------------- */

  'inventory-stock': {
    label: 'Inventory — Stock on Hand',
    group: 'inventory',
    description:
      'Every product with its category, codes, counter, stock level, reorder point, status, prices, stock value and dates.',
    permission: PERMISSIONS.INVENTORY_VIEW,
    filters: ['category', 'stock'],
    // Not a sales period: stock is a snapshot of right now.
    timeless: true,
    build: async (ctx) => {
      const filter = {};
      if (ctx.category) filter.category = ctx.category;
      if (ctx.stock === 'inactive') filter.isActive = false;
      else if (ctx.stock !== 'all') filter.isActive = true;
      if (ctx.stock === 'out') filter.stock = { $lte: 0 };
      if (ctx.stock === 'low')
        filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] };
      if (ctx.stock === 'in') filter.$expr = { $gt: ['$stock', '$lowStockThreshold'] };
      if (ctx.store)
        filter.$or = [{ store: new mongoose.Types.ObjectId(String(ctx.store)) }, { store: null }];

      const since = new Date(Date.now() - 180 * 86_400_000);
      const [products, lastSold] = await Promise.all([
        Product.find(filter)
          .select('+costPrice')
          .populate('category', 'name')
          .populate('store', 'name')
          .sort({ name: 1 })
          .lean(),
        // Last sale per product, from the orders themselves so history before
        // the stock ledger existed still counts. Bounded to six months.
        Order.aggregate([
          { $match: { ...COUNTED, createdAt: { $gte: since } } },
          { $unwind: '$items' },
          { $group: { _id: '$items.product', lastSold: { $max: '$createdAt' } } },
        ]),
      ]);

      const lastSoldBy = new Map(lastSold.map((r) => [String(r._id), r.lastSold]));
      const showCost = ctx.can(PERMISSIONS.REPORT_FINANCIAL) || ctx.can(PERMISSIONS.PRODUCT_MANAGE);

      const statusOf = (p) =>
        !p.isActive
          ? 'Archived / hidden'
          : p.stock <= 0
            ? 'Out of stock'
            : p.stock <= p.lowStockThreshold
              ? 'Low'
              : p.stock <= p.lowStockThreshold * 3
                ? 'Medium'
                : 'In stock';

      const rows = products
        .map((p) => ({
          category: p.category?.name ?? '—',
          name: p.name,
          code: [p.sku, p.barcode].filter(Boolean).join(' / '),
          unit: p.unit,
          store: p.store?.name ?? 'All counters',
          channels: (p.channels?.length ? p.channels : ['web', 'pos'])
            .map((c) => (c === 'web' ? 'Website' : 'Till'))
            .join(' + '),
          stock: p.stock,
          reorderAt: p.lowStockThreshold,
          status: statusOf(p),
          costPrice: p.costPrice ?? 0,
          price: p.price,
          costValue: Math.round((p.costPrice ?? 0) * Math.max(0, p.stock)),
          retailValue: Math.round(p.price * Math.max(0, p.stock)),
          soldCount: p.soldCount ?? 0,
          lastSold: lastSoldBy.get(String(p._id)) ?? null,
          updatedAt: p.updatedAt,
          createdAt: p.createdAt,
        }))
        // Grouped by category, like a stock-take sheet.
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

      const columns = [
        { key: 'category', label: 'Category', width: 1.3 },
        { key: 'name', label: 'Item', width: 1.9 },
        { key: 'code', label: 'SKU / Barcode', width: 1.3 },
        { key: 'unit', label: 'Unit', width: 0.6 },
        { key: 'store', label: 'Counter', width: 1.1 },
        { key: 'channels', label: 'Sold On', width: 1, pdf: false },
        { key: 'stock', label: 'In Stock', numeric: true },
        { key: 'reorderAt', label: 'Reorder At', numeric: true, noTotal: true },
        { key: 'status', label: 'Status', width: 1 },
        ...(showCost ? [{ key: 'costPrice', label: 'Cost Price', money: true, noTotal: true }] : []),
        { key: 'price', label: 'Sell Price', money: true, noTotal: true },
        ...(showCost ? [{ key: 'costValue', label: 'Value at Cost', money: true }] : []),
        { key: 'retailValue', label: 'Value at Retail', money: true },
        { key: 'soldCount', label: 'Units Sold (all time)', numeric: true, pdf: false },
        { key: 'lastSold', label: 'Last Sold', date: true },
        { key: 'updatedAt', label: 'Last Updated', date: true },
        { key: 'createdAt', label: 'Added', date: true, pdf: false },
      ];

      const count = (status) => rows.filter((r) => r.status === status).length;
      const kpis = [
        { key: 'products', label: 'Products', value: rows.length, numeric: true },
        {
          key: 'units',
          label: 'Units in Stock',
          value: rows.reduce((s, r) => s + Math.max(0, r.stock), 0),
          numeric: true,
        },
        {
          key: 'retail',
          label: 'Stock Value (Retail)',
          value: rows.reduce((s, r) => s + r.retailValue, 0),
          money: true,
        },
        ...(showCost
          ? [
              {
                key: 'cost',
                label: 'Stock Value (Cost)',
                value: rows.reduce((s, r) => s + r.costValue, 0),
                money: true,
              },
            ]
          : []),
        { key: 'low', label: 'Running Low', value: count('Low'), numeric: true },
        { key: 'out', label: 'Out of Stock', value: count('Out of stock'), numeric: true },
      ];

      return { kpis, sections: [{ key: 'stock', title: 'Stock on Hand', columns, rows }] };
    },
  },

  'inventory-movements': {
    label: 'Inventory — Stock Movements',
    group: 'inventory',
    description:
      'The stock ledger: every sale, return and adjustment, with the balance it left and who made it.',
    permission: PERMISSIONS.INVENTORY_VIEW,
    filters: ['range', 'category', 'movement'],
    build: async (ctx) => {
      const filter = { createdAt: { $gte: ctx.from, $lt: ctx.to } };
      if (ctx.category) filter.category = new mongoose.Types.ObjectId(String(ctx.category));
      if (ctx.movement && ctx.movement !== 'all') filter.type = ctx.movement;
      if (ctx.store) filter.store = new mongoose.Types.ObjectId(String(ctx.store));

      const limit = LIMITS[ctx.mode].movements;
      const [movements, totalRows, summary] = await Promise.all([
        StockMovement.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
        StockMovement.countDocuments(filter),
        StockMovement.aggregate([
          { $match: filter },
          { $group: { _id: '$type', quantity: { $sum: '$quantity' }, count: { $sum: 1 } } },
        ]),
      ]);

      const TYPE = { opening: 'Opening stock', sale: 'Sale', return: 'Returned', adjustment: 'Adjustment' };
      const rows = movements.map((m) => ({
        at: m.createdAt,
        category: m.categoryName ?? '—',
        name: m.productName,
        type: TYPE[m.type] ?? m.type,
        change: m.quantity,
        balance: m.balanceAfter,
        reference: m.reference ?? '',
        till: m.terminalId ?? (m.channel === 'online' ? 'Website' : ''),
        by: m.actorName ?? '',
        note: m.note ?? '',
      }));

      const byType = Object.fromEntries(summary.map((s) => [s._id, s]));
      const kpis = [
        { key: 'movements', label: 'Movements', value: totalRows, numeric: true },
        { key: 'sold', label: 'Units Sold', value: Math.abs(byType.sale?.quantity ?? 0), numeric: true },
        { key: 'returned', label: 'Units Returned', value: byType.return?.quantity ?? 0, numeric: true },
        { key: 'adjusted', label: 'Net Adjustments', value: byType.adjustment?.quantity ?? 0, numeric: true },
        { key: 'opening', label: 'Opening Stock Added', value: byType.opening?.quantity ?? 0, numeric: true },
      ];

      return {
        kpis,
        sections: [
          {
            key: 'movements',
            title: 'Stock Movements',
            columns: [
              { key: 'at', label: 'Date & Time', datetime: true },
              { key: 'category', label: 'Category', width: 1.2 },
              { key: 'name', label: 'Item', width: 1.8 },
              { key: 'type', label: 'Movement', width: 1 },
              { key: 'change', label: 'Change', numeric: true },
              { key: 'balance', label: 'Balance After', numeric: true, noTotal: true },
              { key: 'reference', label: 'Reference', width: 1.6 },
              { key: 'till', label: 'Till', width: 0.9 },
              { key: 'by', label: 'By', width: 1.1 },
              { key: 'note', label: 'Note', width: 1.6 },
            ],
            rows,
            totalRows,
          },
        ],
      };
    },
  },
});

/* ------------------------------------------------------------------------ */
/* Running a report                                                          */
/* ------------------------------------------------------------------------ */

/** Totals for the numeric/money columns — computed once, here, for every renderer. */
function totalsFor(columns, rows) {
  /*
   * Not every number is summable. Adding up thirty daily margin percentages
   * gave a footer reading "1048.5%" — arithmetically a sum, and complete
   * nonsense as a figure. A ratio has to be recomputed from the totals it is
   * a ratio of, which is what `totalFrom` does.
   */
  const totals = {};
  for (const column of columns) {
    if (!column.money && !column.numeric) continue;
    if (column.noTotal || column.totalFrom) continue;
    totals[column.key] = Number(
      rows.reduce((sum, row) => sum + (Number(row[column.key]) || 0), 0).toFixed(2),
    );
  }
  for (const column of columns) {
    if (column.totalFrom) totals[column.key] = column.totalFrom(totals);
  }
  return totals;
}

/** Column metadata safe to send to a client (functions stripped). */
const publicColumns = (columns) =>
  columns.map(({ totalFrom, ...rest }) => ({ ...rest, ...(totalFrom && { derivedTotal: true }) }));

export const reportService = {
  /** Reports the caller is allowed to see. Drives the menu, so nothing 403s. */
  catalogue(can) {
    return Object.entries(REPORTS)
      .filter(([, report]) => can(report.permission))
      .map(([id, report]) => ({
        id,
        label: report.label,
        description: report.description,
        group: report.group,
        filters: report.filters,
        timeless: Boolean(report.timeless),
        columns: publicColumns(report.columns ?? []),
      }));
  },

  /**
   * @param {string} id
   * @param {object} query   `{ preset|from|to, scope, terminal, store, category, stock, movement }`
   * @param {Function} can
   * @param {object} [actor] The signed-in user, for store scoping.
   * @param {object} [options]
   * @param {'view'|'csv'|'pdf'} [options.mode] decides row ceilings
   */
  async run(id, query, can, actor, { mode = 'view' } = {}) {
    const report = REPORTS[id];
    if (!report) throw ApiError.notFound('Report');
    if (!can(report.permission)) throw ApiError.forbidden('You do not have access to this report');

    /*
     * The requested store is a filter, not a grant.
     *
     * `visibleStoreIds` returns null for someone who may see everything (the
     * super admin, head office), or the list they are assigned to otherwise.
     * For an assigned user the scope is imposed: passing `?store=` for a counter
     * they do not work at is refused rather than quietly widened.
     */
    const allowed = visibleStoreIds(actor);
    let store = query?.store ?? null;

    if (allowed) {
      if (store && !allowed.includes(String(store))) {
        throw ApiError.forbidden('You do not have access to that store');
      }
      // Default to their own counter when they did not name one.
      store = store ?? allowed[0];
    }

    const scope = report.filters.includes('scope') ? await resolveScope(query) : resolveScopeNone();
    // A till at a counter this person cannot see is refused, not silently empty.
    if (allowed && scope.terminalStore && !allowed.includes(scope.terminalStore)) {
      throw ApiError.forbidden('That till is at a counter you do not have access to');
    }

    const range = report.timeless ? null : resolveRange(query);

    const ctx = {
      ...(range ?? {}),
      store,
      channel: scope.channel,
      terminal: scope.terminal,
      category: query?.category ?? null,
      stock: query?.stock ?? 'active',
      movement: query?.movement ?? 'all',
      mode,
      can,
    };

    const built = report.build
      ? await report.build(ctx)
      : {
          kpis: [],
          sections: [
            { key: 'main', title: report.label, columns: report.columns, rows: await report.run(ctx) },
          ],
        };

    const sections = built.sections.map((section) => ({
      key: section.key,
      title: section.title,
      note: section.note ?? null,
      chart: Boolean(section.chart),
      columns: section.columns,
      rows: section.rows,
      totals: totalsFor(section.columns, section.rows),
      totalRows: section.totalRows ?? section.rows.length,
      truncated: (section.totalRows ?? section.rows.length) > section.rows.length,
    }));

    const primary = sections[0] ?? { columns: [], rows: [], totals: {} };

    return {
      id,
      label: report.label,
      description: report.description,
      group: report.group,
      filters: report.filters,
      kpis: built.kpis ?? [],
      sections,
      // The primary table at the top level too — what a single-table report
      // has always returned, and what existing callers read.
      columns: primary.columns,
      rows: primary.rows,
      totals: primary.totals,
      range: range
        ? { from: range.from, to: range.to, label: range.label, display: range.display }
        : { label: 'current', display: 'Current stock (live)' },
      scope: { key: scope.key, label: scope.label, terminal: scope.terminal },
      // Echoed so the screen can caption which counter these figures cover, and
      // warn that online trade is excluded when one is selected.
      store: store ? String(store) : null,
      storeScoped: Boolean(store),
      generatedAt: new Date().toISOString(),
    };
  },
};

function resolveScopeNone() {
  return { key: 'all', channel: null, terminal: null, label: null };
}

/** Strip server-only functions before a report goes to a client. */
export function toClientReport(report) {
  return {
    ...report,
    columns: publicColumns(report.columns),
    sections: report.sections.map((s) => ({ ...s, columns: publicColumns(s.columns) })),
  };
}

/* ------------------------------------------------------------------------ */
/* CSV                                                                       */
/* ------------------------------------------------------------------------ */

/**
 * UTF-8 byte-order mark (U+FEFF), constructed from its code point.
 *
 * Excel needs it to detect the encoding; without it, Urdu product names and the
 * rupee sign open as mojibake on Windows. Built with `fromCharCode` rather than
 * written inline, because the literal character is invisible in an editor.
 */
const BOM = String.fromCharCode(0xfeff);

/**
 * Formula-injection guard: a cell beginning `=`, `+`, `-`, `@`, tab or CR is
 * executed as a formula when the file is opened in Excel or Sheets. Product and
 * category names are user input, so `=HYPERLINK("evil","click")` in a product
 * name would run on the owner's machine. Prefixing with an apostrophe forces
 * the cell to be read as text.
 *
 * Numbers are written raw (not "Rs 1,200") so the spreadsheet can sum them;
 * dates as readable local times. A negative number is a number, not a formula,
 * and is left alone.
 */
function csvCell(column, value) {
  let text;
  if (value === null || value === undefined) text = '';
  else if (column?.money || column?.numeric) text = String(Number(value) || 0);
  else if (column?.datetime || column?.date) text = formatCell(column, value);
  else text = String(value);

  const isNumber = (column?.money || column?.numeric) && /^-?\d+(\.\d+)?$/.test(text);
  if (!isNumber && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  // RFC 4180: quote anything containing a delimiter, quote or newline, and
  // double any embedded quotes.
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvTable({ columns, rows, totals }) {
  const lines = [
    columns.map((c) => csvCell(null, c.label)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(c, row[c.key])).join(',')),
  ];
  if (totals && Object.keys(totals).length > 0 && rows.length) {
    lines.push(
      columns
        .map((c, index) => (index === 0 ? 'TOTAL' : c.key in totals ? csvCell(c, totals[c.key]) : ''))
        .join(','),
    );
  }
  return lines;
}

export function toCsv(report) {
  const sections = report.sections ?? [{ columns: report.columns, rows: report.rows, totals: report.totals }];

  // A single table stays a plain table — the shape it always had, and the one
  // a spreadsheet imports without editing.
  if (sections.length === 1 && !report.kpis?.length) {
    return `${BOM}${csvTable(sections[0]).join('\r\n')}`;
  }

  const lines = [
    csvCell(null, report.label),
    csvCell(null, `Period: ${report.range?.display ?? ''}`),
    ...(report.scope?.label ? [csvCell(null, `Scope: ${report.scope.label}`)] : []),
    csvCell(null, `Generated: ${formatCell({ datetime: true }, report.generatedAt)}`),
    '',
  ];

  if (report.kpis?.length) {
    lines.push('Summary');
    for (const kpi of report.kpis) lines.push(`${csvCell(null, kpi.label)},${csvCell(kpi, kpi.value)}`);
    lines.push('');
  }

  for (const section of sections) {
    lines.push(csvCell(null, section.title));
    lines.push(...csvTable(section));
    if (section.truncated)
      lines.push(csvCell(null, `Showing ${section.rows.length} of ${section.totalRows} rows`));
    lines.push('');
  }

  return `${BOM}${lines.join('\r\n')}`;
}

export { MOVEMENT_TYPE_VALUES };
export default reportService;
