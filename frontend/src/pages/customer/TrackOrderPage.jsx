import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, PackageSearch, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { ordersApi } from '@/features/orders/orders.api.js';
import { orderPath } from '@/constants/routes.js';
import { Seo } from '@/components/seo/Seo.jsx';

/**
 * Track order.
 * ---------------------------------------------------------------------------
 * A guest-accessible lookup by order number — deliberately not behind sign-in.
 * Most food orders are placed once, in a hurry, often as a guest; forcing an
 * account just to see "where is my food" is the wrong trade.
 *
 * A found order navigates to the confirmation page, which already renders the
 * full status timeline — so there is one implementation of "here is your order"
 * rather than a second, slightly different one here.
 */
export function TrackOrderPage() {
  const navigate = useNavigate();
  const [orderNumber, setOrderNumber] = useState('');
  const [error, setError] = useState(null);
  const [isSearching, setSearching] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const trimmed = orderNumber.trim().toUpperCase();
    /*
     * Six characters in the suffix, not four.
     *
     * The suffix was widened server-side (see generateOrderNumber — four
     * characters collided often enough to kill a checkout after payment), and
     * this check was left behind. The result was the worst kind of stale
     * validation: every real order number typed into this box was rejected
     * before any request was made, with a message confidently showing the old
     * format — so the customer concluded their own receipt was wrong.
     */
    if (!/^FB-\d{8}-[A-Z0-9]{6}$/.test(trimmed)) {
      setError('Order numbers look like FB-20260727-A1B2C3. Check your receipt or confirmation email.');
      return;
    }

    setSearching(true);
    try {
      // Verify it exists before navigating — sending the customer to a page
      // that then errors is a worse experience than telling them here.
      await ordersApi.byNumber(trimmed);
      navigate(orderPath(trimmed));
    } catch (err) {
      setError(
        err.status === 404
          ? `We couldn't find order ${trimmed}. Please check the number on your receipt.`
          : (err.message ?? 'Could not look up that order'),
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="container flex min-h-[60vh] items-center justify-center py-12">
      <Seo title="Track Your Order" description="Follow your order from kitchen to door." />
      <div className="w-full max-w-lg">
        <header className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/10">
            <PackageSearch className="h-7 w-7 text-gold" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Track Your Order</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the order number from your receipt or confirmation email.
          </p>
          <div className="mx-auto mt-4 h-px w-24 fb-gold-rule" />
        </header>

        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-panel"
          noValidate
        >
          <Input
            label="Order Number"
            placeholder="FB-20260727-A1B2C3"
            value={orderNumber}
            onChange={(event) => {
              setOrderNumber(event.target.value);
              setError(null);
            }}
            // Uppercase visually so the entered value matches the printed
            // format, without fighting the user's keyboard.
            className="uppercase tracking-wide"
            required
            autoFocus
          />

          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-sm text-warning">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            fullWidth
            size="lg"
            className="mt-5"
            leftIcon={Search}
            isLoading={isSearching}
            loadingText="Looking up…"
          >
            Track Order
          </Button>
        </form>
      </div>
    </div>
  );
}

export default TrackOrderPage;
