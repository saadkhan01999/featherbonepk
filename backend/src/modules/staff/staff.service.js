/**
 * Staff and access management.
 * ---------------------------------------------------------------------------
 * Creating, editing and deactivating employees, plus the role/permission
 * catalogue that drives the matrix UI.
 *
 * The privilege-escalation guard is the point of this file.
 * Without it, any account that can edit staff can promote itself — or a
 * colleague — to super admin, which makes every other permission check
 * decorative. Two rules enforce it:
 *
 *   1. You may never grant a role at or above your own rank.
 *   2. Only a super admin can mint another super admin.
 */
import { randomBytes } from 'node:crypto';

import { ApiError } from '../../core/errors/ApiError.js';
import { parseSort } from '../../core/http/sort.js';
import { logger } from '../../core/utils/logger.js';
import {
  ROLES,
  ROLE_RANK,
  ROLE_LABEL,
  STAFF_ROLES,
  PERMISSION_GROUPS,
  DEFAULT_ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  permissionsFor,
} from '../../core/constants/roles.js';
import { User } from '../users/user.model.js';
import { auditService } from '../audit/audit.service.js';

/** Public shape for a staff row. Never leaks password or session data. */
function toStaff(user) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    roleLabel: ROLE_LABEL[user.role] ?? user.role,
    status: user.status,
    avatarUrl: user.avatarUrl ?? null,
    emailVerified: user.emailVerified,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    /** On a temporary password from a reset — the list shows this as a badge. */
    mustChangePassword: Boolean(user.mustChangePassword),
    // Effective permissions: explicit overrides win, else the role defaults.
    permissions:
      user.role === ROLES.SUPER_ADMIN
        ? ['*']
        : ((user.permissions?.length ? user.permissions : DEFAULT_ROLE_PERMISSIONS[user.role]) ?? []),
    hasCustomPermissions: Boolean(user.permissions?.length),
    stores: (user.stores ?? []).map(String),
    /** Empty assignment means every store — stated so the UI need not infer it. */
    allStores: (user.stores ?? []).length === 0,
  };
}

/**
 * May `actor` assign `targetRole`?
 * Rank comparison, not an allow-list, so adding a role to the catalogue does
 * not silently open a new escalation path.
 */
function assertCanAssignRole(actor, targetRole) {
  if (targetRole === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden('Only a super admin can create another super admin');
  }

  const actorRank = ROLE_RANK[actor.role] ?? 0;
  const targetRank = ROLE_RANK[targetRole] ?? 0;

  // Strictly greater: an admin cannot create another admin either, because
  // that account could then edit the first one.
  if (actor.role !== ROLES.SUPER_ADMIN && targetRank >= actorRank) {
    throw ApiError.forbidden(
      `You cannot assign the "${ROLE_LABEL[targetRole] ?? targetRole}" role — it is at or above your own level`,
    );
  }
}

/** May `actor` modify `target`? Prevents editing peers and superiors. */
function assertCanManage(actor, target) {
  if (String(actor.id) === String(target._id)) {
    // Self-edit of role/status is refused: locking yourself out, or promoting
    // yourself, are both one careless click away otherwise.
    throw ApiError.badRequest('You cannot change your own role or status here');
  }

  if (actor.role === ROLES.SUPER_ADMIN) return;

  if ((ROLE_RANK[target.role] ?? 0) >= (ROLE_RANK[actor.role] ?? 0)) {
    throw ApiError.forbidden('You cannot manage an account at or above your own level');
  }
}

/**
 * You cannot grant what you do not hold.
 *
 * Without this an admin hands a subordinate a capability they were never given
 * themselves — and since they control that account, they have effectively
 * granted it to themselves. Applied on both create and update: guarding only
 * the update path meant an admin could escalate by setting the permissions at
 * creation time instead.
 *
 * Compares against the actor's effective permissions via `permissionsFor`, not
 * the raw `permissions` field. That field is undefined for anyone running on
 * role defaults, so reading it directly compared against an empty list and
 * refused every grant — a guard that looked right and was wrong in both
 * directions at once.
 */
function assertCanGrant(actor, requested) {
  if (actor.role === ROLES.SUPER_ADMIN) return;

  const held = permissionsFor(actor);
  if (held.includes('*')) return;

  const overreach = requested.filter((permission) => !held.includes(permission));
  if (overreach.length > 0) {
    throw ApiError.forbidden('You cannot grant permissions you do not have yourself', {
      details: overreach.map((permission) => ({ field: 'permissions', message: permission })),
    });
  }
}

/**
 * Columns the staff table may be ordered by.
 *
 * `lastActive` maps to `lastLoginAt`: the header says what an administrator is
 * looking for, the value says where it is stored. Nothing sensitive is listed —
 * ordering by a password or token field would leak its distribution.
 */
const STAFF_SORTS = {
  name: 'fullName',
  role: 'role',
  status: 'status',
  lastActive: 'lastLoginAt',
  createdAt: 'createdAt',
};

/**
 * A temporary password nobody has seen before.
 *
 * Base64url of 12 random bytes (~72 bits) plus a fixed `#7`, which guarantees
 * the symbol and digit the shared password policy asks for regardless of what
 * the random draw produced — a generator that trips its own validator one time
 * in twenty becomes a support call during service.
 *
 * Long enough that it cannot be guessed in the minutes before it is used, short
 * enough to read down a phone line to the person standing at the till.
 */
function generateTemporaryPassword() {
  return `${randomBytes(12).toString('base64url')}#7`;
}

export const staffService = {
  /** The role + permission catalogue that renders the matrix. */
  catalogue() {
    return {
      roles: STAFF_ROLES.map((role) => ({
        value: role,
        label: ROLE_LABEL[role],
        rank: ROLE_RANK[role],
        defaultPermissions: DEFAULT_ROLE_PERMISSIONS[role] ?? [],
        // Super admin is the wildcard; its grants are not editable.
        isSystem: role === ROLES.SUPER_ADMIN,
      })),
      permissionGroups: PERMISSION_GROUPS,
      allPermissions: ALL_PERMISSIONS,
    };
  },

  /** Staff list with search and filters. Customers are excluded by definition. */
  async list({ search, role, status, sort, page = 1, limit = 20 } = {}) {
    const filter = { role: { $ne: ROLES.CUSTOMER } };

    if (role) filter.role = role;
    if (status) filter.status = status;

    if (search?.trim()) {
      const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: new RegExp(safe, 'i') },
        { email: new RegExp(safe, 'i') },
        { phone: new RegExp(safe, 'i') },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort(parseSort(sort, STAFF_SORTS, { createdAt: -1 }))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return { items: users.map(toStaff), total, page, limit };
  },

  /** Headline counts for the page summary. */
  async stats() {
    const rows = await User.aggregate([
      { $match: { role: { $ne: ROLES.CUSTOMER } } },
      {
        $group: {
          _id: '$role',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        },
      },
    ]);

    const byRole = Object.fromEntries(rows.map((r) => [r._id, { total: r.total, active: r.active }]));
    return {
      total: rows.reduce((sum, r) => sum + r.total, 0),
      active: rows.reduce((sum, r) => sum + r.active, 0),
      byRole,
    };
  },

  async create(payload, actor) {
    assertCanAssignRole(actor, payload.role);
    // Must be checked here too, not only on update. Without it an admin could
    // escalate simply by setting the permissions at creation time instead of
    // afterwards — same outcome, one step earlier.
    if (payload.permissions?.length) assertCanGrant(actor, payload.permissions);

    const existing = await User.findOne({ email: payload.email.toLowerCase() });
    if (existing) throw ApiError.conflict('An account with that email already exists');

    const user = await User.create({
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      password: payload.password,
      role: payload.role,
      // Staff accounts are created by an administrator who has verified the
      // person exists — no email round-trip needed to let them start work.
      emailVerified: true,
      status: 'active',
      ...(payload.permissions?.length && { permissions: payload.permissions }),
      ...(payload.stores && { stores: payload.stores }),
    });

    logger.info('Staff account created', { userId: String(user._id), role: user.role, by: actor.id });

    // Critical: this hands someone a way into the system.
    await auditService.record({
      actor,
      action: 'staff.created',
      module: 'staff',
      severity: 'critical',
      summary: `Created ${ROLE_LABEL[user.role] ?? user.role} account for ${user.fullName} (${user.email})`,
      targetType: 'user',
      targetId: user._id,
      changes: payload.permissions?.length ? { permissions: { from: null, to: payload.permissions } } : null,
    });

    return toStaff(user.toObject());
  },

  async update(id, payload, actor) {
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound('Employee');
    if (user.role === ROLES.CUSTOMER) throw ApiError.badRequest('That account is a customer, not staff');

    assertCanManage(actor, user);
    if (payload.role && payload.role !== user.role) assertCanAssignRole(actor, payload.role);

    // Captured before mutation, or the diff compares a value with itself.
    const before = { role: user.role, status: user.status };

    if (payload.permissions) {
      assertCanGrant(actor, payload.permissions);
      user.permissions = payload.permissions;
    }

    // Presence, not truthiness: an empty array is a deliberate instruction
    // ("all stores"), and `if (payload.stores)` would silently ignore it.
    if (payload.stores !== undefined) user.stores = payload.stores;

    if (payload.fullName) user.fullName = payload.fullName;
    if (payload.phone !== undefined) user.phone = payload.phone || undefined;
    if (payload.role) user.role = payload.role;

    if (payload.status && payload.status !== user.status) {
      user.status = payload.status;
      // Deactivating must also end existing sessions — otherwise the person
      // stays signed in until their token happens to expire, which is exactly
      // the window that matters when someone is dismissed.
      if (payload.status !== 'active') user.sessions = [];
    }

    await user.save();
    logger.info('Staff account updated', { userId: id, by: actor.id });

    // A role or permission change is the one an auditor actually looks for.
    const sensitive = payload.role || payload.permissions || payload.status;
    await auditService.record({
      actor,
      action: 'staff.updated',
      module: 'staff',
      severity: sensitive ? 'critical' : 'info',
      summary: `Updated ${user.fullName}${payload.role ? ` — role now ${ROLE_LABEL[payload.role] ?? payload.role}` : ''}${payload.status ? ` — ${payload.status}` : ''}`,
      targetType: 'user',
      targetId: id,
      changes: auditService.diff(before, { role: user.role, status: user.status }, ['role', 'status']),
    });

    return toStaff(user.toObject());
  },

  /**
   * Reset an employee's password — the cashier-forgot-their-password path.
   *
   * Why this exists at all, rather than a "show password" button: the stored
   * value is a bcrypt hash, and that is not a limitation to work around, it is
   * the entire point. Nothing in this system can reveal an existing password
   * because nothing in this system knows one. A manager who could read a
   * cashier's password could also sign in as them and ring up sales in their
   * name, and the audit trail would name the wrong person.
   *
   * So recovery replaces the credential instead of disclosing it:
   *
   *   • a password supplied by the admin, or one generated here
   *   • hashed by the model's pre-save hook — never stored in readable form
   *   • returned to the caller exactly once, in this response, and never
   *     persisted in plaintext, so no later request can retrieve it
   *   • the account is flagged `mustChangePassword`, so the temporary value
   *     cannot quietly become a permanent shared secret
   *
   * Every existing session is dropped and the lockout counters cleared. Both
   * matter: a forgotten password usually means the person has already locked
   * themselves out, and a reset that left old sessions alive would not actually
   * end the access it was called to change.
   *
   * @returns {{temporaryPassword: string}} shown once by the caller, then gone.
   */
  async resetPassword(id, { password } = {}, actor) {
    const user = await User.findById(id).select('+sessions');
    if (!user) throw ApiError.notFound('Employee');
    if (user.role === ROLES.CUSTOMER) {
      throw ApiError.badRequest('That account is a customer, not staff');
    }

    // The same rank rules as any other edit: you cannot reset the password of a
    // peer or a superior. Without this, an admin resets the super admin's
    // password and signs in as the owner — the escalation the role guards in
    // this file exist to prevent, reached through a different door.
    assertCanManage(actor, user);

    const temporaryPassword = password || generateTemporaryPassword();

    user.password = temporaryPassword; // hashed by the model's pre-save hook
    user.mustChangePassword = true;

    /*
     * Signed out everywhere, and unlocked.
     *
     * `sessions = []` because a reset that leaves the old device signed in has
     * changed nothing an attacker would notice. The counters are cleared
     * because the usual reason a manager is standing here is that four bad
     * guesses have already locked the account, and handing someone a new
     * password they then cannot use for another minute is a confusing way to
     * fix it.
     */
    user.sessions = [];
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;

    await user.save();

    // No password, no hash — not in the log line and not in the audit record.
    // An audit trail that captures the credential it is recording the change of
    // is a plaintext password store with extra steps.
    logger.info('Staff password reset', { userId: id, by: actor.id });

    await auditService.record({
      actor,
      action: 'staff.password_reset',
      module: 'staff',
      severity: 'critical',
      summary:
        `Reset the password for ${user.fullName} (${user.email}) — ` +
        'signed out of every device, and must set a new password at next sign-in',
      targetType: 'user',
      targetId: id,
    });

    return {
      id: String(user._id),
      fullName: user.fullName,
      email: user.email,
      temporaryPassword,
      mustChangePassword: true,
      message:
        `${user.fullName} must sign in on the website with this password and choose a new one. ` +
        'It is shown once and cannot be retrieved again.',
    };
  },

  /**
   * Deactivate rather than delete.
   * Staff are referenced by orders, shifts and audit records; hard-deleting
   * would orphan all of that history.
   */
  async deactivate(id, actor) {
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound('Employee');

    assertCanManage(actor, user);

    user.status = 'inactive';
    user.sessions = [];
    await user.save();

    logger.info('Staff account deactivated', { userId: id, by: actor.id });

    await auditService.record({
      actor,
      action: 'staff.deactivated',
      module: 'staff',
      severity: 'critical',
      summary: `Deactivated ${user.fullName} — signed out of the website and every till`,
      targetType: 'user',
      targetId: id,
    });

    return { ...toStaff(user.toObject()), message: `${user.fullName} can no longer sign in.` };
  },
};

export default staffService;
