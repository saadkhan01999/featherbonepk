/**
 * Customer account: profile, password, addresses, sessions.
 * ---------------------------------------------------------------------------
 * Everything here is scoped to the caller. No route accepts a customer id, so
 * the "can I read someone else's account by changing the id?" hole has nowhere
 * to exist.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { User } from '../users/user.model.js';
import { Order } from '../orders/order.model.js';
import { WishlistItem } from '../wishlist/wishlist.model.js';
import { Address } from './address.model.js';
import { ROLES } from '../../core/constants/roles.js';
import { auditService } from '../audit/audit.service.js';

/**
 * Record a staff security event in the back-office audit trail.
 *
 * Staff only, and deliberately so. These same two endpoints serve every
 * customer on the website, and writing an entry for each of them would bury the
 * handful of lines that matter — an owner changing the address their business
 * signs in with — under thousands of routine customer edits. The audit log is
 * the back office's record of privileged action, not an activity feed.
 *
 * Never carries the password, the hash, or the old address in a form that would
 * let the entry itself become the leak it exists to detect.
 */
async function recordStaffSecurityEvent(user, entry) {
  if (user.role === ROLES.CUSTOMER) return;

  await auditService.record({
    actor: { id: String(user._id), role: user.role, fullName: user.fullName, email: user.email },
    module: 'auth',
    severity: 'critical',
    targetType: 'user',
    targetId: user._id,
    ...entry,
  });
}

export const accountService = {
  /** Profile as the account pages show it. */
  async profile(userId) {
    const user = await User.findById(userId).lean();
    if (!user) throw ApiError.notFound('Account');

    return {
      id: String(user._id),
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl ?? null,
      emailVerified: user.emailVerified,
      memberSince: user.createdAt,
      lastLoginAt: user.lastLoginAt ?? null,
    };
  },

  /**
   * Update the editable parts of a profile.
   *
   * Email is deliberately not editable here. Changing it is an identity change
   * that has to go through verification, otherwise anyone with a borrowed
   * session could quietly move an account to their own address and then use
   * password reset to take it over.
   */
  async updateProfile(userId, { fullName, phone }) {
    if (phone) {
      const taken = await User.findOne({ phone, _id: { $ne: userId } })
        .select('_id')
        .lean();
      if (taken) throw ApiError.conflict('That mobile number is already in use');
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { ...(fullName && { fullName }), ...(phone && { phone }) },
      { new: true, runValidators: true },
    ).lean();

    if (!user) throw ApiError.notFound('Account');
    logger.info('Profile updated', { user: userId });
    return this.profile(userId);
  },

  /**
   * Change password, verifying the current one first.
   * @param {string} currentSessionId The session to KEEP signed in.
   */
  async changePassword(userId, { currentPassword, newPassword }, currentSessionId) {
    // `password` is `select: false` on the model, so it must be asked for.
    const user = await User.findById(userId).select('+password +sessions');
    if (!user) throw ApiError.notFound('Account');

    const matches = await user.verifyPassword(currentPassword);
    if (!matches) throw ApiError.unauthorized('Your current password is not correct');

    if (currentPassword === newPassword) {
      throw ApiError.badRequest('Your new password must be different from the current one');
    }

    user.password = newPassword; // hashed by the model's pre-save hook
    user.passwordChangedAt = new Date();

    /*
     * The forced-change flag is cleared here, and only by a path where the
     * person chose the password themselves.
     *
     * This is the release valve for an admin reset: until it flips, the
     * middleware refuses every request but this one. Forgetting it would leave
     * the account permanently bounced back to the change-password screen — it
     * would set a new password successfully and still be locked out by the very
     * flag it had just satisfied.
     */
    user.mustChangePassword = false;

    /*
     * Every other session is revoked.
     *
     * The usual reason someone changes a password is that they think it is
     * compromised. Leaving other sessions signed in would make the change
     * cosmetic. The current session is preserved so the customer is not thrown
     * out of the page they just used.
     */
    const currentSession = user.sessions?.find((s) => s.sessionId === currentSessionId);
    user.sessions = currentSession ? [currentSession] : [];

    await user.save();

    logger.info('Password changed', { user: userId });

    await recordStaffSecurityEvent(user, {
      action: 'account.password_changed',
      summary: `${user.fullName} changed their own password — other devices signed out`,
    });

    return { message: 'Password changed. Any other devices have been signed out.' };
  },

  /**
   * Change the address this account signs in with.
   *
   * The password is required, and not as ceremony. Whoever controls the email
   * address controls the account: they can request a reset and let themselves
   * back in whenever they like. So an unattended signed-in session must not be
   * enough to move it — otherwise "left the laptop open for two minutes" and
   * "lost the account permanently" become the same event.
   *
   * The new address starts unverified. It is trusted enough to sign in with —
   * locking someone out of an account they can still prove they own would be
   * absurd — but not trusted for anything that depends on the address being
   * real until they click the link.
   */
  async changeEmail(userId, { newEmail, currentPassword }, currentSessionId) {
    const user = await User.findById(userId).select('+password +sessions');
    if (!user) throw ApiError.notFound('Account');

    const matches = await user.verifyPassword(currentPassword);
    if (!matches) throw ApiError.unauthorized('Your password is not correct');

    const email = newEmail.trim().toLowerCase();
    if (email === user.email) {
      throw ApiError.badRequest('That is already your email address');
    }

    /*
     * Checked explicitly rather than relying on the unique index, so the caller
     * gets a sentence instead of a duplicate-key error — and so the failure
     * arrives before any session is revoked.
     */
    const taken = await User.findOne({ email, _id: { $ne: user._id } }).lean();
    if (taken) throw ApiError.conflict('Another account already uses that email address');

    const previous = user.email;
    user.email = email;
    user.emailVerified = false;

    // Same reasoning as a password change: an address move is a security event,
    // so other devices are signed out. The current session survives.
    const currentSession = user.sessions?.find((session) => session.sessionId === currentSessionId);
    user.sessions = currentSession ? [currentSession] : [];

    await user.save();

    logger.info('Email changed', { user: userId, from: previous, to: email });

    // The address an account signs in with is its identity — whoever holds it
    // can reset the password at will. For the owner account especially, this is
    // the single most consequential edit in the system, and an auditor looking
    // for a takeover looks for exactly this line.
    await recordStaffSecurityEvent(user, {
      action: 'account.email_changed',
      summary: `${user.fullName} changed their sign-in address from ${previous} to ${email}`,
      changes: { email: { from: previous, to: email } },
    });

    return {
      email,
      message: `Sign-in address changed to ${email}. Other devices have been signed out.`,
    };
  },

  /** Dashboard counters for the account landing page. */
  async summary(userId) {
    const [orderStats, wishlistCount, addressCount] = await Promise.all([
      Order.aggregate([
        // `aggregate` does not cast strings to ObjectId the way `find` does —
        // a raw string here matches nothing and silently reports zero orders.
        { $match: { customer: new mongoose.Types.ObjectId(String(userId)) } },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            spent: { $sum: '$total' },
          },
        },
      ]),
      WishlistItem.countDocuments({ customer: userId }),
      Address.countDocuments({ customer: userId }),
    ]);

    return {
      orders: orderStats[0]?.orders ?? 0,
      totalSpent: orderStats[0]?.spent ?? 0,
      wishlist: wishlistCount,
      addresses: addressCount,
    };
  },

  // --- Addresses ----------------------------------------------------------

  async listAddresses(userId) {
    const addresses = await Address.find({ customer: userId }).sort({ isDefault: -1, updatedAt: -1 }).lean();

    return addresses.map((address) => ({
      id: String(address._id),
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      area: address.area ?? null,
      city: address.city,
      notes: address.notes ?? null,
      isDefault: address.isDefault,
    }));
  },

  /**
   * Ensure exactly one default.
   * Run after any write that could have created a second one, or removed the
   * only one — a customer with no default has nothing pre-filled at checkout.
   */
  async normaliseDefault(userId, preferredId = null) {
    const addresses = await Address.find({ customer: userId }).select('_id isDefault').lean();
    if (addresses.length === 0) return;

    const target =
      (preferredId && addresses.find((a) => String(a._id) === String(preferredId))) ||
      addresses.find((a) => a.isDefault) ||
      addresses[0];

    await Address.updateMany({ customer: userId, _id: { $ne: target._id } }, { $set: { isDefault: false } });
    await Address.updateOne({ _id: target._id }, { $set: { isDefault: true } });
  },

  async createAddress(userId, data) {
    const count = await Address.countDocuments({ customer: userId });
    // A cap: an unbounded address book is a cheap way to bloat a document set,
    // and nobody legitimately needs fifty.
    if (count >= 20) throw ApiError.badRequest('You can save up to 20 addresses');

    const address = await Address.create({
      ...data,
      customer: userId,
      // The first address saved becomes the default automatically.
      isDefault: data.isDefault || count === 0,
    });

    if (address.isDefault) await this.normaliseDefault(userId, address._id);
    return { id: String(address._id), message: 'Address saved' };
  },

  async updateAddress(userId, addressId, data) {
    // Scoped by customer in the query, not checked afterwards — this cannot
    // accidentally update someone else's row.
    const address = await Address.findOneAndUpdate({ _id: addressId, customer: userId }, data, {
      new: true,
      runValidators: true,
    });
    if (!address) throw ApiError.notFound('Address');

    if (data.isDefault) await this.normaliseDefault(userId, addressId);
    return { id: addressId, message: 'Address updated' };
  },

  async deleteAddress(userId, addressId) {
    const address = await Address.findOneAndDelete({ _id: addressId, customer: userId });
    if (!address) throw ApiError.notFound('Address');

    // Deleting the default promotes another, so checkout still has one.
    if (address.isDefault) await this.normaliseDefault(userId);
    return { id: addressId, message: 'Address removed' };
  },

  async setDefaultAddress(userId, addressId) {
    const exists = await Address.findOne({ _id: addressId, customer: userId }).select('_id').lean();
    if (!exists) throw ApiError.notFound('Address');

    await this.normaliseDefault(userId, addressId);
    return { id: addressId, message: 'Default address updated' };
  },

  // --- Sessions -----------------------------------------------------------

  /** Devices currently signed in. */
  async sessions(userId, currentSessionId) {
    const user = await User.findById(userId).select('+sessions').lean();
    if (!user) throw ApiError.notFound('Account');

    const now = new Date();
    return (user.sessions ?? [])
      .filter((session) => session.expiresAt > now)
      .map((session) => ({
        id: session.sessionId,
        userAgent: session.userAgent ?? 'Unknown device',
        // Never the full address — the last octet is enough for "was that me?"
        // without turning the page into a location history.
        ip: session.ip ? `${session.ip.split('.').slice(0, 3).join('.')}.•••` : null,
        expiresAt: session.expiresAt,
        isCurrent: session.sessionId === currentSessionId,
      }))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  },

  /** Sign out everywhere except here. */
  async revokeOtherSessions(userId, currentSessionId) {
    const user = await User.findById(userId).select('+sessions');
    if (!user) throw ApiError.notFound('Account');

    const before = user.sessions.length;
    user.sessions = user.sessions.filter((s) => s.sessionId === currentSessionId);
    await user.save();

    logger.info('Other sessions revoked', { user: userId, removed: before - user.sessions.length });
    return { removed: before - user.sessions.length, message: 'Other devices have been signed out' };
  },
};

export default accountService;
