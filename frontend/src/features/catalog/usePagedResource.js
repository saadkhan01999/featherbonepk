import { useCallback, useEffect, useRef, useState } from 'react';

import { useResource } from './catalog.api.js';

/**
 * `useResource` for a server-paginated list.
 * ---------------------------------------------------------------------------
 * Owns the page number, hands the reader the current page, and returns the
 * server's `meta.pagination` for <Pagination> to render.
 *
 * The part that is easy to GET wrong, and the reason this is a hook:
 *
 * Changing a filter while on page 5 must go back to page 1. Otherwise the
 * narrowed result has three pages, the request asks for page 5, and the screen
 * shows an empty table with no explanation — the user concludes the filter
 * found nothing. Written per-screen, that reset gets forgotten on at least one
 * of them; written here, no screen can forget it.
 *
 * @param {(params: {page: number, limit: number}) => Promise<object>} reader
 *   Must resolve to the full envelope — pass `_wantEnvelope: true` — so `meta`
 *   survives. Returning only `data` loses the pagination block.
 * @param {Array} deps Filters. Any change resets to page 1.
 * @param {object} [options]
 * @param {number} [options.limit] Rows per page. 20 suits a laptop viewport.
 */
export function usePagedResource(reader, deps = [], { limit = 20 } = {}) {
  const [page, setPage] = useState(1);

  /*
   * Reset on a filter change — but not on first render, which would fire a
   * second request for the page we are already on.
   */
  const depsKey = JSON.stringify(deps);
  const previousDeps = useRef(depsKey);

  useEffect(() => {
    if (previousDeps.current !== depsKey) {
      previousDeps.current = depsKey;
      setPage(1);
    }
  }, [depsKey]);

  const readerRef = useRef(reader);
  readerRef.current = reader;

  const envelope = useResource(() => readerRef.current({ page, limit }), [depsKey, page, limit]);

  /** Page changes are clamped: a stale "next" click cannot ask for page 0. */
  const goToPage = useCallback(
    (next) => {
      const totalPages = envelope.data?.meta?.pagination?.totalPages ?? 1;
      setPage(Math.min(Math.max(1, next), Math.max(1, totalPages)));
      // The list is above the controls, so paging without this leaves the
      // reader looking at the bottom of a table whose contents just changed.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [envelope.data],
  );

  return {
    rows: envelope.data?.data ?? [],
    meta: envelope.data?.meta?.pagination ?? null,
    isLoading: envelope.isLoading,
    isRefreshing: envelope.isRefreshing,
    error: envelope.error,
    reload: envelope.reload,
    page,
    goToPage,
  };
}

export default usePagedResource;
