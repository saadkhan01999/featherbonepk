/**
 * Backfill `channels` on records that predate the field.
 * ---------------------------------------------------------------------------
 *   npm run migrate:channels
 *
 * Why this exists: `channels` (web / pos) was added to Product and Category
 * after both collections already held data. A Mongoose `default` only applies
 * when a document is created — it does not reach back and fill in what is
 * already stored. So every pre-existing record has no `channels` key, matches
 * no equality test on it, and disappeared from the website and the till at the
 * same moment.
 *
 * The read path tolerates this (see `channelFilter` in catalog.service.js), so
 * nothing is broken while you wait. This makes the data actually correct, which
 * matters because the admin screens show a channel per row: without it, every
 * old item reads as "Web + Till" by inference rather than by record, and the
 * first edit to any of them writes a value that was never chosen.
 *
 * Safe to run twice. It only touches documents where the field is missing or
 * empty, so re-running converges and never overwrites a deliberate choice.
 */
import mongoose from 'mongoose';

import { connectDatabase } from '../src/database/connect.js';
import { logger } from '../src/core/utils/logger.js';
import { Product, CHANNEL_VALUES } from '../src/modules/catalog/product.model.js';
import { Category } from '../src/modules/catalog/category.model.js';

/** Documents with no channel information at all. */
const NEEDS_BACKFILL = {
  $or: [{ channels: { $exists: false } }, { channels: null }, { channels: { $size: 0 } }],
};

export async function backfillChannels() {
  const all = [...CHANNEL_VALUES];

  const [products, categories] = await Promise.all([
    Product.updateMany(NEEDS_BACKFILL, { $set: { channels: all } }),
    Category.updateMany(NEEDS_BACKFILL, { $set: { channels: all } }),
  ]);

  const summary = {
    products: products.modifiedCount ?? 0,
    categories: categories.modifiedCount ?? 0,
  };

  if (summary.products || summary.categories) {
    logger.info(`Backfilled channels — ${summary.products} product(s), ${summary.categories} category(ies)`);
  } else {
    logger.info('Nothing to backfill: every record already declares its channels.');
  }

  return summary;
}

// Allow `node scripts/backfill-channels.mjs` as a standalone command.
if (process.argv[1]?.endsWith('backfill-channels.mjs')) {
  try {
    await connectDatabase();
    await backfillChannels();
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    logger.error('Backfill failed', { message: error.message });
    process.exit(1);
  }
}

export default backfillChannels;
