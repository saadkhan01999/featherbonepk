/**
 * Store (outlet) seed.
 * ---------------------------------------------------------------------------
 * Runs first — terminals, products and staff all reference stores, so nothing
 * else can attach itself to a counter that does not exist yet.
 *
 * These mirror how the business actually trades: separate counters under one
 * roof, each with its own till, its own menu and its own takings. The owner
 * asked to see "all bakery-related when added for the bakery, all chicken
 * related when added for the chicken store" — that separation starts here.
 *
 * Idempotent: keyed on code.
 */
import { Store } from '../../src/modules/stores/store.model.js';
import { logger } from '../../src/core/utils/logger.js';

const STORES = [
  {
    code: 'MAIN',
    name: 'Feather & Bone — Main Kitchen',
    type: 'general',
    location: 'Main hall, ground floor',
    phone: '+92 300 1234567',
    displayOrder: 1,
  },
  {
    code: 'BAKERY',
    name: 'The Bakery Counter',
    type: 'bakery',
    location: 'Left wing, by the entrance',
    phone: '+92 300 1234568',
    displayOrder: 2,
  },
  {
    code: 'CHICKEN',
    name: 'Chicken & Roast Counter',
    type: 'chicken',
    location: 'Right wing, beside the grill',
    phone: '+92 300 1234569',
    displayOrder: 3,
  },
];

export async function seedStores() {
  let created = 0;

  for (const store of STORES) {
    const result = await Store.updateOne({ code: store.code }, { $setOnInsert: store }, { upsert: true });
    if (result.upsertedCount > 0) created += 1;
  }

  if (created > 0) logger.info(`Seeded ${created} store(s)`);
  return `stores: ${created} created, ${STORES.length - created} already present`;
}

export default seedStores;
