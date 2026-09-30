import { apiClient, getAccessToken, refreshSession } from '@/services/apiClient.js';
import { config } from '@/config/env.js';

/**
 * Reports — run one, or download it as CSV / PDF.
 * ---------------------------------------------------------------------------
 * Every screen that offers "View · CSV · PDF" (Inventory, a till's report, the
 * Reports tab) goes through these two functions, so the three always ask the
 * server for the same document with the same filters.
 */

/** Drop empty filter values so the URL carries only what was chosen. */
export function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

export const reportsApi = {
  catalogue: () => apiClient.get('/reports'),

  run: (id, params) => apiClient.get(`/reports/${id}`, { params: cleanParams(params) }),

  /**
   * Download an export and hand it to the browser as a file.
   *
   * fetch + blob rather than a plain <a href>: the endpoint needs the bearer
   * token, and a bare link sends none — the "export" would be a 401 JSON body
   * saved with a .pdf name.
   *
   * An expired access token is refreshed once and the download retried, so an
   * owner who left the screen open over lunch gets their file, not an error.
   */
  async download(id, params, format = 'csv') {
    const query = new URLSearchParams(cleanParams({ ...params, format })).toString();
    const url = `${config.apiUrl}/reports/${id}/export?${query}`;

    const attempt = () =>
      fetch(url, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
      });

    let response = await attempt();
    if (response.status === 401) {
      await refreshSession();
      response = await attempt();
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? `Export failed (${response.status})`);
    }

    // Prefer the server's filename — it carries the report, the till and the date.
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${id}.${format}`;

    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: some browsers cancel a download whose URL is
    // revoked synchronously after click().
    setTimeout(() => URL.revokeObjectURL(href), 1000);

    return filename;
  },
};

export default reportsApi;
