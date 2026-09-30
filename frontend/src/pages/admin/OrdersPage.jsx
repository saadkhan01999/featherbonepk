import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ShoppingBag,
  Globe,
  Monitor,
  AlertCircle,
  CheckCircle2,
  X,
  ChevronRight,
  Clock,
  Wallet,
  Radio,
  Send,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { ConfirmDialog, Modal } from '@/components/ui/Modal.jsx';
import { Input, Select } from '@/components/ui/Input.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { orderTypeLine } from '@/features/kitchen/labels.js';
import { EVENTS, useConnectionStore, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { ForwardOrderDialog } from '@/components/admin/ForwardOrderDialog.jsx';
import { stationsApi } from '@/features/stations/stations.api.js';
import { formatCurrency, formatRelativeTime } from '@/lib/format.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn, useDebouncedValue } from '@/lib/utils.js';

/**
 * Order management.
 * ---------------------------------------------------------------------------
 * The operational queue: what has come in, what stage it is at, and the one
 * action that moves it forward.
 *
 * The action buttons are built from `nextStatuses`, which the server derives
 * from its transition whitelist. The UI therefore cannot offer a move the
 * backend would reject — there is no second copy of the lifecycle rules here to
 * drift out of step with the first.
 *
 * Live: a new website order, a till sale or a cook tapping Done in the kitchen
 * refreshes the queue within a second. "Mark paid" records money received for an
 * unpaid order; "Send to kitchen" forwards a website order to the stations.
 *
 * URL filters (used by links from the dashboard and till reports):
 *   ?status=pending|confirmed|…|to-kitchen   ?search=FB-…   ?terminal=TILL-01
 */

const STATUS_META = {
  pending: { label: 'Pending', variant: 'warning' },
  confirmed: { label: 'Confirmed', variant: 'info' },
  preparing: { label: 'Preparing', variant: 'info' },
  ready: { label: 'Ready', variant: 'gold' },
  out_for_delivery: { label: 'On the way', variant: 'gold' },
  delivered: { label: 'Delivered', variant: 'success' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
  refunded: { label: 'Refunded', variant: 'default' },
};

const PAYMENT_META = {
  paid: { label: 'Paid', variant: 'success' },
  pending: { label: 'Unpaid', variant: 'warning' },
  awaiting_verification: { label: 'Verifying', variant: 'warning' },
  failed: { label: 'Failed', variant: 'destructive' },
  refunded: { label: 'Refunded', variant: 'default' },
};

const METHOD_LABEL = {
  cod: 'COD',
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
};

/** Tabs across the top of the queue. Empty key = everything. */
const TABS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'to-kitchen', label: 'To kitchen' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out_for_delivery', label: 'On the way' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function OrdersPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const terminal = searchParams.get('terminal') ?? '';
  const linkedSearch = searchParams.get('search') ?? '';
  // Arriving from a link (a till report, a dashboard card) shows what it points at, not just "pending".
  const [status, setStatus] = useState(
    () => searchParams.get('status') ?? (terminal || linkedSearch ? '' : 'pending'),
  );
  const [channel, setChannel] = useState('');
  const [paying, setPaying] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [search, setSearch] = useState(linkedSearch);
  const [query, setQuery] = useState(linkedSearch);
  // Searches as you type; Enter searches at once.
  const typed = useDebouncedValue(search.trim(), 350);
  useEffect(() => setQuery(typed), [typed]);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  // A cancellation returns stock, so it gets a confirmation the others don't.
  const [confirming, setConfirming] = useState(null);

  /*
   * Server-paginated. Every filter — including channel — goes to the API, so
   * the rows on screen and the count beside them always come from the same
   * query. See usePagedResource for why the page resets when a filter changes.
   */
  const { rows, meta, isLoading, error, reload, goToPage } = usePagedResource(
    ({ page, limit }) =>
      apiClient.get('/orders/admin/list', {
        params: {
          page,
          limit,
          ...(status === 'to-kitchen' ? { stage: 'to-kitchen' } : status && { status }),
          ...(channel && { channel }),
          ...(terminal && { terminal }),
          ...(query && { search: query }),
        },
        _wantEnvelope: true,
      }),
    [status, channel, terminal, query],
  );

  const { data: stats, reload: reloadStats } = useResource(() => apiClient.get('/orders/admin/stats'), []);

  // Live queue: any order created or moved anywhere re-reads this page.
  const connection = useConnectionStore((s) => s.web);
  const refresh = useDebouncedCallback(() => {
    reload();
    reloadStats();
  }, 600);
  useRealtimeEvent('web', EVENTS.ORDER_CHANGED, refresh);
  useEffect(() => {
    if (connection === 'online') refresh();
  }, [connection, refresh]);

  /** Move an order to its next stage. */
  const transition = useCallback(
    async (order, next) => {
      setBusyId(order.id);
      setNotice(null);
      try {
        const result = await apiClient.patch(`/orders/${order.orderNumber}/status`, { status: next });
        setNotice({ type: 'success', text: result.message ?? 'Order updated' });
        // Both reload: a status change moves the order between tabs and changes
        // the counts on them.
        await Promise.all([reload(), reloadStats()]);
      } catch (err) {
        setNotice({ type: 'error', text: err.message ?? 'Could not update this order' });
      } finally {
        setBusyId(null);
        setConfirming(null);
      }
    },
    [reload, reloadStats],
  );

  /** Open the forwarding dialog with the order's suggested stations. */
  async function openForward(order) {
    setBusyId(order.id);
    setNotice(null);
    try {
      const incoming = await stationsApi.incoming();
      const found = incoming.orders.find((o) => o.orderNumber === order.orderNumber);
      if (found) setForwarding({ order: found, stations: incoming.stations });
      else setNotice({ type: 'error', text: 'This order has already been sent to the kitchen.' });
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not load the stations' });
    } finally {
      setBusyId(null);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setQuery(search.trim());
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Radio
              className={cn('h-3.5 w-3.5', connection === 'online' ? 'text-success' : 'text-warning')}
              aria-hidden="true"
            />
            Website and counter sales in one queue —{' '}
            {connection === 'online' ? 'updating live' : 'reconnecting'}.
          </p>
        </div>

        <form onSubmit={submitSearch}>
          <SearchInput
            size="sm"
            className="w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // Clearing drops the committed query too — see CustomersPage.
            onClear={() => {
              setSearch('');
              setQuery('');
            }}
            placeholder="Order number, name or phone…"
            label="Search orders"
          />
        </form>
      </header>

      {/* --- Summary --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Needs attention', value: stats?.open, icon: Clock, tone: 'text-warning' },
          { label: 'Pending', value: stats?.byStatus?.pending ?? 0, icon: AlertCircle, tone: 'text-warning' },
          {
            label: 'Completed',
            value: stats?.byStatus?.completed ?? 0,
            icon: CheckCircle2,
            tone: 'text-success',
          },
          { label: 'All orders', value: stats?.total, icon: ShoppingBag, tone: 'text-muted-foreground' },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{card.label}</span>
              <card.icon className={cn('h-4 w-4', card.tone)} aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{card.value ?? '—'}</p>
          </div>
        ))}
      </div>

      {notice && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
            notice.type === 'success'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* --- Filters --- */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap rounded-lg border border-border-strong p-0.5"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key || 'all'}
              type="button"
              onClick={() => setStatus(tab.key)}
              aria-pressed={status === tab.key}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === tab.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {(tab.key === 'to-kitchen' ? stats?.toKitchen : stats?.byStatus?.[tab.key]) > 0 && (
                <span className="ml-1.5 tabular-nums opacity-75">
                  ({tab.key === 'to-kitchen' ? stats.toKitchen : stats.byStatus[tab.key]})
                </span>
              )}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Filter by channel"
          className="flex rounded-lg border border-border-strong p-0.5"
        >
          {[
            { key: '', label: 'Both', icon: null },
            { key: 'online', label: 'Website', icon: Globe },
            { key: 'pos', label: 'Counter', icon: Monitor },
          ].map((option) => (
            <button
              key={option.key || 'both'}
              type="button"
              onClick={() => setChannel(option.key)}
              aria-pressed={channel === option.key}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                channel === option.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.icon && <option.icon className="h-3.5 w-3.5" aria-hidden="true" />}
              {option.label}
            </button>
          ))}
        </div>

        {terminal && (
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('terminal');
              setSearchParams(next, { replace: true });
            }}
            className="flex items-center gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold"
          >
            <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
            Till {terminal}
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}

        {query && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setQuery('');
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Clear &ldquo;{query}&rdquo;
          </button>
        )}
      </div>

      {/* --- Queue --- */}
      {isLoading ? (
        <SectionLoader label="Loading orders" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : !rows.length ? (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">{status === 'pending' ? 'Nothing waiting' : 'No orders here'}</p>
          <p className="text-sm text-muted-foreground">
            {query ? 'Try a different search.' : 'Orders will appear as they come in.'}
          </p>
        </div>
      ) : (
        <motion.ul {...staggerContainer} className="space-y-2.5">
          {rows.map((order) => {
            const meta = STATUS_META[order.status] ?? { label: order.status, variant: 'default' };
            const payment = PAYMENT_META[order.paymentStatus] ?? {
              label: order.paymentStatus,
              variant: 'default',
            };
            const isBusy = busyId === order.id;

            return (
              <motion.li
                {...staggerItem}
                key={order.id}
                className="rounded-2xl border border-border bg-surface p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  {/* --- Identity --- */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {order.ticketNumber != null && (
                        <span className="rounded-md bg-foreground px-1.5 py-0.5 text-xs font-black tabular-nums text-background">
                          #{order.ticketNumber}
                        </span>
                      )}
                      <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
                      <Badge variant={meta.variant} size="sm">
                        {meta.label}
                      </Badge>
                      <Badge variant={payment.variant} size="sm">
                        {payment.label}
                      </Badge>
                      <Badge variant="default" size="sm" icon={order.channel === 'pos' ? Monitor : Globe}>
                        {order.channel === 'pos' ? (order.terminalId ?? 'Counter') : 'Website'}
                      </Badge>
                      {order.orderType && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {orderTypeLine(order)}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 truncate text-sm">
                      {order.customerName}
                      {order.customerPhone && (
                        <span className="text-muted-foreground"> · {order.customerPhone}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={order.summary}>
                      {order.summary || `${order.itemCount} items`}
                    </p>
                  </div>

                  {/* --- Money --- */}
                  <div className="shrink-0 text-left lg:text-right">
                    <p className="font-bold tabular-nums text-gold">{formatCurrency(order.total)}</p>
                    <p className="text-xs text-muted-foreground">
                      {METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
                      {' · '}
                      {formatRelativeTime(order.createdAt)}
                    </p>
                  </div>

                  {/* --- Actions ---
                      Derived from the server's transition whitelist, so this can
                      never offer a move the backend refuses. */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {order.awaitingKitchen && can('order.manage') && (
                      <Button
                        size="sm"
                        leftIcon={Send}
                        disabled={isBusy}
                        isLoading={isBusy}
                        onClick={() => openForward(order)}
                      >
                        Send to kitchen
                      </Button>
                    )}
                    {order.canMarkPaid && can('order.manage') && (
                      <Button
                        size="sm"
                        variant="success"
                        leftIcon={Wallet}
                        disabled={isBusy}
                        onClick={() => setPaying(order)}
                      >
                        Mark paid
                      </Button>
                    )}
                    {order.nextStatuses.length === 0
                      ? !order.canMarkPaid && (
                          <span className="text-xs text-muted-foreground">No further action</span>
                        )
                      : order.nextStatuses
                          // Cancelling needs its own permission; the server enforces it too.
                          .filter((next) => next !== 'cancelled' || can('order.cancel'))
                          // Waiting for the kitchen: "Send to kitchen" is the way forward.
                          .filter((next) => !order.awaitingKitchen || next === 'cancelled')
                          .map((next) => {
                            const isCancel = next === 'cancelled';
                            return (
                              <Button
                                key={next}
                                size="sm"
                                variant={isCancel ? 'ghost' : 'primary'}
                                rightIcon={isCancel ? undefined : ChevronRight}
                                disabled={isBusy}
                                isLoading={isBusy && !isCancel}
                                onClick={() =>
                                  // Cancelling puts goods back on the shelf and cannot
                                  // be undone from here — worth one extra tap.
                                  isCancel ? setConfirming(order) : transition(order, next)
                                }
                                className={isCancel ? 'text-destructive hover:bg-destructive/10' : undefined}
                              >
                                {STATUS_META[next]?.label ?? next}
                              </Button>
                            );
                          })}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      {/* Counts and controls come from the same query as the rows above. */}
      <Pagination meta={meta} onPageChange={goToPage} label="orders" />

      <ConfirmDialog
        isOpen={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => transition(confirming, 'cancelled')}
        isLoading={busyId === confirming?.id}
        title={`Cancel ${confirming?.orderNumber}?`}
        message="The items go back into stock and the customer is notified. This cannot be undone from here."
        confirmLabel="Cancel the order"
        cancelLabel="Keep it"
      />

      <ForwardOrderDialog
        order={forwarding?.order}
        stations={forwarding?.stations}
        isOpen={Boolean(forwarding)}
        onClose={() => setForwarding(null)}
        onForwarded={(result) => {
          setForwarding(null);
          setNotice({
            type: 'success',
            text: `${result.orderNumber} sent to ${result.stations.join(' and ')} — ticket #${result.ticketNumber}`,
          });
          reload();
          reloadStats();
        }}
      />

      <MarkPaidDialog
        order={paying}
        onClose={() => setPaying(null)}
        onDone={(message) => {
          setPaying(null);
          setNotice({ type: 'success', text: message });
          reload();
          reloadStats();
        }}
      />
    </div>
  );
}

/**
 * Record money received for an unpaid order.
 * If the order already names a method (COD, bank transfer) that is what was
 * paid; otherwise — an unpaid till tab — the person chooses.
 */
function MarkPaidDialog({ order, onClose, onDone }) {
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState(null);
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    if (order) {
      setMethod(order.paymentMethod ?? 'cash');
      setReference('');
      setError(null);
    }
  }, [order]);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const result = await apiClient.patch(`/orders/${order.orderNumber}/payment`, {
        status: 'paid',
        ...(!order.paymentMethod && { paymentMethod: method }),
        ...(reference.trim() && { reference: reference.trim() }),
      });
      onDone(`${result?.orderNumber ?? order.orderNumber} marked as paid`);
    } catch (err) {
      setError(err.message ?? 'Could not record the payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(order)}
      onClose={onClose}
      title={`Mark ${order?.orderNumber ?? ''} as paid`}
      description={
        order ? `${formatCurrency(order.total)} from ${order.customerName ?? 'the customer'}` : undefined
      }
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="success"
            leftIcon={Wallet}
            isLoading={isSaving}
            loadingText="Recording…"
            onClick={confirm}
          >
            Payment received
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {order?.paymentMethod ? (
          <p className="text-sm text-muted-foreground">
            Paid by{' '}
            <span className="font-semibold text-foreground">
              {METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
            </span>
            .
          </p>
        ) : (
          <Select label="How was it paid?" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="jazzcash">JazzCash</option>
            <option value="bank_transfer">Bank transfer</option>
          </Select>
        )}
        <Input
          label="Reference (optional)"
          placeholder="Transaction ID, receipt number…"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={80}
        />
        <p className="text-xs text-muted-foreground">Recorded in the audit log with your name.</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export default OrdersPage;
