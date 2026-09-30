/**
 * Auth controllers — HTTP translation only.
 * ---------------------------------------------------------------------------
 * These functions read the request, call the service, and shape the response.
 * No business rules live here.
 *
 * The refresh token is never put in a response body: it goes out as an httpOnly
 * cookie so client JavaScript cannot read it. Only the short-lived access token
 * is returned, and the client is expected to hold that in memory (not
 * localStorage, which is readable by injected script).
 */
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../core/http/ApiResponse.js';
import { REFRESH_COOKIE_NAME, refreshCookieOptions, clearRefreshCookie } from '../../config/cookie.config.js';
import { authService } from './auth.service.js';
import { passwordResetService } from './password-reset.service.js';

/** Request metadata recorded against each session, for the device list. */
const contextOf = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

export const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.register(req.body, contextOf(req));

  // A fresh signup persists: someone who has just created an account should not
  // be signed out by closing the tab.
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(req, { persistent: true }));
  return sendCreated(res, { user, accessToken }, 'Welcome to Feather & Bone');
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken, persistent } = await authService.login(req.body, contextOf(req));

  // "Remember me" controls only how long the refresh cookie survives. The
  // access token's lifetime never changes — a longer-lived access token would
  // widen the window in which a stolen one is useful.
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(req, { persistent }));

  return sendSuccess(res, {
    message: `Welcome back, ${user.fullName.split(' ')[0]}`,
    data: { user, accessToken },
  });
});

/**
 * POS terminal sign-in.
 * Returns `posToken` — a different field name from `accessToken` on purpose, so
 * it is obvious at every call site that this is not a website session and must
 * be stored separately.
 *
 * No refresh cookie is issued: a till session is long-lived by design (a full
 * shift) and a shared device should not silently renew itself overnight.
 */
export const posLogin = asyncHandler(async (req, res) => {
  const result = await authService.posLogin(req.body, contextOf(req));
  return sendSuccess(res, {
    message: `Terminal ready — signed in as ${result.user.fullName}`,
    data: result,
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME];
  const { user, accessToken, refreshToken, persistent } = await authService.refresh(
    presented,
    contextOf(req),
  );

  // Reissue with the same lifetime the session was created with.
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(req, { persistent }));
  return sendSuccess(res, { message: 'Session refreshed', data: { user, accessToken } });
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
  clearRefreshCookie(res, req);
  return sendSuccess(res, { message: 'Signed out' });
});

/**
 * Begin a password reset.
 *
 * Always 200, whether or not the address is registered. A 404 here would turn
 * the form into a way of discovering who has an account.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await passwordResetService.requestReset(req.body.email, { ip: req.ip });
  return sendSuccess(res, { message: result.message, data: null });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await passwordResetService.resetPassword(req.body);
  return sendSuccess(res, { message: result.message, data: null });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await passwordResetService.verifyEmail(req.body);
  return sendSuccess(res, { message: result.message, data: null });
});

/** Resend the confirmation email to the signed-in account. */
export const resendVerification = asyncHandler(async (req, res) => {
  const result = await passwordResetService.requestVerification(req.userDoc);
  return sendSuccess(res, { message: result.message, data: null });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  // Returned unwrapped, matching what sign-in puts in `data.user`, so the
  // client has one user shape to handle rather than two.
  return sendSuccess(res, { message: 'OK', data: user });
});
