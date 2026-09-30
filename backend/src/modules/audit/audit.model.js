import mongoose from 'mongoose';

/**
 * Audit log — who changed what, and when.
 * ---------------------------------------------------------------------------
 * Records the actions that move money or grant power: staff created, roles
 * changed, prices edited, stock adjusted, orders cancelled, settings altered.
 *
 * Deliberately not a request log. Recording every GET would bury the six
 * entries that matter under a hundred thousand that do not, and the whole point
 * is that a person can scan this and notice something wrong.
 *
 * Append-only by design: there is no update or delete route. An audit trail an
 * administrator can edit is not evidence of anything.
 */

const auditSchema = new mongoose.Schema(
  {
    /** Who did it. Null for system-originated actions. */
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    /**
     * Denormalised on purpose.
     *
     * The actor's name at the time of the action. A populated reference would
     * silently rewrite history the moment someone is renamed — or vanish
     * entirely if the account is removed, leaving an audit entry with no author.
     */
    actorName: { type: String, default: 'System' },
    actorRole: { type: String, default: null },

    /** Dotted verb: `staff.created`, `product.price_changed`, `order.cancelled`. */
    action: { type: String, required: true, index: true },

    /** Coarse grouping for the filter bar: staff, catalog, orders, settings… */
    module: { type: String, required: true, index: true },

    /** Human-readable sentence, written at the call site where the context is known. */
    summary: { type: String, required: true },

    /** What was acted upon, so the entry can link somewhere useful. */
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },

    /**
     * Before/after for changed fields only.
     *
     * Never the whole document: that would copy password hashes and customer
     * contact details into a second collection with different access rules.
     */
    changes: { type: mongoose.Schema.Types.Mixed, default: null },

    /** Where from — useful when an account behaves unexpectedly. */
    ip: { type: String, default: null },

    /**
     * Severity, so the screen can surface the few entries that need attention.
     *   info     — routine
     *   warning  — unusual but legitimate (a large discount, a stock write-off)
     *   critical — security-relevant (permissions granted, a role changed)
     */
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The screen's default view is "most recent first", optionally filtered by
// module — this index serves both without a collection scan.
auditSchema.index({ createdAt: -1 });
auditSchema.index({ module: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);
export default AuditLog;
