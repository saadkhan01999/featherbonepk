/**
 * Minimal API test harness.
 * ---------------------------------------------------------------------------
 * These are integration tests: they drive the real HTTP API against a running
 * server, because almost every bug worth catching in this codebase lives in the
 * seam between routes, permissions and the database — not inside a pure
 * function a unit test would reach.
 *
 *   npm run dev:memdb      # in one terminal
 *   npm test               # in another
 *
 * Destructive: several suites create, suspend and delete records. Point them at
 * the in-memory development database, never anything real. `assertDevServer`
 * below refuses to run against a production API.
 */
import { DEV_PASSWORD, DEV_EMAIL } from './fixtures/staff.seed.js';

export const API = process.env.TEST_API ?? 'http://localhost:7000/api/v1';

/*
 * The bootstrap credentials, imported from the seed rather than copied.
 *
 * They were written out by hand here, so changing the seeded password broke
 * every suite at once with "the database has not been seeded" — a message that
 * blames the database for what is actually a stale constant in the tests.
 * Importing them means the two can never disagree again.
 */
export const PW = DEV_PASSWORD;

/** Unique per process, so a suite can be re-run without colliding on itself. */
export const stamp = Date.now();

/*
 * A counter, not a random number.
 *
 * These used to draw `Math.random() * 1000` and, for the phone, keep only the
 * last seven digits of `stamp + r`. Since `stamp` is fixed for the process,
 * that yielded at most a thousand possible numbers per run — and a run creates
 * more than twenty accounts against a uniquely-indexed phone column. By the
 * birthday bound that is roughly a one-in-four chance, every run, of two
 * accounts drawing the same number and the second failing with a 409.
 *
 * It duly did: five `stores` assertions failed on a suite that had passed
 * minutes earlier, and the honest reading of a red build that comes and goes
 * is not "flaky infrastructure" but "the tests are lying to us about something,
 * we do not yet know what". A counter cannot collide with itself.
 */
let sequence = 0;
const nextInSequence = () => (sequence += 1);

/** A phone number that will not collide — with a previous run, or with itself. */
export const uniquePhone = (prefix = '0300') =>
  `${prefix}${String(stamp).slice(-4)}${String(nextInSequence()).padStart(3, '0')}`;

/** A unique email. */
export const uniqueEmail = (tag) => `${tag}${stamp}x${nextInSequence()}@fb.test`;

export async function call(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
}

/**
 * The API's origin, without the /api/v1 prefix.
 * Uploaded files are served from `/uploads` at the root, so the upload tests
 * need to reach outside the API path to check that a file is really there —
 * and, after a replacement, really gone.
 */
export const ORIGIN = new URL(API).origin;

/**
 * POST a file as multipart/form-data.
 *
 * The Content-Type header is deliberately not set: fetch derives it from the
 * FormData, including the boundary. Setting it by hand omits the boundary and
 * multer then finds no file — which is the exact mistake the upload route's
 * error message warns about.
 *
 * @param {Buffer} bytes         the file body
 * @param {string} filename      what the client claims it is called
 * @param {string} contentType   what the client claims it is
 */
export async function upload(path, token, bytes, filename = 'photo.png', contentType = 'image/png') {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: contentType }), filename);

  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    body: form,
  });

  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/** A real 1×1 PNG — correct magic bytes, so the signature check accepts it. */
export const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Wait for a condition, polling. Returns false if it never became true. */
export async function waitFor(predicate, { timeoutMs = 40_000, everyMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

export const login = async (email, password = PW) =>
  (await call('POST', '/auth/login', null, { email, password })).body.data?.accessToken;

/**
 * The only account the seed creates. Everyone else is made through the API.
 */
export const OWNER_EMAIL = DEV_EMAIL;

/**
 * Staff the suites sign in as.
 *
 * These are test fixtures, not seed data. The seed ships one account — the
 * super admin — because standing credentials for six roles are a back door
 * waiting to be forgotten at launch. So the suites create what they need
 * through `POST /staff`, exactly as the owner would in User Management.
 *
 * A useful side effect: every run now exercises the real creation path, so
 * "the super admin makes an account and that person can sign in" is covered by
 * the setup itself rather than assumed.
 */
const FIXTURES = [
  { email: 'admin@featherandbone.dev', fullName: 'Fatima Noor', role: 'admin' },
  { email: 'manager@featherandbone.dev', fullName: 'Sana Malik', role: 'manager' },
  { email: 'cashier@featherandbone.dev', fullName: 'Usman Khan', role: 'cashier' },
  { email: 'kitchen@featherandbone.dev', fullName: 'Ahmed Ali', role: 'kitchen' },
  { email: 'rider@featherandbone.dev', fullName: 'Zainab Batool', role: 'rider' },
];

/**
 * Create the fixture staff if they are missing. Idempotent — the suites share a
 * database and this runs on every invocation.
 */
export async function bootstrapStaff() {
  const owner = await login(OWNER_EMAIL);

  if (!owner) {
    console.error(`\n  Cannot sign in as ${OWNER_EMAIL}.`);
    console.error('  The database has not been seeded. Start it with:  npm run dev:memdb\n');
    process.exit(1);
  }

  let created = 0;

  for (const fixture of FIXTURES) {
    // Already there from an earlier run against this database.
    if (await login(fixture.email)) continue;

    const result = await call('POST', '/staff', owner, {
      ...fixture,
      password: PW,
      // Unique per fixture and per process: phone numbers are unique in the
      // model, so a fixed number only works the first time a database sees it.
      phone: uniquePhone(),
    });

    if (result.status !== 201) {
      console.error(
        `\n  Could not create the ${fixture.role} fixture:`,
        result.body.message ?? result.status,
      );
      process.exit(1);
    }
    created += 1;
  }

  if (created > 0) console.log(`  Created ${created} staff fixture(s) via the super admin.\n`);
  /*
   * Website orders at any hour: the suites place orders whenever they are run,
   * and a run after closing time must not fail because the shop is shut. The
   * opening-hours rules have their own suite, which switches them back on.
   */
  await call('PATCH', '/settings/hours', owner, { hoursEnforceOnline: false });

  return created;
}

export const posLogin = (email, terminalId = 'TILL-01', password = PW) =>
  call('POST', '/auth/pos/login', null, { email, password, terminalId });

/** Read a JWT payload without verifying it — tests only. */
export const decode = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

/**
 * A suite: a name and a body that receives `check`.
 * Keeps the reporting identical everywhere and lets the runner total them up.
 */
export function suite(name) {
  let pass = 0;
  let fail = 0;
  const failures = [];

  const check = (label, ok, detail = '') => {
    if (ok) {
      pass += 1;
    } else {
      fail += 1;
      failures.push(`${label}${detail ? `  — ${detail}` : ''}`);
    }
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  ${detail}`}`);
    return ok;
  };

  const section = (title) => console.log(`\n  ${title}\n  ${'-'.repeat(title.length)}`);

  return {
    check,
    section,
    report() {
      console.log(`\n  ${name}: ${pass} passed, ${fail} failed`);
      return { name, pass, fail, failures };
    },
  };
}

/**
 * Refuse to run against anything that is not the development server.
 * These tests suspend accounts and delete records; running them against real
 * data would be unrecoverable.
 */
export async function assertDevServer() {
  const health = await call('GET', '/health');

  if (health.status !== 200) {
    console.error(`\n  Cannot reach the API at ${API}.`);
    console.error('  Start it first:  npm run dev:memdb\n');
    process.exit(1);
  }

  if (health.body.data?.environment === 'production') {
    console.error('\n  REFUSING TO RUN: these tests mutate data and this is a production API.\n');
    process.exit(1);
  }

  /*
   * The environment flag is not enough.
   *
   * `NODE_ENV=development` says nothing about the data behind the API. A
   * developer machine pointed at a live Atlas cluster passes the check above
   * happily — and these suites create staff accounts, ring up sales and
   * suspend customers. That would land in the real business database.
   *
   * `dev:memdb` sets EPHEMERAL_DB, which the API reports here. Anything else is
   * assumed to be real data and refused.
   *
   * TEST_ALLOW_PERSISTENT=1 overrides it, for the rare case of running against
   * a deliberately disposable staging database. Typing that is a conscious act;
   * forgetting which database your .env points at is not.
   */
  if (health.body.data?.ephemeralDatabase !== true && process.env.TEST_ALLOW_PERSISTENT !== '1') {
    console.error(`\n  REFUSING TO RUN against ${API}`);
    console.error('  These tests are DESTRUCTIVE and this API is not using a throwaway database.');
    console.error('\n  Start a disposable one:  npm run dev:memdb');
    console.error('  Or, if you are certain:   TEST_ALLOW_PERSISTENT=1 npm test\n');
    process.exit(1);
  }
}
