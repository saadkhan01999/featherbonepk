import { AuditLog } from './audit.model.js';
import { logger } from '../../core/utils/logger.js';

/**
 * Audit trail.
 * ---------------------------------------------------------------------------
 * `record()` is called from the services that perform consequential actions —
 * not from middleware. Middleware knows the HTTP verb and the URL; it does not
 * know that a PATCH changed a price from 800 to 1,200, and that is the only
 * part anybody cares about later.
 */

/** Modules the filter bar offers. Keep in step with what `record()` is called with. */
export const AUDIT_MODULES = Object.freeze([
  'auth',
  'staff',
  'catalog',
  'inventory',
  'orders',
  'pos',
  'stores',
  'settings',
]);

export const auditService = {
  /**
   * Write one entry.
   *
   * Never throws. An audit failure must not roll back the business action that
   * succeeded — refusing to save a price change because the log was unreachable
   * would turn a monitoring problem into an outage. Failures are logged loudly
   * instead, which is what a monitor is for.
   *
   * @param {object} entry
   * @param {object} [entry.actor]   `req.user`
   * @param {string} entry.action    e.g. `staff.created`
   * @param {string} entry.module
   * @param {string} entry.summary   A sentence a non-developer can read.
   */
  async record({ actor, action, module, summary, targetType, targetId, changes, ip, severity }) {
    try {
      await AuditLog.create({
        actor: actor?.id ?? null,
        actorName: actor?.fullName ?? actor?.email ?? 'System',
        actorRole: actor?.role ?? null,
        action,
        module,
        summary,
        targetType: targetType ?? null,
        targetId: targetId ? String(targetId) : null,
        changes: changes ?? null,
        ip: ip ?? null,
        severity: severity ?? 'info',
      });
    } catch (error) {
      logger.error('Audit write failed', { action, message: error.message });
    }
  },

  /**
   * Compare two objects and return only what actually changed.
   * Keeps entries small and readable — "price: 800 → 1200" rather than a dump
   * of forty unchanged fields.
   */
  diff(before, after, fields) {
    const changes = {};
    for (const field of fields) {
      const from = before?.[field];
      const to = after?.[field];
      // String comparison catches ObjectId vs string, and number vs numeric
      // string, both of which look "changed" to a strict comparison and are not.
      if (String(from ?? '') !== String(to ?? '')) changes[field] = { from, to };
    }
    return Object.keys(changes).length > 0 ? changes : null;
  },

  /** Paged history, newest first. */
  async list({ module, severity, search, page = 1, limit = 50 } = {}) {
    const filter = {};
    if (module) filter.module = module;
    if (severity) filter.severity = severity;

    if (search?.trim()) {
      // Escaped: an unescaped `.*` in a search box matches every row.
      const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ summary: rx }, { actorName: rx }, { action: rx }];
    }

    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return {
      items: items.map((entry) => ({
        id: String(entry._id),
        at: entry.createdAt,
        actorName: entry.actorName,
        actorRole: entry.actorRole,
        action: entry.action,
        module: entry.module,
        summary: entry.summary,
        targetType: entry.targetType,
        targetId: entry.targetId,
        changes: entry.changes,
        ip: entry.ip,
        severity: entry.severity,
      })),
      total,
      page,
      limit,
    };
  },

  /** Counts for the summary tiles. */
  async stats() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [bySeverity, today, total] = await Promise.all([
      AuditLog.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]),
      AuditLog.countDocuments({ createdAt: { $gte: since } }),
      AuditLog.estimatedDocumentCount(),
    ]);

    return {
      total,
      last24h: today,
      bySeverity: Object.fromEntries(bySeverity.map((row) => [row._id, row.count])),
      modules: AUDIT_MODULES,
    };
  },
};

export default auditService;
