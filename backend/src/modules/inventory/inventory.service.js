/**
 * Inventory: the stock ledger and deliberate stock changes.
 * ---------------------------------------------------------------------------
 * Two jobs:
 *
 *  1. `recordMovements` — write ledger lines for stock that has already moved.
 *     Called by the order and POS services after their own atomic updates, so
 *     the ledger describes what happened rather than what was attempted.
 *
 *  2. `adjustStock` — the only way for a person to change a stock figure, so a
 *     miscount, a delivery and a write-off each leave a reason in the ledger.
 *
 * The ledger never blocks a sale. A ledger write that fails is logged loudly
 * and the sale stands — refusing a customer because a history line could not
 * be written would turn a reporting problem into lost trade.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { realtime } from '../../core/realtime/realtime.js';
import { Product } from '../catalog/product.model.js';
import { auditService } from '../audit/audit.service.js';
import { StockMovement, MOVEMENT_TYPES } from './stock-movement.model.js';

/**
 * Append ledger lines. Never throws.
 *
 * @param {Array<{product, quantity, balanceAfter?, name?}>} lines  quantity is SIGNED
 * @param {object} context shared by every line: type, reference, channel, terminalId, store, note, actor
 */
export async function recordMovements(lines, context = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return;

  try {
    const ids = [...new Set(lines.map((line) => String(line.product)))];

    // One query for the snapshots, however many lines there are.
    const products = await Product.find({ _id: { $in: ids } })
      .select('name sku unit category')
      .populate('category', 'name')
      .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const actorId = context.actor?.id ?? null;
    const docs = lines.map((line) => {
      const product = byId.get(String(line.product));
      return {
        product: line.product,
        productName: product?.name ?? line.name ?? 'Unknown product',
        sku: product?.sku ?? null,
        unit: product?.unit ?? line.unit ?? null,
        category: product?.category?._id ?? null,
        categoryName: product?.category?.name ?? null,
        type: context.type,
        quantity: line.quantity,
        balanceAfter: Number.isFinite(line.balanceAfter) ? line.balanceAfter : null,
        reference: context.reference ?? null,
        channel: context.channel ?? null,
        terminalId: context.terminalId ?? null,
        store: context.store ?? null,
        note: context.note ?? null,
        actor: actorId && mongoose.isValidObjectId(actorId) ? actorId : null,
        actorName: context.actor?.fullName ?? context.actor?.name ?? null,
      };
    });

    await StockMovement.insertMany(docs, { ordered: false });
  } catch (error) {
    logger.error('Stock ledger write failed — the stock change itself stands', {
      type: context.type,
      reference: context.reference,
      message: error.message,
    });
  }
}

export const inventoryService = {
  /**
   * Change one product's stock on purpose.
   *
   * @param {string} productId
   * @param {object} change
   * @param {'set'|'add'|'remove'} change.mode
   *   `set` is a stock take ("there are 7"), `add` a delivery, `remove` a
   *   write-off (spoiled, dropped). Three verbs because they are three
   *   different events, and the ledger should say which one happened.
   * @param {number} change.quantity
   * @param {string} [change.note]
   * @param {object} actor `req.user`
   */
  async adjustStock(productId, { mode, quantity, note }, actor) {
    if (!mongoose.isValidObjectId(productId)) throw ApiError.badRequest('Invalid product');

    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount < 0) {
      throw ApiError.badRequest('Enter a quantity of zero or more');
    }

    const product = await Product.findById(productId).select('name stock unit').lean();
    if (!product) throw ApiError.notFound('Product');

    let updated;
    if (mode === 'set') {
      updated = await Product.findOneAndUpdate(
        { _id: productId },
        { $set: { stock: amount, updatedBy: actor?.id } },
        { new: true, projection: { stock: 1, name: 1 } },
      ).lean();
    } else if (mode === 'add') {
      if (amount === 0) throw ApiError.badRequest('Enter how many arrived');
      updated = await Product.findOneAndUpdate(
        { _id: productId },
        { $inc: { stock: amount }, $set: { updatedBy: actor?.id } },
        { new: true, projection: { stock: 1, name: 1 } },
      ).lean();
    } else if (mode === 'remove') {
      if (amount === 0) throw ApiError.badRequest('Enter how many to remove');
      // Conditional, so a write-off can never drive stock below zero.
      updated = await Product.findOneAndUpdate(
        { _id: productId, stock: { $gte: amount } },
        { $inc: { stock: -amount }, $set: { updatedBy: actor?.id } },
        { new: true, projection: { stock: 1, name: 1 } },
      ).lean();
      if (!updated) {
        throw ApiError.badRequest(`Only ${product.stock} ${product.unit} of ${product.name} in stock`);
      }
    } else {
      throw ApiError.badRequest('Choose set, add or remove');
    }

    const delta = updated.stock - product.stock;

    if (delta !== 0) {
      await recordMovements([{ product: productId, quantity: delta, balanceAfter: updated.stock }], {
        type: MOVEMENT_TYPES.ADJUSTMENT,
        note:
          note?.trim() || (mode === 'set' ? 'Stock take' : mode === 'add' ? 'Stock received' : 'Written off'),
        actor,
      });

      await auditService.record({
        actor,
        action: 'inventory.adjusted',
        module: 'inventory',
        // A large write-off is how stock goes missing quietly.
        severity: delta < 0 && Math.abs(delta) >= 10 ? 'warning' : 'info',
        summary: `${product.name}: ${product.stock} → ${updated.stock} (${delta > 0 ? '+' : ''}${delta})${note ? ` — ${note}` : ''}`,
        targetType: 'product',
        targetId: productId,
        changes: { stock: { from: product.stock, to: updated.stock } },
      });

      realtime.stockChanged([productId]);
      realtime.notificationsChanged();
    }

    return {
      id: String(productId),
      name: product.name,
      previous: product.stock,
      stock: updated.stock,
      delta,
      message:
        delta === 0
          ? `${product.name} unchanged at ${updated.stock}`
          : `${product.name}: ${product.stock} → ${updated.stock} (${delta > 0 ? '+' : ''}${delta})`,
    };
  },

  /** Ledger lines for one product, newest first — the product's stock history. */
  async productHistory(productId, { limit = 50 } = {}) {
    if (!mongoose.isValidObjectId(productId)) throw ApiError.badRequest('Invalid product');
    const rows = await StockMovement.find({ product: productId }).sort({ createdAt: -1 }).limit(limit).lean();
    return rows.map((row) => ({
      id: String(row._id),
      at: row.createdAt,
      type: row.type,
      quantity: row.quantity,
      balanceAfter: row.balanceAfter,
      reference: row.reference,
      terminalId: row.terminalId,
      note: row.note,
      actorName: row.actorName,
    }));
  },
};

export default inventoryService;
