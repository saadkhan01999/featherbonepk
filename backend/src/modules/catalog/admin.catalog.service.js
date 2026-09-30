/**
 * Catalogue administration — the write side.
 * ---------------------------------------------------------------------------
 * Separate from catalog.service.js (the read side) because the two have very
 * different concerns: reads are public, cached and shaped for display; writes
 * are permissioned, audited and enforce business invariants.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { parseSort } from '../../core/http/sort.js';
import { logger } from '../../core/utils/logger.js';
import { removeAsset, isManagedAsset } from '../../core/storage/media.storage.js';
import { realtime } from '../../core/realtime/realtime.js';
import { Category } from './category.model.js';
import { Store } from '../stores/store.model.js';
import { Order } from '../orders/order.model.js';
import { auditService } from '../audit/audit.service.js';
import { recordMovements } from '../inventory/inventory.service.js';
import { MOVEMENT_TYPES } from '../inventory/stock-movement.model.js';
import { Product } from './product.model.js';
import { serializeProduct } from './product.serializer.js';

/**
 * Columns the product table may be ordered by.
 *
 * A module constant rather than a property on the service: as `this.X` it
 * would silently become undefined the moment anyone destructured the method
 * off the object, and `parseSort` treats an empty whitelist as "sort by the
 * default" — so the column headers would quietly stop working with nothing
 * failing anywhere.
 *
 * `category` sorts by the stored ObjectId, not the category name — the name
 * lives in another collection and is only joined in by `populate`, so this
 * groups products by category without promising alphabetical order.
 */
const PRODUCT_SORTS = {
  name: 'name',
  price: 'price',
  stock: 'stock',
  category: 'category',
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
};

export const adminCatalogService = {
  // ======================= Categories =======================

  /** Every category, including inactive ones — the admin must see what it hid. */
  async listCategories() {
    const categories = await Category.find().sort({ displayOrder: 1, name: 1 }).lean();

    // Product counts drive the "N items" hint and, more importantly, the delete
    // guard below. One grouped query rather than N per-category counts.
    const counts = await Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.count]));

    return categories.map((category) => ({
      ...category,
      id: String(category._id),
      productCount: countBy.get(String(category._id)) ?? 0,
    }));
  },

  async createCategory(payload, actorId) {
    let category;
    try {
      const duplicate = await Category.findOne({ name: payload.name });
      if (duplicate) throw ApiError.conflict(`A category called "${payload.name}" already exists`);

      category = await Category.create({ ...payload, createdBy: actorId, updatedBy: actorId });
    } catch (error) {
      await discardOrphanAfterFailure(payload.image);
      throw error;
    }

    logger.info('Category created', { id: String(category._id), by: actorId });
    realtime.catalogChanged('category.created', { categoryId: String(category._id) });
    return category.toJSON();
  },

  async updateCategory(id, payload, actorId) {
    const category = await Category.findById(id);
    if (!category) throw ApiError.notFound('Category');

    // Same three cases as updateProduct — see the note there.
    const previousImage = category.image;
    const imageChanged = 'image' in payload && (payload.image ?? null) !== (previousImage ?? null);

    try {
      if (payload.name && payload.name !== category.name) {
        const duplicate = await Category.findOne({ name: payload.name, _id: { $ne: id } });
        if (duplicate) throw ApiError.conflict(`A category called "${payload.name}" already exists`);
      }

      Object.assign(category, payload, { updatedBy: actorId });
      await category.save();
    } catch (error) {
      await discardOrphanAfterFailure(payload.image, {
        previousUrl: previousImage,
        excludeCategoryId: id,
      });
      throw error;
    }

    if (imageChanged) await discardAsset(previousImage, { excludeCategoryId: id });

    realtime.catalogChanged('category.updated', { categoryId: String(id) });
    return category.toJSON();
  },

  /**
   * Delete a category.
   *
   * Refused while products still reference it. Cascading the delete would
   * silently destroy menu items; reassigning them would be a guess. Blocking
   * and telling the admin exactly how many products are in the way lets them
   * decide — which is the only correct answer here.
   */
  async deleteCategory(id) {
    const category = await Category.findById(id);
    if (!category) throw ApiError.notFound('Category');

    const productCount = await Product.countDocuments({ category: id });
    if (productCount > 0) {
      throw ApiError.conflict(
        `"${category.name}" still has ${productCount} product${productCount === 1 ? '' : 's'}. ` +
          'Move or delete them first, or set the category to inactive to hide it.',
        { details: [{ field: 'category', message: `${productCount} products attached` }] },
      );
    }

    const { image } = category;

    await category.deleteOne();
    await discardAsset(image);

    realtime.catalogChanged('category.deleted', { categoryId: String(id) });
    logger.info('Category deleted', { id, name: category.name });
    return { id, name: category.name };
  },

  // ======================= Products =======================

  /** Admin product list — includes inactive items and cost price. */
  async listProducts({ search, category, status, sort, page = 1, limit = 20 } = {}) {
    const filter = {};

    if (category) filter.category = category;
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (status === 'low-stock') filter.$expr = { $lte: ['$stock', '$lowStockThreshold'] };

    if (search?.trim()) {
      const term = search.trim();
      // Barcode is matched exactly as well as by name, so an admin can paste a
      // scanned code straight into the search box and find the item.
      filter.$or = [
        { name: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { sku: term.toUpperCase() },
        { barcode: term },
      ];
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Product.find(filter)
        // `+costPrice` re-includes the field that is select:false by default —
        // margin is admin-only information.
        .select('+costPrice')
        .populate('category', 'name slug')
        .sort(parseSort(sort, PRODUCT_SORTS, { updatedAt: -1 }))
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    return { items: items.map(serializeProduct), total, page, limit };
  },

  async createProduct(payload, actorId) {
    let product;
    try {
      await assertCategoryExists(payload.category);
      await assertStoreExists(payload.store);
      await assertCodesAreFree(payload);

      product = await Product.create({ ...payload, createdBy: actorId, updatedBy: actorId });
    } catch (error) {
      // The image was uploaded by an earlier request and this record will never
      // exist, so nothing will ever point at it. See discardOrphanAfterFailure.
      await discardOrphanAfterFailure(payload.image);
      throw error;
    }

    logger.info('Product created', { id: String(product._id), name: product.name, by: actorId });

    // The first line of this product's stock history.
    if (product.stock > 0) {
      await recordMovements(
        [{ product: product._id, quantity: product.stock, balanceAfter: product.stock }],
        {
          type: MOVEMENT_TYPES.OPENING,
          note: 'Opening stock',
          actor: { id: actorId },
        },
      );
    }
    realtime.catalogChanged('product.created', { productId: String(product._id) });

    const created = await Product.findById(product._id)
      .select('+costPrice')
      .populate('category', 'name slug')
      .lean();
    return serializeProduct(created);
  },

  async updateProduct(id, payload, actorId, actor, { canAdjustStock = true } = {}) {
    const product = await Product.findById(id);
    if (!product) throw ApiError.notFound('Product');

    /*
     * Editing a product and changing how many are on the shelf are separate
     * grants (`inventory.adjust`). Someone allowed to fix a typo in a
     * description should not, by that alone, be able to write 50 chickens into
     * stock. Compared with the current figure, because the form resends it.
     */
    if ('stock' in payload && Number(payload.stock) !== product.stock && !canAdjustStock) {
      throw ApiError.forbidden('You do not have permission to change stock levels.', {
        details: [{ field: 'stock', message: 'Requires: inventory.adjust' }],
      });
    }

    // Snapshot the fields worth auditing before they are overwritten.
    const before = {
      price: product.price,
      costPrice: product.costPrice,
      stock: product.stock,
      isActive: product.isActive,
    };

    /*
     * The image the record holds right now, captured before the assign.
     *
     * Three cases hang off this one value: the admin kept the image (incoming
     * equals previous — delete nothing), replaced it (delete the old one once
     * the new one is safely saved), or removed it (`image: null`, same
     * deletion). `'image' in payload` distinguishes "set it to nothing" from
     * "this PATCH did not mention images at all", which is the difference
     * between an intentional removal and an accidental one.
     */
    const previousImage = product.image;
    const imageChanged = 'image' in payload && (payload.image ?? null) !== (previousImage ?? null);

    try {
      if (payload.category) await assertCategoryExists(payload.category);
      await assertStoreExists(payload.store);
      await assertCodesAreFree(payload, id);

      Object.assign(product, payload, { updatedBy: actorId });
      await product.save();
    } catch (error) {
      await discardOrphanAfterFailure(payload.image, {
        previousUrl: previousImage,
        excludeProductId: id,
      });
      throw error;
    }

    // Only now that the new URL is persisted is the old one genuinely unused.
    if (imageChanged) await discardAsset(previousImage, { excludeProductId: id });

    const updated = await Product.findById(id).select('+costPrice').populate('category', 'name slug').lean();

    /*
     * A stock figure typed into the product form is a stock adjustment like any
     * other, and goes in the ledger as one — otherwise the history has a hole
     * exactly where somebody edited the number by hand.
     */
    if (before.stock !== product.stock) {
      await recordMovements(
        [{ product: product._id, quantity: product.stock - before.stock, balanceAfter: product.stock }],
        {
          type: MOVEMENT_TYPES.ADJUSTMENT,
          note: 'Edited on the product form',
          actor: actor ?? { id: actorId },
        },
      );
      realtime.stockChanged([product._id]);
    }
    realtime.catalogChanged('product.updated', { productId: String(id) });

    const changes = auditService.diff(before, product, ['price', 'costPrice', 'stock', 'isActive']);
    if (changes) {
      await auditService.record({
        actor: actor ?? { id: actorId },
        action: 'product.updated',
        module: changes.stock ? 'inventory' : 'catalog',
        // A price edit is not routine — it changes what every future customer
        // is charged, and is the most common way money goes missing quietly.
        severity: changes.price ? 'warning' : 'info',
        summary: `Updated ${product.name}${changes.price ? ` — price ${changes.price.from} → ${changes.price.to}` : ''}`,
        targetType: 'product',
        targetId: id,
        changes,
      });
    }

    return serializeProduct(updated);
  },

  /**
   * Remove a product.
   *
   * Archive, not DELETE, once it has been sold: historical orders and receipts
   * reference it, and hard-deleting would leave past sales pointing at nothing —
   * breaking reprints, refunds and every report that groups by product. An item
   * that has never sold is safe to remove outright.
   *
   * The image follows that same rule. An archived product keeps its photo,
   * because the admin can put it back on the menu and a receipt reprint may
   * still show it; a genuinely deleted one has its image destroyed, otherwise
   * every removed product leaves an asset behind forever.
   */
  async deleteProduct(id) {
    const product = await Product.findById(id);
    if (!product) throw ApiError.notFound('Product');

    /*
     * Does any order actually reference this product?
     *
     * Asked of the orders themselves, not of `soldCount`. That counter is a
     * running total, incremented when stock is reserved and decremented again
     * when an order is cancelled or its reservation expires — so it answers
     * "how many are currently sold", which is a different question, and it is
     * wrong for this one in both directions:
     *
     *   • A cancelled order returns the counter to zero while the order itself
     *     survives, still pointing at this product. Trusting the counter
     *     therefore hard-deleted a product that order history still references,
     *     leaving the line item pointing at nothing — the exact outcome the
     *     archive rule exists to prevent.
     *
     *   • A product only ever reserved and released, or one whose counter has
     *     drifted, was archived as though it had been sold — so "Delete" left
     *     it sitting in the list and looked like it had silently failed.
     *
     * `Order.exists` stops at the first match and uses the `items.product`
     * index, so this costs one indexed lookup rather than a scan.
     */
    const hasOrderHistory = await Order.exists({ 'items.product': id });

    if (hasOrderHistory) {
      product.isActive = false;
      await product.save();
      realtime.catalogChanged('product.archived', { productId: String(id) });
      return {
        id,
        name: product.name,
        action: 'archived',
        message: `"${product.name}" appears on past orders, so it was archived instead of deleted. It no longer appears on the menu or the till, and its receipts stay intact.`,
      };
    }

    const images = [product.image, ...(product.gallery ?? [])];

    await product.deleteOne();

    // After the delete, so `isStillReferenced` no longer counts this record.
    for (const image of images) await discardAsset(image);

    realtime.catalogChanged('product.deleted', { productId: String(id) });

    return { id, name: product.name, action: 'deleted', message: `"${product.name}" was deleted.` };
  },

  /** Quick toggle used by the list's active switch. */
  async setProductActive(id, isActive, actorId) {
    const product = await Product.findByIdAndUpdate(
      id,
      { isActive, updatedBy: actorId },
      { new: true },
    ).lean();
    if (!product) throw ApiError.notFound('Product');
    return serializeProduct(product);
  },
};

// --- Stored media ----------------------------------------------------------

/**
 * Is this image still referenced by any surviving record?
 *
 * The guard that makes deletion safe. The upload endpoint hands back a URL and
 * the admin then submits it with the record, so the same URL can legitimately
 * be attached to two products — someone re-using a photo, or a duplicated
 * record. Destroying the asset because one of them let go of it would blank the
 * image on the other, and nothing would report an error: the row still holds a
 * URL, it just no longer resolves.
 */
async function isStillReferenced(url, { excludeProductId, excludeCategoryId } = {}) {
  const productFilter = {
    $or: [{ image: url }, { gallery: url }],
    ...(excludeProductId && { _id: { $ne: excludeProductId } }),
  };
  const categoryFilter = {
    image: url,
    ...(excludeCategoryId && { _id: { $ne: excludeCategoryId } }),
  };

  const [product, category] = await Promise.all([
    Product.exists(productFilter),
    Category.exists(categoryFilter),
  ]);

  return Boolean(product || category);
}

/**
 * Delete an image that nothing points at any more.
 *
 * Always called after the database write has succeeded, never before. If the
 * order were reversed, a save that failed validation would already have
 * destroyed the photo the admin was trying to keep.
 *
 * Never throws, and never propagates: an image that could not be deleted is a
 * few kilobytes of waste, while a rejected product update is lost work. The
 * failure is logged by the storage layer, which is what makes it traceable.
 */
async function discardAsset(url, scope) {
  if (!isManagedAsset(url)) {
    // Not ours: an external URL, or bundled client art. Silence is correct —
    // this is the guard working, not a failure.
    return false;
  }

  /*
   * Every outcome is logged — still referenced, declined by storage, deleted or
   * failed — so an orphaned file can be traced. Ordinary paths log at debug,
   * genuine failures at error.
   */
  try {
    if (await isStillReferenced(url, scope)) {
      logger.debug('Kept a stored asset: another record still references it', { url, ...scope });
      return false;
    }

    const removed = await removeAsset(url);
    if (removed) logger.debug('Deleted a stored asset nothing references', { url });
    else logger.error('Storage declined to delete an unreferenced asset', { url });
    return removed;
  } catch (error) {
    logger.error('Could not clean up a stored asset', {
      url,
      ...scope,
      message: error.message,
    });
    return false;
  }
}

/**
 * Delete an image that was uploaded for a record which then failed to save.
 *
 * The upload and the save are two separate requests — that is deliberate, so a
 * rejected form does not make the admin choose their photo again — which means
 * a failed save leaves an asset nothing references. This is the cleanup for the
 * case we can see: the write we just attempted threw.
 *
 * `previousUrl` is what the record held before, and is never deleted: on an
 * update that failed without changing the image, the incoming URL and the
 * stored one are the same asset, and removing it would destroy a live image
 * because an unrelated field was invalid.
 */
async function discardOrphanAfterFailure(url, { previousUrl = null, ...scope } = {}) {
  if (!url || url === previousUrl) return;
  await discardAsset(url, scope);
}

// --- Shared guards ---------------------------------------------------------

/**
 * The counter must exist.
 *
 * Without this a mistyped id is stored happily and the item belongs to a store
 * that is not there — so it appears on no till and in no counter's figures,
 * while looking perfectly saved in the back office. Null is valid and means
 * "sold everywhere", so only a supplied value is checked.
 */
async function assertStoreExists(storeId) {
  if (storeId === undefined || storeId === null) return;
  if (!mongoose.isValidObjectId(storeId)) throw ApiError.badRequest('Choose a valid store');
  const exists = await Store.exists({ _id: storeId });
  if (!exists) throw ApiError.badRequest('That store no longer exists');
}

async function assertCategoryExists(categoryId) {
  if (!mongoose.isValidObjectId(categoryId)) throw ApiError.badRequest('Choose a valid category');
  const exists = await Category.exists({ _id: categoryId });
  if (!exists) throw ApiError.badRequest('That category no longer exists');
}

/**
 * Barcode and SKU must be unique across the catalogue.
 *
 * Checked here as well as by the unique index, purely so the admin gets a clear
 * "that barcode belongs to X" instead of a raw duplicate-key error naming an
 * internal index. The index remains the actual guarantee — this check races,
 * the index does not.
 */
async function assertCodesAreFree({ barcode, sku }, excludeId) {
  const clauses = [];
  if (barcode) clauses.push({ barcode });
  if (sku) clauses.push({ sku: sku.toUpperCase() });
  if (clauses.length === 0) return;

  const filter = { $or: clauses };
  if (excludeId) filter._id = { $ne: excludeId };

  const clash = await Product.findOne(filter).select('name barcode sku').lean();
  if (!clash) return;

  /*
   * Which field actually clashed.
   *
   * `barcode &&` is load-bearing. Without it, a product submitted with only a
   * SKU compares `undefined === undefined` against a clashing record that also
   * has no barcode — which is true — and the admin is told "that barcode is
   * already used" while the barcode box in front of them is empty. The `details`
   * entry then highlights that empty field instead of the SKU that is genuinely
   * duplicated, so the form points at the wrong input and the error cannot be
   * acted on.
   */
  const field = barcode && clash.barcode === barcode ? 'barcode' : 'sku';
  throw ApiError.conflict(`That ${field} is already used by "${clash.name}"`, {
    details: [{ field, message: `In use by ${clash.name}` }],
  });
}

export default adminCatalogService;
