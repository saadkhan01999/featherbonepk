/**
 * Who may use the kitchen screens (/kitchen and /display)?
 * ---------------------------------------------------------------------------
 * TWO MODES, chosen in Settings → Kitchen Display → "Open the kitchen screens
 * without signing in" (`kitchenOpenAccess`):
 *
 *   Open (default)  Anyone who opens the screen's address sees the tickets and
 *                   can press Accept / Done / Served. No account, no password —
 *                   the kitchen PC and the counter TV just show the orders.
 *                   Their actions are recorded as "Kitchen screen".
 *
 *   Signed in       A staff account with `kitchen.view` is required to see the
 *                   screens, and `kitchen.manage` to press the buttons.
 *
 * A signed-in kitchen account works in both modes and is recorded by name.
 *
 * Open mode is for a trusted network. On a public website anybody who guesses
 * `/kitchen` can read order contents and bump tickets. Switch it off before the
 * site is live on the internet — it is one tick in Settings, takes effect
 * immediately, and disconnects any open kitchen screens that are not signed in.
 */
import { ApiError } from '../../core/errors/ApiError.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { verifyAccessToken } from '../../core/utils/token.util.js';
import { PERMISSIONS, userCan } from '../../core/constants/roles.js';
import { loadActiveUser } from '../../middleware/auth.middleware.js';
import { kitchenSettings } from '../settings/settings.service.js';

/** How an unsigned kitchen screen appears in order timelines. */
export const KITCHEN_SCREEN_ACTOR = Object.freeze({ id: null, fullName: 'Kitchen screen', role: 'kitchen' });

/**
 * The signed-in account behind the request, if any.
 * @returns {Promise<{user: object|null, allowed: boolean}>}
 */
async function signedInUser(req) {
  const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) return { user: null, allowed: false };
  try {
    const user = await loadActiveUser(verifyAccessToken(token));
    if (user.mustChangePassword) return { user: null, allowed: false };
    return { user, allowed: userCan(user, PERMISSIONS.KITCHEN_VIEW) };
  } catch {
    // An expired or foreign token is simply "not signed in" here.
    return { user: null, allowed: false };
  }
}

/** Read access to the kitchen screens. Sets `req.kitchenAccess`. */
export const kitchenAccess = asyncHandler(async (req, _res, next) => {
  const open = Boolean(kitchenSettings().openAccess);
  const { user, allowed } = await signedInUser(req);

  if (user && allowed) {
    req.user = { id: String(user._id), role: user.role, email: user.email, fullName: user.fullName };
    req.userDoc = user;
    req.kitchenAccess = {
      open,
      signedIn: true,
      canManage: open || userCan(user, PERMISSIONS.KITCHEN_MANAGE),
    };
    return next();
  }

  if (open) {
    req.user = { ...KITCHEN_SCREEN_ACTOR };
    req.kitchenAccess = { open: true, signedIn: false, canManage: true };
    return next();
  }

  if (user) {
    throw ApiError.forbidden('Your account cannot open the kitchen screens.', { code: 'KITCHEN_FORBIDDEN' });
  }
  throw ApiError.unauthorized('Sign in with a kitchen account to open this screen.', {
    code: 'KITCHEN_SIGN_IN',
  });
});

/** Accept / Done / Served. */
export function kitchenManage(req, _res, next) {
  if (req.kitchenAccess?.canManage) return next();
  return next(ApiError.forbidden('Your account can see the kitchen tickets but not update them.'));
}

/** For the socket handshake: may an unsigned kitchen screen connect? */
export function kitchenIsOpen() {
  return Boolean(kitchenSettings().openAccess);
}
