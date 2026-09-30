/**
 * MongoDB connection lifecycle.
 * ---------------------------------------------------------------------------
 * One connection per process, opened before the HTTP server starts listening.
 * Accepting traffic before the database is reachable would answer the first
 * requests with 500s that look like application bugs.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.config.js';
import { logger } from '../core/utils/logger.js';

// Reject writes containing keys the schema doesn't declare, instead of silently
// dropping them. Silent drops are how "the save worked but the field is empty"
// bugs happen.
mongoose.set('strictQuery', true);

/**
 * Open the connection.
 * @param {string} [uri] Overrides MONGODB_URI — used by the in-memory dev runner.
 */
/*
 * One definition of how this process connects, shared by the first attempt and
 * every retry. Two copies would drift, and the retry copy is the one nobody
 * looks at until production is already down.
 */
const CONNECT_OPTIONS = {
  // Fail fast rather than queueing requests against an unreachable primary.
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 45_000,
  maxPoolSize: 20,
  minPoolSize: 2,
  // autoIndex is fine in development but expensive at scale: in production
  // indexes are built deliberately by the seed/migration step, not on boot.
  autoIndex: !env.isProduction,
};

/**
 * Can a query actually run right now?
 *
 * readyState 1 is "connected". Anything else — connecting, disconnected,
 * disconnecting — means a query would be buffered rather than refused, hang for
 * bufferTimeoutMS, and finally fail with "Operation `x.find()` buffering timed
 * out", which names no cause and reads like an application bug. Callers use this
 * to answer honestly instead of stalling.
 */
export const isDatabaseReady = () => mongoose.connection.readyState === 1;

export async function connectDatabase(uri = env.MONGODB_URI) {
  try {
    const conn = await mongoose.connect(uri, CONNECT_OPTIONS);

    logger.info(`MongoDB connected → ${conn.connection.host}/${conn.connection.name}`);

    // Post-connection events. The initial failure is handled by the catch
    // below; these cover drops that happen later, while serving traffic.
    mongoose.connection.on('error', (err) => logger.error('MongoDB error', { message: err.message }));
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected — driver will retry'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

    return conn;
  } catch (error) {
    logger.error('MongoDB connection failed', { message: error.message });

    /*
     * Name the cause, and the fix.
     *
     * Each branch is a different problem with a different remedy, and the
     * driver's own wording does not distinguish them. "bad auth: authentication
     * failed" is four words with no hint of where the credentials live — and it
     * is exactly the message you meet after rotating an Atlas password and
     * forgetting the .env, which is the most common way this breaks.
     *
     * Order matters, twice. Atlas says "not authorized" for both a blocked IP
     * and a wrong password, so the auth check must come first; otherwise every
     * credential problem is reported as a firewall one and sends the reader to
     * the wrong settings page entirely. For the same reason the refusal check
     * outranks the allow-list one — see the note on that branch.
     */
    if (/bad auth|authentication failed|AuthenticationFailed/i.test(error.message)) {
      logger.error('The database username or password is wrong.');
      logger.error('  1. Atlas → Database Access → edit the user → Edit Password');
      logger.error('  2. update MONGODB_URI in backend/.env to match');
      logger.error('  3. a password containing @ : / ? # or % must be percent-encoded');
    } else if (/ECONNREFUSED/i.test(error.message)) {
      /*
       * A refusal is not an allow-list problem, and it outranks the driver's
       * own guess.
       *
       * This branch sits above the whitelist one on purpose. When no server is
       * reachable, the Atlas driver appends a stock hint — "one common reason is
       * that you're trying to access the database from an IP that isn't
       * whitelisted" — to a message whose topology dump also contains the real
       * per-shard error. Matching /whitelist/ first therefore reports every
       * unreachable cluster as a firewall entry someone forgot, which is the
       * wrong settings page and, here, an entirely wasted afternoon.
       *
       * ECONNREFUSED is unambiguous where that hint is not: it means a TCP reset
       * came back immediately — something on the path answered and said no.
       * Atlas itself never answers that way. An unlisted IP is dropped, which
       * arrives as a timeout; a wrong password gets far enough to fail the
       * handshake. So a reset was produced in between, and on shared hosting
       * that is an outbound firewall rejecting port 27017 — blocked by default
       * at many cPanel providers.
       *
       * Nothing in Atlas can fix it. The allow-list governs packets that
       * arrive; these never leave the server. Widening it to 0.0.0.0/0 changes
       * nothing, and saying so here is the whole point of the branch.
       */
      logger.error('The connection was REFUSED — the address resolved, the port did not open.');
      logger.error('  → this is outbound TCP 27017 blocked by the host, not an Atlas setting');
      logger.error('  → Atlas Network Access cannot fix it: 0.0.0.0/0 makes no difference');
      logger.error('  → see which layer fails:  npm run check:db');
      logger.error('  → then have the host open outbound 27017, or run this API where it is open');
    } else if (/IP.*whitelist|whitelist|not authorized/i.test(error.message)) {
      logger.error('Atlas refused this machine — its IP is not on the allow-list.');
      logger.error('  → Atlas → Network Access → Add IP Address → Add Current IP');
      logger.error('  → temporary entries expire after 6 hours and must be re-added');
    } else if (/ENOTFOUND|querySrv|EAI_AGAIN/i.test(error.message)) {
      // DNS, not Atlas: the name failed to resolve, so no connection was ever
      // attempted. Kept separate from the refusal above because the remedies
      // share no steps — one is a typo in the URI, the other is a firewall.
      logger.error('The cluster hostname in MONGODB_URI does not resolve.');
      logger.error('  → re-copy the string from Atlas → Connect → Drivers');
      if (!env.isProduction) {
        logger.error('  → for a zero-setup local database: npm run dev:memdb');
      }
    } else if (/ETIMEDOUT|ReplicaSetNoPrimary|timed out/i.test(error.message)) {
      logger.error('The cluster did not answer in time.');
      logger.error('  → usually a lapsed Atlas IP entry, or a paused/resuming cluster');
    }

    throw error;
  }
}

/** Close cleanly so in-flight operations finish before the process exits. */
export async function disconnectDatabase() {
  await mongoose.connection.close(false);
  logger.info('MongoDB connection closed');
}

/*
 * Keep trying, in the background, after a failed boot.
 * ---------------------------------------------------------------------------
 * Mongoose reconnects on its own once it has connected once. It does nothing at
 * all when the very first connection fails, which is exactly the case here: the
 * host blocks outbound 27017, the first attempt is refused, and without this the
 * process would need a manual restart at the precise moment someone finally
 * unblocks the port — on a shared host, quite possibly at 3am with nobody
 * watching.
 *
 * Backoff, not a tight loop. A refused connection returns instantly, so a naive
 * `while (true)` would spin thousands of times a minute, fill the host's error
 * log, and plausibly get the account suspended for abuse. The schedule stretches
 * to five minutes and stays there.
 *
 * The timer is unref'd so it can never hold an otherwise-idle process alive.
 */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

export function startConnectionSupervisor({
  uri = env.MONGODB_URI,
  onReady,
  /*
   * Injectable only so the retry/recovery logic can be tested without a live
   * MongoDB. Recovery is the one behaviour here that cannot be checked by
   * reading the code — whether onReady actually runs, exactly once, after N
   * failures — and it is the behaviour the deployment depends on. Production
   * never passes this.
   */
  connect = (target, options) => mongoose.connect(target, options),
} = {}) {
  let attempts = 0;
  let stopped = false;
  let timer = null;

  const nextDelay = () => RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];

  async function tryOnce() {
    if (stopped) return;
    attempts += 1;

    try {
      await connect(uri, CONNECT_OPTIONS);
    } catch (error) {
      // Re-checked after the await: stop() may have been called while this
      // attempt was in flight, and scheduling the next one then logs a
      // confusing "still unreachable" warning in the middle of a shutdown.
      if (stopped) return;

      const delay = nextDelay();
      /*
       * Warn, not error, and deliberately terse. The full diagnosis was already
       * written once by connectDatabase; repeating it every retry would bury the
       * original — and the original is the one that says what to fix.
       */
      logger.warn(
        `Database still unreachable (attempt ${attempts}) — retrying in ${Math.round(delay / 1000)}s`,
        { message: error.message },
      );
      timer = setTimeout(tryOnce, delay);
      timer.unref();
      return;
    }

    if (stopped) return; // Connected as the process was shutting down.

    logger.info(`MongoDB connected on attempt ${attempts} — the API is now serving normally.`);

    /*
     * The caller re-runs whatever boot work needed the database. If that throws,
     * the connection is up but the service is still not usable, so keep
     * supervising rather than reporting a recovery that did not happen.
     */
    try {
      await onReady?.();
    } catch (error) {
      logger.error('Recovered the database but failed to finish starting up', {
        message: error.message,
      });
      const delay = nextDelay();
      timer = setTimeout(tryOnce, delay);
      timer.unref();
    }
  }

  timer = setTimeout(tryOnce, RETRY_DELAYS_MS[0]);
  timer.unref();

  return function stopConnectionSupervisor() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export default connectDatabase;
