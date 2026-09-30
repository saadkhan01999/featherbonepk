/**
 * Terminal registry.
 * ---------------------------------------------------------------------------
 * The gate between "a device claiming to be TILL-01" and an actual till.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { realtime } from '../../core/realtime/realtime.js';
import { Order } from '../orders/order.model.js';
import { Category } from '../catalog/category.model.js';
import { Product } from '../catalog/product.model.js';
import { Terminal } from './terminal.model.js';
import { Shift, SHIFT_STATUS } from './shift.model.js';

/**
 * The Mongo condition that limits a till's menu, or `{}` for "everything".
 *
 * One definition, read by the menu, the scan lookup and the sale pricer — so
 * the three can never disagree about what this till is allowed to sell.
 *
 * Looked up per request rather than baked into the POS token: an owner who
 * narrows a till's menu expects it to take effect now, not at the cashier's
 * next sign-in hours later.
 *
 * @returns {Promise<{filter: object, mode: string, categories: string[], products: string[]}>}
 */
export async function terminalMenuScope(code) {
  const terminal = code
    ? await Terminal.findOne({ code: String(code).toUpperCase() })
        .select('menuMode menuCategories menuProducts')
        .lean()
    : null;

  const mode = terminal?.menuMode ?? 'all';
  const categories = (terminal?.menuCategories ?? []).map(String);
  const products = (terminal?.menuProducts ?? []).map(String);

  if (mode === 'categories') {
    return {
      mode,
      categories,
      products,
      filter: { category: { $in: categories.map((id) => new mongoose.Types.ObjectId(id)) } },
    };
  }
  if (mode === 'products') {
    return {
      mode,
      categories,
      products,
      filter: { _id: { $in: products.map((id) => new mongoose.Types.ObjectId(id)) } },
    };
  }
  return { mode: 'all', categories, products, filter: {} };
}

/** Check submitted menu ids exist, so a typo cannot quietly empty a till. */
async function assertMenuIds({ menuMode, menuCategories, menuProducts }) {
  if (menuMode === 'categories') {
    const ids = menuCategories ?? [];
    if (ids.length === 0) throw ApiError.badRequest('Choose at least one category for this till');
    const found = await Category.countDocuments({ _id: { $in: ids } });
    if (found !== new Set(ids.map(String)).size)
      throw ApiError.badRequest('One of those categories no longer exists');
  }
  if (menuMode === 'products') {
    const ids = menuProducts ?? [];
    if (ids.length === 0) throw ApiError.badRequest('Choose at least one product for this till');
    const found = await Product.countDocuments({ _id: { $in: ids } });
    if (found !== new Set(ids.map(String)).size)
      throw ApiError.badRequest('One of those products no longer exists');
  }
}

export const terminalService = {
  /**
   * Check a terminal may be signed in on, and stamp its usage.
   * Called by POS login — this is the whole point of the registry.
   */
  async assertUsable(code, userId) {
    const normalised = String(code).trim().toUpperCase();
    const terminal = await Terminal.findOne({ code: normalised });

    if (!terminal) {
      // Named explicitly: a cashier facing a refusal needs to know whether to
      // fix a typo or call someone. This leaks nothing — the caller has
      // already proven the credentials in posLogin before reaching here.
      throw ApiError.forbidden(`Terminal "${normalised}" is not registered. Ask an administrator to add it.`);
    }

    if (!terminal.isActive) {
      throw ApiError.forbidden(`Terminal "${normalised}" has been disabled.`);
    }

    terminal.lastUsedAt = new Date();
    terminal.lastUsedBy = userId;
    await terminal.save({ validateBeforeSave: false });

    return terminal;
  },

  /** Registry with live status. */
  async list({ includeInactive = true } = {}) {
    const filter = includeInactive ? {} : { isActive: true };

    const terminals = await Terminal.find(filter)
      .populate('lastUsedBy', 'fullName')
      // Name only — the card shows which counter this till stands at, and
      // without this `storeName` is silently null on every row.
      .populate('store', 'name')
      .sort({ code: 1 })
      .lean();

    // Which tills have a shift open right now, in one query rather than one
    // per terminal.
    const openShifts = await Shift.find({ status: SHIFT_STATUS.OPEN })
      .select('terminalId cashierName openedAt')
      .lean();
    const shiftByTerminal = new Map(openShifts.map((s) => [s.terminalId, s]));

    return terminals.map((terminal) => {
      const shift = shiftByTerminal.get(terminal.code);
      return {
        id: String(terminal._id),
        code: terminal.code,
        name: terminal.name,
        // Both the id (for the edit form) and the name (for the card), because
        // the alternative is the screen holding its own copy of the store list
        // purely to render a label.
        store: terminal.store ? String(terminal.store._id ?? terminal.store) : null,
        storeName: terminal.store?.name ?? null,
        location: terminal.location ?? null,
        notes: terminal.notes ?? null,
        menuMode: terminal.menuMode ?? 'all',
        menuCategories: (terminal.menuCategories ?? []).map(String),
        menuProducts: (terminal.menuProducts ?? []).map(String),
        isActive: terminal.isActive,
        lastUsedAt: terminal.lastUsedAt ?? null,
        lastUsedBy: terminal.lastUsedBy?.fullName ?? null,
        openShift: shift ? { cashierName: shift.cashierName, openedAt: shift.openedAt } : null,
      };
    });
  },

  async stats() {
    const [total, active, openShifts] = await Promise.all([
      Terminal.countDocuments(),
      Terminal.countDocuments({ isActive: true }),
      Shift.countDocuments({ status: SHIFT_STATUS.OPEN }),
    ]);
    return { total, active, disabled: total - active, inUse: openShifts };
  },

  async create(data, actorId) {
    const code = String(data.code).trim().toUpperCase();

    const existing = await Terminal.findOne({ code }).lean();
    if (existing) throw ApiError.conflict(`Terminal "${code}" already exists`);

    await assertMenuIds(data);
    const terminal = await Terminal.create({ ...data, code, createdBy: actorId });
    logger.info('Terminal registered', { code, by: actorId });

    return { id: String(terminal._id), code, message: `${terminal.name} registered` };
  },

  async update(id, data, actorId) {
    const terminal = await Terminal.findById(id);
    if (!terminal) throw ApiError.notFound('Terminal');

    // Renaming the code would orphan every sale and shift already recorded
    // against the old one, because those store the code, not the id.
    if (data.code && String(data.code).toUpperCase() !== terminal.code) {
      throw ApiError.badRequest(
        'A terminal code cannot be changed once sales exist against it. Disable this one and register a new till.',
      );
    }

    // Validate against the mode the till will end up with, not only a mode
    // sent in this request — sending just a new category list must still check it.
    await assertMenuIds({
      menuMode: data.menuMode ?? terminal.menuMode,
      menuCategories: data.menuCategories ?? terminal.menuCategories,
      menuProducts: data.menuProducts ?? terminal.menuProducts,
    });

    Object.assign(terminal, { ...data, code: terminal.code });
    await terminal.save();

    // The till re-reads its menu the moment this lands — no sign-out needed.
    realtime.terminalChanged(terminal.code);
    logger.info('Terminal updated', { code: terminal.code, by: actorId });
    return { id, message: `${terminal.name} updated` };
  },

  /** Enable or disable. Refuses to disable a till mid-shift. */
  async setActive(id, isActive, actorId) {
    const terminal = await Terminal.findById(id);
    if (!terminal) throw ApiError.notFound('Terminal');

    if (!isActive) {
      const openShift = await Shift.findOne({
        terminalId: terminal.code,
        status: SHIFT_STATUS.OPEN,
      }).lean();

      if (openShift) {
        // Disabling mid-shift would strand cash in an open drawer with no way
        // to close and reconcile it.
        throw ApiError.conflict(
          `${terminal.name} has an open shift (${openShift.cashierName}). Close the shift before disabling it.`,
        );
      }
    }

    terminal.isActive = isActive;
    await terminal.save({ validateBeforeSave: false });

    realtime.terminalChanged(terminal.code);
    logger.info('Terminal availability changed', { code: terminal.code, isActive, by: actorId });
    return {
      id,
      isActive,
      message: `${terminal.name} ${isActive ? 'enabled' : 'disabled'}`,
    };
  },

  /**
   * Remove a terminal — only if it has never been used.
   * Anything with sales against it is a financial record and gets disabled
   * instead, so history stays intact.
   */
  async remove(id) {
    const terminal = await Terminal.findById(id);
    if (!terminal) throw ApiError.notFound('Terminal');

    const [sales, shifts] = await Promise.all([
      Order.countDocuments({ terminalId: terminal.code }),
      Shift.countDocuments({ terminalId: terminal.code }),
    ]);

    if (sales > 0 || shifts > 0) {
      throw ApiError.conflict(
        `${terminal.name} has ${sales} sale(s) recorded against it and cannot be deleted. Disable it instead.`,
      );
    }

    await terminal.deleteOne();
    logger.info('Terminal deleted', { code: terminal.code });
    return { id, message: `${terminal.name} removed` };
  },
};

export default terminalService;
