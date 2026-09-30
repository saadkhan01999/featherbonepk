import { apiClient } from '@/services/apiClient.js';

/**
 * Contact form.
 * ---------------------------------------------------------------------------
 * One call, in its own module for the same reason every other domain has one:
 * components never build URLs, so a route change is a single-line edit here
 * rather than a search across pages.
 */
export const contactApi = {
  /**
   * @param {{name: string, email: string, phone?: string, subject?: string, message: string}} payload
   * @returns {Promise<{reference: string}>}
   */
  send: (payload) => apiClient.post('/messages', payload),
};

export default contactApi;
