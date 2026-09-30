import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, CheckCircle2, ChefHat, Clock, MapPin, Phone, Send, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { StatusBanner, useFlash } from '@/components/admin/CatalogShared.jsx';
import { ForwardOrderDialog } from '@/components/admin/ForwardOrderDialog.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useResource } from '@/features/catalog/catalog.api.js';
import { stationsApi } from '@/features/stations/stations.api.js';
import { EVENTS, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { playChime } from '@/lib/chime.js';
import { formatCurrency, formatQuantity, formatRelativeTime } from '@/lib/format.js';
import { useNow } from '@/lib/useNow.js';
import { ROUTES } from '@/constants/routes.js';
import { cn } from '@/lib/utils.js';

const PAYMENT_LABEL = {
  cod: 'Cash on delivery',
  bank_transfer: 'Bank transfer',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
};

/**
 * Website orders waiting for a person to send them to the kitchen.
 * Live: a new order appears (with a chime) the moment it is placed.
 */
export function IncomingOrdersPanel() {
  const { can } = useAuth();
  const canForward = can('order.manage');
  const { data, reload } = useResource(() => stationsApi.incoming(), []);
  const [forwarding, setForwarding] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const { notice, flash } = useFlash();
  useNow(30_000); // keeps "3 min ago" current

  const refresh = useDebouncedCallback(reload, 400);
  useRealtimeEvent('web', EVENTS.ORDER_CHANGED, refresh);
  useRealtimeEvent('web', EVENTS.SETTINGS_CHANGED, (event) => {
    if (event?.sections?.some((s) => ['stations', 'kitchen'].includes(s))) refresh();
  });

  // Ring and highlight orders that arrive while the dashboard is open.
  const seen = useRef(null);
  const [fresh, setFresh] = useState(() => new Set());
  useEffect(() => {
    if (!data) return;
    const ids = data.orders.map((o) => o.id);
    if (seen.current) {
      const arrived = ids.filter((id) => !seen.current.has(id));
      if (arrived.length) {
        playChime('order');
        setFresh(new Set(arrived));
        const timer = setTimeout(() => setFresh(new Set()), 12_000);
        seen.current = new Set(ids);
        return () => clearTimeout(timer);
      }
    }
    seen.current = new Set(ids);
    return undefined;
  }, [data]);

  if (!data || !data.kitchenEnabled || data.mode === 'off') return null;

  const orders = data.orders;
  // Oldest first; a long queue shows the first few until expanded.
  const PREVIEW = 4;
  const visible = showAll ? orders : orders.slice(0, PREVIEW);

  return (
    <section
      aria-labelledby="incoming-orders"
      className={cn(
        'rounded-2xl border bg-surface p-4 sm:p-5',
        orders.length ? 'border-gold/40 shadow-gold' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl',
              orders.length ? 'bg-gold/15 text-gold' : 'bg-surface-raised text-muted-foreground',
            )}
          >
            {orders.length ? <BellRing className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </span>
          <div>
            <h2 id="incoming-orders" className="font-semibold">
              Incoming website orders
              {orders.length > 0 && (
                <span className="ml-2 rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-gold-foreground">
                  {orders.length}
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              {orders.length
                ? 'Check each order and send it to the right station.'
                : data.mode === 'auto'
                  ? 'New website orders go straight to the stations (Settings → Kitchen Display).'
                  : 'Nothing waiting. New website orders appear here the moment they are placed.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {data.awaitingPayment > 0 && (
            <Link
              to={`${ROUTES.ADMIN_ORDERS}?status=pending`}
              className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 font-semibold text-warning"
            >
              {data.awaitingPayment} awaiting payment check
            </Link>
          )}
          <Link
            to={ROUTES.ADMIN_STATIONS}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-muted-foreground hover:text-gold"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Stations
          </Link>
        </div>
      </header>

      <StatusBanner notice={notice} />

      {orders.length > 0 && (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {visible.map((order) => (
              <motion.li
                key={order.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className={cn(
                  'flex flex-col rounded-xl border border-border bg-background/40 p-3.5',
                  fresh.has(order.id) && 'ring-2 ring-gold',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                      <Link
                        to={`${ROUTES.ADMIN_ORDERS}?search=${encodeURIComponent(order.orderNumber)}`}
                        className="font-mono hover:text-gold"
                      >
                        {order.orderNumber}
                      </Link>
                      <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatRelativeTime(order.createdAt)}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-sm">{order.customerName}</p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {order.customerPhone && (
                        <a
                          href={`tel:${order.customerPhone}`}
                          className="flex items-center gap-1 hover:text-gold"
                        >
                          <Phone className="h-3 w-3" aria-hidden="true" />
                          {order.customerPhone}
                        </a>
                      )}
                      {order.address && (
                        <span className="flex min-w-0 items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {[order.address.area, order.address.city].filter(Boolean).join(', ') ||
                              order.address.line1}
                          </span>
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold tabular-nums">{formatCurrency(order.total)}</p>
                    <p
                      className={cn(
                        'text-[11px] font-semibold',
                        order.paymentStatus === 'paid' ? 'text-success' : 'text-muted-foreground',
                      )}
                    >
                      {order.paymentStatus === 'paid'
                        ? 'Paid'
                        : (PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod)}
                    </p>
                  </div>
                </div>

                <ul className="mt-2.5 flex-1 space-y-1 text-sm">
                  {order.items.map((item) => {
                    const station = data.stations.find((s) => s.id === item.suggestedStation);
                    return (
                      <li key={item.index} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                          {formatQuantity(item.quantity, item.unit)}
                        </span>
                        <span className="min-w-0 flex-1 leading-snug">{item.name}</span>
                        {station && data.stations.length > 1 && (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: station.color }}
                              aria-hidden="true"
                            />
                            {station.name}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {canForward && (
                  <div className="mt-3 flex justify-end border-t border-border pt-3">
                    <Button size="sm" leftIcon={Send} onClick={() => setForwarding(order)}>
                      Send to kitchen
                    </Button>
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {orders.length > PREVIEW && (
        <div className="mt-3 text-center">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((all) => !all)}>
            {showAll ? 'Show fewer' : `Show all ${orders.length} orders`}
          </Button>
        </div>
      )}

      <ForwardOrderDialog
        order={forwarding}
        stations={data.stations}
        isOpen={Boolean(forwarding)}
        onClose={() => setForwarding(null)}
        onForwarded={(result) => {
          setForwarding(null);
          flash(
            'success',
            `${result.orderNumber} sent to ${result.stations.join(' and ')} — ticket #${result.ticketNumber}`,
          );
          reload();
        }}
      />

      {orders.length === 0 && data.stations.length <= 1 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ChefHat className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
          Tip: add a station such as &quot;Chicken Counter&quot; in{' '}
          <Link to={ROUTES.ADMIN_STATIONS} className="font-medium text-gold hover:underline">
            Kitchen Stations
          </Link>{' '}
          so chicken items go to their own screen.
        </p>
      )}
    </section>
  );
}

export default IncomingOrdersPanel;
