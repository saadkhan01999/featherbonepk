import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CreditCard, Smartphone, AlertCircle, QrCode } from 'lucide-react';

import { Modal } from '@/components/ui/Modal.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { formatCurrency } from '@/lib/format.js';
import { mediaUrl } from '@/lib/media.js';
import { cn } from '@/lib/utils.js';

/**
 * Take payment at the till.
 * ---------------------------------------------------------------------------
 * Built for speed on a touch screen: large targets, quick-cash buttons for the
 * notes a cashier actually handles, and change computed as they type.
 *
 * The change figure here is a convenience for the person at the counter. The
 * server recomputes it from its own total when the sale is recorded, because
 * the till's arithmetic is not what the ledger is built on.
 */

/*
 * Only what the counter can actually take today: cash, card, and JazzCash via
 * the QR poster. EasyPaisa is built but not enabled — offering a button for a
 * wallet nobody can reconcile takes real money into a black hole.
 */
const METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'jazzcash', label: 'JazzCash', icon: Smartphone },
  { value: 'card', label: 'Card', icon: CreditCard },
];

/** The notes in circulation, so the common case is one tap. Owner-editable in Settings → POS. */
const DEFAULT_QUICK_CASH = [500, 1000, 2000, 5000];

/**
 * @param {string}   [title]     "Take Payment", or "Pay ticket #42" for an open tab
 * @param {string}   [context]   one line under the amount — order type, table, customer
 * @param {number[]} [quickCash] note buttons, from Settings → POS
 */
export function PaymentModal({
  isOpen,
  onClose,
  total,
  onConfirm,
  isSaving,
  error,
  counterPayments,
  title = 'Take Payment',
  context,
  quickCash = DEFAULT_QUICK_CASH,
}) {
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const cashRef = useRef(null);

  // Reset per sale — carrying the last customer's tendered amount into the next
  // bill is how a drawer ends the day short.
  useEffect(() => {
    if (isOpen) {
      setMethod('cash');
      setTendered('');
      requestAnimationFrame(() => cashRef.current?.focus());
    }
  }, [isOpen]);

  const tenderedValue = Number(tendered) || 0;
  const change = useMemo(() => Math.max(0, tenderedValue - total), [tenderedValue, total]);
  const isShort = method === 'cash' && tendered !== '' && tenderedValue < total;

  // Cash requires an amount; the other methods settle for the exact total.
  const canConfirm = method !== 'cash' || (tendered !== '' && !isShort);

  function confirm(event) {
    event.preventDefault();
    if (!canConfirm || isSaving) return;
    onConfirm({ paymentMethod: method, ...(method === 'cash' && { tendered: tenderedValue }) });
  }

  /** Exact money — the second most common case after a round note. */
  function payExact() {
    setTendered(String(total));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <form onSubmit={confirm} className="space-y-4">
        {/* --- Amount due --- */}
        <div className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Total Payable</p>
          <p className="text-3xl font-bold tabular-nums text-gold">{formatCurrency(total)}</p>
          {context && <p className="mt-1 text-xs font-medium text-muted-foreground">{context}</p>}
        </div>

        {/* --- Method --- */}
        <div>
          <p className="mb-2 text-sm font-medium">Payment method</p>
          <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2">
            {METHODS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={method === option.value}
                onClick={() => setMethod(option.value)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3.5 text-sm font-semibold transition-colors',
                  method === option.value
                    ? 'border-gold bg-gold/10 text-gold'
                    : 'border-border-strong text-muted-foreground hover:border-gold/40 hover:text-foreground',
                )}
              >
                <option.icon className="h-4 w-4" aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* --- JazzCash QR ---
            The customer scans the poster QR and pays from their wallet. There
            is no callback into this system, so the cashier confirms receipt —
            which is why the button below says "Confirm Payment Received"
            rather than implying the gateway verified anything. */}
        {method === 'jazzcash' && (
          <div className="space-y-3 rounded-xl border border-border-strong bg-surface-hover p-4">
            {counterPayments?.jazzcashQrImage ? (
              <img
                src={mediaUrl(counterPayments.jazzcashQrImage)}
                alt="JazzCash QR code"
                className="mx-auto h-44 w-44 rounded-lg bg-white object-contain p-2"
              />
            ) : (
              <div className="mx-auto flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-center">
                <QrCode className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="px-3 text-[11px] text-muted-foreground">
                  Upload your QR in Settings → Counter Payments
                </p>
              </div>
            )}

            {counterPayments?.jazzcashTillId && (
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Till ID</p>
                {/* Spaced digits: a cashier reads this aloud to a customer who
                    is typing it into a phone. */}
                <p className="font-mono text-xl font-bold tracking-[0.25em] text-gold">
                  {counterPayments.jazzcashTillId}
                </p>
                {counterPayments.jazzcashUssd && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Or dial {counterPayments.jazzcashUssd} and enter the Till ID
                  </p>
                )}
              </div>
            )}

            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              Confirm the payment landed in your JazzCash app before completing the sale. This is not verified
              automatically.
            </p>
          </div>
        )}

        {/* --- Cash handling --- */}
        {method === 'cash' && (
          <div className="space-y-2.5">
            <label htmlFor="pos-tendered" className="text-sm font-medium">
              Cash received
            </label>
            <input
              id="pos-tendered"
              ref={cashRef}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
              placeholder="0"
              className={cn(
                'h-14 w-full rounded-xl border-2 bg-surface px-4 text-2xl font-bold tabular-nums focus:outline-none',
                isShort ? 'border-destructive text-destructive' : 'border-border-strong focus:border-gold',
              )}
            />

            {/*
              Three across on a phone, five from `sm` up.
              -----------------------------------------------------------------
              Five columns inside a modal on a 375px screen leaves each note
              about 55px wide and 32px tall — under the ~44px a fingertip needs,
              on the one control a cashier hits fastest and with a customer
              waiting. Fewer, larger targets are the right trade on a small
              screen; the full row returns as soon as there is room for it.
            */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {quickCash.map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => setTendered(String(note))}
                  className="min-h-11 rounded-lg border border-border-strong px-1 text-xs font-semibold tabular-nums transition-colors hover:border-gold hover:text-gold"
                >
                  {note.toLocaleString('en-PK')}
                </button>
              ))}
              <button
                type="button"
                onClick={payExact}
                className="min-h-11 rounded-lg border border-gold/50 px-1 text-xs font-semibold text-gold transition-colors hover:bg-gold/10"
              >
                Exact
              </button>
            </div>

            {/* Change: the number the cashier reads out loud. Big, and only
                shown once it is actually meaningful. */}
            {tendered !== '' && !isShort && (
              <div className="flex items-baseline justify-between rounded-xl bg-surface-hover px-4 py-3">
                <span className="text-sm font-medium">Change due</span>
                <span className="text-2xl font-bold tabular-nums text-success">{formatCurrency(change)}</span>
              </div>
            )}

            {isShort && (
              <p role="alert" className="text-sm text-destructive">
                Short by {formatCurrency(total - tenderedValue)}
              </p>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="lg"
            variant="success"
            className="flex-[2]"
            disabled={!canConfirm}
            isLoading={isSaving}
            loadingText="Recording…"
          >
            {method === 'jazzcash' ? 'Confirm Payment Received' : 'Complete Sale'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default PaymentModal;
