import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Package,
  Truck,
  XCircle,
  Copy,
  Check,
  AlertCircle,
  Landmark,
  Banknote,
  Star,
  MessageSquareHeart,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { ConfirmDialog } from '@/components/ui/Modal.jsx';
import { ReviewDialog } from '@/features/reviews/ReviewDialog.jsx';
import { QuickRate } from '@/components/customer/Testimonials.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { ordersApi } from '@/features/orders/orders.api.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { EVENTS, useRealtimeEvent, watchOrder } from '@/services/realtime.js';
import { formatCurrency, formatQuantity, formatDateTime } from '@/lib/format.js';
import { ROUTES } from '@/constants/routes.js';
import { fadeUp } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { Seo } from '@/components/seo/Seo.jsx';

/**
 * Order confirmation and tracking.
 * ---------------------------------------------------------------------------
 * Reachable by order number without signing in — the same page serves as the
 * post-checkout confirmation and as guest order tracking, so there is one
 * implementation of "here is your order" rather than two that drift.
 */

/** Lifecycle stages shown on the tracker, in order. */
const STAGES = [
  { key: 'pending', label: 'Placed', icon: Clock },
  { key: 'confirmed', label: 'Confirmed', icon: CheckCircle2 },
  { key: 'preparing', label: 'Preparing', icon: Package },
  { key: 'ready', label: 'Ready', icon: Package },
  { key: 'out_for_delivery', label: 'On the way', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2 },
];

const PAYMENT_LABEL = {
  cod: 'Cash on Delivery',
  bank_transfer: 'Bank Transfer',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
  card: 'Card',
};

const PAYMENT_BADGE = {
  paid: { variant: 'success', label: 'Paid' },
  pending: { variant: 'warning', label: 'Payment pending' },
  awaiting_verification: { variant: 'warning', label: 'Awaiting verification' },
  failed: { variant: 'destructive', label: 'Payment failed' },
  refunded: { variant: 'info', label: 'Refunded' },
};

export function OrderConfirmationPage() {
  const { orderNumber } = useParams();
  const {
    data: order,
    error,
    isLoading,
    reload,
  } = useResource(() => ordersApi.byNumber(orderNumber), [orderNumber]);

  /*
   * Live status. The page asks the server to send this order's changes to this
   * browser (only the status word travels — see backend realtime.js), then
   * re-reads the order through the normal API when one arrives. "Preparing",
   * "Ready", "On the way" appear without the customer refreshing.
   */
  useEffect(() => watchOrder(orderNumber), [orderNumber]);
  useRealtimeEvent('guest', EVENTS.ORDER_CHANGED, (event) => {
    if (event?.orderNumber && event.orderNumber.toUpperCase() === String(orderNumber).toUpperCase()) reload();
  });

  const { isAuthenticated } = useAuth();
  const [isCancelOpen, setCancelOpen] = useState(false);
  const [isCancelling, setCancelling] = useState(false);
  const [cancelPhone, setCancelPhone] = useState('');
  const [cancelError, setCancelError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Which item the review dialog is open for, and which have been reviewed in
  // this session. Tracked locally because reviews stay hidden until moderated —
  // re-fetching the order would not tell us they exist.
  const [reviewing, setReviewing] = useState(null);
  const [reviewed, setReviewed] = useState(() => new Set());

  if (isLoading && !order) return <SectionLoader label="Loading your order" />;

  if (error) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
        <h1 className="text-xl font-semibold">We couldn&apos;t find that order</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{error.message}</p>
        <Link to={ROUTES.TRACK_ORDER}>
          <Button className="mt-2">Try another order number</Button>
        </Link>
      </div>
    );
  }

  const isCancelled = order.status === 'cancelled';
  const currentStage = STAGES.findIndex((s) => s.key === order.status);
  const payment = PAYMENT_BADGE[order.paymentStatus] ?? { variant: 'default', label: order.paymentStatus };
  const canCancel = ['pending', 'confirmed'].includes(order.status);
  // See the note beside the field itself, in the dialog below.
  const needsPhoneToCancel = !order.customer;

  /**
   * Reviewing needs an account (the server ties the review to a customer id)
   * and a delivered order. Guests who tracked by number alone see nothing —
   * showing a button that always errors is worse than showing no button.
   */
  const canReview = isAuthenticated && ['delivered', 'completed'].includes(order.status);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(order.orderNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked — the number is visible on screen regardless. */
    }
  }

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      await ordersApi.cancel(order.orderNumber, { phone: cancelPhone });
      reload();
      setCancelOpen(false);
      setCancelPhone('');
    } catch (err) {
      /*
       * Shown rather than swallowed. A guest who mistypes their number is the
       * most likely person to land here, and a dialog that simply stays open
       * with no explanation reads as a broken button.
       */
      setCancelError(err.message ?? 'We could not cancel this order. Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="container max-w-3xl py-10">
      {/* --- Header --- */}
      <motion.header {...fadeUp} className="text-center">
        <span
          className={cn(
            'mx-auto flex h-16 w-16 items-center justify-center rounded-full',
            isCancelled ? 'bg-destructive/15' : 'bg-success/15',
          )}
        >
          {isCancelled ? (
            <XCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
          )}
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          {isCancelled ? 'Order cancelled' : 'Thank you for your order!'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isCancelled
            ? 'This order was cancelled and the items have been returned to stock.'
            : 'We have received your order and will start preparing it shortly.'}
        </p>

        <button
          type="button"
          onClick={copyNumber}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface px-3.5 py-2 font-mono text-sm transition-colors hover:border-gold"
        >
          {order.orderNumber}
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="sr-only">Copy order number</span>
        </button>
      </motion.header>

      {/* --- Tracker --- */}
      {!isCancelled && (
        <motion.ol
          {...fadeUp}
          className="mt-8 flex items-start justify-between gap-1"
          aria-label="Order progress"
        >
          {STAGES.map((stage, index) => {
            const reached = index <= currentStage;
            const Icon = stage.icon;

            return (
              <li key={stage.key} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                <div className="flex w-full items-center">
                  {/* Connector lines fill only up to the reached stage, so the
                      bar itself communicates progress at a glance. */}
                  <span
                    className={cn(
                      'h-0.5 flex-1',
                      index === 0 ? 'bg-transparent' : reached ? 'bg-gold' : 'bg-border',
                    )}
                  />
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      reached
                        ? 'bg-gold-gradient text-gold-foreground'
                        : 'bg-surface-hover text-muted-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span
                    className={cn(
                      'h-0.5 flex-1',
                      index === STAGES.length - 1
                        ? 'bg-transparent'
                        : index < currentStage
                          ? 'bg-gold'
                          : 'bg-border',
                    )}
                  />
                </div>
                <span
                  className={cn(
                    'text-[10px] sm:text-xs',
                    reached ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {stage.label}
                </span>
              </li>
            );
          })}
        </motion.ol>
      )}

      {/* --- Payment state --- */}
      <motion.div {...fadeUp} className="mt-8 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {order.paymentMethod === 'bank_transfer' ? (
              <Landmark className="h-5 w-5 text-gold" aria-hidden="true" />
            ) : (
              <Banknote className="h-5 w-5 text-gold" aria-hidden="true" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}
              </p>
              <p className="text-xs text-muted-foreground">Placed {formatDateTime(order.createdAt)}</p>
            </div>
          </div>
          <Badge variant={payment.variant}>{payment.label}</Badge>
        </div>

        {/* Method-specific next step. A confirmation that doesn't say what to do
            next is where "is my order actually going to arrive?" comes from. */}
        {order.paymentStatus === 'awaiting_verification' && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
            Please complete your bank transfer using <strong>{order.orderNumber}</strong> as the reference. We
            will confirm your order as soon as the transfer is verified.
          </p>
        )}
        {order.paymentMethod === 'cod' && order.paymentStatus === 'pending' && !isCancelled && (
          <p className="mt-3 rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-muted-foreground">
            Please keep <strong className="text-foreground">{formatCurrency(order.total)}</strong> ready — our
            rider will collect it on delivery.
          </p>
        )}
      </motion.div>

      {/* --- Items --- */}
      <motion.section {...fadeUp} className="mt-5 rounded-2xl border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3 font-semibold">Order Details</h2>

        <ul className="divide-y divide-border">
          {order.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatQuantity(item.quantity, item.unit)} × {formatCurrency(item.unitPrice)}
                </p>

                {/* Rate this dish — only once the food has actually arrived. */}
                {canReview &&
                  item.product &&
                  (reviewed.has(String(item.product)) ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs text-success">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Review sent
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReviewing(item)}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gold transition-opacity hover:opacity-80"
                    >
                      <Star className="h-3 w-3" aria-hidden="true" />
                      Rate this item
                    </button>
                  ))}
              </div>
              <span className="shrink-0 text-sm tabular-nums">{formatCurrency(item.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <dl className="space-y-1.5 border-t border-border px-5 py-4 text-sm">
          <Row label="Subtotal" value={formatCurrency(order.subtotal)} />
          <Row
            label="Delivery"
            value={order.deliveryFee === 0 ? 'Free' : formatCurrency(order.deliveryFee)}
            accent={order.deliveryFee === 0}
          />
          <Row label={`GST (${(order.taxRate * 100).toFixed(0)}%)`} value={formatCurrency(order.tax)} />
        </dl>

        <div className="flex items-baseline justify-between border-t border-border px-5 py-4">
          <span className="font-semibold">Total</span>
          <span className="text-xl font-bold tabular-nums text-gold">{formatCurrency(order.total)}</span>
        </div>
      </motion.section>

      {/* --- Delivery address --- */}
      {order.deliveryAddress && (
        <motion.section {...fadeUp} className="mt-5 rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-semibold">Delivering To</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {order.customerName} · {order.customerPhone}
            <br />
            {order.deliveryAddress.line1}
            {order.deliveryAddress.area ? `, ${order.deliveryAddress.area}` : ''}
            <br />
            {order.deliveryAddress.city}
          </p>
          {order.deliveryAddress.notes && (
            <p className="mt-2 text-xs italic text-muted-foreground">“{order.deliveryAddress.notes}”</p>
          )}
        </motion.section>
      )}

      {/* --- How was it? Once the food has arrived. --- */}
      {['delivered', 'completed'].includes(order.status) && (
        <motion.section
          {...fadeUp}
          className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-gold/30 bg-gold/5 p-5"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold/15 text-gold">
            <MessageSquareHeart className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">How was your order?</h2>
            <p className="text-sm text-muted-foreground">
              Tap a star — it takes ten seconds, and the owner reads every word.
            </p>
          </div>
          <QuickRate label="Rate it" orderNumber={order.orderNumber} />
        </motion.section>
      )}

      {/* --- Actions --- */}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to={ROUTES.MENU}>
          <Button variant="outline">Order Again</Button>
        </Link>
        {canCancel && (
          <Button variant="destructive" onClick={() => setCancelOpen(true)}>
            Cancel Order
          </Button>
        )}
      </div>

      <ConfirmDialog
        isOpen={isCancelOpen}
        onClose={() => {
          setCancelOpen(false);
          setCancelError(null);
        }}
        onConfirm={cancel}
        isLoading={isCancelling}
        title="Cancel this order?"
        message="The items will be returned to stock. Once we start preparing your food, cancelling online is no longer possible."
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep my order"
      >
        {/*
          A guest order needs its phone number to cancel.

          `order.customer` is present only when the viewer is the signed-in
          customer who placed it — the server proves ownership from the session
          then, and omits the field for everyone else. So its absence is exactly
          the case where the order number alone must not be enough: a receipt
          left on a table would otherwise let a stranger cancel someone's dinner.
        */}
        {needsPhoneToCancel && (
          <div className="mt-4">
            <Input
              label="Mobile number on this order"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="03XXXXXXXXX"
              value={cancelPhone}
              onChange={(event) => {
                setCancelPhone(event.target.value);
                setCancelError(null);
              }}
            />
          </div>
        )}

        {cancelError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {cancelError}
          </p>
        )}
      </ConfirmDialog>

      {reviewing && (
        <ReviewDialog
          isOpen
          item={reviewing}
          orderNumber={order.orderNumber}
          onClose={() => setReviewing(null)}
          onSubmitted={(productId) => setReviewed((prev) => new Set(prev).add(String(productId)))}
        />
      )}
    </div>
  );
}

function Row({ label, value, accent = false }) {
  return (
    <div className="flex items-center justify-between">
      <Seo title="Order Confirmed" noindex />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={accent ? 'font-semibold text-success' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

export default OrderConfirmationPage;
