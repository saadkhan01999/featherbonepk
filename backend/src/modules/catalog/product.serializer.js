/**
 * Product serialisation for API responses.
 * ---------------------------------------------------------------------------
 * Why this exists: catalogue reads use `.lean()` for speed, and lean documents
 * are plain objects — Mongoose virtuals are not computed on them. Passing
 * `{ virtuals: true }` to `.lean()` does nothing unless the mongoose-lean-virtuals
 * plugin is installed, so the fields silently come back `undefined` rather than
 * throwing. That is a nasty failure mode: the till would show a blank price
 * badge and no one would see an error.
 *
 * Deriving the fields explicitly here keeps the speed of `lean()` and makes the
 * computation visible instead of magic. The definitions must stay in step with
 * the virtuals in product.model.js.
 */
import { UNITS } from './product.model.js';

/**
 * Add the derived fields the UI needs to a lean product document.
 * @param {object} product A lean product document.
 */
export function serializeProduct(product) {
  if (!product) return product;

  const discountPercent = product.discountPercent ?? 0;
  const price = product.price ?? 0;
  const stock = product.stock ?? 0;
  const threshold = product.lowStockThreshold ?? 5;

  return {
    ...product,
    id: String(product._id ?? product.id),

    /** What the customer actually pays per unit, after any discount. */
    effectivePrice: discountPercent ? Math.round(price * (1 - discountPercent / 100)) : price,

    /** Can this be sold in fractions (1.5 kg)? Drives the till's quantity input. */
    isWeighed: UNITS[product.unit]?.isWeight ?? false,

    /** Display label for the unit ("Kg", "Pcs"). */
    unitLabel: UNITS[product.unit]?.label ?? product.unit,

    /**
     * Three levels, not two — "medium" is what gives the owner time to reorder
     * before an item actually hits zero.
     */
    stockStatus:
      stock <= 0
        ? 'out_of_stock'
        : stock <= threshold
          ? 'low'
          : stock <= threshold * 3
            ? 'medium'
            : 'in_stock',
  };
}

/** Map a list of lean products. */
export function serializeProducts(products = []) {
  return products.map(serializeProduct);
}

export default serializeProduct;
