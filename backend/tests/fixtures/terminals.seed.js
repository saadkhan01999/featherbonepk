/**
 * Terminal seed.
 * ---------------------------------------------------------------------------
 * POS login now requires a registered terminal. Without these, every existing
 * till sign-in would start failing the moment the registry landed — including
 * the development flow and the verification scripts, which use TILL-01.
 *
 * Idempotent: keyed on code.
 */
import { Terminal } from '../../src/modules/pos/terminal.model.js';
import { Store } from '../../src/modules/stores/store.model.js';
import { logger } from '../../src/core/utils/logger.js';

/**
 * `storeCode` is resolved to an id below. Each till stands at exactly one
 * counter, and that is what scopes the menu the cashier sees — the terminal
 * decides, not the cashier.
 */
const TERMINALS = [
  { code: 'TILL-01', name: 'Front Counter', location: 'Main hall, by the entrance', storeCode: 'MAIN' },
  { code: 'TILL-02', name: 'Bakery Till', location: 'Left wing', storeCode: 'BAKERY' },
  { code: 'TILL-03', name: 'Chicken Counter Till', location: 'Right wing', storeCode: 'CHICKEN' },
  {
    code: 'TILL-04',
    name: 'Spare Terminal',
    location: 'Back office',
    storeCode: 'MAIN',
    // Seeded disabled so the back-office screen has a real example of a till
    // that is registered but out of service.
    isActive: false,
  },
];

export async function seedTerminals() {
  let created = 0;

  // One read, then a lookup — not a findOne per terminal.
  const stores = await Store.find({}).select('code').lean();
  const storeIdByCode = new Map(stores.map((store) => [store.code, store._id]));

  for (const { storeCode, ...terminal } of TERMINALS) {
    const result = await Terminal.updateOne(
      { code: terminal.code },
      { $setOnInsert: { ...terminal, store: storeIdByCode.get(storeCode) ?? null } },
      { upsert: true },
    );
    if (result.upsertedCount > 0) created += 1;
  }

  /*
   * Backfill for databases seeded before stores existed. Without this, an
   * existing dev database keeps terminals with `store: null`, every till shows
   * the whole menu, and the scoping looks broken for reasons that have nothing
   * to do with the code.
   */
  for (const { code, storeCode } of TERMINALS) {
    const storeId = storeIdByCode.get(storeCode);
    if (storeId) await Terminal.updateOne({ code, store: null }, { $set: { store: storeId } });
  }

  if (created > 0) logger.info(`Seeded ${created} POS terminal(s)`);
  return `terminals: ${created} created, ${TERMINALS.length - created} already present`;
}

export default seedTerminals;
