/**
 * User — one account model for customers and staff.
 * ---------------------------------------------------------------------------
 * A single collection rather than separate Customer/Staff models, because the
 * same person can legitimately be both (a cashier who orders online), and
 * splitting them would duplicate authentication, lockout and session logic in
 * two places — where they would inevitably drift apart.
 *
 * The `role` field is what separates the surfaces, and `select: false` on the
 * password means it is never returned unless a query explicitly asks for it.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import { ROLES, ROLE_VALUES } from '../../core/constants/roles.js';

/** Cost 12 ≈ 250ms on modern hardware — slow enough to blunt offline cracking,
 *  fast enough that a login doesn't feel sluggish. */
const BCRYPT_ROUNDS = 12;

/** Lockout policy. Defends the account; the rate limiter defends the IP. Both
 *  are needed: one attacker, many IPs vs. many attackers, one account. */
/*
 * Brute-force lockout.
 *
 * Four attempts, then one minute.
 *
 * The balance matters more than it looks. Fifteen minutes stops an attacker
 * cold, but it also strands a cashier mid-service over a mistyped password —
 * and a queue does not wait fifteen minutes. One minute is long enough to make
 * automated guessing useless (four tries a minute against an 8-character
 * password is not an attack, it is a rounding error) and short enough that a
 * real person can simply try again.
 *
 * Per-account lockout works alongside the per-IP rate limiter; they defend
 * against different things, and neither replaces the other.
 */
const MAX_FAILED_ATTEMPTS = 4;
const LOCK_DURATION_MS = 60 * 1000;

const sessionSchema = new mongoose.Schema(
  {
    // The refresh token is stored hashed — a database leak must not hand over
    // live sessions.
    tokenHash: { type: String, required: true },
    sessionId: { type: String, required: true, index: true },
    userAgent: String,
    ip: String,
    expiresAt: { type: Date, required: true },
    /*
     * Did the user tick "remember me"?
     *
     * Stored because a refresh rotates the cookie, and the server has no other
     * way to know what to reissue — browsers send a cookie's value back, never
     * its Max-Age. Without this, the first rotation silently converts every
     * non-persistent session into a week-long one.
     */
    persistent: { type: Boolean, default: false },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } },
);

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'],
    },

    // Pakistani mobile format (03XX XXXXXXX), stored digits-only.
    phone: {
      type: String,
      trim: true,
      match: [/^03\d{9}$/, 'Enter a valid mobile number (03XXXXXXXXX)'],
      // `sparse` so multiple accounts may omit a phone without colliding on null.
      index: { unique: true, sparse: true },
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 8,
      select: false, // Never leaves the database unless explicitly selected.
    },

    role: { type: String, enum: ROLE_VALUES, default: ROLES.CUSTOMER, index: true },

    /**
     * Per-user permission overrides, layered on top of the role defaults.
     * Lets the owner grant one cashier the ability to refund without inventing
     * a whole new role for one person.
     */
    permissions: { type: [String], default: undefined },

    /**
     * Which stores this employee works at.
     *
     * Empty means every store — head office, the owner, and anyone whose job
     * spans counters. That default matters: a new admin should not be silently
     * blind to the whole business because nobody remembered to tick a box.
     *
     * Scoping a person to one store limits what their dashboard and reports
     * show; it does not replace permissions. The two compose — a bakery manager
     * needs both `report.view` and an assignment to the bakery.
     */
    stores: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }], default: [] },

    avatarUrl: String,

    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
      index: true,
    },

    emailVerified: { type: Boolean, default: false },
    verificationToken: { type: String, select: false },
    verificationExpires: { type: Date, select: false },

    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordChangedAt: Date,

    /**
     * Is this account on a temporary password it must replace before working?
     *
     * Set when a super admin resets someone's password — see
     * staff.service.resetPassword. A cashier who has forgotten theirs is handed
     * a generated string that the manager has now seen and may have written
     * down; leaving that as their standing credential would turn a recovery
     * step into a permanently shared password.
     *
     * Not `select: false`: the flag is not a secret, and both the sign-in
     * response and the request middleware need it on every call. It is cleared
     * by accountService.changePassword and by the emailed self-service reset —
     * i.e. by any path where the person chose the password themselves.
     *
     * Enforced on the server, in auth.middleware. A flag the client is merely
     * asked to respect is a suggestion, and the till would be free to ignore it.
     */
    mustChangePassword: { type: Boolean, default: false },

    // --- Brute-force protection ---
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },

    lastLoginAt: Date,

    /**
     * Which alerts this person has already seen, as `{ id: signature }`.
     *
     * Why a signature and not a boolean. Notifications here are conditions
     * derived from live state, not stored events — "9 items low on stock" is a
     * fact about right now, recomputed on every request. A plain read flag
     * would therefore silence the alert permanently: mark it read at 9 items,
     * and it stays quiet at 40.
     *
     * The signature captures the condition's current magnitude. Reading stores
     * it; the badge counts anything whose signature has since changed. So
     * dismissing "9 low" is honoured while it stays 9, and the alert returns
     * the moment it becomes 10 — which is the only reading of "seen it" that
     * does not eventually hide a real problem.
     *
     * Not `select: false`: the notification endpoints need it on every call,
     * and it holds nothing sensitive.
     */
    notificationsSeen: { type: Map, of: String, default: () => new Map() },

    /** Active refresh sessions — one entry per signed-in device. */
    sessions: { type: [sessionSchema], default: [], select: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      /**
       * Belt-and-braces scrubbing. Fields are already `select: false`, but a
       * developer who writes `.select('+password')` for a legitimate reason
       * must not accidentally serialise it into a response.
       */
      transform(_doc, ret) {
        delete ret.password;
        delete ret.sessions;
        delete ret.verificationToken;
        delete ret.passwordResetToken;
        delete ret.failedLoginAttempts;
        delete ret.lockedUntil;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// --- Indexes ---------------------------------------------------------------
// Compound index for the staff list, which always filters by role then status.
userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });

// --- Virtuals --------------------------------------------------------------

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil > Date.now());
});

/** First name only — used for greetings ("Welcome back, Ali!"). */
userSchema.virtual('firstName').get(function firstName() {
  return this.fullName?.split(' ')[0] ?? '';
});

// --- Hooks -----------------------------------------------------------------

/**
 * Hash the password whenever it changes.
 *
 * Living in a hook rather than in the service means every write path is
 * covered — service, seed, admin reset, future bulk import. A service-level
 * hash is one forgotten call away from storing plaintext.
 */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);

  // Backdate by a second: the JWT `iat` claim has second precision, so a token
  // issued in the same second as the change could otherwise appear to predate
  // it and survive a "log out everywhere" password change.
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);

  return next();
});

// --- Instance methods ------------------------------------------------------

/**
 * Verify a plaintext password.
 * bcrypt.compare is constant-time for a given hash, so it does not leak
 * information about the password through response timing.
 */
userSchema.methods.verifyPassword = function verifyPassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** Record a failed attempt, locking the account once the threshold is hit. */
userSchema.methods.registerFailedLogin = async function registerFailedLogin() {
  this.failedLoginAttempts = (this.failedLoginAttempts ?? 0) + 1;

  if (this.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    this.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    this.failedLoginAttempts = 0; // Reset the counter for the next window.
  }

  await this.save({ validateBeforeSave: false });
};

/** Clear the failure counter after a successful sign-in. */
userSchema.methods.registerSuccessfulLogin = async function registerSuccessfulLogin() {
  this.failedLoginAttempts = 0;
  this.lockedUntil = undefined;
  this.lastLoginAt = new Date();
  await this.save({ validateBeforeSave: false });
};

/**
 * Was the password changed after this token was issued?
 * Used to invalidate every outstanding access token when a password changes —
 * otherwise a stolen token keeps working after the victim "secured" the account.
 */
userSchema.methods.passwordChangedAfter = function passwordChangedAfter(issuedAtSeconds) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > issuedAtSeconds;
};

export const User = mongoose.model('User', userSchema);
export default User;
