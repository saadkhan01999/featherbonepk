import { apiClient } from '@/services/apiClient.js';

/**
 * Kitchen Display + Order Board endpoints (`/kitchen`, `/settings/kitchen-config`).
 * Website session; the account needs `kitchen.view` to read and
 * `kitchen.manage` to press Accept / Done / Served.
 */
export const kitchenApi = {
  config: () => apiClient.get('/settings/kitchen-config'),

  /** Live tickets + today's finished ones + tab counts; `station` narrows to one station's work. */
  tickets: ({ store, channel, station } = {}) =>
    apiClient.get('/kitchen/tickets', {
      params: {
        ...(store && { store }),
        ...(channel && channel !== 'all' && { channel }),
        ...(station && { station }),
      },
    }),

  /** Numbers only, for the counter screen. */
  board: ({ store } = {}) => apiClient.get('/kitchen/board', { params: { ...(store && { store }) } }),

  /** Without a station the whole order moves; with one, only that station's share. */
  accept: (id, station) => apiClient.post(`/kitchen/tickets/${id}/accept`, station ? { station } : {}),
  ready: (id, station) => apiClient.post(`/kitchen/tickets/${id}/ready`, station ? { station } : {}),
  serve: (id) => apiClient.post(`/kitchen/tickets/${id}/serve`),
};

export default kitchenApi;
