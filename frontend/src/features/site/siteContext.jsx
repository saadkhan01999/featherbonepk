import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { create } from 'zustand';

import { apiClient } from '@/services/apiClient.js';
import { EVENTS, useRealtimeEvent } from '@/services/realtime.js';
import { applySurfaceTheme, surfaceForPath } from '@/lib/theme.js';
import { config } from '@/config/env.js';

/**
 * Public site settings — the owner's own business details, theme and content.
 * ---------------------------------------------------------------------------
 * A Zustand store, not a React context. Every consumer reads the same object;
 * nothing re-fetches per component; and the store can be refreshed from
 * outside React (the socket handler), so a change saved in Settings reaches an
 * open storefront, back office and till within a second, without a reload.
 *
 * Why this exists at all:
 *
 * The footer, contact page, homepage and cart each fetched `/settings/public`
 * separately, so loading the site made four identical requests and four copies
 * of the answer that could disagree mid-render. This fetches once and shares.
 *
 * Blank means omit, never substitute. If the owner has not entered a phone
 * number, the footer shows no phone row. It does not fall back to an invented
 * one — a plausible-looking wrong number is worse than an absent one, because
 * customers ring it.
 *
 * `SiteProvider` and `useSite()` keep their old names and shapes, so every page
 * written against the context keeps working unchanged.
 */

/** Shape used before the request resolves, so consumers never see undefined. */
const EMPTY = Object.freeze({
  business: Object.freeze({ name: config.brand.name, tagline: config.brand.tagline, social: {} }),
  content: Object.freeze({}),
  pricing: Object.freeze({}),
  theme: null,
  footer: Object.freeze({ socialLinks: [], links: [], customFields: [] }),
  contact: Object.freeze({ customFields: [] }),
  slider: Object.freeze({ slides: [], effect: 'book', interval: 6, autoplay: true, height: 'standard' }),
  pages: Object.freeze([]),
  currency: config.currency,
});

export const useSiteStore = create((set, get) => ({
  ...EMPTY,
  isLoading: true,
  loadedAt: null,

  /** Fetch settings and the published page list. Safe to call repeatedly. */
  async load() {
    try {
      const [data, pages] = await Promise.all([
        apiClient.get('/settings/public'),
        apiClient.get('/pages').catch(() => []),
      ]);
      if (!data) return;
      set({
        ...EMPTY,
        ...data,
        // Merge so `name` and `tagline` keep a sensible value if the owner has
        // cleared them, while contact details stay genuinely blank.
        business: {
          ...EMPTY.business,
          ...(data.business ?? {}),
          name: data.business?.name || EMPTY.business.name,
        },
        footer: { ...EMPTY.footer, ...(data.footer ?? {}) },
        contact: { ...EMPTY.contact, ...(data.contact ?? {}) },
        slider: { ...EMPTY.slider, ...(data.slider ?? {}) },
        pages: pages ?? [],
        isLoading: false,
        loadedAt: Date.now(),
      });
    } catch {
      // Non-fatal: the storefront must still render if settings are
      // unreachable. Contact rows simply stay hidden.
      if (get().isLoading) set({ isLoading: false });
    }
  },

  /** Just the page list — after the owner publishes or edits a page. */
  async loadPages() {
    try {
      set({ pages: (await apiClient.get('/pages')) ?? [] });
    } catch {
      /* Keep the list we have. */
    }
  },
}));

/**
 * Loads the settings once, keeps them live, and applies the right theme for
 * whichever surface the current URL belongs to.
 */
export function SiteProvider({ children }) {
  const load = useSiteStore((s) => s.load);
  const loadPages = useSiteStore((s) => s.loadPages);
  const theme = useSiteStore((s) => s.theme);
  const { pathname } = useLocation();
  const surface = surfaceForPath(pathname);

  useEffect(() => {
    load();
  }, [load]);

  // Live: the owner saved a setting or a page somewhere.
  useRealtimeEvent('guest', EVENTS.SETTINGS_CHANGED, () => load());
  useRealtimeEvent('guest', EVENTS.PAGES_CHANGED, () => loadPages());

  // The till and the kitchen apply their own theme from their own config.
  useEffect(() => {
    if (surface === 'website' || surface === 'admin') applySurfaceTheme(surface, theme);
  }, [surface, theme]);

  return children;
}

/**
 * @returns {{business: object, content: object, pricing: object, theme: object,
 *   footer: object, contact: object, pages: Array, currency: string, isLoading: boolean}}
 */
export function useSite() {
  return useSiteStore();
}

/** Convenience: just the business identity block. */
export function useBusiness() {
  return useSiteStore((s) => s.business);
}

export default SiteProvider;
