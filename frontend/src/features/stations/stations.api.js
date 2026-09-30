import { apiClient } from '@/services/apiClient.js';

/** Preparation stations, and forwarding website orders to them (back office). */
export const stationsApi = {
  list: () => apiClient.get('/stations'),
  create: (body) => apiClient.post('/stations', body),
  update: (id, body) => apiClient.patch(`/stations/${id}`, body),
  remove: (id) => apiClient.delete(`/stations/${id}`),

  /** Website orders waiting to be forwarded, with a suggested station per item. */
  incoming: () => apiClient.get('/orders/admin/incoming'),

  /**
   * @param {string} orderNumber
   * @param {{lines?: Array<{index: number, station: string|null}>, kitchenNote?: string}} body
   */
  forward: (orderNumber, body) => apiClient.post(`/orders/${orderNumber}/forward`, body),
};

export const STATION_COLORS = [
  '#f97316',
  '#ef4444',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

export default stationsApi;
