/**
 * Test fixtures — a sample shop for the suite to run against.
 * ---------------------------------------------------------------------------
 * Not reachable from the application, and that is the entire point.
 *
 * This was `scripts/seed.mjs`, an `npm run seed` away from any database the
 * `.env` happened to point at. It now lives under `tests/`, has no npm script,
 * and is imported by exactly two callers — the test harness and `dev:memdb`,
 * both of which run against a throwaway in-memory database. A production
 * install has no path to it whatsoever.
 *
 * The reason is one the owner asked for directly: a real shop must never
 * contain invented food, fabricated orders or five-star reviews nobody wrote.
 * Sample data that ships with the software eventually reaches a live database
 * — and fake orders are far harder to disentangle from real ones after a week
 * of trading than they would have been to add on request.
 *
 * A real database starts empty. `npm run owner` creates the one account that
 * can sign in, and the super admin builds everything else from inside the app.
 *
 * Every builder is idempotent: re-running converges on the same state rather
 * than duplicating rows. `dev:memdb` runs this on every boot, so anything that
 * is not would break the development loop immediately — a useful early warning.
 */
import mongoose from 'mongoose';

import { env } from '../../src/config/env.config.js';
import { connectDatabase } from '../../src/database/connect.js';
import { logger } from '../../src/core/utils/logger.js';
import { seedStores } from './stores.seed.js';
import { seedStaff } from './staff.seed.js';
import { seedCatalog } from './catalog.seed.js';
import { seedDemoSales } from './demo-sales.seed.js';
import { seedReviews } from './reviews.seed.js';
import { seedPromotions } from './promotions.seed.js';
import { seedTerminals } from './terminals.seed.js';
import { seedSettings } from './settings.seed.js';
import { backfillChannels } from '../../scripts/backfill-channels.mjs';

/**
 * @param {object} [options]
 * @param {boolean} [options.silent] Suppress the completion banner.
 * @param {boolean} [options.demo]   Include sample catalogue, counters and trade.
 */
export async function runSeed({ silent = false, demo = false } = {}) {
  // Refuse to run against production data. A seed that resets a live catalogue
  // is unrecoverable, and this guard costs nothing.
  if (env.isProduction) {
    logger.error('Refusing to seed a production database.');
    throw new Error('Seeding is disabled in production');
  }

  // --- Seeders run in dependency order ----------------------------------
  // Staff before catalogue: catalogue records reference a creating user once
  // authorship is wired in.
  // Reviews last: they need both customers and a catalogue, and they overwrite
  // the catalogue's placeholder rating figures with real computed ones.
  /*
   * Essentials — always seeded, because without them nobody can get in.
   *
   *   • the owner account: the single bootstrap credential
   *   • settings: tax rate, currency, delivery fee and the storefront copy
   *
   * That is genuinely all a live business needs from a seed. Its counters,
   * tills, categories and menu are its own, and it creates them in the back
   * office — pre-inventing them would only mean deleting someone else's ideas
   * before entering your own.
   */
  /*
   * Backfill first. `channels` was added to collections that already had data,
   * and a Mongoose default never reaches back — so an existing database has
   * records that match no channel query and vanish from both the website and
   * the till. Running it here means a deploy that seeds is also a deploy that
   * migrates, with no separate step for anyone to forget.
   */
  const migrated = await backfillChannels();

  const results = [
    `channels backfilled: ${migrated.products} product(s), ${migrated.categories} category(ies)`,
    await seedStaff(),
    await seedSettings(),
  ];

  if (demo) {
    /*
     * Sample data — for exploring the UI and for the integration suite.
     *
     * Order matters: stores first (tills, products and staff all reference
     * one), then the catalogue, then the trade that depends on both.
     */
    results.push(await seedStores());
    results.push(await seedCatalog());
    results.push(await seedTerminals());
    results.push(await seedDemoSales());
    results.push(await seedReviews());
    results.push(await seedPromotions());
  } else {
    results.push('sample catalogue, counters, tills and trade: SKIPPED (use seed:demo)');
  }

  if (!silent) {
    logger.info('Seed complete');
    for (const line of results) logger.info(`  • ${line}`);
  }

  return results;
}

// Allow `node scripts/seed.mjs` as a standalone command.
const isDirectRun = process.argv[1]?.endsWith('seed.mjs');

if (isDirectRun) {
  try {
    await connectDatabase();
    // Only ever invoked with demo data from dev:memdb.
    await runSeed({ demo: process.argv.includes('--demo') });
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    logger.error('Seed failed', { message: error.message });
    process.exit(1);
  }
}

export default runSeed;
