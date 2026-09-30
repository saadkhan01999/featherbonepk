/**
 * Environment loading and validation.
 * ---------------------------------------------------------------------------
 * The process refuses to start if configuration is missing or malformed.
 *
 * Why fail at boot: an unset JWT secret does not break anything at startup —
 * it breaks the first login attempt, in production, at 2am. Validating here
 * converts a silent runtime failure into a loud deploy-time one.
 *
 * Secrets additionally must not keep their development placeholder values in
 * production; that check is what stops a `.env.example` copy from shipping.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

/*
 * The backend package root, derived from this file rather than process.cwd().
 * npm workspaces run scripts with the cwd set to the workspace, but a bare
 * `node src/server.js` from the repo root does not — so cwd is not a reliable
 * anchor, and getting it wrong silently writes uploads to a second directory
 * that nothing serves.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/*
 * Load .env from the package, not from wherever the process was launched.
 *
 * This was `import 'dotenv/config'`, which resolves `.env` against
 * `process.cwd()`. That works on a developer machine, because you are standing
 * in `backend/` when you type the command — and it fails on managed hosting,
 * where the process is started for you from a directory you did not choose.
 *
 * The failure is brutal to diagnose because nothing reports a missing file:
 * dotenv simply finds nothing, every variable stays undefined, and the schema
 * below reports "MONGODB_URI: Required" for a `.env` that is sitting right
 * there, correctly filled in, three lines from the code that could not see it.
 * Identical files, identical code, works locally, dead in production.
 *
 * Reproduced before changing it: launched from `backend/` the URI loads;
 * launched from the home directory the same file is invisible.
 *
 * PACKAGE_ROOT is derived from this file's own location, so it is the same
 * directory no matter who started the process or from where. The cwd is still
 * consulted afterwards as a fallback — `override: false` is dotenv's default,
 * so the package copy wins and a cwd `.env` can only fill gaps — which keeps
 * every existing local workflow working exactly as it did.
 *
 * Real environment variables always win over both: dotenv never overwrites a
 * value that is already set, so a host's own configuration panel remains
 * authoritative.
 */
const ENV_FILE = path.join(PACKAGE_ROOT, '.env');
const loadedFromPackage = !dotenv.config({ path: ENV_FILE }).error;

// Only reached when there is no backend/.env — e.g. a deployment that sets its
// variables in a hosting panel instead, or a developer running from the repo root.
const loadedFromCwd = !dotenv.config().error;

/** Coerce "5000" → 5000 while rejecting "abc". */
const port = z.coerce.number().int().positive();

/** Accepts "15m" / "7d" / "12h" / "3600" — the jsonwebtoken expiry format. */
const duration = z.string().regex(/^\d+[smhdw]?$/, 'expected a duration like 15m, 12h or 7d');

/**
 * An on/off switch from the environment.
 *
 * Not `z.coerce.boolean()`, which is actively dangerous here: it applies
 * JavaScript truthiness, and `Boolean('false')` is true — so the one spelling an
 * operator is most likely to reach for to turn a payment method off would have
 * turned it on.
 *
 * A blank value counts as unset. `.env` files habitually carry
 * `PAYMENT_JAZZCASH_ENABLED=` for "not decided yet", and dotenv turns that into
 * the empty string rather than leaving it undefined; treating it as a typo
 * would refuse to boot over a line that means nothing.
 *
 * Anything else is a hard error rather than a silent default. `PAYMENT_COD_
 * ENABLED=ture` must not quietly disable the only payment method the shop has.
 */
const TRUTHY = new Set(['true', '1', 'yes', 'on']);
const FALSEY = new Set(['false', '0', 'no', 'off']);

const flag = (fallback) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      const text = (value ?? '').trim().toLowerCase();
      if (text === '') return fallback;
      if (TRUTHY.has(text)) return true;
      if (FALSEY.has(text)) return false;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expected true or false, got "${value}"`,
      });
      return z.NEVER;
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /*
   * 7000, not 5000. The fallback matters: with PORT missing from .env the
   * server would quietly bind whatever this says, and 5000/5173 are held by
   * other projects on this machine — producing an EADDRINUSE that looks like a
   * bug in this app rather than a collision with a neighbour.
   */
  PORT: port.default(7000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CLIENT_URL: z.string().url().default('http://localhost:7002/'),

  /*
   * Additional browser origins allowed to make credentialed requests, comma
   * separated. CLIENT_URL is always allowed and does not need repeating here.
   *
   * This exists so the apex and www forms of a domain — and, later, an admin or
   * POS subdomain — can be added by editing an environment variable instead of
   * this file. A missing origin is not a subtle bug: every request from it fails
   * CORS, which the browser reports as a network error rather than a policy one,
   * and the site simply appears broken.
   *
   *   ALLOWED_ORIGINS=https://featherbone.com,https://www.featherbone.com
   */
  ALLOWED_ORIGINS: z.string().optional(),

  /*
   * --- Email -------------------------------------------------------------
   * Optional in development, required in production: the mailer refuses to
   * start without them rather than silently dropping password-reset messages.
   */
  APP_NAME: z.string().default('Feather & Bone'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: duration.default('15m'),
  JWT_REFRESH_EXPIRES_IN: duration.default('7d'),

  // POS terminals are signed with their own secret so a stolen till token is
  // useless against the customer site, and rotating one does not log out the other.
  JWT_POS_SECRET: z.string().min(16, 'JWT_POS_SECRET must be at least 16 characters'),
  JWT_POS_EXPIRES_IN: duration.default('12h'),

  /*
   * Where uploaded media lives.
   *
   *   local       — written to UPLOAD_DIR and served from /uploads.
   *   cloudinary  — uploaded to Cloudinary; the database stores the HTTPS URL.
   *
   * `local` is correct for development and for a host with a mounted volume.
   * `cloudinary` is what production wants on a platform that hands each deploy a
   * fresh filesystem, because there every product photo disappears on the next
   * push. Both write a URL string into the same field, so switching drivers
   * leaves existing records working — see media.js on the client.
   */
  UPLOAD_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(5),
  // Video needs its own, larger cap: a 5MB ceiling that suits a product photo
  // rejects almost every real clip, and raising the image cap to match would
  // let someone upload a 200MB "photo".
  UPLOAD_VIDEO_MAX_MB: z.coerce.number().positive().default(50),
  /*
   * Where uploaded files are written.
   *
   * Defaults to `backend/uploads`, which is correct for local development and
   * wrong for most hosting: Render, Railway, Heroku and Fly hand each deploy a
   * fresh filesystem, so every product photo and the payment QR vanish on the
   * next push. Point this at a mounted volume (e.g. /data/uploads) in
   * production and the files outlive deploys.
   */
  UPLOAD_DIR: z.string().optional(),

  /*
   * --- Cloudinary ----------------------------------------------------------
   * Required only when UPLOAD_DRIVER=cloudinary; the check is below, after
   * parsing, so a `local` install is never asked for credentials it will not
   * use.
   *
   * API_SECRET is server-only. It signs uploads and deletions, so anything
   * holding it can destroy every asset in the account. It is never sent to the
   * browser, never returned by an endpoint, and never prefixed VITE_.
   */
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  /** Folder assets are filed under, so one account can host several sites. */
  CLOUDINARY_FOLDER: z.string().default('feather-and-bone'),

  /*
   * --- Abandoned-payment reservations --------------------------------------
   * How long stock stays held for an online order whose gateway payment has not
   * completed, and how often the sweeper looks for expired ones.
   *
   * 30 minutes is comfortably longer than any real wallet payment takes and
   * short enough that the last chicken is back on sale the same evening. Set
   * RESERVATION_SWEEP_SECONDS=0 to disable the in-process sweeper, e.g. when an
   * external scheduler runs `npm run expire:reservations` instead.
   */
  RESERVATION_MINUTES: z.coerce.number().positive().default(30),
  RESERVATION_SWEEP_SECONDS: z.coerce.number().min(0).default(60),

  /*
   * --- Payments ------------------------------------------------------------
   * All optional: a method that is not configured is simply not offered. They
   * are declared here rather than read from process.env at the point of use so
   * they pass through the same validation as everything else, and so a typo in
   * a variable name shows up as a missing value rather than as `undefined`
   * quietly becoming a default.
   */
  /*
   * --- Which payment methods this installation offers ----------------------
   *
   * The switch is separate from the credentials on purpose, because they answer
   * different questions. `isConfigured` asks "could this work?"; these ask
   * "should we offer it?" — and an operator needs to be able to say no to a
   * method whose credentials are perfectly valid, the moment a gateway starts
   * misbehaving, without deleting keys they will want back an hour later.
   *
   * Only cash on delivery is on by default. A payment method that turns itself
   * on because someone happened to paste credentials into the environment is a
   * method that takes real money before anybody decided it should.
   *
   * A gateway switched on without its credentials refuses to boot — see the
   * check below the schema. A gateway switched off is never asked for them.
   */
  PAYMENT_COD_ENABLED: flag(true),
  PAYMENT_JAZZCASH_ENABLED: flag(false),
  PAYMENT_EASYPAISA_ENABLED: flag(false),
  PAYMENT_BANK_TRANSFER_ENABLED: flag(false),

  JAZZCASH_MERCHANT_ID: z.string().optional(),
  JAZZCASH_PASSWORD: z.string().optional(),
  JAZZCASH_INTEGRITY_SALT: z.string().optional(),
  JAZZCASH_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  EASYPAISA_STORE_ID: z.string().optional(),
  EASYPAISA_HASH_KEY: z.string().optional(),
  EASYPAISA_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  /*
   * The account customers transfer into. No defaults, deliberately — see the
   * note in offline.providers.js. A placeholder here is a real customer sending
   * real money to an account number that belongs to nobody.
   */
  BANK_NAME: z.string().optional(),
  BANK_ACCOUNT_TITLE: z.string().optional(),
  BANK_ACCOUNT_NUMBER: z.string().optional(),
  BANK_IBAN: z.string().optional(),
  BANK_BRANCH: z.string().optional(),

  COD_MAX_ORDER_VALUE: z.coerce.number().positive().default(15000),

  /*
   * --- The first account -----------------------------------------------------
   * Optional, and read only by `npm run owner`. There is no seed: a real
   * database starts empty and that command creates the single account that can
   * sign in, generating a password unique to the installation unless these are
   * set. A default production password is a published one.
   */
  SUPERADMIN_EMAIL: z.string().optional(),
  SUPERADMIN_PASSWORD: z.string().optional(),

  CURRENCY: z.string().default('PKR'),
  TAX_RATE: z.coerce.number().min(0).max(1).default(0.05),
  DELIVERY_FEE: z.coerce.number().min(0).default(60),
  FREE_DELIVERY_THRESHOLD: z.coerce.number().min(0).default(3000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\n✖ Invalid environment configuration:\n${issues}\n`);

  /*
   * Say whether a file was even found.
   *
   * "MONGODB_URI: Required" reads as "you forgot to set it", and sends people
   * to edit a file that is already correct. When no .env was located at all,
   * the real problem is where the process is looking — so name the path, and
   * name the other place the values can legitimately come from.
   */
  if (!loadedFromPackage && !loadedFromCwd) {
    /*
     * De-duplicated, because the two candidates are the same path whenever the
     * command was run from the package root — which is the normal case. Printing
     * it twice made the message look like a bug in the message, at exactly the
     * moment the reader is deciding whether to trust what it says about where
     * their file should go.
     */
    const searched = [...new Set([ENV_FILE, path.join(process.cwd(), '.env')])];
    console.error(`No .env file was found. Looked for:\n${searched.map((f) => `  ${f}`).join('\n')}\n`);
    console.error("Create it there, or set the variables in your host's environment panel.\n");
  } else {
    console.error(
      `Loaded ${loadedFromPackage ? ENV_FILE : path.join(process.cwd(), '.env')} — but some values are missing or invalid.\n`,
    );
  }
  process.exit(1);
}

const raw = parsed.data;

// Any secret still carrying its template value is a deployment mistake. In
// production that is fatal; in development it is a nudge, because local work
// should not require inventing secrets.
const PLACEHOLDER = /change-me/i;
const secrets = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_POS_SECRET'];
const untouched = secrets.filter((key) => PLACEHOLDER.test(raw[key]));

if (untouched.length) {
  if (raw.NODE_ENV === 'production') {
    console.error(`\n✖ Refusing to start: ${untouched.join(', ')} still use the example values.`);
    console.error('  Generate real secrets, e.g. `openssl rand -base64 48`.\n');
    process.exit(1);
  }
  console.warn(`⚠  Using development placeholder secrets for: ${untouched.join(', ')}`);
}

/*
 * The three secrets must differ.
 *
 * The whole separation between the website and the till rests on their tokens
 * being verifiable only by their own secret. Reuse one value across two
 * families and a stolen POS token verifies against customer routes — the
 * isolation becomes decorative while still looking correct in every test that
 * only checks the happy path.
 *
 * Fatal in production, loud in development, because this is silent otherwise.
 */
const distinct = new Set(secrets.map((key) => raw[key]));
if (distinct.size !== secrets.length) {
  const message = 'JWT secrets must all be different — reusing one breaks token-family isolation.';
  if (raw.NODE_ENV === 'production') {
    console.error(`\n✖ Refusing to start: ${message}\n`);
    process.exit(1);
  }
  console.warn(`⚠  ${message}`);
}

/*
 * A production secret must be long enough to resist offline brute force. The
 * schema allows 16 characters so local development is not obstructed; a live
 * deployment needs considerably more entropy than that.
 */
if (raw.NODE_ENV === 'production') {
  const weak = secrets.filter((key) => raw[key].length < 32);
  if (weak.length) {
    console.error(
      `\n✖ Refusing to start: ${weak.join(', ')} are too short for production (need 32+ characters).\n`,
    );
    process.exit(1);
  }
}

/*
 * CLIENT_URL must be real in production.
 *
 * The default exists so a fresh clone runs with no .env at all, and that is
 * right for development and silently wrong the moment it ships. This one value
 * is read in two places that fail in opposite directions:
 *
 *   • CORS — allowedOrigins is built from it, so a deployment that forgot it
 *     allows localhost and nothing else. Every request from the real domain is
 *     refused, and the browser reports that as a network error rather than a
 *     policy one, so the site simply appears to be down.
 *
 *   • Password-reset links — the email points at http://localhost:7001, which
 *     resolves to the customer's own machine. They see a dead link, or worse,
 *     whatever else they happen to be running on that port.
 *
 * Neither failure names its cause, and both arrive after launch. A missing
 * value is refused at boot instead; a localhost value in production is always
 * a leftover, never a choice.
 */
if (raw.NODE_ENV === 'production') {
  const host = new URL(raw.CLIENT_URL).hostname;
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (isLoopback) {
    console.error(`\n✖ Refusing to start: CLIENT_URL is ${raw.CLIENT_URL} in production.`);
    console.error("  Set it to the site's real address, e.g. https://featherbone.com —");
    console.error('  it is the CORS origin and the host used in password-reset links.\n');
    process.exit(1);
  }
}

/*
 * Cloudinary credentials are all-or-nothing.
 *
 * A partially configured driver fails on the first product photo an admin
 * uploads — in production, after launch. Two of the three values present is
 * always a mistake, so it is refused at boot in every environment rather than
 * discovered later by someone whose image "just doesn't save".
 */
const CLOUDINARY_KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

if (raw.UPLOAD_DRIVER === 'cloudinary') {
  const missing = CLOUDINARY_KEYS.filter((key) => !raw[key]?.trim());
  if (missing.length) {
    console.error(
      `\n✖ Refusing to start: UPLOAD_DRIVER=cloudinary but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
    );
    console.error('  Copy them from the Cloudinary dashboard, or set UPLOAD_DRIVER=local.\n');
    process.exit(1);
  }
}

/*
 * A payment method that is switched on must have what it needs.
 *
 * The mirror of the Cloudinary check above, and refused for the same reason: a
 * gateway enabled without its credentials does not fail at boot, it fails at
 * the last step of a real checkout, for a customer who has already chosen their
 * food and entered an address. That is the most expensive place in the whole
 * application to discover a missing environment variable.
 *
 * A method that is switched off is never asked for anything — which is what
 * lets this release ship with no gateway credentials at all.
 *
 * Bank transfer is included deliberately: it has no API, but publishing a
 * checkout page with a blank account number invites customers to transfer money
 * nowhere, which is worse than a gateway that simply errors.
 */
const PAYMENT_REQUIREMENTS = [
  [
    'PAYMENT_JAZZCASH_ENABLED',
    'JazzCash',
    ['JAZZCASH_MERCHANT_ID', 'JAZZCASH_PASSWORD', 'JAZZCASH_INTEGRITY_SALT'],
  ],
  ['PAYMENT_EASYPAISA_ENABLED', 'EasyPaisa', ['EASYPAISA_STORE_ID', 'EASYPAISA_HASH_KEY']],
  [
    'PAYMENT_BANK_TRANSFER_ENABLED',
    'Bank transfer',
    ['BANK_NAME', 'BANK_ACCOUNT_TITLE', 'BANK_ACCOUNT_NUMBER', 'BANK_IBAN'],
  ],
];

for (const [switchKey, label, required] of PAYMENT_REQUIREMENTS) {
  if (!raw[switchKey]) continue;

  const missing = required.filter((key) => !raw[key]?.trim());
  if (missing.length) {
    console.error(
      `\n✖ Refusing to start: ${switchKey}=true but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
    );
    console.error(`  Add ${label}'s credentials, or set ${switchKey}=false.\n`);
    process.exit(1);
  }
}

/*
 * Something has to be able to take money.
 *
 * Turning every method off leaves a shop that can show a menu and a cart and
 * cannot complete a single order — and nothing else in the system would report
 * that as wrong, because each individual method being off is perfectly legal.
 * The checkout would simply present an empty list of ways to pay.
 */
if (
  !raw.PAYMENT_COD_ENABLED &&
  !raw.PAYMENT_JAZZCASH_ENABLED &&
  !raw.PAYMENT_EASYPAISA_ENABLED &&
  !raw.PAYMENT_BANK_TRANSFER_ENABLED
) {
  console.error('\n✖ Refusing to start: every payment method is disabled, so no order could be completed.');
  console.error(
    '  Set at least one PAYMENT_*_ENABLED to true — PAYMENT_COD_ENABLED=true is the usual answer.\n',
  );
  process.exit(1);
}

/**
 * Extra browser origins, parsed once.
 * Trailing slashes are stripped because `new URL()` in a browser sends
 * `https://site.com` as the Origin header while a hand-written env value often
 * carries the slash — and the comparison is an exact string match.
 */
const extraOrigins = (raw.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const malformed = extraOrigins.filter((origin) => {
  try {
    return new URL(origin).origin !== origin;
  } catch {
    return true;
  }
});

if (malformed.length) {
  console.error(`\n✖ Invalid ALLOWED_ORIGINS entries: ${malformed.join(', ')}`);
  console.error(
    '  Each must be a bare scheme+host, e.g. https://featherbone.com — no path, no trailing slash.\n',
  );
  process.exit(1);
}

/** Frozen, validated configuration. Import this — never read process.env directly. */
export const env = Object.freeze({
  ...raw,
  /*
   * Without a trailing slash. Links are built as `${CLIENT_URL}/reset-password`,
   * so "http://localhost:7002/" in .env produced "…7002//reset-password" — a
   * path the website does not recognise, so reset and verification links
   * opened the homepage instead.
   */
  CLIENT_URL: raw.CLIENT_URL.replace(/\/+$/, ''),
  /** CLIENT_URL plus ALLOWED_ORIGINS, de-duplicated. */
  allowedOrigins: Object.freeze([...new Set([raw.CLIENT_URL.replace(/\/+$/, ''), ...extraOrigins])]),
  reservationMs: raw.RESERVATION_MINUTES * 60 * 1000,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  uploadMaxBytes: raw.UPLOAD_MAX_MB * 1024 * 1024,
  uploadVideoMaxBytes: raw.UPLOAD_VIDEO_MAX_MB * 1024 * 1024,
  /*
   * Resolved once, here, so the upload middleware and the static handler that
   * serves the files back can never disagree about where they live. They used
   * to compute the path independently.
   */
  uploadDir: path.resolve(raw.UPLOAD_DIR?.trim() || path.join(PACKAGE_ROOT, 'uploads')),
});

/**
 * Is this process running against a throwaway database?
 *
 * The one thing that may not be a snapshot. Everything above is frozen at
 * import time, which is what makes it trustworthy — but `dev-memory-db.mjs`
 * cannot set this before that happens: ESM hoists its imports, so the logger
 * (and therefore this file) is evaluated before the script's first statement
 * runs. Frozen here, the flag reads `false` on the very server that is
 * ephemeral.
 *
 * That failure is quiet and points the wrong way: the destructive test suite
 * gates on this value, so a stale `false` makes it refuse a safe run — and if
 * anyone ever "fixed" that by defaulting to true, it would authorise a
 * destructive run against a real database.
 *
 * So it is read live, from one place, as a function. Not configuration: a
 * runtime marker that the process writes about itself.
 */
export const isEphemeralDatabase = () => process.env.EPHEMERAL_DB === 'true';

export default env;
