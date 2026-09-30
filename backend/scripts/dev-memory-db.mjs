/**
 * Zero-setup development runner.
 * ---------------------------------------------------------------------------
 * Spins up an in-memory MongoDB and points the API at it, so the project can be
 * cloned and run with no database installed and no Atlas account.
 *
 *   npm run dev:memdb
 *
 * Important: the data is discarded when the process exits. The seed therefore
 * runs on every boot, which also keeps the seed script honest — if it stops
 * being idempotent or drifts from the schema, it breaks here immediately
 * rather than silently rotting.
 */
/*
 * First, and it must stay first.
 *
 * Applies the disposable environment as a side effect. ESM evaluates imports in
 * declaration order, so this finishes before the logger below pulls in
 * env.config.js — which snapshots and freezes process.env the moment it loads.
 * Anything set after that point changes process.env and changes nothing the
 * application reads. See the note in dev-env.mjs; this ordering is load-bearing.
 */
import { assertDevEnvApplied } from './dev-env.mjs';

import { MongoMemoryServer } from 'mongodb-memory-server';

import { logger } from '../src/core/utils/logger.js';

async function main() {
  logger.info('Starting in-memory MongoDB (first run downloads a binary — this is slow once)…');

  const mongo = await MongoMemoryServer.create({
    instance: { dbName: 'featherandbone' },
  });

  // getUri() returns the server root without a database path, so Mongoose would
  // silently land in `test`. Appending the name keeps the in-memory database
  // identical to the real one — otherwise collection names in logs and Compass
  // don't match what production shows.
  const uri = `${mongo.getUri()}featherandbone`;
  logger.info(`In-memory MongoDB ready → ${uri}`);

  /*
   * The environment was applied by ./dev-env.mjs, imported at the top of this
   * file so it lands before env.config.js freezes process.env. Confirmed rather
   * than assumed — this ordering is silent when it breaks.
   */
  logger.info(`Disposable upload directory → ${process.env.UPLOAD_DIR}`);

  // Imported dynamically and after the server exists, because both modules read
  // configuration at import time.
  const { startServer } = await import('../src/server.js');

  /*
   * Prove the disposable settings actually took, before serving a request.
   *
   * The freeze in env.config.js is invisible when it wins: process.env says one
   * thing, the application reads another, and the only symptom is a test suite
   * quietly using production media and an unconfigured gateway. Reading the
   * frozen object back and comparing is the only way to see it, so this stops
   * the runner rather than letting the suite proceed against the wrong storage.
   */
  const { env } = await import('../src/config/env.config.js');
  assertDevEnvApplied(env);

  await startServer({ mongoUri: uri });

  const { runSeed } = await import('../tests/fixtures/build.mjs');
  /*
   * The fixtures live under tests/, not in the application.
   *
   * Nothing in `src/` or in a production script can write sample data any more
   * — the sample menu, demo trade and test tills are test fixtures and sit with
   * the tests. This command is a development tool, so it is allowed to use
   * them; `npm start` has no way to reach them at all.
   *
   * demo: true by default, because this database is in memory and dies with the
   * process, and the suite needs a catalogue to run against.
   *
   * `--empty` rehearses a first run: the owner account and nothing else, which
   * is exactly what a new shop sees.
   */
  const demo = !process.argv.includes('--empty');
  await runSeed({ silent: false, demo });

  logger.info('Development environment ready. Data resets when this process stops.');

  // Ensure the mongod child process dies with us — an orphan holds its port and
  // the next `dev:memdb` fails with a confusing bind error.
  const stop = async () => {
    await mongo.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  logger.error('dev:memdb failed to start', { message: error.message });
  process.exit(1);
});
