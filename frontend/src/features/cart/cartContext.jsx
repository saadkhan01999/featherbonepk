import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';

import { config } from '@/config/env.js';
import { useSite } from '@/features/site/siteContext.jsx';

/**
 * Shopping cart.
 * ---------------------------------------------------------------------------
 * Client-authoritative for speed, server-authoritative for money.
 *
 * Cart contents live in the browser and persist to localStorage, so adding an
 * item is instant and a refresh doesn't lose the basket. But the totals shown
 * at checkout are re-computed on the server, because prices, tax and delivery
 * rules can all change between adding and paying — and because a total the
 * client can edit is a total a customer can edit.
 *
 * The local totals here are for display only. The order is priced server-side.
 */

const CartContext = createContext(null);

const STORAGE_KEY = config.storageKeys.cart;

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Guard against a stale or hand-edited payload: a malformed cart must not
    // crash the whole storefront on boot.
    return Array.isArray(parsed) ? parsed.filter((l) => l?.productId && l?.quantity > 0) : [];
  } catch {
    return [];
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD': {
      const { product, quantity } = action;
      const existing = state.find((line) => line.productId === product.id);

      if (existing) {
        return state.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + quantity } : line,
        );
      }

      return [
        ...state,
        {
          productId: product.id,
          slug: product.slug,
          name: product.name,
          image: product.image ?? null,
          unit: product.unit,
          unitLabel: product.unitLabel,
          isWeighed: product.isWeighed,
          // Snapshot for display. The server re-reads the real price at
          // checkout, so a stale snapshot can never under-charge.
          unitPrice: product.effectivePrice ?? product.price,
          quantity,
        },
      ];
    }

    case 'SET_QUANTITY': {
      const quantity = action.isWeighed
        ? Math.round(action.quantity * 1000) / 1000
        : Math.round(action.quantity);
      if (quantity <= 0) return state.filter((line) => line.productId !== action.productId);
      return state.map((line) => (line.productId === action.productId ? { ...line, quantity } : line));
    }

    case 'REMOVE':
      return state.filter((line) => line.productId !== action.productId);

    case 'CLEAR':
      return [];

    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const [lines, dispatch] = useReducer(reducer, undefined, loadPersisted);
  const [isOpen, setOpen] = useState(false);
  /*
   * Pricing comes from the shared site settings (loaded once by SiteProvider).
   * The fallbacks match the server's defaults, so the cart still totals if
   * settings are unreachable.
   */
  const site = useSite();
  const pricing = useMemo(
    () => ({
      taxRate: 0.05,
      taxLabel: 'GST',
      deliveryFee: 60,
      freeDeliveryThreshold: 3000,
      ...(site.pricing ?? {}),
    }),
    [site.pricing],
  );

  // --- Persist ------------------------------------------------------------
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* Private mode / quota — the cart simply won't survive a reload. */
    }
  }, [lines]);

  const addItem = useCallback((product, quantity = 1) => {
    dispatch({ type: 'ADD', product, quantity });
    // Opening the drawer is the confirmation that the click worked. A silent
    // add leaves the customer unsure and clicking again.
    setOpen(true);
  }, []);

  const setQuantity = useCallback(
    (productId, quantity, isWeighed) => dispatch({ type: 'SET_QUANTITY', productId, quantity, isWeighed }),
    [],
  );
  const removeItem = useCallback((productId) => dispatch({ type: 'REMOVE', productId }), []);
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  /** Display totals. Mirrors the server's order of operations exactly. */
  const totals = useMemo(() => {
    const lineTotals = lines.map((line) => Math.round(line.quantity * line.unitPrice));
    const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);

    // Free delivery is a threshold, not a discount — it is applied before tax
    // and never produces a negative fee.
    const qualifiesFree = pricing.freeDeliveryThreshold > 0 && subtotal >= pricing.freeDeliveryThreshold;
    const delivery = subtotal === 0 || qualifiesFree ? 0 : pricing.deliveryFee;

    const tax = pricing.taxInclusive ? 0 : Math.round(subtotal * pricing.taxRate);
    const total = subtotal + delivery + tax;

    return {
      lineTotals,
      subtotal,
      delivery,
      tax,
      taxRate: pricing.taxRate,
      taxLabel: pricing.taxLabel ?? 'GST',
      total,
      itemCount: lines.length,
      unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      qualifiesFreeDelivery: qualifiesFree,
      // How much more to spend for free delivery — a proven nudge, and useful
      // information rather than a dark pattern.
      amountToFreeDelivery:
        pricing.freeDeliveryThreshold > 0 && !qualifiesFree && subtotal > 0
          ? pricing.freeDeliveryThreshold - subtotal
          : 0,
    };
  }, [lines, pricing]);

  const value = useMemo(
    () => ({
      lines,
      totals,
      pricing,
      isEmpty: lines.length === 0,
      isOpen,
      openCart: () => setOpen(true),
      closeCart: () => setOpen(false),
      addItem,
      setQuantity,
      removeItem,
      clear,
    }),
    [lines, totals, pricing, isOpen, addItem, setQuantity, removeItem, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside <CartProvider>');
  return context;
}

export default CartProvider;
