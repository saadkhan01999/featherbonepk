/**
 * Development gateway credentials.
 * ---------------------------------------------------------------------------
 * Not secrets, and not usable for anything. JazzCash issues a real merchant id,
 * password and integrity salt only after onboarding; these three strings simply
 * make `isConfigured` true so the online payment path can be exercised without
 * a merchant account.
 *
 * That path is worth exercising precisely because it is the one with teeth:
 * stock is decremented the moment the order is placed and is only released when
 * the payment settles, fails, or the reservation expires. With no gateway
 * configured, the only method on offer is cash on delivery — which confirms
 * immediately and never leaves a reservation hanging — so none of that logic
 * would ever run outside production.
 *
 * Why they live under tests/fixtures/ and not in src/: the same reason the demo
 * menu does. Nothing the production server can reach is able to invent payment
 * configuration. `npm start` cannot import this file; `dev:memdb` can, and
 * applies the credentials only when the real ones are unset, so a developer
 * with genuine sandbox keys in `.env` keeps them. The reservation timings are
 * forced — see the note on applyDevPaymentEnv.
 *
 * The signature maths is real either way — the integrity salt is just an HMAC
 * key, so a callback signed with this one verifies exactly as JazzCash's would,
 * and a callback signed with anything else is rejected exactly as it should be.
 */
export const DEV_JAZZCASH = Object.freeze({
  merchantId: 'DEV00000001',
  password: 'devpassword',
  integritySalt: 'dev-integrity-salt-not-a-real-key',
});

/**
 * How long a development reservation holds stock, and how often the sweeper
 * looks. Fifteen seconds rather than the production thirty minutes: this
 * database is thrown away when the process stops, and a behaviour you have to
 * wait half an hour to observe is a behaviour nobody ever observes — including
 * the test suite, which asserts that abandoned stock genuinely comes back.
 */
export const DEV_RESERVATION_MINUTES = '0.25';
export const DEV_RESERVATION_SWEEP_SECONDS = '3';

/**
 * Apply the development payment configuration to this process.
 *
 * Must run before anything imports `env.config.js`, which snapshots the
 * environment at import time.
 *
 * Credentials defer to anything real already in the environment; the
 * reservation timings do not. See the notes on each below.
 */
/**
 * Set a variable only if it is genuinely unconfigured.
 *
 * `??=` was wrong here, and wrong in a way that read as correct. It assigns
 * only when the value is null or undefined — but a `.env` almost always lists
 * the gateway keys with nothing after the `=`, because that is how you say "not
 * configured yet":
 *
 *     JAZZCASH_MERCHANT_ID=
 *
 * dotenv turns that into the empty string, and `'' ??= x` leaves the empty
 * string in place. So on every installation that had the keys listed and blank
 * — which is every installation that copied .env.example — the development
 * credentials below were silently not applied, no gateway was configured, and
 * the payments suite failed at "JazzCash is offered at checkout" with nothing
 * in the logs to explain why.
 *
 * Blank means unset. That is the whole fix.
 */
function setIfBlank(key, value) {
  if (!process.env[key] || process.env[key].trim() === '') process.env[key] = value;
}

export function applyDevPaymentEnv() {
  // Credentials: only when absent, so a developer holding genuine sandbox keys
  // keeps them and exercises the real gateway.
  setIfBlank('JAZZCASH_MERCHANT_ID', DEV_JAZZCASH.merchantId);
  setIfBlank('JAZZCASH_PASSWORD', DEV_JAZZCASH.password);
  setIfBlank('JAZZCASH_INTEGRITY_SALT', DEV_JAZZCASH.integritySalt);
  setIfBlank('JAZZCASH_MODE', 'sandbox');

  /*
   * Switch the gateway on — for this process only.
   *
   * Since payment methods became opt-in, credentials alone no longer offer a
   * method: PAYMENT_JAZZCASH_ENABLED defaults to false so that a production
   * deployment cannot start taking wallet payments because a key appeared in
   * its environment. That default is right, and it would also make the entire
   * online-payment lifecycle untestable — held stock, expiry, the sweeper,
   * callback verification, double-settlement — because with cash on delivery
   * alone no reservation is ever created.
   *
   * Forced rather than defaulted, and safe to force, for the same reason the
   * rest of this file is: nothing a deployed server can reach imports it. It is
   * loaded only by `dev:memdb`, against a database that is discarded when the
   * process stops.
   */
  process.env.PAYMENT_JAZZCASH_ENABLED = 'true';

  /*
   * Timings: Forced, not defaulted.
   *
   * These are not configuration here, they are what makes the suite finish. A
   * real `.env` carries the production window — thirty minutes, correct for a
   * shop and useless for a test that waits for stock to come back within forty
   * seconds. Deferring to it means the reservation-expiry assertions cannot
   * pass on any installation that has actually been configured, which is the
   * opposite of what deferring was meant to achieve.
   *
   * Only this process is affected, and only against the in-memory database it
   * just created.
   */
  process.env.RESERVATION_MINUTES = DEV_RESERVATION_MINUTES;
  process.env.RESERVATION_SWEEP_SECONDS = DEV_RESERVATION_SWEEP_SECONDS;
}

export default applyDevPaymentEnv;
