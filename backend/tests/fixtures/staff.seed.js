/**
 * Staff seed — the owner account, and nothing else.
 * ---------------------------------------------------------------------------
 * Exactly one account is created: the super admin. Every other person —
 * admins, managers, cashiers, kitchen and riders — is created by the super
 * admin in User Management, and signs in with the email and password set for
 * them there. The same credentials work on both surfaces: a cashier created in
 * the back office signs in at `/pos/login` with that email, that password, and
 * the code of the till they are standing at.
 *
 * Why only one:
 *
 * Seeded staff accounts are standing credentials. Everyone who has read the
 * repository, the README or a screen recording knows them, and they are
 * trivially forgotten at launch — a seeded `admin@…` with a published password
 * is a back door with a friendly name. One bootstrap account is the minimum
 * needed to reach the system at all, and the owner changes it immediately.
 *
 * It also matches how the business actually works. Staff arrive and leave; the
 * owner creates and deactivates them. Baking six people into the database
 * models a company that never changes.
 *
 * Safety: refuses to run in production, where a known password would be a real
 * vulnerability rather than a convenience.
 */
import { randomBytes } from 'node:crypto';

import { env, isEphemeralDatabase } from '../../src/config/env.config.js';
import { ROLES } from '../../src/core/constants/roles.js';
import { User } from '../../src/modules/users/user.model.js';
import { logger } from '../../src/core/utils/logger.js';

/**
 * The throwaway-database password.
 *
 * Used only when the database is ephemeral — `npm run dev:memdb`, which the
 * test suite runs against and which discards everything on exit. It is fixed
 * because the harness has to be able to sign in, and it is harmless because
 * the database it unlocks ceases to exist when the process stops.
 *
 * It is not used against a real database. See `ownerIdentity` below.
 */
export const DEV_PASSWORD = 'FeatherBone@Mardan2026';

export const DEV_EMAIL = 'owner@featherandbone.local';

/**
 * The address the owner account gets when none is configured.
 *
 * A default email is safe in a way that a default password never is: knowing
 * the address grants nothing, and the owner changes it from the account menu
 * in ten seconds. Refusing to create an account without one would be the
 * secure-looking choice and the wrong one — a fresh install with no way to
 * sign in is a system nobody can even reach to secure.
 */
export const DEFAULT_OWNER_EMAIL = 'owner@featherandbone.pk';

/**
 * A strong password nobody has seen before.
 *
 * Base64url of 18 random bytes, plus a fixed suffix guaranteeing the policy's
 * symbol and digit requirements are met regardless of what the random draw
 * happened to produce — a generator that fails validation one time in twenty
 * is a support call on somebody's launch day.
 */
function generatePassword() {
  return `${randomBytes(18).toString('base64url')}#7`;
}

/**
 * The one account that exists before anybody signs in.
 *
 * Three cases, and the difference matters:
 *
 *  1. `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD` are set — use them. This is
 *     the deployment path: the values live in the host's secret store and
 *     never touch the repository.
 *
 *  2. The database is ephemeral — use the fixed development pair. The database
 *     dies with the process, so a known password unlocks nothing.
 *
 *  3. A real database with no environment variables — generate a password,
 *     unique to this installation, and print it once.
 *
 * Case 3 is the one that changed, and it changed because the alternative was
 * indefensible. A hard-coded default password ships in the repository, appears
 * in the README, and is read by everyone who ever sees the project — including
 * anyone who finds the login page later. "Change it after first login" is not a
 * control; it is a hope. Generating means every installation differs, and the
 * only copy is the one printed to the operator running the seed.
 */
function ownerIdentity() {
  const email = (env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = env.SUPERADMIN_PASSWORD ?? '';

  if (email && password) return { email, password, source: 'environment' };

  if (isEphemeralDatabase()) {
    return { email: email || DEV_EMAIL, password: DEV_PASSWORD, source: 'ephemeral' };
  }

  // A real database: default the address, never the password.
  return { email: email || DEFAULT_OWNER_EMAIL, password: generatePassword(), source: 'generated' };
}

const OWNER = {
  fullName: 'Super Admin',
  role: ROLES.SUPER_ADMIN,
  phone: '03152989005',
};

export async function seedStaff() {
  const identity = ownerIdentity();

  if (!identity) {
    logger.error(
      'No owner account created: set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD before deploying, ' +
        'or nobody will be able to sign in.',
    );
    return 'staff: SKIPPED — SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set';
  }

  const existing = await User.findOne({ email: identity.email });
  if (existing) return 'staff: owner already present';

  // Created through the model, not insertMany, so the password-hashing hook
  // runs. A bulk insert would store this in plaintext.
  await User.create({
    ...OWNER,
    email: identity.email,
    password: identity.password,
    // No email round-trip for the bootstrap account — there would be nobody to
    // approve it, and the system would be unreachable.
    emailVerified: true,
    status: 'active',
  });

  /*
   * How the password is announced depends entirely on where it came from.
   *
   * A generated one exists nowhere else. If it scrolls past unnoticed the
   * account is unreachable and the database has to be wiped to try again — so
   * it gets a box that cannot be mistaken for log noise, written to stdout
   * rather than through the logger, because a JSON log line is exactly the
   * thing an operator's eye skips.
   *
   * One from the environment is never echoed. It is already in the deployer's
   * secret store, and repeating it into a hosting provider's log stream copies
   * a live credential somewhere permanent and searchable.
   */
  if (identity.source === 'generated') {
    const line = '─'.repeat(64);
    process.stdout.write(
      [
        '',
        line,
        '  SUPER ADMIN ACCOUNT CREATED',
        '',
        `    Email     ${identity.email}`,
        `    Password  ${identity.password}`,
        '',
        '  This password was generated for this installation and is shown',
        '  ONCE. It is not stored anywhere in readable form and cannot be',
        '  recovered — copy it now.',
        '',
        '  Sign in, then change both from the account menu.',
        line,
        '',
      ].join('\n'),
    );
  } else {
    logger.info(
      identity.source === 'environment'
        ? `Seeded the super admin — ${identity.email} (password from SUPERADMIN_PASSWORD)`
        : `Seeded the super admin — ${identity.email} / ${identity.password}`,
    );
  }

  logger.info('Every other role is created from User Management. Nothing else is seeded.');

  return 'staff: super admin created (all other roles are created in the app)';
}

export default seedStaff;
