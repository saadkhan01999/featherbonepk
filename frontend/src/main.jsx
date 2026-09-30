import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App.jsx';
import '@/index.css';

/**
 * Client entry point.
 * ---------------------------------------------------------------------------
 * StrictMode is intentional in development: it double-invokes effects and
 * renders to surface impure logic and missing cleanup functions. It is a no-op
 * in the production build, so it costs nothing at runtime.
 */
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
