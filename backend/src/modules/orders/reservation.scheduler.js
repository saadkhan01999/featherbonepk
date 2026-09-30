/**
 * The reservation sweeper.
 * ---------------------------------------------------------------------------
 * Wakes every RESERVATION_SWEEP_SECONDS and asks the database which held
 * reservations are past their deadline. See order.model.js for why the deadline
 * is a stored timestamp rather than a timer.
 *
 * This timer is a trigger, not the mechanism. Everything that matters — which
 * orders are due, and whether this process is the one that gets to release them
 * — is decided by the database in an atomic write. So losing the timer loses
 * nothing permanently: the work is still queued in the collection, and the next
 * process to run a sweep picks it up. That is what makes the same function safe
 * to run from three places at once:
 *
 *   • here, in-process, which is all a single always-on service needs;
 *   • `npm run expire:reservations`, for a platform-level cron on hosts that
 *     sleep an idle instance (set RESERVATION_SWEEP_SECONDS=0 there);
 *   • several replicas behind a load balancer, all sweeping, harmlessly.
 *
 * A sweep never throws into the timer. An error here is a database problem that
 * will still be a database problem in sixty seconds, and crashing the API over
 * a background job would take the shop offline for it.
 */
import { env } from '../../config/env.config.js';
import { logger } from '../../core/utils/logger.js';
import { isDatabaseReady } from '../../database/connect.js';
import { expireAbandonedReservations } from './order.service.js';
import { kitchenService } from '../kitchen/kitchen.service.js';

let timer = null;

/**
 * Begin sweeping. Returns a stop function, and is a no-op when the interval is
 * zero — which is how an external scheduler takes over.
 */
export function startReservationSweeper() {
  if (env.RESERVATION_SWEEP_SECONDS === 0) {
    logger.info('Reservation sweeper disabled (RESERVATION_SWEEP_SECONDS=0)');
    return () => {};
  }

  const intervalMs = env.RESERVATION_SWEEP_SECONDS * 1000;

  const sweep = async () => {
    /*
     * Skip, rather than fail, while the database is unreachable. The query would
     * not be refused — Mongoose buffers it, so the sweep stalls for ten seconds
     * and then logs a timeout, once per interval, forever. Nothing is lost by
     * waiting: the deadlines live in the collection, not in this timer, so the
     * first sweep after the database returns picks up everything that came due
     * meanwhile.
     */
    if (!isDatabaseReady()) return;

    try {
      const { expired } = await expireAbandonedReservations();
      // Only speak when something happened. A line every minute saying "nothing
      // to do" is how a log stops being read.
      if (expired > 0) logger.info(`Released stock from ${expired} abandoned order(s)`);
    } catch (error) {
      logger.error('Reservation sweep failed', { message: error.message });
    }

    // Same heartbeat, separate failure: a kitchen hiccup must not stop stock
    // being released, and vice versa.
    try {
      await kitchenService.closeStaleTickets();
    } catch (error) {
      logger.error('Kitchen ticket sweep failed', { message: error.message });
    }
  };

  timer = setInterval(sweep, intervalMs);
  // Never hold the process open on this account: a shutdown must not wait for
  // a background timer that has nothing to finish.
  timer.unref();

  logger.info(
    `Reservation sweeper running every ${env.RESERVATION_SWEEP_SECONDS}s ` +
      `(holds expire after ${env.RESERVATION_MINUTES} minutes)`,
  );

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

export default startReservationSweeper;
