import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Moon, ShoppingBag, Sparkles, X } from 'lucide-react';

import { Modal } from '@/components/ui/Modal.jsx';
import { timeUntil } from '@/features/site/orderingStatus.js';
import { ROUTES } from '@/constants/routes.js';
import { useNow } from '@/lib/useNow.js';
import { cn } from '@/lib/utils.js';

/**
 * "We're closed" — the storefront side of the opening hours.
 * ---------------------------------------------------------------------------
 *   ClosedBanner  a slim strip under the menu bar on every page while closed
 *   ClosedPanel   the full message: the owner's words, when ordering opens
 *                 (with a countdown), the week's hours, and a way to carry on
 *   ClosedDialog  the panel in a dialog, for an order the server refused
 *   ClosedNote    one line for the basket
 *   OpenChip      "Open now · until 11:00 pm" / "Closed" for the footer
 *
 * The words are the owner's (Website Management → Opening Hours & Online
 * Orders). The tone is an invitation to come back, not an error: the basket is
 * kept, and the page says exactly when they can order.
 */

function headline(status) {
  if (status.reason === 'last-orders') return "We've taken our last orders for today";
  return status.title || "We're closed right now";
}

/** "1:45 pm" never splits across two lines. */
const keepTogether = (text) => text?.replace(/ (am|pm)\b/gi, '\u00a0$1');

function opensLine(status) {
  if (status.reason === 'temporarily-closed' || !status.opensAtText) return 'We will be back very soon';
  return `Ordering opens ${keepTogether(status.opensAtText)}`;
}

export function ClosedBanner({ status }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('fb-closed-banner') === status?.opensAt;
    } catch {
      return false;
    }
  });
  const now = useNow(30_000);
  const show = status && !status.canOrder && !dismissed;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('fb-closed-banner', status?.opensAt ?? 'x');
    } catch {
      /* private mode */
    }
  };

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b border-gold/25 bg-gradient-to-r from-surface-raised via-surface to-surface-raised"
          role="status"
        >
          <div className="container flex items-center gap-3 py-2.5 text-sm">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold/15 text-gold">
              <Moon className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{headline(status)}</span>
              <span className="text-muted-foreground">
                {' · '}
                {opensLine(status)}
                {status.opensAt && status.reason !== 'temporarily-closed' && (
                  <span className="hidden sm:inline"> ({timeUntil(status.opensAt, now)})</span>
                )}
                <span className="hidden md:inline"> — you can still browse and fill your basket.</span>
              </span>
            </p>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Hide this message"
              className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The full "closed" message. `compact` drops the hours list for tight spaces.
 */
export function ClosedPanel({ status, compact = false, onClose, className }) {
  const now = useNow(30_000);
  if (!status) return null;
  const countdown = status.reason !== 'temporarily-closed' ? timeUntil(status.opensAt, now) : null;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl border border-gold/25 bg-gradient-to-br from-surface-raised via-surface to-background p-6 text-center sm:p-8',
        className,
      )}
    >
      {/* A quiet night sky: the shop is resting, not broken. */}
      <div className="pointer-events-none absolute inset-0 opacity-60" aria-hidden="true">
        {[
          ['8%', '18%', 1.2],
          ['22%', '72%', 0.8],
          ['78%', '14%', 1],
          ['88%', '64%', 1.4],
          ['60%', '30%', 0.7],
          ['35%', '12%', 0.9],
        ].map(([left, top, scale], i) => (
          <motion.span
            key={i}
            className="absolute h-1 w-1 rounded-full bg-gold"
            style={{ left, top, scale }}
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 2.4 + i * 0.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </div>

      <div className="relative">
        <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-full bg-gold/15 text-gold shadow-gold">
          <Moon className="h-8 w-8" aria-hidden="true" />
          <Sparkles className="absolute -right-1 -top-1 h-5 w-5 text-gold" aria-hidden="true" />
        </span>

        <h2 className="mt-4 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          {headline(status)}
        </h2>
        {status.message && (
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
            {status.message}
          </p>
        )}

        <div className="mx-auto mt-6 inline-flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-5 py-3 text-left">
          <Clock className="h-6 w-6 shrink-0 text-gold" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{opensLine(status)}</p>
            {countdown && <p className="text-xs text-muted-foreground">That&apos;s {countdown}</p>}
          </div>
        </div>

        {!compact && status.summary?.length > 0 && (
          <dl className="mx-auto mt-6 max-w-xs space-y-1 text-sm">
            {status.summary.map((line) => (
              <div key={line.days} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{line.days}</dt>
                <dd className={cn('font-medium', line.hours === 'Closed' && 'text-muted-foreground')}>
                  {line.hours}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to={ROUTES.MENU}
            onClick={onClose}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-gold-gradient px-5 text-sm font-semibold text-gold-foreground shadow-gold transition-all hover:brightness-110"
          >
            <ShoppingBag className="h-4 w-4" aria-hidden="true" /> Keep browsing the menu
          </Link>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center rounded-full border border-border-strong px-5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              OK, I&apos;ll come back
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Your basket is saved on this device.</p>
      </div>
    </div>
  );
}

export function ClosedDialog({ isOpen, status, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" showCloseButton={false}>
      <ClosedPanel status={status} onClose={onClose} className="border-0 bg-transparent p-2 sm:p-4" />
    </Modal>
  );
}

/** One line for the basket drawer and cart page. */
export function ClosedNote({ status, className }) {
  if (!status || status.canOrder) return null;
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/5 px-3 py-2.5 text-xs',
        className,
      )}
    >
      <Moon className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
      <span>
        <span className="font-semibold">{headline(status)}.</span>{' '}
        <span className="text-muted-foreground">{opensLine(status)} — your basket will be waiting.</span>
      </span>
    </p>
  );
}

/** "Open now · until 11:00 pm" or "Closed · opens tomorrow at 9:00 am". */
export function OpenChip({ status }) {
  if (!status) return null;
  const open = status.isOpen && status.reason !== 'temporarily-closed';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        open ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', open ? 'bg-success' : 'bg-destructive')} />
      {open
        ? `Open now · until ${keepTogether(status.closesAtText)}`
        : status.opensAtText
          ? `Closed · opens ${keepTogether(status.opensAtText)}`
          : 'Closed'}
    </span>
  );
}
