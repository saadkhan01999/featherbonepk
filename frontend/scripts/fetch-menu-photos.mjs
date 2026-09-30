/**
 * Fetch placeholder menu photography.
 * ---------------------------------------------------------------------------
 *   node scripts/fetch-menu-photos.mjs
 *
 * Downloads a curated set of food photographs into public/images/products/photos/
 * so the storefront, till and back office all show realistic imagery instead of
 * flat placeholders.
 *
 * SOURCE & LICENCE
 * Images come from the Unsplash CDN. The Unsplash Licence permits free use for
 * commercial and non-commercial purposes with no attribution required, which is
 * why this source was chosen over keyword placeholder services — those return
 * Creative-Commons NC-ND images with the licence and photographer burned into
 * the pixels as a watermark. NC ("non-commercial") is the wrong licence for a
 * real restaurant, and a watermark looks broken in a premium UI.
 *
 * WHAT WAS DELIBERATELY EXCLUDED
 *  • Branded soft-drink photography (Coca-Cola, Schweppes cans). The trademark
 *    belongs to its owner; a generic juice shot carries no such risk.
 *  • Alcohol. The business is a Pakistani halal restaurant.
 *  • Raw meat. Appetising on a butcher's site, off-putting on a menu.
 *
 * These remain PLACEHOLDERS. Real photography uploaded through the admin
 * product form replaces them per item, and nothing here is referenced after that.
 *
 * Each id below was visually checked before being included — an id alone says
 * nothing about what the photo actually shows.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'products', 'photos');

/** filename → Unsplash photo id (each verified by eye). */
const PHOTOS = {
  'roast-chicken': '1598103442097-8b74394b95c6', // whole roast bird in a skillet
  'chicken-tikka': '1567188040759-fb8a883dc6d8', // charred grilled chicken pieces
  'mutton-karahi': '1585937421612-70a008356fbe', // curry bowls with rice
  'beef-nihari': '1600891964092-4316c288032e', // sliced steak with fries
  bbq: '1544025162-d76694265947', // grilled ribs on a board
  bakery: '1606491956689-2ea866880c84', // soft bread rolls
  sweets: '1565958011703-44f9829ba187', // layered cake slice
  'sweets-alt': '1578985545062-69928b1d9587', // chocolate cake
  beverages: '1595981267035-7b04ca84a82d', // fresh juice (no trademark)
  sides: '1541592106381-b31e9677c0e5', // fries
  'sides-alt': '1601050690597-df0568f70950', // samosas
  combos: '1633945274405-b6c8069047b0', // rice platter
  ambience: '1517248135467-4c7edcad34c4', // restaurant interior (hero / about)

  // --- Venue footage for the story video ---------------------------------
  // Deliberately the ROOM AND THE PEOPLE IN IT, not plated food. The story
  // section is about atmosphere; the menu already shows the dishes, and
  // repeating them here makes the video feel like an advert for the grid
  // directly beside it.
  'venue-room': '1552566626-52f8b828add9', // wide dining room, warm light
  'venue-interior': '1517248135467-4c7edcad34c4', // moody interior
  'venue-guests': '1592861956120-e524fc739696', // guests sharing a meal
  'venue-table': '1414235077428-338989a2e8c0', // fine-dining table, candlelit
  'venue-friends': '1466978913421-dad2ebd01d17', // friends eating together
};

/** 800×600 at q80 — sharp on a POS touchscreen, still ~60–120KB each. */
const url = (id) => `https://images.unsplash.com/photo-${id}?w=800&h=600&fit=crop&q=80`;

mkdirSync(OUT_DIR, { recursive: true });

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const [name, id] of Object.entries(PHOTOS)) {
  const target = join(OUT_DIR, `${name}.jpg`);

  // Idempotent: re-running must not re-download megabytes for no reason.
  if (existsSync(target)) {
    skipped += 1;
    continue;
  }

  try {
    const response = await fetch(url(id), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    // A truncated or error-page response would otherwise be written as a
    // "valid" file and render as a broken image.
    if (buffer.byteLength < 10_000) throw new Error(`suspiciously small (${buffer.byteLength}b)`);

    writeFileSync(target, buffer);
    console.log(`  ✓ ${name}.jpg (${Math.round(buffer.byteLength / 1024)}KB)`);
    downloaded += 1;
  } catch (error) {
    console.warn(`  ✗ ${name}.jpg — ${error.message}`);
    failed += 1;
  }
}

console.log(`\n${downloaded} downloaded, ${skipped} already present, ${failed} failed.`);
if (failed > 0) {
  console.log('Failures fall back to the generated SVG artwork, so the UI still renders.');
}
