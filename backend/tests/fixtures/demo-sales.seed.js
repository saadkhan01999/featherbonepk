/**
 * Demo sales — backdated orders so the dashboard has something real to chart.
 * ---------------------------------------------------------------------------
 * Development only. Refuses to run in production, because inventing revenue in
 * a live system would corrupt every report the owner relies on.
 *
 * These are real Order documents queried by the same aggregation the live
 * dashboard uses — not fixtures hard-coded into the chart. That means the date
 * bucketing, timezone handling and channel split are all genuinely exercised,
 * and a bug in them shows up here rather than after go-live.
 */
import { env } from '../../src/config/env.config.js';
import { Order } from '../../src/modules/orders/order.model.js';
import { Product } from '../../src/modules/catalog/product.model.js';
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD } from '../../src/core/constants/payments.js';
import { logger } from '../../src/core/utils/logger.js';

const DAYS = 90;
const METHODS = [PAYMENT_METHOD.COD, PAYMENT_METHOD.JAZZCASH, PAYMENT_METHOD.EASYPAISA, PAYMENT_METHOD.BANK_TRANSFER];

/** Deterministic pseudo-random so successive runs produce a stable shape. */
function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

export async function seedDemoSales() {
  if (env.isProduction) {
    logger.warn('Skipping demo sales seed — refusing to fabricate revenue in production');
    return 'demo sales: skipped (production)';
  }

  const existing = await Order.countDocuments();
  if (existing > 0) return `demo sales: ${existing} already present`;

  const products = await Product.find({ isActive: true }).select('name price unit').lean();
  if (products.length === 0) return 'demo sales: skipped (no products)';

  const random = seededRandom(20260727);
  const orders = [];
  const now = Date.now();

  for (let dayOffset = DAYS; dayOffset >= 0; dayOffset -= 1) {
    // Weekends are busier — a flat distribution makes every chart a straight
    // line, which hides whether the bucketing actually works.
    const date = new Date(now - dayOffset * 24 * 60 * 60 * 1000);
    const isWeekend = [0, 5, 6].includes(date.getDay());
    const baseCount = isWeekend ? 14 : 8;
    const count = baseCount + Math.floor(random() * 6);

    for (let i = 0; i < count; i += 1) {
      const lineCount = 1 + Math.floor(random() * 3);
      const items = [];

      for (let l = 0; l < lineCount; l += 1) {
        const product = products[Math.floor(random() * products.length)];
        const quantity = product.unit === 'kg' ? Math.round((0.5 + random() * 2) * 2) / 2 : 1 + Math.floor(random() * 3);
        const lineTotal = Math.round(quantity * product.price);
        items.push({
          product: product._id,
          name: product.name,
          unit: product.unit,
          unitPrice: product.price,
          quantity,
          lineTotal,
        });
      }

      const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
      const channel = random() > 0.45 ? 'pos' : 'online';
      const deliveryFee = channel === 'online' && subtotal < 3000 ? 60 : 0;
      const taxRate = 0.05;
      const tax = Math.round(subtotal * taxRate);

      // Spread through trading hours (11:00–23:00) so an hourly view is
      // meaningful rather than every order landing at midnight.
      const placedAt = new Date(date);
      placedAt.setHours(11 + Math.floor(random() * 12), Math.floor(random() * 60), 0, 0);

      orders.push({
        orderNumber: `FB-${placedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${String(orders.length + 1).padStart(4, '0')}`,
        channel,
        customerName: channel === 'pos' ? 'Walk-in Customer' : 'Online Customer',
        items,
        subtotal,
        discount: 0,
        deliveryFee,
        tax,
        taxRate,
        total: subtotal + deliveryFee + tax,
        paymentMethod: channel === 'pos' ? PAYMENT_METHOD.COD : METHODS[Math.floor(random() * METHODS.length)],
        paymentStatus: PAYMENT_STATUS.PAID,
        status: ORDER_STATUS.COMPLETED,
        createdAt: placedAt,
        updatedAt: placedAt,
      });
    }
  }

  // `timestamps: false` is essential — without it Mongoose overwrites the
  // backdated createdAt with "now" and every order lands on today, collapsing
  // the entire trend into a single bar.
  await Order.insertMany(orders, { timestamps: false });

  logger.info(`Seeded ${orders.length} demo orders across ${DAYS} days`);
  return `demo sales: ${orders.length} orders over ${DAYS} days`;
}

export default seedDemoSales;
