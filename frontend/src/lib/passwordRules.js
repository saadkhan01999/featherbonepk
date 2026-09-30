/**
 * The password policy, once.
 * ---------------------------------------------------------------------------
 * This mirrors the server — `backend/src/core/validation/password.schema.js`.
 * The server is the authority; this exists so someone typing a password is told
 * the answer before they submit, not after a round trip.
 *
 * Why it is shared: registration listed five requirements as if all were
 * mandatory, while the reset screen asked for eight characters and three of
 * four classes. Two screens, two policies, and only one of them matched what
 * the server would actually accept — so a password could pass the meter on one
 * page and be rejected on the other.
 *
 * Being stricter than the server is also a bug, not a safe default. Demanding
 * all four classes refuses a long passphrase the server is happy with, and
 * pushes people towards `Password1!` — which satisfies every rule and is among
 * the first things any attacker tries. Length and variety beat a checklist.
 */

/** The four character classes. Any three satisfy the policy. */
export const CHARACTER_CLASSES = Object.freeze([
  { key: 'lower', label: 'a lowercase letter', test: (v) => /[a-z]/.test(v) },
  { key: 'upper', label: 'an uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { key: 'number', label: 'a number', test: (v) => /\d/.test(v) },
  { key: 'symbol', label: 'a symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
]);

export const MIN_LENGTH = 8;
export const MIN_CLASSES = 3;

/**
 * Check a password against the policy.
 * @returns {{ok: boolean, message: string|null, classesMet: number, lengthMet: boolean}}
 */
export function checkPassword(password = '') {
  const lengthMet = password.length >= MIN_LENGTH;
  const classesMet = CHARACTER_CLASSES.filter((c) => c.test(password)).length;

  if (!lengthMet) {
    return {
      ok: false,
      lengthMet,
      classesMet,
      message: `At least ${MIN_LENGTH} characters`,
    };
  }

  if (classesMet < MIN_CLASSES) {
    return {
      ok: false,
      lengthMet,
      classesMet,
      message: `Mix at least ${MIN_CLASSES} of: ${CHARACTER_CLASSES.map((c) => c.label).join(', ')}`,
    };
  }

  return { ok: true, lengthMet, classesMet, message: null };
}

/**
 * Rules for a live checklist under the field.
 *
 * The class rule is one line ("three of four"), not four separate ticks — four
 * ticks read as four requirements, which is the misunderstanding that made the
 * registration screen look stricter than it is.
 */
export function passwordChecklist(password = '') {
  const { lengthMet, classesMet } = checkPassword(password);

  return [
    { key: 'length', label: `At least ${MIN_LENGTH} characters`, met: lengthMet },
    {
      key: 'variety',
      label: `Any ${MIN_CLASSES} of: lowercase, uppercase, number, symbol`,
      met: classesMet >= MIN_CLASSES,
    },
  ];
}

export default checkPassword;
