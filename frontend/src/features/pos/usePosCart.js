import { useCallback, useMemo, useReducer } from 'react';

/**
 * POS cart state.
 * ---------------------------------------------------------------------------
 * A reducer rather than scattered useState calls: a till cart has ~8 mutations
 * that all have to keep the same invariants (no zero quantities, no duplicate
 * lines, totals always consistent). One reducer means one place to get that
 * right, and every transition is inspectable.
 *
 * The pricing model — this is the part that is easy to get wrong.
 * `unitPrice` is the price of one unit, and `quantity` is how many units.
 * For a weighed item the unit is a kilo, so the reference receipt's
 *   "Full Chicken Roast 1.5 Kg × Rs 1,200/kg = Rs 1,800"
 * is quantity 1.5 × unitPrice 1,200. For a countable item quantity is a whole
 * number. Treating `price` as a flat per-item figure would make it impossible
 * to bill a 1.5 kg bird correctly.
 *
 * Money is computed in whole rupees and rounded per line, so the printed slip
 * always adds up exactly — a total derived from unrounded lines can disagree
 * with the visible figures by a rupee, and a cash drawer that is out by a rupee
 * is a support call.
 */

const initialState = {
  lines: [],
  /** Sale-level discount in whole rupees (applied after line totals). */
  saleDiscount: 0,
  customer: null, // null → "Walk-in Customer"
  /** 'take_away' | 'dine_in' — printed on the kitchen ticket and the order board. */
  orderType: 'take_away',
  tableNumber: '',
  /** "No chilli", "extra sauce" — goes to the kitchen, not the receipt. */
  kitchenNote: '',
};

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM': {
      const { product, quantity } = action;
      const existing = state.lines.find((line) => line.productId === product.id);

      // Scanning the same barcode twice increments the existing line rather
      // than creating a duplicate — a receipt listing "Naan ×1" four times is
      // hard for both the cashier and the customer to check.
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((line) =>
            line.productId === product.id
              ? { ...line, quantity: roundQuantity(line.quantity + quantity, line.isWeighed) }
              : line,
          ),
        };
      }

      return {
        ...state,
        lines: [
          ...state.lines,
          {
            productId: product.id,
            name: product.name,
            image: product.image,
            unit: product.unit,
            unitLabel: product.unitLabel,
            isWeighed: product.isWeighed,
            // Snapshot the price at the till. If the owner re-prices mid-sale,
            // the customer pays what they were quoted.
            unitPrice: product.effectivePrice ?? product.price,
            listPrice: product.price,
            quantity: roundQuantity(quantity, product.isWeighed),
            lineDiscount: 0,
          },
        ],
      };
    }

    case 'SET_QUANTITY': {
      const quantity = roundQuantity(action.quantity, action.isWeighed);
      // Dropping to zero removes the line — an item at quantity 0 on a receipt
      // is confusing and would print as a zero-value row.
      if (quantity <= 0) {
        return { ...state, lines: state.lines.filter((l) => l.productId !== action.productId) };
      }
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.productId === action.productId ? { ...line, quantity } : line,
        ),
      };
    }

    case 'REMOVE_ITEM':
      return { ...state, lines: state.lines.filter((line) => line.productId !== action.productId) };

    case 'SET_LINE_DISCOUNT':
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.productId === action.productId
            ? { ...line, lineDiscount: Math.max(0, Math.round(action.amount)) }
            : line,
        ),
      };

    case 'SET_SALE_DISCOUNT':
      return { ...state, saleDiscount: Math.max(0, Math.round(action.amount)) };

    case 'SET_CUSTOMER':
      return { ...state, customer: action.customer };

    case 'SET_ORDER_TYPE':
      // A take-away has no table; keeping a stale one would print it.
      return {
        ...state,
        orderType: action.orderType,
        tableNumber: action.orderType === 'dine_in' ? state.tableNumber : '',
      };

    case 'SET_TABLE':
      return { ...state, tableNumber: String(action.tableNumber ?? '').slice(0, 20) };

    case 'SET_KITCHEN_NOTE':
      return { ...state, kitchenNote: String(action.note ?? '').slice(0, 300) };

    case 'CLEAR':
      return { ...initialState, orderType: action.orderType ?? initialState.orderType };

    /** Restore a parked/held bill wholesale. */
    case 'RESTORE':
      return { ...initialState, ...action.state };

    default:
      return state;
  }
}

/**
 * Weighed items keep 3 decimals (grams); countable items are whole numbers.
 * Without this, floating-point drift turns 0.1 + 0.2 into 0.30000000000000004
 * and the receipt prints a nonsense weight.
 */
function roundQuantity(value, isWeighed) {
  const n = Number(value) || 0;
  return isWeighed ? Math.round(n * 1000) / 1000 : Math.round(n);
}

/**
 * @param {object} options
 * @param {number} options.taxRate Fractional GST, e.g. 0.05 for 5%.
 */
export function usePosCart({ taxRate = 0.05, defaultOrderType = 'take_away' } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const addItem = useCallback(
    (product, quantity = 1) => dispatch({ type: 'ADD_ITEM', product, quantity }),
    [],
  );
  const setQuantity = useCallback(
    (productId, quantity, isWeighed) => dispatch({ type: 'SET_QUANTITY', productId, quantity, isWeighed }),
    [],
  );
  const removeItem = useCallback((productId) => dispatch({ type: 'REMOVE_ITEM', productId }), []);
  const setSaleDiscount = useCallback((amount) => dispatch({ type: 'SET_SALE_DISCOUNT', amount }), []);
  const setCustomer = useCallback((customer) => dispatch({ type: 'SET_CUSTOMER', customer }), []);
  const setOrderType = useCallback((orderType) => dispatch({ type: 'SET_ORDER_TYPE', orderType }), []);
  const setTableNumber = useCallback((tableNumber) => dispatch({ type: 'SET_TABLE', tableNumber }), []);
  const setKitchenNote = useCallback((note) => dispatch({ type: 'SET_KITCHEN_NOTE', note }), []);
  // The next bill starts as the till's default order type (Settings → POS).
  const clear = useCallback(
    () => dispatch({ type: 'CLEAR', orderType: defaultOrderType }),
    [defaultOrderType],
  );
  const restore = useCallback((saved) => dispatch({ type: 'RESTORE', state: saved }), []);

  /**
   * Totals.
   *
   * Order of operations matters and mirrors the server's pricing engine:
   *   line totals → sale discount → tax on the discounted amount → total
   * Taxing before the discount would overcharge; the two must agree exactly or
   * the printed slip and the recorded sale will differ.
   */
  const totals = useMemo(() => {
    const lineTotals = state.lines.map((line) =>
      Math.max(0, Math.round(line.quantity * line.unitPrice) - line.lineDiscount),
    );

    const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
    // A discount can never exceed the subtotal, or tax would be computed on a
    // negative base and the sale would refund money.
    const discount = Math.min(state.saleDiscount, subtotal);
    const taxable = subtotal - discount;
    const tax = Math.round(taxable * taxRate);
    const total = taxable + tax;

    return {
      subtotal,
      discount,
      tax,
      taxRate,
      total,
      itemCount: state.lines.length,
      unitCount: state.lines.reduce((sum, line) => sum + line.quantity, 0),
      lineTotals,
    };
  }, [state.lines, state.saleDiscount, taxRate]);

  return {
    lines: state.lines,
    customer: state.customer,
    saleDiscount: state.saleDiscount,
    orderType: state.orderType,
    tableNumber: state.tableNumber,
    kitchenNote: state.kitchenNote,
    totals,
    isEmpty: state.lines.length === 0,
    addItem,
    setQuantity,
    removeItem,
    setSaleDiscount,
    setCustomer,
    setOrderType,
    setTableNumber,
    setKitchenNote,
    clear,
    restore,
    /** Raw snapshot, for parking a bill. */
    snapshot: state,
  };
}

export default usePosCart;
