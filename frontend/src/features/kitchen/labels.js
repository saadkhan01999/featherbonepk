/** Shared words for order types and kitchen stages — the till, the kitchen and the board say the same thing. */

export const ORDER_TYPE_LABEL = Object.freeze({
  dine_in: 'Dine in',
  take_away: 'Take away',
  delivery: 'Delivery',
});

export const STAGE_LABEL = Object.freeze({
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  done: 'Served',
});

/** "Dine in · Table 5", "Take away", "Delivery". */
export function orderTypeLine({ orderType, tableNumber } = {}) {
  const label = ORDER_TYPE_LABEL[orderType] ?? 'Take away';
  return orderType === 'dine_in' && tableNumber ? `${label} · Table ${tableNumber}` : label;
}

/** "2 ×" for pieces, "0.5 kg" for weighed goods — how a cook reads a quantity. */
export function kitchenQuantity(item) {
  if (item.isWeighed) return `${Number(item.quantity)} ${item.unitLabel ?? item.unit ?? ''}`.trim();
  return `${Number(item.quantity)} ×`;
}
