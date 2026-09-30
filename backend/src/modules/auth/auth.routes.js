/**
 * Auth routes — mounted at {API_PREFIX}/auth.
 * ---------------------------------------------------------------------------
 * Note the POS route: `/auth/pos/login` is a different endpoint from
 * `/auth/login`, not a flag on the same one. Keeping them separate means the
 * "only POS roles may sign in here" rule cannot be bypassed by omitting a
 * parameter, and the two can be rate-limited and audited independently.
 */
import { Router } from 'express';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authLimiter, registerLimiter } from '../../middleware/rateLimiter.middleware.js';
import {
  register,
  login,
  posLogin,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
} from './auth.controller.js';
import {
  registerSchema,
  loginSchema,
  posLoginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.validation.js';

const router = Router();

// --- Public ---
router.post('/register', registerLimiter, validate({ body: registerSchema }), register);
router.post('/login', authLimiter, validate({ body: loginSchema }), login);

/*
 * --- Account recovery ---
 *
 * Rate-limited with `authLimiter` for the same reason login is: without it,
 * `/forgot-password` becomes a way to send someone thousands of emails, and the
 * mail provider blocks the domain long before anyone notices.
 */
router.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), resetPassword);
router.post('/verify-email', validate({ body: verifyEmailSchema }), verifyEmail);

// --- POS terminal (separate credential surface) ---
router.post('/pos/login', authLimiter, validate({ body: posLoginSchema }), posLogin);

// Uses the httpOnly cookie rather than a bearer token, so it is not
// `authenticate`-guarded — an expired access token is the normal reason to call it.
router.post('/refresh', refresh);
router.post('/logout', logout);

// --- Authenticated ---
router.get('/me', authenticate, me);
router.post('/resend-verification', authenticate, authLimiter, resendVerification);

export default router;
