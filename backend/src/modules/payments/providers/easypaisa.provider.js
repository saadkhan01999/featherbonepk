/**
 * EasyPaisa — Hosted Checkout integration.
 * ---------------------------------------------------------------------------
 * Same shape as JazzCash (redirect → pay → return with a signed response) but
 * a different signing scheme, which is the main thing to get right:
 *
 *   JazzCash  → HMAC-SHA256 over sorted values, hex
 *   EasyPaisa → AES-128-ECB encryption of a sorted `key=value&…` string,
 *               base64-encoded
 *
 * They are not interchangeable. Applying JazzCash's approach here produces a
 * request EasyPaisa rejects with an unhelpful generic failure.
 *
 * ── WHAT IS AND ISN'T LIVE ────────────────────────────────────────────────
 * The protocol is real. Moving money requires a merchant `storeId` and
 * `hashKey`, issued by EasyPaisa on onboarding. With those in the environment
 * this transacts against sandbox or production unchanged; without them
 * `isConfigured` is false and the method is not offered at checkout.
 */
import { env } from '../../../config/env.config.js';
import crypto from 'node:crypto';

import { logger } from '../../../core/utils/logger.js';

const ENDPOINTS = {
  sandbox: 'https://easypaystg.easypaisa.com.pk/easypay/Index.jsf',
  live: 'https://easypay.easypaisa.com.pk/easypay/Index.jsf',
};

function credentials() {
  return {
    storeId: env.EASYPAISA_STORE_ID ?? '',
    hashKey: env.EASYPAISA_HASH_KEY ?? '',
    mode: env.EASYPAISA_MODE,
  };
}

/** `ddMMyyyy HHmmss`, EasyPaisa's expiry format (note the space). */
function expiryStamp(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('day')}${get('month')}${get('year')} ${get('hour')}${get('minute')}${get('second')}`;
}

/**
 * Build EasyPaisa's `merchantHashedReq`.
 *
 * AES-128-ECB, PKCS#7 padded, base64 output. The hash key is exactly 16 bytes —
 * a key of any other length makes Node throw "Invalid key length", which is
 * actually helpful, because silently truncating would produce a hash that fails
 * server-side with no explanation.
 *
 * ECB is inherently weak (identical plaintext blocks encrypt identically), but
 * it is what the EasyPaisa specification mandates — this is an interoperability
 * requirement, not a design choice. It is acceptable here only because the
 * plaintext is a single non-secret, non-repeating parameter string.
 */
export function buildMerchantHash(params, hashKey) {
  const plaintext = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]).length > 0)
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(hashKey, 'utf8'), null);
  cipher.setAutoPadding(true);

  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

export const easypaisaProvider = {
  key: 'easypaisa',
  label: 'EasyPaisa',

  /**
   * The operator's switch, independent of whether credentials exist.
   *
   * Separate from `isConfigured` because they answer different questions:
   * "could this work?" versus "should we offer it?". A gateway that is
   * misbehaving has to be turnable off without deleting keys you want back an
   * hour later, and a method must never switch itself on merely because
   * credentials happened to appear in the environment.
   */
  isEnabled: env.PAYMENT_EASYPAISA_ENABLED,

  get isConfigured() {
    const { storeId, hashKey } = credentials();
    // The 16-byte requirement is checked here so a misconfigured key surfaces
    // as "not configured" rather than as a crash mid-checkout.
    return Boolean(storeId && hashKey && Buffer.byteLength(hashKey, 'utf8') === 16);
  },

  get mode() {
    return credentials().mode;
  },

  createPayment({ order, returnUrl }) {
    const { storeId, hashKey, mode } = credentials();

    if (!this.isConfigured) {
      throw new Error(
        'EasyPaisa is not configured — set EASYPAISA_STORE_ID and a 16-character EASYPAISA_HASH_KEY',
      );
    }

    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    // EasyPaisa amounts are in rupees with 1 decimal place — the opposite
    // convention to JazzCash's paisa. Mixing the two up over/under-charges by
    // a factor of 100.
    const params = {
      amount: order.total.toFixed(1),
      autoRedirect: '1',
      // Must be unique per attempt; a repeat is refused as a duplicate.
      orderRefNum: `${order.orderNumber}-${Date.now().toString().slice(-5)}`,
      paymentMethod: 'MA_PAYMENT_METHOD', // mobile account
      postBackURL: returnUrl,
      storeId,
      expiryDate: expiryStamp(expiry),
    };

    const merchantHashedReq = buildMerchantHash(params, hashKey);

    logger.info('EasyPaisa payment initiated', {
      orderNumber: order.orderNumber,
      orderRefNum: params.orderRefNum,
      mode,
    });

    return {
      provider: 'easypaisa',
      method: 'POST',
      endpoint: ENDPOINTS[mode],
      fields: { ...params, merchantHashedReq },
      reference: params.orderRefNum,
    };
  },

  /**
   * Verify an EasyPaisa postback.
   *
   * EasyPaisa returns a status code rather than a signature on the redirect, so
   * the payload alone is not proof of payment — it reaches us through the
   * customer's browser and is therefore editable.
   *
   * `trustworthy: false` is returned deliberately: the caller must confirm the
   * amount against the order and, in production, reconcile via EasyPaisa's
   * Merchant Inquiry API before releasing goods. Treating this callback as
   * final would allow a hand-edited success response to mark an order paid.
   */
  verifyCallback(payload) {
    const code = payload.status ?? payload.responseCode;
    const isPaid = code === '0000' || code === '0';

    return {
      verified: true,
      trustworthy: false, // See the note above — requires server-side inquiry.
      isPaid,
      reference: payload.orderRefNumber ?? payload.orderRefNum,
      orderNumber: String(payload.orderRefNumber ?? payload.orderRefNum ?? '').split('-')[0],
      amount: Number(payload.transactionAmount ?? payload.amount ?? 0),
      responseCode: code,
      message: payload.desc ?? payload.responseDesc ?? '',
      raw: payload,
    };
  },
};

export default easypaisaProvider;
