/**
 * Demo reviews — real, verifiable customer feedback.
 * ---------------------------------------------------------------------------
 * Development only.
 *
 * Every review here is backed by a real customer account and a real delivered
 * order, because the review API refuses anything else. Fabricating a rating
 * average directly on the product would have been one line — but it would then
 * be wrong the moment anyone moderated a review, since the service recomputes
 * the average from approved reviews rather than incrementing a counter.
 *
 * Seeding the whole chain instead means the Customer Feedback screen has a real
 * queue on first boot, and the stars on the menu are numbers you can click
 * through to.
 */
import { env } from '../../src/config/env.config.js';
import { ROLES } from '../../src/core/constants/roles.js';
import { User } from '../../src/modules/users/user.model.js';
import { Order } from '../../src/modules/orders/order.model.js';
import { Product } from '../../src/modules/catalog/product.model.js';
import { Review, REVIEW_STATUS } from '../../src/modules/reviews/review.model.js';
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD } from '../../src/core/constants/payments.js';
import { logger } from '../../src/core/utils/logger.js';

const DEV_PASSWORD = 'Passw0rd!23';

/** Demo diners. Phone numbers continue the staff seed's block. */
const CUSTOMERS = [
  { fullName: 'Bilal Ahmed', email: 'bilal@diner.dev', phone: '03011234501' },
  { fullName: 'Ayesha Siddiqui', email: 'ayesha@diner.dev', phone: '03011234502' },
  { fullName: 'Hamza Sheikh', email: 'hamza@diner.dev', phone: '03011234503' },
  { fullName: 'Maryam Yousaf', email: 'maryam@diner.dev', phone: '03011234504' },
  { fullName: 'Junaid Iqbal', email: 'junaid@diner.dev', phone: '03011234505' },
];

/**
 * Written feedback, keyed by rating so the tone matches the stars. A 5-star
 * review that reads "the naan was cold" is the sort of detail that makes demo
 * data obviously fake.
 */
const COMMENTS = {
  5: [
    'Genuinely the best in Mardan. The meat was tender and the spice was perfect.',
    'Arrived hot and packed properly. Ordering again this weekend.',
    'Portion size was generous and the flavour was spot on. Highly recommended.',
  ],
  4: [
    'Really good. A touch more gravy next time and it would be perfect.',
    'Tasty and fresh, though delivery took a little longer than expected.',
  ],
  3: [
    'Decent, but not quite as good as the last time I ordered.',
    'It was fine — nothing wrong with it, just not memorable.',
  ],
  2: ['Arrived lukewarm and the portion felt small for the price.'],
  1: ['Order was missing an item and nobody picked up the phone.'],
};

/** Deterministic pseudo-random, so successive runs produce the same shape. */
function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

export async function seedReviews() {
  if (env.isProduction) {
    logger.warn('Skipping review seed — refusing to fabricate customer feedback in production');
    return 'reviews: skipped (production)';
  }

  const existing = await Review.countDocuments();
  if (existing > 0) return `reviews: ${existing} already present`;

  const products = await Product.find({ isActive: true }).select('name price unit').lean();
  if (products.length === 0) return 'reviews: skipped (no products)';

  // --- 1. Customers -------------------------------------------------------
  const customers = [];
  for (const definition of CUSTOMERS) {
    // Created through the model so the password-hashing hook runs.
    const user =
      (await User.findOne({ email: definition.email })) ??
      (await User.create({
        ...definition,
        password: DEV_PASSWORD,
        role: ROLES.CUSTOMER,
        emailVerified: true,
        status: 'active',
      }));
    customers.push(user);
  }

  const random = seededRandom(20260728);
  const orders = [];
  const reviews = [];
  const now = Date.now();

  // --- 2. A delivered order per customer, each with a few dishes ---------
  customers.forEach((customer, index) => {
    const placedAt = new Date(now - (index * 3 + 2) * 24 * 60 * 60 * 1000);
    const lineCount = 2 + Math.floor(random() * 2);
    const chosen = [];

    for (let l = 0; l < lineCount; l += 1) {
      const product = products[Math.floor(random() * products.length)];
      // Skip a repeat — the unique index is per product per order, so the same
      // dish twice in one order would collide when the reviews are written.
      if (chosen.some((c) => String(c._id) === String(product._id))) continue;
      chosen.push(product);
    }

    const items = chosen.map((product) => {
      const quantity = product.unit === 'kg' ? 1 : 1 + Math.floor(random() * 2);
      return {
        product: product._id,
        name: product.name,
        unit: product.unit,
        unitPrice: product.price,
        quantity,
        lineTotal: Math.round(quantity * product.price),
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxRate = 0.05;
    const tax = Math.round(subtotal * taxRate);
    const deliveryFee = subtotal < 3000 ? 60 : 0;
    const orderId = new Order()._id;

    orders.push({
      _id: orderId,
      orderNumber: `FB-${placedAt.toISOString().slice(0, 10).replace(/-/g, '')}-R${String(index + 1).padStart(3, '0')}`,
      channel: 'online',
      customer: customer._id,
      customerName: customer.fullName,
      customerPhone: customer.phone,
      items,
      subtotal,
      discount: 0,
      deliveryFee,
      tax,
      taxRate,
      total: subtotal + deliveryFee + tax,
      paymentMethod: PAYMENT_METHOD.COD,
      paymentStatus: PAYMENT_STATUS.PAID,
      status: ORDER_STATUS.DELIVERED,
      deliveryAddress: { line1: 'Chota Chowk', area: 'Mardan', city: 'Mardan' },
      createdAt: placedAt,
      updatedAt: placedAt,
    });

    // --- 3. Reviews for those items -------------------------------------
    items.forEach((item, itemIndex) => {
      // Weighted toward the top — a real restaurant's distribution, not a
      // uniform one, and it makes the star-breakdown bars look like a menu
      // rather than a test fixture.
      const roll = random();
      const rating = roll > 0.55 ? 5 : roll > 0.3 ? 4 : roll > 0.15 ? 3 : roll > 0.06 ? 2 : 1;
      const pool = COMMENTS[rating];

      // Leave the newest few pending so the moderation queue is not empty on
      // first boot — an empty queue teaches nobody what the screen is for.
      const isPending = index >= customers.length - 2 && itemIndex === 0;

      reviews.push({
        product: item.product,
        customer: customer._id,
        order: orderId,
        customerName: customer.fullName,
        rating,
        comment: pool[Math.floor(random() * pool.length)],
        status: isPending ? REVIEW_STATUS.PENDING : REVIEW_STATUS.APPROVED,
        ...(isPending ? {} : { moderatedAt: new Date(placedAt.getTime() + 3600_000) }),
        createdAt: new Date(placedAt.getTime() + 86_400_000),
        updatedAt: new Date(placedAt.getTime() + 86_400_000),
      });
    });
  });

  // `timestamps: false` — otherwise Mongoose overwrites the backdated dates
  // and every review lands on today.
  await Order.insertMany(orders, { timestamps: false });
  await Review.insertMany(reviews, { timestamps: false });

  // --- 4. Roll the ratings up ---------------------------------------------
  // The same recomputation the moderation endpoint performs, so the seeded
  // averages cannot disagree with what the app would calculate.
  const rated = await Review.aggregate([
    { $match: { status: REVIEW_STATUS.APPROVED } },
    { $group: { _id: '$product', average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  await Product.bulkWrite([
    // Clear first: products carrying an invented count from an earlier seed
    // would otherwise keep it and diverge the moment one is moderated.
    { updateMany: { filter: {}, update: { $set: { ratingAverage: 0, ratingCount: 0 } } } },
    ...rated.map((row) => ({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { ratingAverage: Math.round(row.average * 10) / 10, ratingCount: row.count } },
      },
    })),
  ]);

  const pending = reviews.filter((r) => r.status === REVIEW_STATUS.PENDING).length;
  logger.info(`Seeded ${reviews.length} reviews (${pending} awaiting moderation) across ${rated.length} products`);

  return `reviews: ${reviews.length} reviews, ${pending} pending, ${customers.length} demo customers`;
}

export default seedReviews;
