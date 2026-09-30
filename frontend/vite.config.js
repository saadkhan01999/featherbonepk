import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration.
 * ---------------------------------------------------------------------------
 * - `@` aliases the src root so imports read `@/components/ui/Button.jsx`
 *   instead of `../../../components/ui/Button.jsx`.
 * - The dev server proxies `/api` and `/uploads` to the Express service, so the
 *   browser sees one origin. That keeps cookies first-party in development,
 *   which matters because the refresh token is an httpOnly cookie.
 * - `manualChunks` splits the heavy vendor libraries into their own bundles so
 *   a change to app code doesn't invalidate the whole cached vendor payload.
 *
 * ---------------------------------------------------------------------------
 * DEPLOYING THIS BUILD (see also vercel.json beside this file)
 * ---------------------------------------------------------------------------
 * `vercel.json` carries two things that are easy to get wrong by hand:
 *
 *  1. A REWRITE OF EVERY NON-ASSET PATH TO index.html. This is a single-page
 *     app — React Router owns /shop, /checkout, /admin/… and /pos/…, and none
 *     of those exist as files. Without the rewrite the first load works (you
 *     arrive via /) and a REFRESH on any deeper route returns the host's 404.
 *     That is the classic "works until you press F5, and only in production"
 *     report. `assets/` is excluded so a genuinely missing script still 404s
 *     honestly instead of being handed a page of HTML.
 *
 *  2. Long-lived caching for hashed assets, plus the small set of security
 *     headers that costs nothing at the edge.
 *
 * NO API HOSTNAME IS COMMITTED ANYWHERE. The API address is VITE_API_URL, set
 * in the hosting dashboard — hard-coding one would freeze a single deployment's
 * backend into the repository, which is how a placeholder like
 * `https://your-api.onrender.com` survives to launch and every request fails
 * against a host nobody owns. Note that Vite inlines it at BUILD time, so
 * changing it needs a redeploy, and it must never be `localhost` in a deployed
 * environment: the bundle runs on the customer's machine, where localhost is
 * their computer.
 *
 * The API must, in turn, list the site's origin(s) in CLIENT_URL /
 * ALLOWED_ORIGINS, or the browser refuses every credentialed request and
 * reports it as a plain network error rather than a policy one.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Dedicated ports (web 7001 / API 7000) so this suite can run alongside
    // other local projects without fighting over 5173/5000.
    port: 7001,
    strictPort: false,
    proxy: {
      // `ws: true` — the live-update socket lives under the API prefix
      // (/api/v1/socket.io), so this one rule carries both HTTP and WebSocket.
      '/api': { target: 'http://localhost:7000', changeOrigin: true, ws: true },
      '/uploads': { target: 'http://localhost:7000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'state-vendor': ['zustand'],
          'realtime-vendor': ['socket.io-client'],
          'chart-vendor': ['recharts'],
          'motion-vendor': ['framer-motion'],
        },
      },
    },
  },
});
