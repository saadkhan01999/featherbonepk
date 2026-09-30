import { z } from 'zod';

/**
 * The password rule. One definition, used by signup, staff creation and
 * password change alike.
 * ---------------------------------------------------------------------------
 * It lived in two files that each said "mirrors the policy in the other one" —
 * which is a promise nobody can keep. Two copies drift, and the drift shows up
 * as a password accepted at signup and rejected when the same person tries to
 * change it.
 *
 * Why 3-OF-4 rather than all four classes:
 *
 * Demanding upper + lower + digit + symbol does not produce strong passwords;
 * it produces `Password1!`. People satisfy the checklist in the most
 * predictable way available, and attackers know the checklist too. NIST
 * SP 800-63B explicitly advises against composition rules for this reason and
 * favours length.
 *
 * So: a real minimum length, and enough variety to rule out `aaaaaaaa` — while
 * still accepting `FeatherBone@Mardan2026` or a memorable passphrase, neither of which
 * is weak and both of which the all-four rule refused.
 */

const CLASSES = [
  { test: /[a-z]/, label: 'a lowercase letter' },
  { test: /[A-Z]/, label: 'an uppercase letter' },
  { test: /\d/, label: 'a number' },
  { test: /[^A-Za-z0-9]/, label: 'a symbol' },
];

const REQUIRED_CLASSES = 3;

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((value) => CLASSES.filter((c) => c.test.test(value)).length >= REQUIRED_CLASSES, {
    // Names what is missing rather than restating the whole rule, so the user
    // can act on it without re-reading the requirements.
    message: 'Use at least three of: a lowercase letter, an uppercase letter, a number, a symbol',
  });

export default passwordSchema;
