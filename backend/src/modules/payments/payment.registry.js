/**
 * Payment provider registry.
 * ---------------------------------------------------------------------------
 * One lookup table keyed by method. Adding a provider (Stripe, PayPal, a card
 * acquirer) means writing its module and adding one line here — no changes to
 * the order service, the checkout controller or the UI.
 *
 * `availableMethods()` is what the checkout screen renders from, so a method
 * without working credentials is never offered. Showing a payment button that
 * cannot complete is worse than not showing it: the customer abandons at the
 * last step, having already committed.
 */
import { PAYMENT_METHOD } from '../../core/constants/payments.js';
import { ApiError } from '../../core/errors/ApiError.js';
import { jazzcashProvider } from './providers/jazzcash.provider.js';
import { easypaisaProvider } from './providers/easypaisa.provider.js';
import { codProvider, bankTransferProvider } from './providers/offline.providers.js';

/*
 * Every provider is registered; whether one is offered is decided by
 * configuration in `isOfferable` (switched on and fully configured), not by
 * editing this list.
 */
const PROVIDERS = {
  [PAYMENT_METHOD.COD]: codProvider,
  [PAYMENT_METHOD.JAZZCASH]: jazzcashProvider,
  [PAYMENT_METHOD.EASYPAISA]: easypaisaProvider,
  [PAYMENT_METHOD.BANK_TRANSFER]: bankTransferProvider,
};

/**
 * May this method be offered to a customer, and used to pay?
 *
 * Both halves are required, and each catches a different mistake. Without the
 * switch, pasting credentials into the environment silently starts taking money
 * through a method nobody approved. Without the credential check, an operator
 * who flips a switch early gets a checkout button that fails at the last step,
 * after the customer has committed.
 */
const isOfferable = (provider) => Boolean(provider?.isEnabled && provider?.isConfigured);

/** Display metadata for the checkout UI. */
const PRESENTATION = {
  [PAYMENT_METHOD.COD]: {
    description: 'Pay the rider in cash when your order arrives.',
    icon: 'banknote',
    order: 1,
  },
  [PAYMENT_METHOD.JAZZCASH]: {
    description: 'Pay securely from your JazzCash mobile wallet.',
    icon: 'smartphone',
    order: 2,
  },
  // Presentation is kept for the two disabled providers so re-enabling one
  // needs no second edit here.
  [PAYMENT_METHOD.EASYPAISA]: {
    description: 'Pay securely from your EasyPaisa mobile account.',
    icon: 'smartphone',
    order: 3,
  },
  [PAYMENT_METHOD.BANK_TRANSFER]: {
    description: 'Transfer from any Pakistani bank and upload your receipt.',
    icon: 'landmark',
    order: 4,
  },
};

/** Resolve a provider, or fail with a clear message. */
export function getProvider(method) {
  const provider = PROVIDERS[method];
  if (!provider) throw ApiError.badRequest(`Unsupported payment method: ${method}`);

  /*
   * The gate that actually matters.
   *
   * `availableMethods` decides what the checkout draws; this decides what the
   * server will act on, and only the second is a control. A method that is off
   * is refused here even when the request names it directly — which is the
   * shape any attempt to use a disabled gateway takes, since it never appeared
   * in the UI to be clicked.
   *
   * The customer-facing wording is the same either way. Which of the two
   * conditions failed is our business, not a hint to hand back to whoever is
   * probing.
   */
  if (!isOfferable(provider)) {
    throw ApiError.badRequest(
      `${provider.label} is not available at the moment. Please choose another method.`,
    );
  }
  return provider;
}

/**
 * Methods currently offerable to a customer.
 * @param {object} [options]
 * @param {number} [options.orderTotal] Lets a method exclude itself by value (COD cap).
 */
export function availableMethods({ orderTotal } = {}) {
  return Object.entries(PROVIDERS)
    .filter(([, provider]) => isOfferable(provider))
    .map(([method, provider]) => {
      const meta = PRESENTATION[method] ?? {};

      // A method can be configured yet unusable for this order — COD above its
      // cap, for instance. It is still listed, but disabled with the reason
      // shown, which is far less confusing than silently omitting it.
      let unavailableReason = null;
      if (method === PAYMENT_METHOD.COD && orderTotal && orderTotal > provider.maxOrderValue) {
        unavailableReason = `Not available above Rs ${provider.maxOrderValue.toLocaleString('en-PK')}`;
      }

      return {
        method,
        label: provider.label,
        description: meta.description ?? '',
        icon: meta.icon ?? 'wallet',
        order: meta.order ?? 99,
        isAvailable: !unavailableReason,
        unavailableReason,
        // Surfaced so the UI can badge non-live gateways during testing —
        // hiding sandbox mode is how test payments get mistaken for real ones.
        mode: provider.mode ?? null,
        ...(method === PAYMENT_METHOD.BANK_TRANSFER && {
          banks: provider.banks,
          account: provider.account,
        }),
      };
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * The status of every method, for the health endpoint and the back office.
 *
 * `enabled` and `configured` are reported separately rather than collapsed into
 * one boolean, because the two failure modes need different actions and an
 * owner looking at this screen has to be able to tell them apart: switched off
 * (flip the flag) versus switched on but missing keys (add the credentials).
 *
 * No secrets. Whether a value is present, never the value — a merchant id is
 * enough to identify an account, and this is read by the back office.
 */
export function configurationReport() {
  return Object.entries(PROVIDERS).map(([method, provider]) => ({
    method,
    label: provider.label,
    enabled: Boolean(provider.isEnabled),
    configured: Boolean(provider.isConfigured),
    offered: isOfferable(provider),
    mode: provider.mode ?? 'n/a',
  }));
}

export default { getProvider, availableMethods, configurationReport };
