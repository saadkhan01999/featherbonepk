import { useMemo, useState } from 'react';
import { Ban, ChefHat, CircleCheck, ClipboardList, Receipt, Wallet } from 'lucide-react';

import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { posClient } from '@/services/apiClient.js';
import { orderTypeLine, STAGE_LABEL } from '@/features/kitchen/labels.js';
import { formatCurrency, formatRelativeTime } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';

/**
 * Open tickets — this counter's orders that are not finished.
 * ---------------------------------------------------------------------------
 * Everything sent to the kitchen and not yet served, and every unpaid tab:
 *
 *   Pay         take payment for a ticket sent earlier ("the table wants the bill")
 *   Print bill  an itemised bill marked not paid, to take to the table
 *   Served      the customer has it — closes a ready ticket
 *   Void        cancel an unpaid ticket the kitchen has not started; its items
 *               go back into stock. Needs the "cancel orders" permission, and is
 *               refused by the server once the kitchen has accepted it — food
 *               already being cooked is a cost, not a mistake to erase.
 *
 * Statuses change live: the list is re-read whenever the kitchen moves one of
 * this till's tickets.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'kitchen', label: 'In kitchen' },
  { key: 'ready', label: 'Ready' },
];

const STATUS_STAGE = { confirmed: 'new', preparing: 'preparing', ready: 'ready', completed: 'done' };

const STAGE_TONE = {
  new: 'bg-info/15 text-info border-info/40',
  preparing: 'bg-warning/15 text-warning border-warning/40',
  ready: 'bg-success/15 text-success border-success/40',
  done: 'bg-surface-raised text-muted-foreground border-border-strong',
};

export function OpenTicketsModal({
  isOpen,
  onClose,
  orders,
  terminalId,
  canCancel,
  onChanged,
  onPay,
  onPrintBill,
  onPrintKitchen,
  onFlash,
}) {
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(null); // `${id}:${action}`
  const [error, setError] = useState(null);
  const [voiding, setVoiding] = useState(null);

  const visible = useMemo(() => {
    switch (filter) {
      case 'unpaid':
        return orders.filter((o) => o.paymentStatus !== 'paid');
      case 'kitchen':
        return orders.filter((o) => o.status === 'confirmed' || o.status === 'preparing');
      case 'ready':
        return orders.filter((o) => o.status === 'ready');
      default:
        return orders;
    }
  }, [orders, filter]);

  async function run(ticket, action, work) {
    setBusy(`${ticket.id}:${action}`);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err.message ?? 'That did not go through');
    } finally {
      setBusy(null);
    }
  }

  /** The full slip (lines, totals) — the open-ticket row only carries a summary. */
  const fetchSlip = (ticket) => posClient.get(`/pos/sales/${ticket.id}`);

  const serve = (ticket) =>
    run(ticket, 'serve', async () => {
      await posClient.post(`/pos/orders/${ticket.id}/serve`);
      onFlash?.(`Ticket #${ticket.ticketNumber} served`);
      onChanged?.();
    });

  const printBill = (ticket) => run(ticket, 'bill', async () => onPrintBill(await fetchSlip(ticket)));
  const printKitchen = (ticket) => run(ticket, 'kot', async () => onPrintKitchen(await fetchSlip(ticket)));

  const confirmVoid = () =>
    run(voiding, 'void', async () => {
      await posClient.post(`/pos/orders/${voiding.id}/void`);
      onFlash?.(`Ticket #${voiding.ticketNumber} voided — items back in stock`);
      setVoiding(null);
      onChanged?.();
    });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Open tickets"
        description="Sent to the kitchen, or waiting for payment."
        size="lg"
      >
        <div className="space-y-3">
          <div role="group" aria-label="Filter tickets" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const count =
                f.key === 'all'
                  ? orders.length
                  : f.key === 'unpaid'
                    ? orders.filter((o) => o.paymentStatus !== 'paid').length
                    : f.key === 'ready'
                      ? orders.filter((o) => o.status === 'ready').length
                      : orders.filter((o) => o.status === 'confirmed' || o.status === 'preparing').length;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
                    filter === f.key
                      ? 'bg-gold-gradient text-gold-foreground'
                      : 'bg-surface-raised text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label} <span className="tabular-nums opacity-80">{count}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <ClipboardList className="h-8 w-8" aria-hidden="true" />
              <p className="text-sm">No open tickets here.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {visible.map((ticket) => {
                const stage = STATUS_STAGE[ticket.status] ?? 'done';
                const unpaid = ticket.paymentStatus !== 'paid';
                const own = !terminalId || ticket.terminalId === terminalId;
                const isBusy = (action) => busy === `${ticket.id}:${action}`;

                return (
                  <li
                    key={ticket.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 p-3',
                      stage === 'ready' && 'bg-success/5',
                    )}
                  >
                    <div className="w-16 shrink-0 text-center">
                      <p className="text-2xl font-black leading-none tabular-nums">
                        #{ticket.ticketNumber ?? '—'}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatRelativeTime(ticket.firedAt ?? ticket.createdAt)}
                      </p>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase',
                            STAGE_TONE[stage],
                          )}
                        >
                          {STAGE_LABEL[stage]}
                        </span>
                        <span
                          className={cn(
                            'rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase',
                            unpaid ? 'border-warning/50 text-warning' : 'border-success/50 text-success',
                          )}
                        >
                          {unpaid ? 'Unpaid' : 'Paid'}
                        </span>
                        <span className="text-sm font-semibold">{orderTypeLine(ticket)}</span>
                        {!own && <span className="text-xs text-muted-foreground">· {ticket.terminalId}</span>}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground" title={ticket.summary}>
                        {ticket.customer && ticket.customer !== 'Walk-in Customer' && `${ticket.customer} — `}
                        {ticket.summary}
                      </p>
                    </div>

                    <p className="w-24 shrink-0 text-right text-lg font-bold tabular-nums text-gold">
                      {formatCurrency(ticket.total)}
                    </p>

                    <div className="flex w-full flex-wrap justify-end gap-1.5 sm:w-auto">
                      {unpaid && (
                        <Button
                          size="sm"
                          leftIcon={Wallet}
                          onClick={() => onPay(ticket)}
                          disabled={Boolean(busy)}
                        >
                          Pay
                        </Button>
                      )}
                      {stage === 'ready' && (
                        <Button
                          size="sm"
                          variant="success"
                          leftIcon={CircleCheck}
                          isLoading={isBusy('serve')}
                          disabled={Boolean(busy)}
                          onClick={() => serve(ticket)}
                        >
                          Served
                        </Button>
                      )}
                      {own && unpaid && (
                        <Button
                          size="sm"
                          variant="outline"
                          leftIcon={Receipt}
                          isLoading={isBusy('bill')}
                          disabled={Boolean(busy)}
                          onClick={() => printBill(ticket)}
                        >
                          Bill
                        </Button>
                      )}
                      {own && ticket.ticketNumber != null && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={ChefHat}
                          isLoading={isBusy('kot')}
                          disabled={Boolean(busy)}
                          onClick={() => printKitchen(ticket)}
                          title="Reprint the kitchen ticket"
                        >
                          KOT
                        </Button>
                      )}
                      {canCancel && unpaid && ticket.status === 'confirmed' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={Ban}
                          disabled={Boolean(busy)}
                          onClick={() => setVoiding(ticket)}
                          className="text-destructive hover:text-destructive"
                        >
                          Void
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(voiding)}
        onClose={() => setVoiding(null)}
        onConfirm={confirmVoid}
        title={`Void ticket #${voiding?.ticketNumber ?? ''}?`}
        message="The kitchen has not started it. The ticket is cancelled and its items go back into stock."
        confirmLabel="Void ticket"
      />
    </>
  );
}

export default OpenTicketsModal;
