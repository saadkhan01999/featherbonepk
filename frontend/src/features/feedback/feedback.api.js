import { apiClient } from '@/services/apiClient.js';

/** Customer feedback — see backend modules/feedback. */
export const feedbackApi = {
  submit: (payload) => apiClient.post('/feedback', payload),
  published: (limit = 6) => apiClient.get('/feedback/public', { params: { limit } }),

  // Back office
  list: (params) => apiClient.get('/feedback', { params, _wantEnvelope: true }),
  stats: () => apiClient.get('/feedback/stats'),
  moderate: (id, payload) => apiClient.patch(`/feedback/${id}`, payload),
  remove: (id) => apiClient.delete(`/feedback/${id}`),
};

export default feedbackApi;
