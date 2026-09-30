/**
 * The disposable environment, applied before anything reads it.
 * ---------------------------------------------------------------------------
 * Import this first, above every other import in dev-memory-db.mjs. Its whole
 * job is to run early; it exports nothing.
 *
 * Why it has to be a separate module.
 *
 * `env.config.js` snapshots `process.env` and freezes it the moment it is first
 * imported. Assignments made after that point still change `process.env`, and
 * change nothing the application actually reads — a difference with no visible
 * symptom, because both values exist and only one is used.
 *
 * dev-memory-db.mjs set its variables inside `main()`, which looks early enough
 * and is not: ESM evaluates every static import before the first statement of
 * the importing module runs, and one of those imports is the logger, which
 * imports env.config. So the freeze had already happened, and the runner's
 * settings were silently discarded. The visible result was a test suite that
 * uploaded to the real Cloudinary account and a JazzCash gateway that was never
 * configured — seven failures, none of which looked like an ordering problem.
 *
 * `env.config.js` already documents this hazard for EPHEMERAL_DB, and that is
 * exactly why `isEphemeralDatabase()` is a live function rather than a frozen
 * field. Everything else needs to be set before the freeze instead, which means
 * before any app module is imported — and the only way to guarantee that in ESM
 * is a module of its own, imported first.
 *
 * Nothing here may import from src/. A single app import would pull in
 * env.config and reintroduce the very bug this file exists to prevent.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/*
 * A static import, and not `await import(...)`.
 *
 * Top-level await is what makes this module's ordering guarantee fail. A module
 * containing TLA suspends at the await, and ESM does not hold its siblings
 * while it is suspended — so dev-memory-db's next import, the logger, was
 * evaluated during the suspension, pulled in env.config.js, and froze
 * process.env before this file had applied the payment settings. The
 * synchronous assignments below survived that; everything after the await did
 * not, which is why the driver was fixed and the gateway was still missing.
 *
 * Safe to import statically precisely because payments.seed.js imports nothing
 * itself — see the note at the top of that file.
 */
import { applyDevPaymentEnv } from '../tests/fixtures/payments.seed.js';

/*
 * Mark this database as throwaway.
 *
 * The test suite is destructive. Its only guard used to be "is NODE_ENV
 * production?", which says nothing about the data: a developer machine running
 * NODE_ENV=development against a live Atlas cluster passed that check happily.
 * The API reports this flag on /health and the harness refuses to run without
 * it. Set here rather than in .env so it cannot be copied into a real
 * environment by accident.
 */
process.env.EPHEMERAL_DB = 'true';

/*
 * Throwaway storage too.
 *
 * Forced, not defaulted. This runner reads backend/.env like everything else,
 * so an installation configured for production media — UPLOAD_DRIVER=cloudinary
 * — had its test suite uploading to the real Cloudinary account. That is wrong
 * three ways, and each produced failures that looked like application bugs:
 *
 *   · The video fixtures are 76 bytes — a valid `ftyp` box and no frames. That
 *     is exactly right for exercising our own type sniffing, and Cloudinary
 *     refuses it, because it is not a decodable video.
 *
 *   · The deletion tests assert an asset stops resolving. A CDN does not do
 *     that on demand: `invalidate` schedules a purge across the edge rather
 *     than performing one, so a correct delete looked like a failed one.
 *
 *   · It billed a third-party account and left fixtures in the shop's real
 *     media library.
 *
 * Tests must not need somebody else's servers to decide whether this code is
 * correct. The Cloudinary path keeps its own coverage: the request shape is
 * asserted against a stubbed fetch in media.test.mjs, and `npm run doctor`
 * performs the live round trip against real credentials.
 */
process.env.UPLOAD_DRIVER = 'local';

/*
 * ...into a directory discarded with the database, so a suite that uploads a
 * few hundred files does not slowly fill backend/uploads with fixtures that
 * look like real product photos.
 *
 * `mkdtempSync` deliberately: this module's whole contract is that it finishes
 * before anything else is evaluated, and an await would hand control back.
 */
export const DEV_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'featherbone-uploads-'));
process.env.UPLOAD_DIR = DEV_UPLOAD_DIR;

/*
 * Development payment configuration.
 *
 * payments.seed.js imports nothing, which is what makes it safe to load here —
 * ahead of the freeze. It supplies gateway credentials only where none are
 * configured, forces the short reservation window the expiry assertions need,
 * and switches JazzCash on for this process so the online-payment lifecycle can
 * be exercised at all. With cash on delivery alone no reservation is ever
 * created, so held stock, expiry, the sweeper and callback verification would
 * go completely uncovered.
 *
 * None of it can reach a deployed server: nothing under tests/ is importable
 * from `npm start`, and this runner only ever points at an in-memory database.
 */
applyDevPaymentEnv();

/**
 * Confirm the settings above actually reached the frozen configuration.
 *
 * This trap is silent by construction and has now been fallen into twice, so it
 * gets a guard rather than a comment. Called after the app has been imported;
 * if a static import ever creeps back above this module and re-freezes the
 * environment early, the runner stops immediately and says so, instead of
 * quietly running the suite against production media and a dead gateway.
 */
export function assertDevEnvApplied(env) {
  const wrong = [];
  if (env.UPLOAD_DRIVER !== 'local') wrong.push(`UPLOAD_DRIVER=${env.UPLOAD_DRIVER} (expected local)`);
  if (env.uploadDir !== DEV_UPLOAD_DIR) wrong.push(`uploadDir=${env.uploadDir} (expected ${DEV_UPLOAD_DIR})`);

  if (wrong.length === 0) return;

  throw new Error(
    `dev:memdb settings did not reach the application configuration: ${wrong.join('; ')}.\n` +
      '  env.config.js freezes process.env when it is first imported, so something imported it\n' +
      '  before scripts/dev-env.mjs ran. Check that dev-env.mjs is still the FIRST import in\n' +
      '  dev-memory-db.mjs, and that nothing above it reaches into src/.',
  );
}
