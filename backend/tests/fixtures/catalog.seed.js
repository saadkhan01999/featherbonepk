/**
 * Catalogue seed — the menu from the reference designs.
 * ---------------------------------------------------------------------------
 * Categories, prices, units and barcodes are taken directly from the design
 * mock-ups, so what renders on screen matches the intended product exactly
 * (Full Chicken Roast at Rs 1,200/kg, Naan at Rs 40, and so on).
 *
 * Idempotent: keyed on slug/barcode with upserts, so re-running updates rather
 * than duplicating. `dev:memdb` reseeds on every boot, which keeps this honest.
 *
 * Note: no ratings are set here. `reviews.seed.js` computes them from real
 * approved reviews, exactly as the moderation endpoint does. A number typed in
 * this file would be silently replaced the first time anyone moderated a
 * review, so it is better not to write one at all.
 */
import { Category } from '../../src/modules/catalog/category.model.js';
import { Product } from '../../src/modules/catalog/product.model.js';
import { Store } from '../../src/modules/stores/store.model.js';
import { logger } from '../../src/core/utils/logger.js';


/**
 * Placeholder imagery.
 *
 * Cutout is the primary asset: the dish on a transparent background, so it sits
 * on our own surface instead of dragging another photographer's backdrop into
 * the grid. Twelve competing backgrounds read as a scrapbook; twelve cutouts on
 * one dark canvas read as a designed menu, and the same file works on a dark
 * card, a white invoice and a coloured offer banner.
 *
 * WebP is served (alpha at roughly a tenth of PNG's size); the PNG beside it is
 * the fallback. Art (generated SVG) is the last resort so a missing asset can
 * never render as a broken tile.
 *
 * Paths are root-relative — these live in the web client's public folder. A real
 * photo uploaded through the admin form replaces them per product.
 */
const CUTOUT = {
  'Roast Chicken': '/images/products/cutouts/roast-chicken.webp',
  'Chicken Tikka': '/images/products/cutouts/chicken-tikka.webp',
  'Mutton & Beef': '/images/products/cutouts/mutton-karahi.webp',
  BBQ: '/images/products/cutouts/bbq.webp',
  Bakery: '/images/products/cutouts/bakery.webp',
  Sweets: '/images/products/cutouts/sweets.webp',
  Beverages: '/images/products/cutouts/beverages.webp',
  Combos: '/images/products/cutouts/combos.webp',
  Sides: '/images/products/cutouts/sides.webp',
};

/** Generated SVG fallback, one per family. */
const ART = {
  'Roast Chicken': '/images/products/roast-chicken.svg',
  'Chicken Tikka': '/images/products/tikka.svg',
  'Mutton & Beef': '/images/products/mutton-beef.svg',
  BBQ: '/images/products/bbq.svg',
  Bakery: '/images/products/bakery.svg',
  Sweets: '/images/products/sweets.svg',
  Beverages: '/images/products/beverages.svg',
  Combos: '/images/products/combos.svg',
  Sides: '/images/products/sides.svg',
};

/** Per-product overrides where the family image would be wrong. */
const PRODUCT_PHOTO = {
  'FB-MB-002': '/images/products/cutouts/beef-nihari.webp',
  'FB-SW-001': '/images/products/cutouts/sweets-alt.webp',
  'FB-SD-002': '/images/products/cutouts/sides-alt.webp',
};

/** Cutout first, generated art as the fallback. */
const imageFor = (categoryName) => CUTOUT[categoryName] ?? ART[categoryName] ?? null;

/** Menu sections, in the order the storefront sidebar and POS tabs show them. */
const CATEGORIES = [
  { name: 'Roast Chicken', displayOrder: 1, isFeatured: true, description: 'Slow-roasted, crisp-skinned, carved to order.' },
  { name: 'Chicken Tikka', displayOrder: 2, isFeatured: true, description: 'Charcoal-grilled tikka and boti.' },
  { name: 'Mutton & Beef', displayOrder: 3, isFeatured: true, description: 'Karahi, nihari and slow-cooked cuts.' },
  { name: 'BBQ', displayOrder: 4, description: 'Seekh kababs and grilled platters.' },
  { name: 'Bakery', displayOrder: 5, isFeatured: true, description: 'Fresh naan, breads and garlic bread.' },
  { name: 'Sweets', displayOrder: 6, description: 'Traditional mithai and desserts.' },
  { name: 'Beverages', displayOrder: 7, description: 'Soft drinks, lassi and fresh juices.' },
  { name: 'Combos', displayOrder: 8, description: 'Family deals and value platters.' },
  { name: 'Sides', displayOrder: 9, description: 'Fries, coleslaw, raita and salads.' },
];

/**
 * Menu items.
 *
 * `price` is always the price of one `unit` — for kg items that is the per-kilo
 * rate, which is what lets the till bill 1.5 kg as 1.5 × 1,200 = 1,800 exactly
 * as the reference receipt shows.
 */
/**
 * Which counter sells which family of goods.
 *
 * A category not listed here is sold everywhere — drinks, sides and combos are
 * rung up at whichever till the customer reaches, and they exist once in stock,
 * not once per counter. That is why `Product.store` is nullable: null means
 * "every store", and it is the default rather than a special case to remember.
 */
const STORE_BY_CATEGORY = {
  Bakery: 'BAKERY',
  Sweets: 'BAKERY',
  'Roast Chicken': 'CHICKEN',
  'Chicken Tikka': 'CHICKEN',
  'Mutton & Beef': 'MAIN',
  BBQ: 'MAIN',
  // Beverages, Sides, Combos: deliberately absent — sold at every counter.
};

const PRODUCTS = [
  // --- Roast Chicken ---
  {
    name: 'Full Chicken Roast',
    category: 'Roast Chicken',
    price: 1200,
    costPrice: 800,
    unit: 'kg',
    barcode: '8901234567890',
    sku: 'FB-RC-001',
    description: 'Delicious full chicken roast with our signature blend of spices.',
    isFeatured: true,
    isBestSeller: true,
    stock: 25,
    soldCount: 425,
  },
  {
    name: 'Half Chicken Roast',
    category: 'Roast Chicken',
    price: 650,
    costPrice: 420,
    unit: 'pcs',
    barcode: '8901234567891',
    sku: 'FB-RC-002',
    description: 'Half portion of our signature roast chicken.',
    isFeatured: true,
    stock: 30,
    soldCount: 210,
  },

  // --- Chicken Tikka ---
  {
    name: 'Chicken Tikka',
    category: 'Chicken Tikka',
    price: 800,
    costPrice: 520,
    unit: 'pcs',
    barcode: '8901234567892',
    sku: 'FB-CT-001',
    description: 'Charcoal-grilled chicken tikka marinated overnight.',
    isBestSeller: true,
    discountPercent: 15, // Drives the "15% OFF" badge in the design.
    stock: 40,
    soldCount: 350,
  },

  // --- Mutton & Beef ---
  {
    name: 'Mutton Karahi',
    category: 'Mutton & Beef',
    price: 1500,
    costPrice: 1050,
    unit: 'kg',
    barcode: '8901234567893',
    sku: 'FB-MB-001',
    description: 'Traditional mutton karahi cooked in tomato and green chilli.',
    isFeatured: true,
    isBestSeller: true,
    stock: 12,
    soldCount: 300,
  },
  {
    name: 'Beef Nihari',
    category: 'Mutton & Beef',
    price: 950,
    costPrice: 620,
    unit: 'plate',
    barcode: '8901234567894',
    sku: 'FB-MB-002',
    description: 'Slow-cooked beef nihari, served with fresh naan.',
    stock: 18,
    soldCount: 120,
  },

  // --- BBQ ---
  {
    name: 'Beef Seekh Kabab',
    category: 'BBQ',
    price: 900,
    costPrice: 590,
    unit: 'kg',
    barcode: '8901234567895',
    sku: 'FB-BQ-001',
    description: 'Minced beef seekh kababs grilled over charcoal.',
    isBestSeller: true,
    stock: 20,
    soldCount: 250,
  },
  {
    name: 'BBQ Platter',
    category: 'BBQ',
    price: 2400,
    costPrice: 1560,
    unit: 'plate',
    barcode: '8901234567896',
    sku: 'FB-BQ-002',
    description: 'Mixed grill platter — tikka, seekh kabab, malai boti and naan.',
    isFeatured: true,
    discountPercent: 20, // "Flat 20% OFF" weekend deal from the offers page.
    stock: 10,
    soldCount: 95,
  },

  // --- Bakery ---
  {
    name: 'Naan',
    category: 'Bakery',
    price: 40,
    costPrice: 18,
    unit: 'pcs',
    barcode: '8901234567897',
    sku: 'FB-BK-001',
    description: 'Fresh tandoori naan, baked to order.',
    stock: 200,
    soldCount: 1450,
  },
  {
    name: 'Garlic Bread',
    category: 'Bakery',
    price: 250,
    costPrice: 140,
    unit: 'pcs',
    barcode: '8901234567898',
    sku: 'FB-BK-002',
    description: 'Oven-baked garlic bread with herbs and butter.',
    isBestSeller: true,
    stock: 45,
    soldCount: 280,
  },

  // --- Sweets ---
  {
    name: 'Gulab Jamun',
    category: 'Sweets',
    price: 700,
    costPrice: 430,
    unit: 'kg',
    barcode: '8901234567899',
    sku: 'FB-SW-001',
    description: 'Soft gulab jamun in warm sugar syrup.',
    stock: 15,
    soldCount: 88,
  },

  // --- Beverages ---
  {
    name: 'Coke Drink',
    category: 'Beverages',
    price: 120,
    costPrice: 85,
    unit: 'pcs',
    barcode: '8901234567900',
    sku: 'FB-BV-001',
    description: 'Chilled 1.5 litre bottle.',
    stock: 8, // Low on purpose — exercises the low-stock alert in the dashboard.
    lowStockThreshold: 10,
    soldCount: 640,
  },

  // --- Sides ---
  {
    name: 'Fries',
    category: 'Sides',
    price: 200,
    costPrice: 95,
    unit: 'pcs',
    barcode: '8901234567901',
    sku: 'FB-SD-001',
    description: 'Golden, crisp-cut fries with seasoning.',
    stock: 60,
    soldCount: 520,
  },
  {
    name: 'Coleslaw',
    category: 'Sides',
    price: 150,
    costPrice: 70,
    unit: 'pcs',
    barcode: '8901234567902',
    sku: 'FB-SD-002',
    description: 'Creamy coleslaw, made fresh daily.',
    stock: 35,
    soldCount: 190,
  },

  // --- Combos ---
  {
    name: 'Family Combo',
    category: 'Combos',
    price: 3200,
    costPrice: 2100,
    unit: 'pack',
    barcode: '8901234567903',
    sku: 'FB-CB-001',
    description: 'Full roast chicken, 4 naan, fries, coleslaw and a 1.5L drink.',
    isFeatured: true,
    discountPercent: 25, // "Get up to 25% OFF" Eid special from the offers page.
    stock: 14,
    soldCount: 160,
  },
];

export async function seedCatalog() {
  // --- Categories ---
  const categoryByName = new Map();

  for (const definition of CATEGORIES) {
    // findOneAndUpdate with upsert keeps this idempotent, but the document must
    // go through the model so the slug hook runs — hence the create/save path
    // rather than a raw update.
    const withArt = { ...definition, image: imageFor(definition.name) };

    let category = await Category.findOne({ name: definition.name });
    if (category) {
      Object.assign(category, withArt);
      await category.save();
    } else {
      category = await Category.create(withArt);
    }
    categoryByName.set(definition.name, category._id);
  }

  // --- Products ---
  // One read for the whole run rather than a lookup per product.
  const stores = await Store.find({}).select('code').lean();
  const storeIdByCode = new Map(stores.map((store) => [store.code, store._id]));

  let created = 0;
  let updated = 0;

  for (const { category: categoryName, ...definition } of PRODUCTS) {
    const categoryId = categoryByName.get(categoryName);
    if (!categoryId) {
      logger.warn(`Seed: unknown category "${categoryName}" for ${definition.name}`);
      continue;
    }

    // Products inherit their family's artwork unless one was set explicitly.
    const withImage = {
      ...definition,
      image: definition.image ?? PRODUCT_PHOTO[definition.sku] ?? imageFor(categoryName),
      // Undefined code -> undefined id -> null on the document: sold everywhere.
      store: storeIdByCode.get(STORE_BY_CATEGORY[categoryName]) ?? null,
    };

    const existing = await Product.findOne({ sku: definition.sku });
    if (existing) {
      Object.assign(existing, withImage, { category: categoryId });
      await existing.save();
      updated += 1;
    } else {
      await Product.create({ ...withImage, category: categoryId });
      created += 1;
    }
  }

  // The text index is built explicitly: autoIndex lags behind a bulk insert, and
  // menu search silently returns nothing until the index exists.
  await Product.syncIndexes();

  return `catalogue: ${CATEGORIES.length} categories, ${created} products created, ${updated} updated`;
}

export default seedCatalog;
