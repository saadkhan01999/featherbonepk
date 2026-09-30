/**
 * Authentication and authorization middleware.
 * ---------------------------------------------------------------------------
 * `authenticate`    — website/back-office access token
 * `authenticatePos` — POS terminal token (different secret, see token.util.js)
 * `authorize`       — coarse role check
 * `checkPermission` — fine-grained capability check (prefer this on routes)
 *
 * The two authenticators are deliberately not interchangeable. A POS token
 * fails signature verification against the website secret and vice-versa, so a
 * terminal session can never be replayed against customer endpoints.
 */
import { ApiError } from '../core/errors/ApiError.js';
import { asyncHandler } from '../core/utils/asyncHandler.js';
import { verifyAccessToken, verifyPosToken } from '../core/utils/token.util.js';
import { ROLES, ROLE_RANK, permissionsFor } from '../core/constants/roles.js';
import { User } from '../modules/users/user.model.js';

/** Pull a bearer token off the Authorization header. */
function bearerToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Load the account and re-validate it on every request.
 *
 * A valid signature is not sufficient. The token was minted minutes ago; since
 * then the account may have been suspended, deleted, or had its password
 * changed. Skipping this lookup is what lets a sacked employee keep working
 * until their token happens to expire.
 */
export async function loadActiveUser(payload) {
  const user = await User.findById(payload.sub);

  if (!user) throw ApiError.unauthorized('This account no longer exists');
  if (user.status !== 'active') {
    throw ApiError.forbidden(
      user.status === 'suspended' ? 'This account has been suspended' : 'This account is inactive',
    );
  }
  if (user.passwordChangedAfter(payload.iat)) {
    throw ApiError.unauthorized('Password was changed — please sign in again');
  }

  return user;
}

/**
 * The one request a person on a temporary password is allowed to make.
 *
 * `POST {API_PREFIX}/account/password` — matched on the tail of the path so it
 * holds whatever API_PREFIX is set to. Everything else is refused until they
 * have chosen their own password; see `assertPasswordIsTheirs`.
 */
const CHANGE_PASSWORD_ROUTE = /\/account\/password$/;

/**
 * A temporary password may be used to replace itself, and for nothing else.
 *
 * Without this the `mustChangePassword` flag would be advisory — a note the
 * client is politely asked to honour, which the till, a stale tab or anything
 * speaking to the API directly would simply not see. The forced change has to
 * be enforced where it cannot be skipped, which is here.
 *
 * The refusal carries `code: 'PASSWORD_CHANGE_REQUIRED'` so the client can route
 * to the change-password screen instead of showing a generic "forbidden" that
 * tells the cashier nothing about what to do next.
 */
function assertPasswordIsTheirs(req, user) {
  if (!user.mustChangePassword) return;

  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
  const isTheChange = req.method === 'POST' && CHANGE_PASSWORD_ROUTE.test(path);
  if (isTheChange) return;

  throw ApiError.forbidden(
    'Your password was reset by an administrator. Choose a new password before continuing.',
    { code: 'PASSWORD_CHANGE_REQUIRED' },
  );
}

/** Require a signed-in website/back-office user. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized('You must be signed in to do that');

  const payload = verifyAccessToken(token);
  const user = await loadActiveUser(payload);
  assertPasswordIsTheirs(req, user);

  req.user = {
    id: String(user._id),
    role: user.role,
    email: user.email,
    fullName: user.fullName,
    sid: payload.sid,
    /*
     * Which counters this person may see. Must be carried here: `visibleStoreIds`
     * reads it, and an absent field reads as "assigned to nothing", which that
     * function treats as unrestricted — so omitting it would silently hand every
     * store's takings to a single-counter manager.
     *
     * Empty array = head office, sees everything. Not a bug.
     */
    stores: (user.stores ?? []).map(String),
  };
  req.userDoc = user;
  return next();
});

/**
 * Optional authentication — attaches the user when a valid token is present,
 * but never rejects. Used by endpoints that serve both guests and members
 * (menu browsing, cart) where signing in only enriches the response.
 */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await loadActiveUser(payload);
    req.user = { id: String(user._id), role: user.role, email: user.email, fullName: user.fullName };
    req.userDoc = user;
  } catch {
    // An invalid token on an optional route is treated as "guest", not an
    // error — an expired token must not break menu browsing.
  }
  return next();
});

/**
 * Require an authenticated POS terminal session.
 * Populates `req.pos` with the cashier and the terminal, because a sale has to
 * be attributable to both for the cash drawer to reconcile.
 */
export const authenticatePos = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized('POS session required — please sign in at the terminal');

  const payload = verifyPosToken(token);
  const user = await loadActiveUser(payload);

  /*
   * A temporary password cannot operate a till.
   *
   * The terminal has no account screen to change a password on, so there is no
   * "allowed one request" carve-out here as there is on the website — the
   * answer is simply no, with the sentence that tells the cashier where to go.
   * Letting a reset credential ring up sales indefinitely would defeat the
   * point of forcing the change, and the till is the surface where it matters
   * most: those sales are attributed to that person by name.
   */
  if (user.mustChangePassword) {
    throw ApiError.forbidden(
      'Your password was reset. Sign in on the website, choose a new password, then sign in here again.',
      { code: 'PASSWORD_CHANGE_REQUIRED' },
    );
  }

  req.user = {
    id: String(user._id),
    role: user.role,
    email: user.email,
    fullName: user.fullName,
  };
  req.pos = {
    terminalId: payload.terminal,
    /** Scopes the till's menu and stamps every sale. */
    storeId: payload.store ?? null,
    shiftId: payload.shift ?? null,
    cashierId: String(user._id),
    cashierName: user.fullName,
  };
  req.userDoc = user;
  return next();
});

/**
 * Coarse role gate. Use for surface-level access ("is this a staff member");
 * prefer `checkPermission` for anything feature-specific.
 *
 * @param {...string} allowed
 */
export function authorize(...allowed) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === ROLES.SUPER_ADMIN) return next(); // Always permitted.
    if (!allowed.includes(req.user.role)) {
      return next(ApiError.forbidden('Your account does not have access to this area'));
    }
    return next();
  };
}

/** Minimum-rank gate — "manager or above". */
export function authorizeMinRank(minimumRole) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if ((ROLE_RANK[req.user.role] ?? 0) < (ROLE_RANK[minimumRole] ?? 0)) {
      return next(ApiError.forbidden('Your account does not have access to this area'));
    }
    return next();
  };
}

/**
 * Resolve the effective permission set for a user.
 *
 * Order: super admin wildcard → explicit per-user overrides → role defaults.
 * The role-default fallback is what lets accounts work before any custom Role
 * document exists.
 */
// Re-exported from the constants module, which is the single definition.
// Two copies of "what may this user do" is exactly the kind of duplication
// that drifts and becomes a security hole.
export { permissionsFor };

/**
 * Fine-grained capability gate. This is what routes should use.
 *
 *   router.post('/', authenticate, checkPermission(PERMISSIONS.PRODUCT_MANAGE), create)
 *
 * Gating on a capability rather than a role rank is what makes the role editor
 * in the back office functional instead of decorative.
 */
export function checkPermission(...required) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.userDoc) throw ApiError.unauthorized();

    const granted = permissionsFor(req.userDoc);
    if (granted.includes('*')) return next();

    const missing = required.filter((permission) => !granted.includes(permission));
    if (missing.length > 0) {
      throw ApiError.forbidden('You do not have permission to perform this action', {
        details: [{ field: 'permission', message: `Requires: ${missing.join(', ')}` }],
      });
    }
    return next();
  });
}

/**
 * Attach a `req.can(permission)` helper without enforcing anything.
 * Lets a controller shape its response by capability — e.g. a cashier sees
 * their own sales, a manager sees the whole terminal's.
 */
export const attachPermissions = asyncHandler(async (req, _res, next) => {
  if (req.userDoc) {
    const granted = permissionsFor(req.userDoc);
    req.permissions = granted;
    req.can = (permission) => granted.includes('*') || granted.includes(permission);
  } else {
    req.permissions = [];
    req.can = () => false;
  }
  return next();
});
