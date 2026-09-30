import { AppRouter } from '@/routes/AppRouter.jsx';

/**
 * Application root.
 * ---------------------------------------------------------------------------
 * Global providers (Redux store, React Query client, toasts) are added here as
 * each lands. The router owns per-surface providers — the POS session provider,
 * for example, belongs only to the /pos subtree and must not wrap the
 * storefront.
 */
export function App() {
  return <AppRouter />;
}

export default App;
