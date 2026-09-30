/**
 * Auth request schemas.
 * ---------------------------------------------------------------------------
 * The password policy is enforced here (and mirrored in the client for instant
 * feedback), so a weak password can never reach the model regardless of which
 * client is calling.
 */
import { z } from 'zod';

import { passwordSchema } from '../../core/validation/password.schema.js';

/*
 * One shared definition, imported rather than restated.
 *
 * This file and staff.routes.js each carried their own copy, with a comment in
 * each saying it mirrored the other. Two copies of a security rule drift, and
 * the drift shows up as a password accepted at signup and refused when the same
 * person tries to change it.
 */
const password = passwordSchema;

const email = z.string().trim().toLowerCase().email('Enter a valid email address');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email,
  // Accepts "0300 1234567" / "0300-1234567" and normalises to digits.
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^03\d{9}$/, 'Enter a valid mobile number (03XXXXXXXXX)'))
    .optional(),
  password,
});

/**
 * Login deliberately does not apply the password policy — it only checks that
 * something was sent. Validating strength at sign-in would tell an attacker
 * which passwords are even possible, and would lock out users whose password
 * predates a policy change.
 */
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean().optional().default(false),
  /**
   * Which sign-in page this came from: the customer site or the staff portal.
   *
   * Optional, and absence means "do not check". That keeps direct API clients
   * and the test suite working, and costs nothing — see the note in
   * auth.service.js explaining why this is a clarity control rather than a
   * security one.
   */
  scope: z.enum(['customer', 'staff']).optional(),
});

/** POS sign-in additionally binds the session to a physical terminal. */
export const posLoginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
  terminalId: z
    .string()
    .trim()
    .min(1, 'Terminal ID is required')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Terminal ID may only contain letters, numbers, dashes'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  // The token is looked up alongside the email, so a stolen token is useless
  // without knowing whose it is — and the lookup stays indexed.
  email,
  password,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Confirmation token is required'),
  email,
});
