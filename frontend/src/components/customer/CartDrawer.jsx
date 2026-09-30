import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Plus, Minus, Trash2, ShoppingCart, Truck } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { useCart } from '@/features/cart/cartContext.jsx';
import { useFocusTrap } from '@/lib/useFocusTrap.js';
import { formatCurrency, formatQuantity } from '@/lib/format.js';
import { ROUTES } from '@/constants/routes.js';
import { drawerRight, backdrop } from '@/lib/motion.js';
import { mediaUrl } from '@/lib/media.js';
import { useOrderingStatus } from '@/features/site/orderingStatus.js';
import { ClosedNote } from '@/components/customer/ShopClosed.jsx';

/**
 * Mini-cart drawer.
 * ---------------------------------------------------------------------------
 * Slides in when an item is added or the cart icon is clicked. A drawer rather
 * than a full page navigation on purpose: adding an item should never lose the
 * customer's place in a long menu.
 *
 * Mounted once in the storefront layout so it is available on every page.
 */
export function CartDrawer() {
  const ordering = useOrderingStatus();
  const { lines, totals, isOpen, closeCart, setQuantity, removeItem, isEmpty } = useCart();

  /*
   * Escape to close, scroll locked, and — the part that was missing — focus
   * trapped. This element claims `aria-modal="true"`, which tells assistive
   * technology that everything behind it is inert. Tab still walked out into
   * the page, so the promise was false: a keyboard user ended up somewhere they
   * could not see, in a "modal" they could not escape by tabbing.
   *
   * Shared with Modal rather than reimplemented — see lib/useFocusTrap.js.
   */
  const { containerRef } = useFocusTrap(isOpen, { onClose: closeCart });

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          ref={containerRef}
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Shopping cart"
        >
          <motion.div
            {...backdrop}
            onClick={closeCart}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-hidden="true"
          />

          <motion.aside
            {...drawerRight}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-surface"
          >
            {/* --- Header --- */}
            <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2.5">
                <ShoppingCart className="h-5 w-5 text-gold" aria-hidden="true" />
                <h2 className="font-semibold">Your Order</h2>
                {totals.itemCount > 0 && (
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                    {totals.itemCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={closeCart}
                aria-label="Close cart"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            {/* --- Lines --- */}
            {isEmpty ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-hover">
                  <ShoppingCart className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                </span>
                <p className="font-medium">Your cart is empty</p>
                <p className="text-sm text-muted-foreground">
                  Add something from the menu and it will show up here.
                </p>
                <Link to={ROUTES.MENU} onClick={closeCart}>
                  <Button className="mt-2">Browse the Menu</Button>
                </Link>
              </div>
            ) : (
              <>
                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                  {lines.map((line, index) => (
                    <li key={line.productId} className="flex gap-3 px-5 py-4">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-hover">
                        {line.image && (
                          <img
                            src={mediaUrl(line.image)}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col justify-between">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{line.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatQuantity(line.quantity, line.unit)} · {formatCurrency(line.unitPrice)}/
                              {line.unitLabel}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(line.productId)}
                            aria-label={`Remove ${line.name}`}
                            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <QtyButton
                              onClick={() =>
                                setQuantity(
                                  line.productId,
                                  line.quantity - (line.isWeighed ? 0.5 : 1),
                                  line.isWeighed,
                                )
                              }
                              label={`Decrease ${line.name}`}
                            >
                              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                            </QtyButton>
                            <span className="w-10 text-center text-sm font-semibold tabular-nums">
                              {line.quantity}
                            </span>
                            <QtyButton
                              onClick={() =>
                                setQuantity(
                                  line.productId,
                                  line.quantity + (line.isWeighed ? 0.5 : 1),
                                  line.isWeighed,
                                )
                              }
                              label={`Increase ${line.name}`}
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </QtyButton>
                          </div>

                          <span className="text-sm font-bold tabular-nums text-gold">
                            {formatCurrency(totals.lineTotals[index])}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* --- Totals + checkout --- */}
                <div className="shrink-0 border-t border-border p-5">
                  {/* Free-delivery nudge: genuine information, and it disappears
                      the moment it is achieved. */}
                  {totals.amountToFreeDelivery > 0 && (
                    <p className="mb-3 flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">
                      <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Add {formatCurrency(totals.amountToFreeDelivery)} more for free delivery
                    </p>
                  )}

                  <dl className="space-y-1.5 text-sm">
                    <Row label="Subtotal" value={formatCurrency(totals.subtotal)} />
                    <Row
                      label="Delivery"
                      value={totals.delivery === 0 ? 'Free' : formatCurrency(totals.delivery)}
                      accent={totals.delivery === 0}
                    />
                    <Row
                      label={`${totals.taxLabel} (${(totals.taxRate * 100).toFixed(0)}%)`}
                      value={formatCurrency(totals.tax)}
                    />
                  </dl>

                  <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                    <span className="font-semibold">Total</span>
                    <span className="text-xl font-bold tabular-nums text-gold">
                      {formatCurrency(totals.total)}
                    </span>
                  </div>

                  <ClosedNote status={ordering} className="mt-4" />

                  <div className="mt-4 grid gap-2">
                    <Link to={ROUTES.CHECKOUT} onClick={closeCart}>
                      <Button fullWidth size="lg">
                        Proceed to Checkout
                      </Button>
                    </Link>
                    <Link to={ROUTES.CART} onClick={closeCart}>
                      <Button fullWidth variant="outline">
                        View Full Cart
                      </Button>
                    </Link>
                  </div>
                </div>
              </>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

function QtyButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-raised text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Row({ label, value, accent = false }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={accent ? 'font-semibold text-success' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

export default CartDrawer;
