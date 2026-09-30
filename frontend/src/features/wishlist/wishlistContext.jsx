import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { apiClient } from '@/services/apiClient.js';
import { useAuth } from '@/features/auth/authContext.jsx';

/**
 * Wishlist.
 * ---------------------------------------------------------------------------
 * Server-authoritative, unlike the cart.
 *
 * A cart is a transient basket, so it lives in the browser for speed. A
 * wishlist is a saved list you expect to still be there on your phone tomorrow
 * — it belongs to the account, not the device. So there is no localStorage
 * mirror here, and saving requires being signed in.
 *
 * The UI stays instant regardless by updating optimistically and rolling back
 * if the request fails; a heart that lags behind the tap feels broken.
 */

const WishlistContext = createContext(null);

export function WishlistProvider({ children }) {
  const { isAuthenticated } = useAuth();

  /** Ids only — enough to render every heart in the right state, cheap to hold. */
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [isLoading, setLoading] = useState(false);
  /** Set when a signed-out visitor taps a heart, so a page can prompt them. */
  const [needsAuth, setNeedsAuth] = useState(false);

  // Load on sign-in; clear on sign-out so the next person at a shared device
  // does not see the previous account's saves.
  useEffect(() => {
    if (!isAuthenticated) {
      setSavedIds(new Set());
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiClient
      .get('/wishlist/ids')
      .then((ids) => {
        /*
         * `.map(String)` — the rest of this context compares with String(id),
         * so ids loaded raw from the API never matched. A saved item showed an
         * unfilled heart until the page was interacted with.
         */
        if (!cancelled) setSavedIds(new Set((ids ?? []).map(String)));
      })
      .catch(() => {
        // Non-fatal: hearts render empty rather than the storefront breaking.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const isSaved = useCallback((productId) => savedIds.has(String(productId)), [savedIds]);

  /**
   * Toggle a product.
   * @returns {boolean} whether the product is saved AFTER the change.
   */
  const toggle = useCallback(
    async (product) => {
      const id = String(product.id ?? product);

      if (!isAuthenticated) {
        setNeedsAuth(true);
        return false;
      }

      const wasSaved = savedIds.has(id);

      // Optimistic: flip immediately so the heart responds to the tap.
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(id);
        else next.add(id);
        return next;
      });

      try {
        const result = await apiClient.post(`/wishlist/toggle/${id}`);
        // Trust the server's answer over the optimistic guess — they diverge if
        // the same account toggled this on another device.
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (result.saved) next.add(id);
          else next.delete(id);
          return next;
        });
        return result.saved;
      } catch {
        // Roll back — a heart left filled after a failed save is a lie.
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (wasSaved) next.add(id);
          else next.delete(id);
          return next;
        });
        return wasSaved;
      }
    },
    [isAuthenticated, savedIds],
  );

  const remove = useCallback(async (productId) => {
    const id = String(productId);
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      await apiClient.delete(`/wishlist/${id}`);
    } catch {
      setSavedIds((prev) => new Set(prev).add(id));
    }
  }, []);

  const clear = useCallback(async () => {
    const previous = savedIds;
    setSavedIds(new Set());
    try {
      await apiClient.delete('/wishlist');
    } catch {
      setSavedIds(previous);
    }
  }, [savedIds]);

  const value = useMemo(
    () => ({
      savedIds,
      count: savedIds.size,
      isLoading,
      isSaved,
      toggle,
      remove,
      clear,
      needsAuth,
      dismissAuthPrompt: () => setNeedsAuth(false),
    }),
    [savedIds, isLoading, isSaved, toggle, remove, clear, needsAuth],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error('useWishlist must be used inside <WishlistProvider>');
  return context;
}

export default WishlistContext;
