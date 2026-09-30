/**
 * Named sequences — the kitchen ticket number, and anything else that needs
 * "the next integer" without two writers ever receiving the same one.
 * ---------------------------------------------------------------------------
 * One document per sequence, incremented with `$inc` in a single atomic write.
 *
 * The tempting alternative — read the highest ticket today, add one — is a race:
 * two tills firing in the same millisecond both read 26 and both write 27, and
 * the kitchen cooks one plate for two different orders. `findOneAndUpdate` with
 * `$inc` and `upsert` is resolved inside MongoDB, so the second caller always
 * sees the first caller's increment.
 *
 * The key carries the date (`ticket:2026-09-25`), so the numbers restart every
 * morning without anything having to reset them — a new day is simply a new
 * document.
 */
import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Counter = mongoose.model('Counter', counterSchema);

/**
 * Take the next number in a sequence.
 * @param {string} key e.g. `ticket:2026-09-25`
 * @returns {Promise<number>} 1 for the first call, then 2, 3, …
 */
export async function nextSequence(key) {
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return doc.seq;
}

/** Today's date in the business timezone, as `YYYY-MM-DD`. */
export function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(date);
}

export default Counter;
