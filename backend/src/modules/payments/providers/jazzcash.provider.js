/**
 * JazzCash — Hosted Checkout (Page Redirection) integration.
 * ---------------------------------------------------------------------------
 * Implements JazzCash's documented HTTP POST flow:
 *
 *   1. We build a signed field set and render it as a self-submitting form.
 *   2. The customer is redirected to JazzCash, pays, and is returned to
 *      `pp_ReturnURL` with the same fields plus a response code and hash.
 *   3. We re-compute the hash over the returned fields and compare. Only then
 *      is the payment treated as real.
 *
 * ── WHAT IS AND ISN'T LIVE ────────────────────────────────────────────────
 * The protocol below (field names, hash construction, amount units, date
 * formats, verification) is the real JazzCash specification. What it cannot do
 * without the merchant's own credentials is move actual money: JazzCash issues
 * `MerchantID`, `Password` and `IntegritySalt` only to a registered merchant
 * after onboarding.
 *
 * So: put real credentials in the environment and this transacts against
 * JazzCash's sandbox or live endpoint with no code change. Leave them unset and
 * the service refuses to pretend — `isConfigured` is false and the checkout UI
 * hides the method rather than showing a button that cannot work.
 *
 * ── THE PART PEOPLE GET WRONG ─────────────────────────────────────────────
 * The secure hash is HMAC-SHA256 over the field values only — sorted by field
 * name, joined with '&', prefixed by the integrity salt. Empty fields are
 * excluded. Including them, or hashing "key=value" pairs, produces a hash that
 * JazzCash rejects with a generic error that says nothing about why.
 */
import { env } from '../../../config/env.config.js';
import crypto from 'node:crypto';

import { logger } from '../../../core/utils/logger.js';

const ENDPOINTS = {
  sandbox: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
  live: 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
};

/** Credentials come from the environment; nothing is ever hard-coded. */
function credentials() {
  return {
    merchantId: env.JAZZCASH_MERCHANT_ID ?? '',
    password: env.JAZZCASH_PASSWORD ?? '',
    integritySalt: env.JAZZCASH_INTEGRITY_SALT ?? '',
    mode: env.JAZZCASH_MODE,
  };
}

/** `yyyyMMddHHmmss` in Pakistan Standard Time, which is what JazzCash expects. */
function timestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type).value;
  // `hour` can come back as "24" at midnight in some ICU versions; JazzCash
  // requires "00", and sending 24 fails validation with no useful message.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${get('second')}`;
}

/**
 * Compute the JazzCash secure hash.
 *
 * @param {Record<string,string>} fields
 * @param {string} salt Integrity salt (also the HMAC key).
 */
export function computeSecureHash(fields, salt) {
  const ordered = Object.keys(fields)
    .filter((key) => key !== 'pp_SecureHash')
    // Sort by field name — the order of the values in the string is defined by
    // the alphabetical order of their keys, not by insertion order.
    .sort((a, b) => a.localeCompare(b))
    // Empty values are omitted entirely, not sent as empty strings.
    .filter((key) => fields[key] !== undefined && fields[key] !== null && String(fields[key]).length > 0)
    .map((key) => String(fields[key]));

  const message = `${salt}&${ordered.join('&')}`;
  return crypto.createHmac('sha256', salt).update(message).digest('hex').toUpperCase();
}

export const jazzcashProvider = {
  key: 'jazzcash',
  label: 'JazzCash',

  /**
   * The operator's switch, independent of whether credentials exist.
   *
   * Separate from `isConfigured` because they answer different questions:
   * "could this work?" versus "should we offer it?". A gateway that is
   * misbehaving has to be turnable off without deleting keys you want back an
   * hour later, and a method must never switch itself on merely because
   * credentials happened to appear in the environment.
   */
  isEnabled: env.PAYMENT_JAZZCASH_ENABLED,

  /** Is this method usable right now? Drives whether the UI offers it. */
  get isConfigured() {
    const { merchantId, password, integritySalt } = credentials();
    return Boolean(merchantId && password && integritySalt);
  },

  get mode() {
    return credentials().mode;
  },

  /**
   * Build the redirect payload for an order.
   *
   * Returns the endpoint plus the signed fields. The client renders them as a
   * hidden auto-submitting form — JazzCash's hosted checkout is a form POST,
   * not a JSON API, so there is no way to do this purely server-side without
   * proxying the customer's browser session.
   */
  createPayment({ order, returnUrl }) {
    const { merchantId, password, integritySalt, mode } = credentials();

    if (!this.isConfigured) {
      throw new Error('JazzCash is not configured — set JAZZCASH_MERCHANT_ID, _PASSWORD and _INTEGRITY_SALT');
    }

    const now = new Date();
    // A 1-hour window: long enough for a customer to complete a wallet OTP,
    // short enough that an abandoned attempt cannot be replayed tomorrow.
    const expiry = new Date(now.getTime() + 60 * 60 * 1000);

    const fields = {
      pp_Version: '1.1',
      pp_TxnType: 'MWALLET',
      pp_Language: 'EN',
      pp_MerchantID: merchantId,
      pp_SubMerchantID: '',
      pp_Password: password,
      pp_BankID: '',
      pp_ProductID: '',
      // Must be unique per attempt. A retry of the same order therefore gets a
      // new reference — reusing one is rejected as a duplicate transaction.
      pp_TxnRefNo: `T${timestamp(now)}${Math.floor(Math.random() * 900 + 100)}`,
      // Amount is in paisa. Sending rupees under-charges by 100x — the single
      // most expensive unit mistake available in this integration.
      pp_Amount: String(Math.round(order.total * 100)),
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: timestamp(now),
      pp_BillReference: order.orderNumber,
      pp_Description: `Order ${order.orderNumber} — Feather & Bone`,
      pp_TxnExpiryDateTime: timestamp(expiry),
      pp_ReturnURL: returnUrl,
      // ppmpf_* are merchant passthrough fields, echoed back untouched. Used
      // here to correlate the callback with our order without trusting the
      // customer-supplied bill reference alone.
      ppmpf_1: order.orderNumber,
      ppmpf_2: String(order.customerPhone ?? ''),
      ppmpf_3: '',
      ppmpf_4: '',
      ppmpf_5: '',
    };

    fields.pp_SecureHash = computeSecureHash(fields, integritySalt);

    logger.info('JazzCash payment initiated', {
      orderNumber: order.orderNumber,
      txnRef: fields.pp_TxnRefNo,
      mode,
    });

    return {
      provider: 'jazzcash',
      method: 'POST',
      endpoint: ENDPOINTS[mode],
      fields,
      reference: fields.pp_TxnRefNo,
    };
  },

  /**
   * Verify a callback from JazzCash.
   *
   * Trust nothing in the payload until the hash matches. The callback arrives
   * via the customer's browser, so its contents are fully under the customer's
   * control — a hand-edited `pp_ResponseCode=000` would otherwise mark an
   * unpaid order as paid. Recomputing the HMAC with the integrity salt (which
   * only we and JazzCash know) is what makes the response trustworthy.
   */
  verifyCallback(payload) {
    const { integritySalt } = credentials();

    const receivedHash = payload.pp_SecureHash;
    const expectedHash = computeSecureHash(payload, integritySalt);

    // timingSafeEqual to avoid leaking hash bytes through comparison timing.
    // The length guard is required — timingSafeEqual throws on a length
    // mismatch rather than returning false.
    const a = Buffer.from(String(receivedHash ?? ''), 'utf8');
    const b = Buffer.from(expectedHash, 'utf8');
    const hashValid = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!hashValid) {
      logger.warn('JazzCash callback REJECTED — hash mismatch', {
        txnRef: payload.pp_TxnRefNo,
      });
      return { verified: false, reason: 'Signature mismatch — this response was not sent by JazzCash' };
    }

    // '000' is success; '121' is the documented "already paid" duplicate.
    const code = payload.pp_ResponseCode;
    const isPaid = code === '000' || code === '121';

    return {
      verified: true,
      isPaid,
      reference: payload.pp_TxnRefNo,
      orderNumber: payload.ppmpf_1 || payload.pp_BillReference,
      // Convert paisa back to rupees for our own records.
      amount: Number(payload.pp_Amount ?? 0) / 100,
      responseCode: code,
      message: payload.pp_ResponseMessage ?? '',
      raw: payload,
    };
  },
};

export default jazzcashProvider;
