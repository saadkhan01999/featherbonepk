/**
 * Process entry point.
 * ---------------------------------------------------------------------------
 * Owns the things an application factory must not: opening the database,
 * binding the port, and shutting all of it down cleanly.
 *
 * SOCKET.IO is attached here — see core/realtime/realtime.js.
 *
 * It was added deliberately, for the one thing polling could not do well: the
 * kitchen. A ticket fired from the till has to appear on the Kitchen Display
 * within a second, "Ready" has to reach the counter board the moment the cook
 * taps it, and every till has to see stock drop when another till sells the
 * last chicken. The socket carries signals only; data is still read through
 * the permission-checked REST API.
 *
 * Startup order matters: the database is connected before the port is bound.
 * Listening first would accept requests the service cannot yet serve, and
 * every one of them would fail in a way that looks like an application bug.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { env } from './config/env.config.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase, startConnectionSupervisor } from './database/connect.js';
import { logger } from './core/utils/logger.js';
import { settingsService } from './modules/settings/settings.service.js';
import { startReservationSweeper } from './modules/orders/reservation.scheduler.js';
import { mailer } from './core/mail/mailer.js';
import { initRealtime, closeRealtime } from './core/realtime/realtime.js';

/**
 * Boot the service.
 * @param {object}  [options]
 * @param {string}  [options.mongoUri] Override for the in-memory dev runner.
 */
export async function startServer({ mongoUri } = {}) {
  /*
   * The database is still opened first, and in development a failure still
   * ends the process. What changed is only what happens in production when that
   * first connection fails.
   *
   * Exiting was right for a container platform: the orchestrator restarts the
   * process and routes no traffic to it. It is actively harmful under Passenger
   * on shared hosting, which is where this runs. There, the process dying means
   * the panel answers every request — the site, the API, the login — with a
   * generic 503 that names no cause. The operator sees "503" and has no way to
   * learn whether the database is down, the .env is missing, or the code is
   * broken, because the one process that knew is gone. That opaque 503 is
   * exactly the failure this deployment spent days on.
   *
   * So in production the port is bound anyway and the service says what is
   * wrong. The original guarantee is not weakened: requireDatabase in app.js
   * refuses every API route with a 503 while the connection is down, so no
   * request is ever served against a database that is not there. The difference
   * is purely that the refusal is now specific and instant instead of absent.
   *
   * Development keeps fail-fast, deliberately. A developer is watching a
   * terminal and wants the error immediately; a dev server that silently
   * degrades hides a broken .env until something much more confusing breaks. The
   * asymmetry is the point: production has nobody reading stdout, development
   * has nothing but.
   */
  let databaseReady = false;
  let stopSupervisor = () => {};

  try {
    await connectDatabase(mongoUri);
    databaseReady = true;
  } catch (error) {
    if (!env.isProduction) throw error;

    /*
     * Mongoose only auto-reconnects after it has connected once, so a failed
     * first attempt needs this or the service stays down until someone restarts
     * it by hand — at whatever hour the port is finally unblocked.
     */
    stopSupervisor = startConnectionSupervisor({
      uri: mongoUri,
      onReady: () => settingsService.warm(),
    });

    logger.warn('Starting WITHOUT a database so the failure is visible and recoverable.');
    logger.warn(`  → every API route will answer 503 DATABASE_UNAVAILABLE until it connects`);
    logger.warn(`  → GET ${env.API_PREFIX}/health reports the live state and needs no database`);
    logger.warn('  → reconnection is automatic; no restart or redeploy is needed');
  }

  /*
   * Load settings into the synchronous cache before serving traffic — pricing
   * reads it on the hot path and must never see an empty cache. When the
   * database is absent this is deferred to the supervisor's onReady, which runs
   * it the moment the connection succeeds; until then requireDatabase makes sure
   * nothing reaches the code that would read an empty cache.
   */
  if (databaseReady) {
    await settingsService.warm();
  }

  /*
   * Build the mail transport before serving traffic.
   *
   * In production this throws when SMTP is unconfigured, which is deliberate:
   * a mailer that silently does nothing is discovered by a locked-out customer
   * waiting for a reset link that will never arrive. Failing at boot turns that
   * into a two-minute fix at deploy time.
   */
  mailer.init();

  /*
   * Abandoned-payment cleanup, started after the database is up so the first
   * sweep has something to talk to. See reservation.scheduler.js — the timer is
   * only a trigger; the deadlines themselves live in MongoDB.
   */
  const stopSweeper = startReservationSweeper();

  const app = createApp();
  const server = http.createServer(app);

  // Before listen(), so the very first client can open a socket.
  initRealtime(server);

  /*
   * Bound to 0.0.0.0, not the default.
   *
   * Node's default binds every interface too, so this changes nothing locally —
   * it is written explicitly because a container platform's health check reaches
   * the process from outside the container. A future edit narrowing this to
   * `localhost` would still pass every test on a developer machine and then fail
   * every probe on Render, which reports it as "no open ports detected" and
   * kills the deploy without the service ever having been wrong about anything
   * else. Saying it out loud is what stops that edit looking harmless.
   */
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.PORT, '0.0.0.0', () => resolve());
  });

  logger.banner({
    Service: 'Feather & Bone API',
    Environment: env.NODE_ENV,
    Database: databaseReady ? 'connected' : 'UNREACHABLE — API returns 503 until it connects',
    URL: `http://localhost:${env.PORT}`,
    API: `http://localhost:${env.PORT}${env.API_PREFIX}`,
    Health: `http://localhost:${env.PORT}${env.API_PREFIX}/health`,
    Client: env.CLIENT_URL,
  });

  // --- Graceful shutdown -------------------------------------------------
  // Stop accepting new connections, let in-flight requests drain, then close
  // the database. Killing the process immediately can abandon a half-written
  // order or leave stock decremented for a sale that never completed.
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return; // A second Ctrl-C must not re-enter this.
    shuttingDown = true;
    logger.info(`${signal} received — shutting down gracefully`);

    // Hard deadline: if a connection refuses to drain we still exit rather
    // than hanging forever and being SIGKILLed mid-write.
    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out after 10s — forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      // Before the database closes, so an in-flight sweep is not cut off
      // mid-write.
      stopSweeper();
      stopSupervisor(); // Or a pending retry keeps firing through the shutdown.
      // Sockets first: an open socket keeps server.close() waiting forever.
      await closeRealtime();
      await new Promise((resolve) => server.close(resolve));
      await disconnectDatabase();
      clearTimeout(forceExit);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { message: error.message });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM')); // Orchestrator stop
  process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl-C

  // A rejection that reaches here escaped a try/catch — the process is in an
  // unknown state, so log loudly and let the supervisor restart it clean.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { message: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });

  return server;
}

/*
 * Was this file run directly, or imported by something else?
 *
 * The answer decides whether a port gets bound, so it has to be exact:
 * importing this module in a test must not start a server, and
 * `node src/server.js` must.
 *
 * Compared as URLs, not as strings. The previous check asked whether
 * `import.meta.url` ended with argv[1] with its backslashes flipped, and that
 * is not the same question. A file URL is percent-encoded and a filesystem path
 * is not, so one space anywhere in the path — `C:\Users\Saad Khan\...`, which
 * is an ordinary Windows home directory — gives `.../Saad%20Khan/server.js`
 * against `.../Saad Khan/server.js`, the comparison is false, and the server
 * never starts. It does not crash or complain: the process reaches the end of
 * the module with nothing left to do and exits 0, which looks like a program
 * that ran fine and is the hardest possible failure to diagnose.
 *
 * `pathToFileURL` does the encoding the same way the runtime did, so the two
 * are comparable by construction — on Windows and POSIX alike, and regardless
 * of what the path contains.
 */
const isDirectRun = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  startServer().catch((error) => {
    logger.error('Failed to start server', { message: error.message });

    /*
     * A PORT clash is almost never a config problem here.
     *
     * It is another copy of this server still running — a nodemon watcher that
     * outlived its terminal, or a `dev:memdb` left open in a window nobody
     * closed. The raw "EADDRINUSE :::7000" sends people to change PORT, which
     * appears to work and quietly leaves the stale process holding the real
     * port and, in the memdb case, serving a throwaway in-memory database that
     * looks exactly like the real one until the data vanishes.
     *
     * So say what it actually is, and give the command that ends it.
     */
    if (error.code === 'EADDRINUSE') {
      const port = env.PORT;
      logger.error(`Another process is already listening on port ${port}.`);
      logger.error('  It is almost certainly an older copy of this server. Find it:');
      logger.error(`    Windows  netstat -ano | findstr :${port}`);
      logger.error(`             taskkill /PID <pid> /F`);
      logger.error(`    macOS    lsof -ti :${port} | xargs kill -9`);
      logger.error('  Do NOT just change PORT — the stale process keeps serving the old one.');
    }

    process.exit(1);
  });
}

export default startServer;
