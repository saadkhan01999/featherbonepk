/**
 * Preflight — is this installation actually able to run?
 * ---------------------------------------------------------------------------
 *   npm run doctor
 *
 * Checks the things that break a deployment on the day it goes live, in the
 * order they bite. Each result says what is wrong and what to do; a checklist
 * that only reports "fail" makes you go and find the answer somewhere else.
 *
 * Why a command and not a document. Every item here is a fact about the live
 * machine — whether Atlas answers from this ip, whether the upload volume is
 * writable by this user, whether the owner account exists in this database. A
 * README can only tell you to check them; this checks them.
 *
 * Three outcomes, and the middle one matters:
 *   Pass  verified working
 *   warn  runs, but something real is degraded (no email, no payment provider)
 *   fail  will not work — fix before deploying
 *
 * Warnings are not padding. "No SMTP" means password resets silently go
 * nowhere, which nobody notices until a member of staff is locked out.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const results = [];
const record = (level, label, detail) => results.push({ level, label, detail });
const pass = (l, d) => record('PASS', l, d);
const warn = (l, d) => record('WARN', l, d);
const fail = (l, d) => record('FAIL', l, d);

// --- Environment -----------------------------------------------------------
// Imported inside a try: env.config.js calls process.exit on invalid config,
// which would end the run before anything is reported.
let env;
try {
  ({ env } = await import('../src/config/env.config.js'));
  pass('Environment', `loaded, NODE_ENV=${env.NODE_ENV}`);
} catch (error) {
  record('FAIL', 'Environment', error.message);
  process.stdout.write('\nConfiguration is invalid — nothing else can be checked.\n');
  process.exit(1);
}

// --- Secrets ---------------------------------------------------------------
const secrets = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_POS_SECRET'];
const placeholder = secrets.filter((k) => /change-me/i.test(env[k]));
const short = secrets.filter((k) => env[k].length < 32);
const distinct = new Set(secrets.map((k) => env[k])).size === secrets.length;

if (placeholder.length) fail('JWT secrets', `${placeholder.join(', ')} still use the example value`);
else if (!distinct) fail('JWT secrets', 'two or more are identical — token isolation is broken');
else if (short.length && env.isProduction) fail('JWT secrets', `${short.join(', ')} under 32 chars`);
else if (short.length) warn('JWT secrets', `${short.join(', ')} are short; use 32+ before going live`);
else pass('JWT secrets', 'three distinct secrets, adequate length');

// --- Database --------------------------------------------------------------
let mongoose;
let dbReachable = false;
try {
  mongoose = (await import('mongoose')).default;
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  dbReachable = true;
  pass('Database', `connected to "${mongoose.connection.name}"`);
} catch (error) {
  const m = error.message;
  if (/bad auth|authentication failed/i.test(m)) {
    fail(
      'Database',
      'wrong username/password → Atlas → Database Access → Edit Password, then update MONGODB_URI',
    );
  } else if (/whitelist|not authorized/i.test(m)) {
    fail(
      'Database',
      'IP not allowed → Atlas → Network Access → Add Current IP (temp entries expire after 6h)',
    );
  } else if (/ECONNREFUSED|ENOTFOUND|querySrv/i.test(m)) {
    fail('Database', 'host unreachable → check MONGODB_URI, or use npm run dev:memdb locally');
  } else {
    fail('Database', m.split('\n')[0].slice(0, 110));
  }
}

// --- The owner account -----------------------------------------------------
if (dbReachable) {
  try {
    const { User } = await import('../src/modules/users/user.model.js');
    const { ROLES } = await import('../src/core/constants/roles.js');
    const owners = await User.countDocuments({ role: ROLES.SUPER_ADMIN });
    const staff = await User.countDocuments({ role: { $nin: [ROLES.CUSTOMER, ROLES.SUPER_ADMIN] } });

    if (owners === 0) fail('Owner account', 'nobody can sign in → npm run owner -- --email you@shop.pk');
    else if (owners > 1) warn('Owner account', `${owners} super admins exist — each is a full-access key`);
    else pass('Owner account', `1 super admin, ${staff} other staff`);
  } catch (error) {
    warn('Owner account', `could not be checked: ${error.message.slice(0, 80)}`);
  }
}

// --- Port ------------------------------------------------------------------
const portFree = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', (e) => resolve(e.code !== 'EADDRINUSE'));
  probe.once('listening', () => probe.close(() => resolve(true)));
  probe.listen(env.PORT);
});
if (portFree) pass('Port', `${env.PORT} is free`);
else fail('Port', `${env.PORT} is taken — almost always an older copy of this server, not a config problem`);

// --- Uploads ---------------------------------------------------------------
try {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  const probe = path.join(env.uploadDir, `.doctor-${Date.now()}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);

  if (env.isProduction && !env.UPLOAD_DIR) {
    // Most hosts hand each release a fresh filesystem, so the default path
    // loses every photo on the next deploy — silently, and only later.
    warn('Uploads', `writable, but UPLOAD_DIR is unset — on most hosts images vanish on redeploy`);
  } else {
    pass('Uploads', `${env.uploadDir} is writable`);
  }
} catch (error) {
  fail('Uploads', `cannot write to ${env.uploadDir} — ${error.code}`);
}

// --- Email -----------------------------------------------------------------
/*
 * Actually connect and authenticate. Checking that three variables are
 * non-empty proves nothing: a wrong app password produces a system where the
 * user asks for a reset, is told "a link is on its way", and nothing ever
 * arrives — the send failure is logged server-side and swallowed so that a
 * dead mail server cannot break the request. Silent is the correct behaviour
 * there and the worst possible behaviour here, so this verifies for real.
 */
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
  try {
    const nodemailer = (await import('nodemailer')).default;
    const port = env.SMTP_PORT ?? 587;
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
    await transport.verify();
    pass('Email', `${env.SMTP_HOST} accepted the credentials — resets will send`);
  } catch (error) {
    const m = error.message ?? '';
    const hint = /invalid login|authentication|535/i.test(m)
      ? 'wrong username or password (Gmail needs an APP password, not the account one)'
      : /ENOTFOUND|EAI_AGAIN/i.test(m)
        ? 'host not found — check SMTP_HOST'
        : /timeout|ETIMEDOUT|socket/i.test(m)
          ? 'no answer — check SMTP_PORT (587 STARTTLS, 465 TLS) and any firewall'
          : m.slice(0, 70);
    fail('Email', `SMTP is set but does not work — ${hint}`);
  }
} else if (env.isProduction) {
  fail('Email', 'no SMTP in production — password resets go nowhere and staff get locked out');
} else {
  warn('Email', 'no SMTP — reset links print to the server console instead of being sent');
}

// --- Media storage ---------------------------------------------------------
/*
 * Prove the upload path, don't just note that the variables are filled in.
 *
 * "The photo appears on the site but is not in Cloudinary" is the symptom of a
 * driver that is set to `local` while the operator believes it is set to
 * `cloudinary` — the image is written to backend/uploads and served from
 * /uploads, which looks identical in the browser and is invisible in the
 * Cloudinary dashboard. It is also what a wrong API secret looks like, because
 * that fails on the first upload rather than at boot.
 *
 * So this actually signs a request and sends a one-pixel PNG, then deletes it.
 * A round trip is the only answer that distinguishes "configured" from
 * "working".
 */
if (env.UPLOAD_DRIVER === 'cloudinary') {
  try {
    const { uploadToCloudinary, parseCloudinaryUrl, destroyCloudinaryAsset } =
      await import('../src/core/storage/media.storage.js');

    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const stored = await uploadToCloudinary(
      { mimetype: 'image/png', buffer: onePixelPng },
      { folder: 'doctor-check' },
    );

    // Tidy up after ourselves — a probe that leaves litter in the customer's
    // media library is a bug of its own.
    const removed = await destroyCloudinaryAsset(parseCloudinaryUrl(stored.url));

    pass(
      'Media storage',
      `Cloudinary "${env.CLOUDINARY_CLOUD_NAME}" accepted a test upload into ` +
        `${env.CLOUDINARY_FOLDER}/ and it was ${removed ? 'removed again' : 'left behind — delete it manually'}`,
    );
  } catch (error) {
    // Cloudinary's own wording, because "Invalid Signature" (wrong secret) and
    // "Stale request" (server clock is wrong) need completely different fixes.
    fail('Media storage', `UPLOAD_DRIVER=cloudinary but the upload failed — ${error.message}`);
  }
} else if (env.isProduction && !env.UPLOAD_DIR) {
  fail(
    'Media storage',
    'UPLOAD_DRIVER=local with no UPLOAD_DIR in production — most hosts give each deploy a ' +
      'fresh filesystem, so every product photo disappears on the next push',
  );
} else {
  warn(
    'Media storage',
    `UPLOAD_DRIVER=local — files are written to ${env.uploadDir} and will NOT appear in Cloudinary`,
  );
}

// --- Payments --------------------------------------------------------------
const gateways = [
  ['JazzCash', env.JAZZCASH_MERCHANT_ID && env.JAZZCASH_PASSWORD && env.JAZZCASH_INTEGRITY_SALT],
  ['EasyPaisa', env.EASYPAISA_STORE_ID && env.EASYPAISA_HASH_KEY],
  ['Bank transfer', env.BANK_ACCOUNT_NUMBER && env.BANK_IBAN],
];
const live = gateways.filter(([, ok]) => ok).map(([name]) => name);
if (live.length) pass('Payments', `${live.join(', ')} configured (cash on delivery is always available)`);
else warn('Payments', 'only cash on delivery — no online payment provider is configured');

// --- Client URL ------------------------------------------------------------
if (env.isProduction && /localhost|127\.0\.0\.1/.test(env.CLIENT_URL)) {
  fail('CLIENT_URL', `points at ${env.CLIENT_URL} in production — CORS and email links will be wrong`);
} else {
  pass('CLIENT_URL', env.CLIENT_URL);
}

// --- Report ----------------------------------------------------------------
const width = Math.max(...results.map((r) => r.label.length));
const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };

process.stdout.write(`\n${'─'.repeat(72)}\n  PREFLIGHT — ${env.NODE_ENV}\n${'─'.repeat(72)}\n`);
for (const r of results) {
  process.stdout.write(`  ${icon[r.level]} ${r.label.padEnd(width)}  ${r.detail}\n`);
}

const failures = results.filter((r) => r.level === 'FAIL').length;
const warnings = results.filter((r) => r.level === 'WARN').length;

process.stdout.write(`${'─'.repeat(72)}\n`);
process.stdout.write(
  failures
    ? `  ${failures} blocking problem${failures === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''} — fix the ✗ lines before deploying.\n\n`
    : warnings
      ? `  Ready to run. ${warnings} warning${warnings === 1 ? '' : 's'} above are degraded features, not blockers.\n\n`
      : '  All checks passed.\n\n',
);

if (dbReachable) await mongoose.disconnect();
process.exit(failures ? 1 : 0);
