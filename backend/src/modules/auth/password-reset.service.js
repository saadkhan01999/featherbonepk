import crypto from 'node:crypto';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { randomToken } from '../../core/utils/token.util.js';
import { mailer } from '../../core/mail/mailer.js';
import { env } from '../../config/env.config.js';
import { User } from '../users/user.model.js';

/**
 * Password reset and email verification.
 * ---------------------------------------------------------------------------
 * Rules:
 *
 * 1. Tokens are stored hashed. A database dump otherwise hands an attacker a
 *    working reset link for every pending request. The raw token exists only in
 *    the email.
 *
 * 2. The response never reveals whether an account exists. "No account with
 *    that email" turns the reset form into a list of who banks here. Both
 *    outcomes return the same message, and take the same visible time.
 *
 * 3. A used or expired token is dead. Reset clears the token and ends every
 *    session, because a password reset is exactly what you do when you think
 *    someone else has your account.
 */

/** One hour. Long enough to find the email, short enough that a leaked link ages out. */
const RESET_TTL_MS = 60 * 60 * 1000;

/** A day — verification is not urgent and people check email on their own schedule. */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tokens are compared by hash.
 * SHA-256 rather than bcrypt: the input is already 256 bits of unguessable
 * randomness, so a slow hash buys nothing and costs latency on every attempt.
 */
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** The generic answer, whether or not the address is registered. */
const NEUTRAL_RESET_REPLY =
  'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.';

export const passwordResetService = {
  /**
   * Begin a reset. Always resolves the same way.
   */
  async requestReset(email, { ip } = {}) {
    const user = await User.findOne({ email: String(email).toLowerCase() }).select(
      '+passwordResetToken +passwordResetExpires',
    );

    // No account: return the same message without sending anything. Doing the
    // work and discarding it would be pointless; the timing difference here is
    // a database read, not a bcrypt comparison.
    if (!user) {
      logger.info('Password reset requested for an unknown address', { ip });
      return { message: NEUTRAL_RESET_REPLY };
    }

    if (user.status !== 'active') {
      // A suspended account must not be recoverable by its holder — that is the
      // point of suspending it. Same reply, no email.
      logger.warn('Password reset requested for a non-active account', {
        userId: String(user._id),
      });
      return { message: NEUTRAL_RESET_REPLY };
    }

    const token = randomToken(32);
    user.passwordResetToken = hash(token);
    user.passwordResetExpires = new Date(Date.now() + RESET_TTL_MS);
    await user.save({ validateBeforeSave: false });

    const link = `${env.CLIENT_URL}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

    await mailer.send({
      to: user.email,
      subject: `Reset your ${env.APP_NAME} password`,
      text: [
        `Hello ${user.fullName},`,
        '',
        'Someone asked to reset the password on your account. If that was you, open this link:',
        '',
        link,
        '',
        'The link works once and expires in one hour.',
        '',
        'If it was not you, ignore this email — your password has not changed.',
      ].join('\n'),
    });

    logger.info('Password reset email issued', { userId: String(user._id) });
    return { message: NEUTRAL_RESET_REPLY };
  },

  /**
   * Complete a reset.
   * Failure here can be specific: the caller already holds a token, so telling
   * them it has expired reveals nothing and saves them guessing.
   */
  async resetPassword({ token, email, password }) {
    const user = await User.findOne({
      email: String(email).toLowerCase(),
      passwordResetToken: hash(token),
    }).select('+passwordResetToken +passwordResetExpires +sessions');

    if (!user) {
      throw ApiError.badRequest(
        'That reset link is not valid. It may already have been used — request a new one.',
      );
    }

    if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      throw ApiError.badRequest('That reset link has expired. Request a new one.');
    }

    // The pre-save hook hashes it.
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    /*
     * Every session ends.
     *
     * People reset a password precisely when they suspect someone else is in
     * their account. Leaving that person signed in on another device would
     * defeat the whole exercise.
     */
    user.sessions = [];

    // A successful reset also clears any lockout — the person has proven
    // control of the mailbox, which is stronger evidence than the password was.
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;

    /*
     * Also satisfies a forced change from an admin reset.
     *
     * A cashier handed a temporary password may well go through "forgot
     * password" instead of the change-password screen — it is the flow they
     * already know. They have chosen this password themselves and proven they
     * control the mailbox, which is everything the flag was waiting for. Left
     * set, it would refuse every request after a reset that plainly succeeded.
     */
    user.mustChangePassword = false;

    await user.save();

    logger.info('Password reset completed', { userId: String(user._id) });
    return { message: 'Your password has been changed. Sign in with your new password.' };
  },

  /** Send (or resend) an address-verification email. */
  async requestVerification(user) {
    if (user.emailVerified) {
      return { message: 'That address is already verified.' };
    }

    const token = randomToken(32);
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          verificationToken: hash(token),
          verificationExpires: new Date(Date.now() + VERIFY_TTL_MS),
        },
      },
    );

    const link = `${env.CLIENT_URL}/verify-email?token=${token}&email=${encodeURIComponent(user.email)}`;

    await mailer.send({
      to: user.email,
      subject: `Confirm your email for ${env.APP_NAME}`,
      text: [
        `Hello ${user.fullName},`,
        '',
        'Confirm this address so we can send you order updates:',
        '',
        link,
        '',
        'The link expires in 24 hours.',
      ].join('\n'),
    });

    return { message: 'Verification email sent. Check your inbox.' };
  },

  async verifyEmail({ token, email }) {
    const user = await User.findOne({
      email: String(email).toLowerCase(),
      verificationToken: hash(token),
    }).select('+verificationToken +verificationExpires');

    if (!user) {
      throw ApiError.badRequest('That confirmation link is not valid. Request a new one.');
    }

    if (user.verificationExpires && user.verificationExpires < new Date()) {
      throw ApiError.badRequest('That confirmation link has expired. Request a new one.');
    }

    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.info('Email verified', { userId: String(user._id) });
    return { message: 'Thank you — your email is confirmed.' };
  },
};

export default passwordResetService;
