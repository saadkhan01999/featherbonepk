/**
 * Release stock held by online orders whose payment never completed.
 * ---------------------------------------------------------------------------
 *   npm run expire:reservations
 *
 * The API already does this on a timer (see reservation.scheduler.js). This
 * script exists for the hosting arrangements where that is not enough:
 *
 *   • a platform that suspends an idle instance, so the in-process timer stops
 *     running exactly when nobody is ordering — and starts again only when the
 *     next customer arrives, which is the worst possible moment to discover the
 *     last chicken is still held by someone who left an hour ago;
 *   • a scheduled-job runner (platform cron, GitHub Actions, systemd timer)
 *     that the operator would rather own the schedule in.
 *
 * Set RESERVATION_SWEEP_SECONDS=0 in that case so the two do not both run —
 * though if they did, nothing would break: the sweep is idempotent, and every
 * release is claimed with an atomic conditional write.
 *
 * Safe to run against production. It touches only orders that are unpaid,
 * still pending and past their own recorded deadline. It cannot cancel a paid
 * order and it cannot restore stock twice.
 */
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../src/database/connect.js';
import { logger } from '../src/core/utils/logger.js';
import { expireAbandonedReservations } from '../src/modules/orders/order.service.js';

async function main() {
  await connectDatabase();

  /*
   * Keep going while a full batch comes back.
   *
   * expireAbandonedReservations caps each pass so one query never has to load a
   * weekend's backlog at once. A single call would therefore leave work behind
   * after an outage — silently, and in exactly the situation where the shop most
   * needs its stock freed.
   */
  let scanned = 0;
  let expired = 0;
  const BATCH = 100;

  for (;;) {
    const result = await expireAbandonedReservations({ limit: BATCH });
    scanned += result.scanned;
    expired += result.expired;
    if (result.scanned < BATCH) break;
  }

  if (expired > 0) {
    logger.info(`Released stock from ${expired} abandoned order(s) (${scanned} due).`);
  } else {
    logger.info('No expired reservations — nothing to release.');
  }

  await disconnectDatabase();
  process.exit(0);
}

main().catch(async (error) => {
  logger.error('Could not expire reservations', { message: error.message });
  if (mongoose.connection.readyState === 1) await disconnectDatabase().catch(() => {});
  process.exit(1);
});
