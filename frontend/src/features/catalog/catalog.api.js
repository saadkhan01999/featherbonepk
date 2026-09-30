import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '@/services/apiClient.js';

/**
 * Public catalogue access.
 * ---------------------------------------------------------------------------
 * Thin fetch helpers plus a small `useResource` hook. A full query-cache layer
 * (React Query) is wired in with the cart work; until then this keeps the
 * storefront honest about the three states every remote read has —
 * loading, error and data — so no screen renders as if data were always present.
 */

export const catalogApi = {
  categories: () => apiClient.get('/catalog/categories'),

  products: (params) => apiClient.get('/catalog/products', { params, _wantEnvelope: true }),

  product: (slug) => apiClient.get(`/catalog/products/${slug}`),

  /** Pinned picks, then real sales, then popular — see catalog.service `bestSellers`. */
  bestSellers: (params) => apiClient.get('/catalog/best-sellers', { params }),
};

/**
 * Run an async reader and expose {data, error, isLoading, reload}.
 *
 * `deps` controls re-fetching, e.g. `useResource(() => api.products({sort}), [sort])`.
 *
 * Two details that matter:
 *
 * 1. The reader is held in a ref, not a dependency. Callers pass an inline
 *    arrow that is a new function on every render, so depending on it directly
 *    would re-fetch forever. The ref always holds the latest closure, so the
 *    reader still sees current props without driving the effect.
 *
 * 2. `deps` is serialised to a string rather than spread into the dependency
 *    array. A spread array changes length between renders, which React cannot
 *    verify statically — and an accidental length change silently breaks
 *    dependency comparison. A single stable key sidesteps both problems.
 *
 * The `cancelled` flag matters for correctness, not just tidiness: without it a
 * slow response can resolve after the user has changed filters and overwrite
 * newer data with older results.
 *
 * 3. `isLoading` means "nothing to show yet" — the first load only. Every
 *    later fetch (a search keystroke, a filter, a live update, `reload()`)
 *    keeps the current data on screen and reports `isRefreshing` instead.
 *
 *    Many screens do `if (isLoading) return <SectionLoader />`. When a search
 *    box drove a re-fetch, that swapped the whole page — search box included —
 *    for a spinner on every keystroke: the input was destroyed under the
 *    cursor, so after typing one letter the rest went nowhere and focus landed
 *    on whatever button was left. Keeping the page mounted during a refresh
 *    fixes that for every caller at once.
 */
export function useResource(reader, deps = [], initial = null) {
  const readerRef = useRef(reader);
  // Assigned during render so the ref is current before the effect runs.
  readerRef.current = reader;

  const [data, setData] = useState(initial);
  const [error, setError] = useState(null);
  const [isFetching, setFetching] = useState(true);
  // Has any request finished (with data or an error)? Until then there is
  // genuinely nothing to render, and only then is it a "loading" state.
  const [hasSettled, setSettled] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    setError(null);

    readerRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) {
          setFetching(false);
          setSettled(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [depsKey, reloadToken]);

  return {
    data,
    error,
    isLoading: isFetching && !hasSettled,
    isRefreshing: isFetching && hasSettled,
    reload,
  };
}

export default catalogApi;
