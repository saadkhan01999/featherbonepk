import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Minus, Trash2, ShoppingCart, ArrowRight, Truck } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { ConfirmDialog } from '@/components/ui/Modal.jsx';
import { useCart } from '@/features/cart/cartContext.jsx';
import { formatCurrency, formatQuantity } from '@/lib/format.js';
import { ROUTES } from '@/constants/routes.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { mediaUrl } from '@/lib/media.js';
import { Seo } from '@/components/seo/Seo.jsx';
import { useOrderingStatus } from '@/features/site/orderingStatus.js';
import { ClosedNote } from '@/components/customer/ShopClosed.jsx';

/**
 * Full cart page — the "Take Order" screen from the reference design.
 * ---------------------------------------------------------------------------
 * The drawer covers quick edits; this page is for reviewing a large order
 * comfortably before checkout.
 */
export function CartPage() {
  const ordering = useOrderingStatus();
  const { lines, totals, isEmpty, setQuantity, removeItem, clear } = useCart();
  // Emptying a basket is not undoable and the button sits next to the quantity
  // controls, so a mis-tap costs the whole order.
  const [confirmClear, setConfirmClear] = useState(false);

  if (isEmpty) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-hover">
          <ShoppingCart className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold">Your cart is empty</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Browse the menu and add something — your order will appear here.
        </p>
        <Link to={ROUTES.MENU}>
          <Button className="mt-2">Browse the Menu</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your Order</h1>
          <p className="text-sm text-muted-foreground">
            {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} ready to go.
          </p>
        </div>
        <Button variant="ghost" size="sm" leftIcon={Trash2} onClick={() => setConfirmClear(true)}>
          Clear cart
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* --- Lines --- */}
        <motion.ul
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface"
        >
          {lines.map((line, index) => (
            <motion.li key={line.productId} variants={staggerItem} className="flex gap-4 p-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-hover">
                {line.image && (
                  <img
                    src={mediaUrl(line.image)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium">{line.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {formatCurrency(line.unitPrice)} per {line.unitLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(line.productId)}
                    aria-label={`Remove ${line.name}`}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <StepButton
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
                    </StepButton>

                    <span className="min-w-[68px] text-center text-sm font-semibold tabular-nums">
                      {formatQuantity(line.quantity, line.unit)}
                    </span>

                    <StepButton
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
                    </StepButton>
                  </div>

                  <span className="text-lg font-bold tabular-nums text-gold">
                    {formatCurrency(totals.lineTotals[index])}
                  </span>
                </div>
              </div>
            </motion.li>
          ))}
        </motion.ul>

        {/* --- Summary --- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-semibold">Summary</h2>

            {totals.amountToFreeDelivery > 0 && (
              <p className="mt-3 flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">
                <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Add {formatCurrency(totals.amountToFreeDelivery)} more for free delivery
              </p>
            )}

            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Subtotal" value={formatCurrency(totals.subtotal)} />
              <Row
                label="Delivery Charges"
                value={totals.delivery === 0 ? 'Free' : formatCurrency(totals.delivery)}
                accent={totals.delivery === 0}
              />
              <Row
                label={`${totals.taxLabel} (${(totals.taxRate * 100).toFixed(0)}%)`}
                value={formatCurrency(totals.tax)}
              />
            </dl>

            <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
              <span className="font-semibold">Total Amount</span>
              <span className="text-2xl font-bold tabular-nums text-gold">
                {formatCurrency(totals.total)}
              </span>
            </div>

            <ClosedNote status={ordering} className="mt-5" />

            <div className="mt-5 grid gap-2">
              <Link to={ROUTES.CHECKOUT}>
                <Button fullWidth size="lg" rightIcon={ArrowRight}>
                  Proceed to Checkout
                </Button>
              </Link>
              <Link to={ROUTES.MENU}>
                <Button fullWidth variant="outline">
                  Add More Items
                </Button>
              </Link>
            </div>

            {/* Set expectations before checkout rather than after. */}
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Final totals are confirmed by our server at checkout.
            </p>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        isOpen={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear();
          setConfirmClear(false);
        }}
        title="Empty your basket?"
        message={`This removes all ${lines.length} item${lines.length === 1 ? '' : 's'}. It cannot be undone.`}
        confirmLabel="Empty basket"
      />
    </div>
  );
}

function StepButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-raised text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Row({ label, value, accent = false }) {
  return (
    <div className="flex items-center justify-between">
      <Seo title="Your Cart" noindex />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={accent ? 'font-semibold text-success' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

export default CartPage;
