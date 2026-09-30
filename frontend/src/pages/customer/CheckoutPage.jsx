import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  MapPin,
  Wallet,
  Check,
  ChevronLeft,
  ShoppingCart,
  AlertCircle,
  Banknote,
  Smartphone,
  Landmark,
  Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, Textarea, Select } from '@/components/ui/Input.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { useCart } from '@/features/cart/cartContext.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { ordersApi } from '@/features/orders/orders.api.js';
import { formatCurrency, formatQuantity } from '@/lib/format.js';
import { ROUTES, orderPath } from '@/constants/routes.js';
import { fadeUp, prefersReducedMotion } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { Seo } from '@/components/seo/Seo.jsx';
import { useOrderingStatus, useOrderingStore } from '@/features/site/orderingStatus.js';
import { ClosedDialog, ClosedPanel } from '@/components/customer/ShopClosed.jsx';

/**
 * Checkout.
 * ---------------------------------------------------------------------------
 * Three steps — details, address, payment — with a server-priced summary
 * alongside. Guest checkout is supported: forcing account creation before
 * someone can buy dinner is the biggest avoidable drop-off in this flow.
 *
 * Opening hours: outside the owner's hours the page says so first — with when
 * ordering opens — and "Place order" waits. If the clock passes closing time
 * while someone is typing, the server refuses the order (SHOP_CLOSED) and the
 * same message opens as a dialog; nothing is charged or held.
 *
 * The totals shown here come from the server, not from the local cart. The
 * local figures are fine for a drawer badge, but the number a customer agrees
 * to pay must be the number the server will charge — otherwise a stale price
 * produces a confirmation that disagrees with the receipt.
 */

const STEPS = [
  { key: 'details', label: 'Your Details', icon: User },
  { key: 'address', label: 'Delivery', icon: MapPin },
  { key: 'payment', label: 'Payment', icon: Wallet },
];

const METHOD_ICON = { banknote: Banknote, smartphone: Smartphone, landmark: Landmark, wallet: Wallet };

export function CheckoutPage() {
  const { lines, isEmpty, clear } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const reduceMotion = prefersReducedMotion();
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [isPlacing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const ordering = useOrderingStatus();
  const refreshOrdering = useOrderingStore((s) => s.refresh);
  const isClosed = Boolean(ordering && !ordering.canOrder);
  // The status the server gave when it refused, shown in the dialog.
  const [refusal, setRefusal] = useState(null);

  const [form, setForm] = useState(() => ({
    name: user?.fullName ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    line1: '',
    area: '',
    city: 'Mardan',
    notes: '',
    paymentMethod: '',
    bankCode: '',
  }));

  /*
   * Guards the empty-cart redirect.
   *
   * Placing an order clears the cart, which would instantly satisfy "cart is
   * empty" and bounce the customer back to /cart before the confirmation
   * navigation commits. A ref is synchronous, so it wins that race; state
   * would not.
   */
  const orderPlacedRef = useRef(false);

  const update = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  // --- Server pricing ------------------------------------------------------
  const refreshQuote = useCallback(async () => {
    if (lines.length === 0) return;
    try {
      const result = await ordersApi.quote(lines);
      setQuote(result);
      setQuoteError(null);
      // Default to the first available method so payment isn't a blank step.
      setForm((prev) =>
        prev.paymentMethod
          ? prev
          : { ...prev, paymentMethod: result.paymentMethods.find((m) => m.isAvailable)?.method ?? '' },
      );
    } catch (error) {
      setQuoteError(error.message ?? 'Could not price your cart');
    }
  }, [lines]);

  useEffect(() => {
    refreshQuote();
  }, [refreshQuote]);

  if (isEmpty && !orderPlacedRef.current) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <ShoppingCart className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Your cart is empty</h1>
        <p className="text-sm text-muted-foreground">Add something from the menu to check out.</p>
        <Link to={ROUTES.MENU}>
          <Button className="mt-2">Browse the Menu</Button>
        </Link>
      </div>
    );
  }

  // --- Per-step validation -------------------------------------------------
  function validateStep(index) {
    const errors = {};
    if (index === 0) {
      if (form.name.trim().length < 2) errors.name = 'Enter your full name';
      if (!/^03\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) {
        errors.phone = 'Enter a valid mobile number (03XXXXXXXXX)';
      }
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        errors.email = 'Enter a valid email address';
      }
    }
    if (index === 1) {
      if (form.line1.trim().length < 4) errors.line1 = 'Enter your street address';
      if (form.city.trim().length < 2) errors.city = 'Enter your city';
    }
    if (index === 2) {
      if (!form.paymentMethod) errors.paymentMethod = 'Choose how you would like to pay';
      const method = quote?.paymentMethods.find((m) => m.method === form.paymentMethod);
      if (method?.method === 'bank_transfer' && !form.bankCode) {
        errors.bankCode = 'Select the bank you will transfer from';
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function next() {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function placeOrder() {
    if (!validateStep(2)) return;
    if (isClosed) {
      setRefusal(ordering);
      return;
    }

    setPlacing(true);
    setPlaceError(null);

    try {
      const result = await ordersApi.place({
        items: lines,
        customer: { name: form.name, phone: form.phone, email: form.email || undefined },
        deliveryAddress: {
          line1: form.line1,
          area: form.area || undefined,
          city: form.city,
          notes: form.notes || undefined,
        },
        paymentMethod: form.paymentMethod,
        bankCode: form.bankCode || undefined,
      });

      orderPlacedRef.current = true;

      // Gateway methods hand the customer to the provider via a form POST.
      // The fields are already signed server-side; the browser just carries them.
      if (result.payment?.method === 'POST' && result.payment.endpoint) {
        submitGatewayForm(result.payment.endpoint, result.payment.fields);
        return;
      }

      clear();
      navigate(orderPath(result.order.orderNumber), { replace: true });
    } catch (error) {
      // Closed while they were filling in the form: the friendly message, not a red error.
      if (error.code === 'SHOP_CLOSED') {
        const detail = Array.isArray(error.details) ? error.details[0] : null;
        setRefusal({ ...(ordering ?? {}), ...(detail ?? {}), canOrder: false });
        refreshOrdering();
        return;
      }
      if (Array.isArray(error.details)) {
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
      }
      setPlaceError(error.message ?? 'Could not place your order');
      // A stock or price change invalidates the quote — refresh so the customer
      // sees the corrected figures rather than the stale ones they agreed to.
      refreshQuote();
    } finally {
      setPlacing(false);
    }
  }

  const selectedMethod = quote?.paymentMethods.find((m) => m.method === form.paymentMethod);

  return (
    <div className="container py-10">
      <ClosedDialog isOpen={Boolean(refusal)} status={refusal} onClose={() => setRefusal(null)} />

      {isClosed && <ClosedPanel status={ordering} compact className="mb-8" />}

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
        <p className="text-sm text-muted-foreground">
          {user ? `Signed in as ${user.fullName}` : 'No account needed — order as a guest.'}
        </p>
      </header>

      {/* --- Progress --- */}
      <ol className="mb-6 flex items-center gap-2" aria-label="Checkout progress">
        {STEPS.map((s, index) => {
          const state = index < step ? 'done' : index === step ? 'current' : 'upcoming';
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                // Only completed steps are re-enterable — jumping forward would
                // skip validation the later step depends on.
                onClick={() => index < step && setStep(index)}
                disabled={index > step}
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                  state === 'current' && 'font-semibold text-gold',
                  state === 'done' && 'text-foreground hover:bg-surface-hover',
                  state === 'upcoming' && 'cursor-not-allowed text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    state === 'done' && 'bg-success text-success-foreground',
                    state === 'current' && 'bg-gold-gradient text-gold-foreground',
                    state === 'upcoming' && 'bg-surface-hover text-muted-foreground',
                  )}
                >
                  {state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {index < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ================= Steps ================= */}
        <div className="rounded-2xl border border-border bg-surface p-6">
          {/*
            `duration: 0` under reduced motion, matching Modal.jsx.
            ---------------------------------------------------------------
            Framer animates inline styles, which the reduced-motion media
            query in index.css cannot reach — so JS-driven motion has to check
            the preference itself. This screen was not doing so, meaning a
            visitor who has asked for less movement still got the full slide.

            It also removes a real fragility. `mode="wait"` mounts the next
            step at `initial` (opacity 0) and only reveals it once the
            animation completes; if frames never arrive — a backgrounded tab,
            a device under load — the customer is left looking at an empty
            panel on the checkout, with their basket priced and nothing to
            click. A zero-duration transition settles on the final value
            immediately instead of waiting for an animation frame.
          */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              {...fadeUp}
              transition={reduceMotion ? { duration: 0 } : fadeUp.transition}
            >
              {step === 0 && (
                <div className="space-y-4">
                  <StepHeading icon={User} title="Your Details" hint="So we can reach you about the order." />
                  <Input
                    label="Full Name"
                    value={form.name}
                    onChange={update('name')}
                    error={fieldErrors.name}
                    required
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Mobile Number"
                      placeholder="03XX XXXXXXX"
                      value={form.phone}
                      onChange={update('phone')}
                      error={fieldErrors.phone}
                      required
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={form.email}
                      onChange={update('email')}
                      error={fieldErrors.email}
                      hint="Optional — for your receipt."
                    />
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-4">
                  <StepHeading icon={MapPin} title="Delivery Address" hint="Where should we bring it?" />
                  <Input
                    label="Street Address"
                    placeholder="House 12, Street 4"
                    value={form.line1}
                    onChange={update('line1')}
                    error={fieldErrors.line1}
                    required
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Area"
                      placeholder="Chota Chowk"
                      value={form.area}
                      onChange={update('area')}
                    />
                    <Input
                      label="City"
                      value={form.city}
                      onChange={update('city')}
                      error={fieldErrors.city}
                      required
                    />
                  </div>
                  <Textarea
                    label="Delivery Notes"
                    rows={2}
                    placeholder="Landmark, gate code, or anything else that helps us find you."
                    value={form.notes}
                    onChange={update('notes')}
                  />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <StepHeading icon={Wallet} title="Payment Method" hint="Choose how you'd like to pay." />

                  {fieldErrors.paymentMethod && (
                    <p role="alert" className="text-sm text-destructive">
                      {fieldErrors.paymentMethod}
                    </p>
                  )}

                  <div className="grid gap-3">
                    {quote?.paymentMethods.map((method) => {
                      const Icon = METHOD_ICON[method.icon] ?? Wallet;
                      const isSelected = form.paymentMethod === method.method;

                      return (
                        <label
                          key={method.method}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all',
                            !method.isAvailable && 'cursor-not-allowed opacity-50',
                            isSelected
                              ? 'border-gold bg-gold/5 shadow-gold'
                              : 'border-border-strong hover:border-gold/50',
                          )}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value={method.method}
                            checked={isSelected}
                            disabled={!method.isAvailable}
                            onChange={update('paymentMethod')}
                            className="mt-1 h-4 w-4 accent-gold"
                          />
                          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">{method.label}</span>
                              {/* Sandbox is surfaced, never hidden — a test
                                  payment mistaken for a real one is worse. */}
                              {method.mode === 'sandbox' && (
                                <Badge variant="warning" size="sm">
                                  Test mode
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {method.unavailableReason ?? method.description}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {/* --- Bank picker, only for bank transfer --- */}
                  {selectedMethod?.method === 'bank_transfer' && (
                    <motion.div {...fadeUp} className="rounded-xl border border-border bg-background p-4">
                      <Select
                        label="Select Your Bank"
                        placeholder="Choose the bank you will transfer from"
                        value={form.bankCode}
                        onChange={update('bankCode')}
                        error={fieldErrors.bankCode}
                        required
                      >
                        {selectedMethod.banks?.map((bank) => (
                          <option key={bank.code} value={bank.code}>
                            {bank.name}
                          </option>
                        ))}
                      </Select>

                      {selectedMethod.account && (
                        <div className="mt-4 space-y-1 rounded-lg bg-surface p-3 text-sm">
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gold">
                            Transfer to
                          </p>
                          <AccountRow label="Bank" value={selectedMethod.account.bankName} />
                          <AccountRow label="Title" value={selectedMethod.account.accountTitle} />
                          <AccountRow label="Account" value={selectedMethod.account.accountNumber} mono />
                          <AccountRow label="IBAN" value={selectedMethod.account.iban} mono />
                          <p className="pt-2 text-xs text-muted-foreground">
                            Use your order number as the payment reference. We verify transfers within a few
                            hours during business time.
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {placeError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                      <p className="text-sm text-destructive">{placeError}</p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* --- Navigation --- */}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
            {step > 0 ? (
              <Button variant="ghost" leftIcon={ChevronLeft} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : (
              <Link to={ROUTES.MENU}>
                <Button variant="ghost" leftIcon={ChevronLeft}>
                  Keep Shopping
                </Button>
              </Link>
            )}

            {step < STEPS.length - 1 ? (
              <Button onClick={next}>Continue</Button>
            ) : (
              <Button
                size="lg"
                onClick={placeOrder}
                isLoading={isPlacing}
                loadingText="Placing order…"
                disabled={isClosed}
                title={isClosed ? 'We are closed right now' : undefined}
              >
                {isClosed
                  ? ordering.opensAtText
                    ? `Ordering opens ${ordering.opensAtText}`
                    : 'Ordering is paused'
                  : `Place Order · ${formatCurrency(quote?.total ?? 0)}`}
              </Button>
            )}
          </div>
        </div>

        {/* ================= Summary ================= */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-border bg-surface">
            <h2 className="border-b border-border px-5 py-3 font-semibold">Order Summary</h2>

            {quoteError ? (
              <p className="px-5 py-6 text-sm text-destructive">{quoteError}</p>
            ) : !quote ? (
              <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Pricing your order…
              </div>
            ) : (
              <>
                <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                  {quote.items.map((item) => (
                    <li key={item.product} className="flex items-start gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatQuantity(item.quantity, item.unit)} × {formatCurrency(item.unitPrice)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums">{formatCurrency(item.lineTotal)}</span>
                    </li>
                  ))}
                </ul>

                <dl className="space-y-1.5 border-t border-border px-5 py-4 text-sm">
                  <SummaryRow label="Subtotal" value={formatCurrency(quote.subtotal)} />
                  <SummaryRow
                    label="Delivery"
                    value={quote.deliveryFee === 0 ? 'Free' : formatCurrency(quote.deliveryFee)}
                    accent={quote.deliveryFee === 0}
                  />
                  <SummaryRow
                    label={`GST (${(quote.taxRate * 100).toFixed(0)}%)`}
                    value={formatCurrency(quote.tax)}
                  />
                </dl>

                <div className="flex items-baseline justify-between border-t border-border px-5 py-4">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-bold tabular-nums text-gold">
                    {formatCurrency(quote.total)}
                  </span>
                </div>
              </>
            )}
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Prices are confirmed by our server at checkout.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Hand the customer to a payment gateway.
 *
 * Hosted checkouts (JazzCash, EasyPaisa) are form POSTs, not JSON APIs, so the
 * browser has to do the navigating. The fields are already signed server-side —
 * this only carries them, and any tampering breaks the signature the gateway
 * checks on arrival.
 */
function submitGatewayForm(endpoint, fields) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = endpoint;
  form.style.display = 'none';

  for (const [name, value] of Object.entries(fields ?? {})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = String(value ?? '');
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

function StepHeading({ icon: Icon, title, hint }) {
  return (
    <div className="mb-2 flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/10">
        <Icon className="h-4.5 w-4.5 text-gold" aria-hidden="true" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, accent = false }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={accent ? 'font-semibold text-success' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

function AccountRow({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-3">
      <Seo title="Checkout" noindex />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-right', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}

export default CheckoutPage;
