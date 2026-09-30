/**
 * Offline payment methods — Cash on Delivery and Bank Transfer.
 * ---------------------------------------------------------------------------
 * Neither involves a gateway, but both are real payment flows with real rules,
 * and in Pakistan COD is the single most-used option for online food orders.
 */
import { env } from '../../../config/env.config.js';
import { PAYMENT_STATUS, PAKISTANI_BANKS } from '../../../core/constants/payments.js';
import { ApiError } from '../../../core/errors/ApiError.js';

/**
 * Cash on Delivery.
 *
 * The order is confirmed immediately — the kitchen must start cooking — but the
 * payment stays pending until the rider collects. Marking it paid at placement
 * would overstate revenue in every report and hide genuine non-payment.
 */
export const codProvider = {
  key: 'cod',
  label: 'Cash on Delivery',
  isConfigured: true, // Always available.

  /**
   * The operator's switch, independent of whether credentials exist.
   *
   * Separate from `isConfigured` because they answer different questions:
   * "could this work?" versus "should we offer it?". A gateway that is
   * misbehaving has to be turnable off without deleting keys you want back an
   * hour later, and a method must never switch itself on merely because
   * credentials happened to appear in the environment.
   */
  isEnabled: env.PAYMENT_COD_ENABLED,

  /** COD carries fraud risk, so it is capped. */
  maxOrderValue: env.COD_MAX_ORDER_VALUE,

  createPayment({ order }) {
    if (order.total > this.maxOrderValue) {
      throw ApiError.badRequest(
        `Cash on Delivery is available for orders up to Rs ${this.maxOrderValue.toLocaleString('en-PK')}. ` +
          'Please choose another payment method for this order.',
      );
    }

    return {
      provider: 'cod',
      method: 'NONE', // Nothing to redirect to.
      // Confirmed order, unpaid balance — the two are tracked separately.
      paymentStatus: PAYMENT_STATUS.PENDING,
      confirmOrder: true,
      instructions: `Please keep Rs ${order.total.toLocaleString('en-PK')} ready. Our rider will collect on delivery.`,
    };
  },
};

/**
 * Bank Transfer.
 *
 * The customer transfers manually and uploads proof; an administrator verifies
 * it before the order is released. The order is not auto-confirmed: releasing
 * goods on an unverified screenshot is how this flow gets abused.
 */
export const bankTransferProvider = {
  key: 'bank_transfer',
  label: 'Bank Transfer',

  /**
   * The operator's switch, independent of whether credentials exist.
   *
   * Separate from `isConfigured` because they answer different questions:
   * "could this work?" versus "should we offer it?". A gateway that is
   * misbehaving has to be turnable off without deleting keys you want back an
   * hour later, and a method must never switch itself on merely because
   * credentials happened to appear in the environment.
   */
  isEnabled: env.PAYMENT_BANK_TRANSFER_ENABLED,

  /**
   * Offered only once a real receiving account is configured — never with
   * placeholder bank details.
   */
  get isConfigured() {
    const { accountNumber, iban } = this.account;
    return Boolean(accountNumber && iban);
  },

  /** The banks a customer can transfer from — drives the checkout dropdown. */
  get banks() {
    return PAKISTANI_BANKS;
  },

  /**
   * Our receiving account. Configured per deployment, since a business changes
   * banks — and never defaulted, for the reason given above.
   */
  get account() {
    return {
      bankName: env.BANK_NAME ?? null,
      accountTitle: env.BANK_ACCOUNT_TITLE ?? null,
      accountNumber: env.BANK_ACCOUNT_NUMBER ?? null,
      iban: env.BANK_IBAN ?? null,
      branch: env.BANK_BRANCH ?? null,
    };
  },

  createPayment({ order, bankCode }) {
    // Validate against the catalogue so an arbitrary string can't be stored as
    // a bank and break reporting later.
    if (bankCode && !PAKISTANI_BANKS.some((bank) => bank.code === bankCode)) {
      throw ApiError.badRequest('Choose a bank from the list');
    }

    return {
      provider: 'bank_transfer',
      method: 'NONE',
      paymentStatus: PAYMENT_STATUS.AWAITING_VERIFICATION,
      // Deliberately not confirmed — a human verifies the transfer first.
      confirmOrder: false,
      account: this.account,
      customerBank: bankCode ?? null,
      instructions:
        `Transfer Rs ${order.total.toLocaleString('en-PK')} to the account shown, ` +
        `using order number ${order.orderNumber} as the payment reference, then upload your receipt. ` +
        'We verify transfers within a few hours during business time.',
    };
  },
};

export default { codProvider, bankTransferProvider };
