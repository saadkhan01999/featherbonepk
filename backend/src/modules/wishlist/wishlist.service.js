/**
 * Wishlist.
 * ---------------------------------------------------------------------------
 * Saved products, resolved through the same serializer the menu uses, so a
 * saved item shows the current price and stock rather than whatever they were
 * when it was saved. A wishlist that shows a stale price is worse than none —
 * the customer adds it to the cart and the number changes under them.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { Product } from '../catalog/product.model.js';
import { serializeProducts } from '../catalog/product.serializer.js';
import { WishlistItem } from './wishlist.model.js';

export const wishlistService = {
  /** A customer's saved products, with live pricing and stock. */
  async list(customerId) {
    const saves = await WishlistItem.find({ customer: customerId }).sort({ createdAt: -1 }).lean();

    if (saves.length === 0) return { items: [], total: 0 };

    const products = await Product.find({
      _id: { $in: saves.map((s) => s.product) },
      isActive: true,
    })
      .populate('category', 'name slug')
      .lean();

    // Preserve save order — `$in` returns documents in index order, not the
    // order of the ids given, so the list would otherwise appear shuffled.
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const ordered = saves
      .map((save) => byId.get(String(save.product)))
      // Silently drops products archived since being saved. Showing a dead
      // entry the customer cannot buy or meaningfully act on is just clutter.
      .filter(Boolean);

    return { items: serializeProducts(ordered), total: ordered.length };
  },

  /** Just the ids — cheap enough to load on app start so hearts render filled. */
  async ids(customerId) {
    const saves = await WishlistItem.find({ customer: customerId }).select('product').lean();
    return saves.map((save) => String(save.product));
  },

  /**
   * Save a product.
   * Idempotent: saving twice is a no-op, not an error. The customer tapped a
   * heart — telling them off for tapping it again would be absurd.
   */
  async add(customerId, productId) {
    if (!mongoose.isValidObjectId(productId)) throw ApiError.badRequest('Invalid product');

    const product = await Product.findOne({ _id: productId, isActive: true }).select('_id name').lean();
    if (!product) throw ApiError.notFound('Product');

    await WishlistItem.updateOne(
      { customer: customerId, product: productId },
      { $setOnInsert: { customer: customerId, product: productId } },
      { upsert: true },
    );

    return { productId: String(productId), saved: true, message: `${product.name} saved` };
  },

  async remove(customerId, productId) {
    await WishlistItem.deleteOne({ customer: customerId, product: productId });
    // Deleting something already gone is success, not a 404 — the caller's
    // desired state ("not in my wishlist") holds either way.
    return { productId: String(productId), saved: false, message: 'Removed from your wishlist' };
  },

  /** One call for the heart button, which does not track which way it is going. */
  async toggle(customerId, productId) {
    const existing = await WishlistItem.findOne({ customer: customerId, product: productId }).lean();
    return existing ? this.remove(customerId, productId) : this.add(customerId, productId);
  },

  async clear(customerId) {
    const { deletedCount } = await WishlistItem.deleteMany({ customer: customerId });
    return { removed: deletedCount, message: 'Wishlist cleared' };
  },

  async count(customerId) {
    return WishlistItem.countDocuments({ customer: customerId });
  },
};

export default wishlistService;
