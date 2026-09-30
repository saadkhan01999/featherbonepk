/**
 * Owner account tool — inspect, create, or reset the super admin.
 * ---------------------------------------------------------------------------
 *   npm run owner                              show the owner account(s)
 *   npm run owner -- --email you@shop.pk       create it, or point it at a new address
 *   npm run owner -- --reset                   new generated password for the existing owner
 *   npm run owner -- --reset --password 'xyz'  ...or a password you choose
 *
 * Why this exists. A forgotten owner password was previously unrecoverable in
 * any practical sense: the reset flow emails a link, and a fresh install has no
 * SMTP configured, so the mail is printed to a server console the owner is not
 * watching. The only route back in was editing the database by hand. That is a
 * bad position for a shop owner to be in on the morning they open.
 *
 * It talks to whatever `MONGODB_URI` points at, so it works the same against a
 * local database and a live Atlas cluster.
 *
 * Safe to run twice. Without `--reset` it never changes an existing password;
 * it reports what is there. Nothing is destructive except a reset you asked for.
 */
import { randomBytes } from 'node:crypto';

import mongoose from 'mongoose';

import { env } from '../src/config/env.config.js';
import { ROLES } from '../src/core/constants/roles.js';
import { User } from '../src/modules/users/user.model.js';

/** `--email x` / `--email=x` / bare `--reset`. */
function readFlag(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index !== -1) {
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
  }
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

/**
 * The only way an account is created outside the app.
 *
 * There is no seed any more. The sample menu, demo trade and test tills moved
 * under `tests/fixtures/`, where nothing shipped or deployed can reach them, so
 * a real database now starts genuinely empty and this command is what puts the
 * first person in it. Everyone else — admins, managers, cashiers, riders — is
 * created by that person inside User Management.
 */
const generatePassword = () => `${randomBytes(18).toString('base64url')}#7`;

const line = '─'.repeat(64);

function announce(email, password) {
  process.stdout.write(
    [
      '',
      line,
      '  SUPER ADMIN CREDENTIALS',
      '',
      `    Email     ${email}`,
      `    Password  ${password}`,
      '',
      '  Shown ONCE. Stored only as a bcrypt hash — it cannot be read back',
      '  out of the database, by anyone. Copy it now.',
      line,
      '',
    ].join('\n'),
  );
}

async function main() {
  const wantEmail = readFlag('email');
  const wantReset = Boolean(readFlag('reset'));
  const givenPassword = readFlag('password');

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  process.stdout.write(`\nConnected to ${mongoose.connection.name}\n`);

  const owners = await User.find({ role: ROLES.SUPER_ADMIN }).select('+password').lean();

  // --- Nothing exists: create it ------------------------------------------
  if (owners.length === 0) {
    const email = (typeof wantEmail === 'string' ? wantEmail : 'owner@featherandbone.pk')
      .trim()
      .toLowerCase();
    const password = typeof givenPassword === 'string' ? givenPassword : generatePassword();

    // Through the model, never insertMany — the pre-save hook is what hashes
    // the password. A bulk insert would store it in plain text.
    await User.create({
      fullName: 'Super Admin',
      email,
      password,
      phone: '03152989005',
      role: ROLES.SUPER_ADMIN,
      emailVerified: true,
      status: 'active',
    });

    process.stdout.write('No owner existed — created one.\n');
    announce(email, password);
    return;
  }

  const owner = owners[0];

  if (owners.length > 1) {
    process.stdout.write(
      `\nWARNING: ${owners.length} super admin accounts exist. Acting on ${owner.email}.\n` +
        'Extra owner accounts are worth removing — each is a full-access key.\n',
    );
  }

  // --- Just looking --------------------------------------------------------
  if (!wantReset && !wantEmail) {
    process.stdout.write(
      [
        '',
        `  Email    ${owner.email}`,
        `  Status   ${owner.status}`,
        `  Created  ${owner.createdAt?.toISOString().slice(0, 10) ?? 'unknown'}`,
        `  Last in  ${owner.lastLoginAt?.toISOString().slice(0, 16).replace('T', ' ') ?? 'never'}`,
        '',
        '  The password cannot be shown — it is hashed. To set a new one:',
        '    npm run owner -- --reset',
        '',
      ].join('\n'),
    );
    return;
  }

  /*
   * Loaded as a document, not `.lean()`, so assigning `password` runs the
   * hashing hook on save. Writing to the lean object above would store the
   * new password in plain text — the exact bug this comment exists to prevent.
   */
  const document = await User.findById(owner._id);

  if (typeof wantEmail === 'string') {
    const email = wantEmail.trim().toLowerCase();
    const clash = await User.findOne({ email, _id: { $ne: document._id } });
    if (clash) {
      process.stdout.write(`\nCannot use ${email} — another account already has it.\n`);
      process.exitCode = 1;
      return;
    }
    document.email = email;
    // A changed address must be re-verified in normal flow, but this account is
    // the one that would have to approve it. Trust the operator at the console.
    document.emailVerified = true;
  }

  let password;
  if (wantReset || typeof givenPassword === 'string') {
    password = typeof givenPassword === 'string' ? givenPassword : generatePassword();
    document.password = password;

    /*
     * Sign every other device out. A password reset that leaves old refresh
     * tokens working is not a reset — if the reason for it is that somebody
     * else got in, they simply stay in.
     */
    document.sessions = [];
  }

  // The account is no use if it is suspended.
  if (document.status !== 'active') {
    process.stdout.write(`\nAccount was "${document.status}" — reactivating.\n`);
    document.status = 'active';
  }

  await document.save();

  process.stdout.write('\nUpdated.\n');
  if (password) announce(document.email, password);
  else process.stdout.write(`  Email is now ${document.email}. Password unchanged.\n\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`\n${error.message}\n`);
    if (/bad auth|authentication failed/i.test(error.message)) {
      process.stderr.write('The MONGODB_URI credentials are wrong — this is a database\n');
      process.stderr.write('login failure, not an application one.\n');
    }
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
