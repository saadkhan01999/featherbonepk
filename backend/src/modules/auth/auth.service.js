/**
 * Authentication service — all sign-in logic lives here.
 * ---------------------------------------------------------------------------
 * Controllers only translate HTTP; every rule about who may sign in, and what
 * happens when they fail, is in this file so there is exactly one place to
 * audit.
 */
import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { ROLES, PERMISSIONS, permissionsFor } from '../../core/constants/roles.js';
import {
  signAccessToken,
  signRefreshToken,
  signPosToken,
  verifyRefreshToken,
  hashToken,
  randomToken,
} from '../../core/utils/token.util.js';
import { User } from '../users/user.model.js';
import { terminalService } from '../pos/terminal.service.js';

/** Refresh-token lifetime, mirrored from the JWT expiry for the session record. */
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A single generic failure message for every credential problem.
 *
 * Account-enumeration defence: "no account with that email" and "wrong
 * password" must be indistinguishable, otherwise the login form becomes an
 * oracle for discovering which emails are registered.
 */
const INVALID_CREDENTIALS = 'Email or password is incorrect';

/**
 * How long until an account unlocks, in words.
 * Seconds below a minute: "try again in 1 minute(s)" for a 40-second wait reads
 * as a much longer punishment than it is, and a cashier with a queue will
 * believe it.
 */
function lockoutMessage(lockedUntil) {
  const seconds = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? '' : 's'}`
      : `${Math.ceil(seconds / 60)} minute${seconds < 120 ? '' : 's'}`;
  return `Too many failed attempts. Try again in ${wait}.`;
}

/** Trim a user document down to what the client is allowed to see. */
function publicUser(user) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    emailVerified: user.emailVerified,
    status: user.status,
    /*
     * On a temporary password from an admin reset.
     *
     * Sent so the client can route straight to the change-password screen
     * rather than letting someone reach a dashboard that will refuse every
     * request it makes. The enforcement itself is in auth.middleware — this
     * field only spares the user a wall of failed calls.
     */
    mustChangePassword: Boolean(user.mustChangePassword),
    // Included on sign-in too, so the back office can render the correct nav
    // on the first paint rather than flashing every module and then removing
    // the ones this person cannot reach.
    permissions: permissionsFor(user),
  };
}

/** Create a refresh session on the user document and return the raw token. */
async function issueRefreshSession(user, { userAgent, ip, persistent = false }) {
  /*
   * Session ids are random bytes, not derived from the token: two logins in the
   * same second produce identical JWT payloads, and "sign out other devices"
   * needs every session to have its own id.
   */
  const sessionId = randomToken(16);

  const refreshToken = signRefreshToken({ userId: user._id, sessionId });
  const finalHash = hashToken(refreshToken);

  const session = {
    tokenHash: finalHash,
    sessionId,
    userAgent: userAgent?.slice(0, 200),
    ip,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    persistent,
  };

  /*
   * Atomic push, not `user.save()`.
   *
   * `save()` carries the document's `__v` and fails with a VersionError if
   * anything else touched the document in between. Two refreshes arriving
   * together — which happens on every page load in development, because React
   * StrictMode double-invokes effects, and in production whenever two tabs wake
   * at once — both read version N, both write, and the loser got a 500.
   *
   * The user saw an error while the other request quietly succeeded, so the
   * session was fine and the log said otherwise. That is the worst kind of bug:
   * alarming, intermittent, and not actually breaking anything.
   *
   * `$push` with `$slice` is a single atomic operation. Concurrent refreshes
   * now both succeed, and the list is capped in the same write rather than by
   * reading, trimming and hoping nobody else wrote first.
   */
  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        sessions: {
          $each: [session],
          // Keep the newest 10; the oldest device is signed out first.
          $slice: -10,
        },
      },
    },
  );

  // Keep the in-memory document consistent for anything that reads it after
  // this call — the atomic write above does not update the loaded copy.
  user.sessions.push(session);

  return { refreshToken, sessionId, persistent };
}

export const authService = {
  /** Create a customer account. Self-service signup can only create customers. */
  async register({ fullName, email, phone, password }, context = {}) {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      // A duplicate email is inherently observable at signup (the account
      // cannot be created), so a clear message here costs nothing extra.
      throw ApiError.conflict('An account with that email already exists');
    }

    const user = await User.create({
      fullName,
      email,
      phone,
      password,
      // Hard-coded, never taken from the request body: accepting a role here
      // would let anyone mint themselves a super admin.
      role: ROLES.CUSTOMER,
    });

    // Use the id the session was actually stored with. Re-deriving it here (as
    // this once did) produced an access token whose `sid` matched no session,
    // so a freshly registered user had no identifiable current device.
    // A signup has no "remember me" checkbox, and being signed out by closing
    // the tab moments after creating an account is a poor first impression.
    const { refreshToken, sessionId } = await issueRefreshSession(user, {
      ...context,
      persistent: true,
    });
    const accessToken = signAccessToken({ userId: user._id, role: user.role, sessionId });

    logger.info('Account registered', { userId: String(user._id) });
    return { user: publicUser(user), accessToken, refreshToken };
  },

  /** Sign in to the website / back office. */
  async login({ email, password, scope, rememberMe }, context = {}) {
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password +failedLoginAttempts +lockedUntil +sessions',
    );

    if (!user) throw ApiError.unauthorized(INVALID_CREDENTIALS);

    if (user.isLocked) {
      throw ApiError.forbidden(lockoutMessage(user.lockedUntil));
    }

    const passwordMatches = await user.verifyPassword(password);
    if (!passwordMatches) {
      await user.registerFailedLogin();
      throw ApiError.unauthorized(INVALID_CREDENTIALS);
    }

    // Status is checked after the password, deliberately: revealing "this
    // account is suspended" to someone who doesn't know the password would
    // confirm the account exists.
    if (user.status !== 'active') {
      throw ApiError.forbidden('This account is not active. Please contact support.');
    }

    /*
     * Which door did they come through?
     *
     * The storefront and the back office have separate sign-in pages, so a
     * customer never sees a staff form and an admin never has to hunt for the
     * dashboard. `scope` tells the server which one was used.
     *
     * Be clear about what this is: a routing and clarity control, not a
     * security boundary. Anyone speaking to the API directly can omit `scope`,
     * and that is fine — the real authorisation is `checkPermission` on every
     * protected route, which no client can talk its way past. This exists so
     * the two audiences get the right form and the right destination, and so a
     * customer typing their password into a page headed "Staff Portal" is told
     * plainly that they are in the wrong place.
     */
    if (scope === 'staff' && user.role === 'customer') {
      throw ApiError.forbidden('This is the staff portal. Customer accounts sign in on the main website.');
    }
    if (scope === 'customer' && user.role !== 'customer') {
      throw ApiError.forbidden('Staff accounts sign in through the staff portal, not the customer login.');
    }

    await user.registerSuccessfulLogin();
    const { refreshToken, sessionId } = await issueRefreshSession(user, {
      ...context,
      persistent: Boolean(rememberMe),
    });
    const accessToken = signAccessToken({ userId: user._id, role: user.role, sessionId });

    return {
      user: publicUser(user),
      accessToken,
      refreshToken,
      persistent: Boolean(rememberMe),
    };
  },

  /**
   * Sign in at a till. Separate from `login` on purpose:
   *   • only accounts holding `pos.operate` may pass — a customer, or an admin
   *     whose till access was revoked, is rejected here even with correct
   *     credentials
   *   • it requires a terminal id, so every sale is attributable to a device
   *   • it mints a POS-secret token that is useless on the customer site
   */
  async posLogin({ email, password, terminalId }, context = {}) {
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password +failedLoginAttempts +lockedUntil',
    );

    if (!user) throw ApiError.unauthorized(INVALID_CREDENTIALS);

    if (user.isLocked) {
      throw ApiError.forbidden(lockoutMessage(user.lockedUntil));
    }

    const passwordMatches = await user.verifyPassword(password);
    if (!passwordMatches) {
      await user.registerFailedLogin();
      throw ApiError.unauthorized(INVALID_CREDENTIALS);
    }

    if (user.status !== 'active') {
      throw ApiError.forbidden('This account is not active. Please contact your manager.');
    }

    /*
     * A temporary password cannot open a till.
     *
     * Refused here rather than only in the middleware so the cashier is told at
     * the sign-in screen, where they can act on it, instead of being handed a
     * session that fails on its first request. The terminal has no account
     * screen, so the change has to happen on the website first.
     */
    if (user.mustChangePassword) {
      throw ApiError.forbidden(
        'Your password was reset. Sign in on the website, choose a new password, then sign in here again.',
        { code: 'PASSWORD_CHANGE_REQUIRED' },
      );
    }

    /*
     * Till access is the `pos.operate` permission, so it can be revoked per
     * person. The credentials are already proven here, so the refusal can say why.
     */
    const granted = permissionsFor(user);
    const mayOperateTill = granted.includes('*') || granted.includes(PERMISSIONS.POS_OPERATE);

    if (!mayOperateTill) {
      throw ApiError.forbidden(
        'This account is not authorised to use a POS terminal. Ask a super admin to grant till access.',
      );
    }

    /*
     * The terminal must be registered and active.
     *
     * Checked after the credentials so this cannot be used to enumerate which
     * till codes exist without a valid staff account. Before the registry
     * existed any string was accepted, so sales could be attributed to a till
     * that was never installed and a lost device could not be shut out.
     */
    const terminal = await terminalService.assertUsable(terminalId, user._id);

    await user.registerSuccessfulLogin();

    const posToken = signPosToken({
      userId: user._id,
      role: user.role,
      // The canonical code from the registry, not the raw client string — so
      // "till-01" and "TILL-01" cannot record sales against two different tills.
      terminalId: terminal.code,
      storeId: terminal.store,
    });

    logger.info('POS terminal sign-in', {
      userId: String(user._id),
      terminalId: terminal.code,
      ip: context.ip,
    });

    return {
      user: publicUser(user),
      posToken,
      // The till's registered identity, so the terminal can show its own name
      // rather than echoing back whatever code was typed.
      terminal: {
        id: terminal.code,
        name: terminal.name,
        location: terminal.location ?? null,
        storeId: terminal.store ? String(terminal.store) : null,
      },
    };
  },

  /**
   * Exchange a refresh token for a new pair.
   *
   * Rotation: the presented token is invalidated as the new one is issued, so
   * a stolen refresh token is single-use. If a token that is not in the session
   * list is presented, it has already been rotated — which means either a
   * replay or a theft, so every session for that user is revoked.
   */
  async refresh(presentedToken, context = {}) {
    if (!presentedToken) throw ApiError.unauthorized('No session found');

    const payload = verifyRefreshToken(presentedToken);
    const user = await User.findById(payload.sub).select('+sessions');
    if (!user) throw ApiError.unauthorized('Session is no longer valid');

    const presentedHash = hashToken(presentedToken);
    const index = user.sessions.findIndex((s) => s.tokenHash === presentedHash);

    if (index === -1) {
      // Reuse of an already-rotated token — treat as compromise.
      logger.warn('Refresh token reuse detected — revoking all sessions', {
        userId: String(user._id),
      });
      user.sessions = [];
      await user.save({ validateBeforeSave: false });
      throw ApiError.unauthorized('Session is no longer valid, please sign in again');
    }

    if (user.sessions[index].expiresAt < new Date()) {
      user.sessions.splice(index, 1);
      await user.save({ validateBeforeSave: false });
      throw ApiError.unauthorized('Your session has expired, please sign in again');
    }

    if (user.status !== 'active') {
      throw ApiError.forbidden('This account is not active');
    }

    /*
     * Carry the "remember me" choice across the rotation.
     *
     * The browser sends a cookie's value back, never its Max-Age, so the server
     * cannot tell from the request whether this session was meant to persist.
     * Read it from the record being replaced. Without this the first refresh
     * quietly upgrades every session to a week — which is precisely the setting
     * the user declined.
     */
    const wasPersistent = Boolean(user.sessions[index].persistent);

    // Drop the old session, then issue a fresh one.
    user.sessions.splice(index, 1);
    const { refreshToken, sessionId } = await issueRefreshSession(user, {
      ...context,
      persistent: wasPersistent,
    });
    const accessToken = signAccessToken({ userId: user._id, role: user.role, sessionId });

    return { user: publicUser(user), accessToken, refreshToken, persistent: wasPersistent };
  },

  /** Sign out the current device only. */
  async logout(presentedToken) {
    if (!presentedToken) return; // Already signed out — not an error.

    try {
      const payload = verifyRefreshToken(presentedToken);
      const user = await User.findById(payload.sub).select('+sessions');
      if (!user) return;

      const presentedHash = hashToken(presentedToken);
      user.sessions = user.sessions.filter((s) => s.tokenHash !== presentedHash);
      await user.save({ validateBeforeSave: false });
    } catch {
      // An expired or malformed token still means "signed out" from the
      // caller's point of view; failing here would only confuse the client.
    }
  },

  /** The signed-in account. */
  async me(userId) {
    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound('Account');

    /*
     * Permissions travel with the user.
     *
     * The back office needs them to decide which nav items and dashboard
     * panels to render at all. Hiding a module the person cannot use is not a
     * security control — every route is still enforced server-side — but
     * showing an admin a "Finance" link that always 403s teaches them the UI
     * lies to them.
     *
     * `'*'` for the super admin, so the client does not have to know the role
     * hierarchy to answer "can I?".
     */
    return publicUser(user);
  },
};

export default authService;
