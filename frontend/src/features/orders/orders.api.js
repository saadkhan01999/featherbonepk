import { apiClient } from '@/services/apiClient.js';

/**
 * Checkout and order API.
 * ---------------------------------------------------------------------------
 * Note what is not sent: prices, tax or totals. The client sends product ids
 * and quantities only — the server re-prices everything. Anything this file
 * sent about money would be a number the customer could edit.
 */
export const ordersApi = {
  /** Server-authoritative totals for the current basket. */
  quote: (items) => apiClient.post('/orders/quote', { items: toLines(items) }),

  paymentMethods: (total) => apiClient.get('/orders/payment-methods', { params: { total } }),

  place: ({ items, customer, deliveryAddress, paymentMethod, bankCode }) =>
    apiClient.post('/orders', {
      items: toLines(items),
      customer,
      deliveryAddress,
      paymentMethod,
      ...(bankCode && { bankCode }),
    }),

  byNumber: (orderNumber) => apiClient.get(`/orders/${orderNumber}`),

  /**
   * Cancel an order.
   *
   * `phone` is required for an order placed without an account, and ignored for
   * one placed with it — the server proves ownership from the session in that
   * case. Holding the order number is no longer enough on its own, because
   * order numbers are printed, forwarded and read aloud.
   */
  cancel: (orderNumber, { phone } = {}) =>
    apiClient.post(`/orders/${orderNumber}/cancel`, phone ? { phone } : {}),

  mine: (params) => apiClient.get('/orders/mine', { params, _wantEnvelope: true }),
};

/** Strip cart lines down to what the server accepts. */
function toLines(items) {
  return items.map((line) => ({ productId: line.productId, quantity: line.quantity }));
}

export default ordersApi;
