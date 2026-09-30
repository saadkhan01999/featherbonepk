import { create } from 'zustand';

import { posClient } from '@/services/apiClient.js';

/**
 * Till state (Zustand).
 * ---------------------------------------------------------------------------
 * Everything on the till that is not the bill being rung up:
 *
 *   terminal     who/where this till is, and what the cashier may do
 *   config       tax, receipt, kitchen and theme settings (live — Settings saves
 *                are pushed over the socket and re-read here)
 *   menu         the categories and products this till sells (its menu scope is
 *                applied by the server)
 *   openOrders   tickets sent to the kitchen and unpaid tabs, for this counter
 *   readyAlerts  "ticket #42 is ready" notices from the kitchen
 *   parked       held bills — kept in localStorage per terminal, so a refresh or
 *                a cashier handover no longer loses a customer's parked order
 *
 * The bill itself stays in usePosCart's reducer: it is one screen's working
 * state with strict invariants, and nothing else reads it.
 */

const PARKED_KEY = (terminal) => `fb-pos-parked:${terminal}`;
const MAX_PARKED = 20;

function readParked(terminal) {
  try {
    const list = JSON.parse(localStorage.getItem(PARKED_KEY(terminal)) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeParked(terminal, list) {
  try {
    localStorage.setItem(PARKED_KEY(terminal), JSON.stringify(list));
  } catch {
    /* private mode: parking still works until the page reloads */
  }
}

export const usePosStore = create((set, get) => ({
  terminal: null,
  config: null,
  categories: [],
  products: [],
  menuStatus: 'loading', // loading | ready | error
  openOrders: [],
  readyAlerts: [],
  parked: [],
  parkedFor: null,

  /** /pos/terminal — name, store, menu mode, the cashier's till permissions. */
  async loadTerminal() {
    try {
      const terminal = await posClient.get('/pos/terminal');
      set({ terminal });
      return terminal;
    } catch {
      return null;
    }
  },

  /** /settings/pos-config — pricing, receipt, kitchen, theme, business. */
  async loadConfig() {
    try {
      const config = await posClient.get('/settings/pos-config');
      set({ config });
      return config;
    } catch {
      return null;
    }
  },

  async loadMenu() {
    try {
      const [categories, products] = await Promise.all([
        posClient.get('/pos/categories'),
        posClient.get('/pos/products', { params: { limit: 200 } }),
      ]);
      set({ categories: categories ?? [], products: products ?? [], menuStatus: 'ready' });
    } catch {
      set((state) => ({ menuStatus: state.products.length ? 'ready' : 'error' }));
    }
  },

  /** Stock levels only — after a sale, or a stock event from elsewhere. */
  async refreshProducts() {
    try {
      const products = await posClient.get('/pos/products', { params: { limit: 200 } });
      set({ products: products ?? [] });
    } catch {
      /* stale tiles are cosmetic; never an error over a completed sale */
    }
  },

  async loadOpenOrders() {
    try {
      const openOrders = await posClient.get('/pos/orders/open');
      set({ openOrders: openOrders ?? [] });
    } catch {
      /* the strip keeps its last known state */
    }
  },

  /** A ticket from this till turned ready in the kitchen. */
  pushReady(alert) {
    set((state) =>
      state.readyAlerts.some((a) => a.id === alert.id)
        ? state
        : { readyAlerts: [...state.readyAlerts, { ...alert, at: Date.now() }].slice(-6) },
    );
  },

  dismissReady(id) {
    set((state) => ({ readyAlerts: state.readyAlerts.filter((a) => a.id !== id) }));
  },

  // --- Parked bills, per terminal -------------------------------------------------
  loadParked(terminal) {
    if (!terminal) return;
    set({ parked: readParked(terminal), parkedFor: terminal });
  },

  park(bill) {
    const { parkedFor, parked } = get();
    const next = [...parked, { ...bill, id: `HOLD-${Date.now()}`, at: new Date().toISOString() }].slice(
      -MAX_PARKED,
    );
    set({ parked: next });
    if (parkedFor) writeParked(parkedFor, next);
  },

  unpark(id) {
    const { parkedFor, parked } = get();
    const next = parked.filter((b) => b.id !== id);
    set({ parked: next });
    if (parkedFor) writeParked(parkedFor, next);
  },
}));

export default usePosStore;
