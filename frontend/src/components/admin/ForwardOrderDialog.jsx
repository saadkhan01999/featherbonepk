import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChefHat, Send } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Modal } from '@/components/ui/Modal.jsx';
import { Textarea } from '@/components/ui/Input.jsx';
import { stationsApi } from '@/features/stations/stations.api.js';
import { formatCurrency, formatQuantity } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';

const NONE = 'none';

/**
 * Forward a website order to the preparation stations.
 *
 * Each item starts on the station its category belongs to (the server's
 * suggestion); staff can move any item, or mark it as needing no preparation.
 */
export function ForwardOrderDialog({ order, stations = [], isOpen, onClose, onForwarded }) {
  const [assignment, setAssignment] = useState({});
  const [note, setNote] = useState('');
  const [isSending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!order) return;
    setAssignment(
      Object.fromEntries(
        order.items.map((item) => [item.index, item.suggestedStation ?? stations[0]?.id ?? NONE]),
      ),
    );
    setNote(order.kitchenNote ?? '');
    setError(null);
  }, [order, stations]);

  const byStation = useMemo(() => {
    const counts = new Map();
    for (const value of Object.values(assignment)) {
      if (value !== NONE) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [assignment]);

  if (!order) return null;

  const sendAllTo = (stationId) =>
    setAssignment(Object.fromEntries(order.items.map((item) => [item.index, stationId])));

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const result = await stationsApi.forward(order.orderNumber, {
        lines: order.items.map((item) => ({
          index: item.index,
          station: assignment[item.index] === NONE ? null : assignment[item.index],
        })),
        kitchenNote: note,
      });
      onForwarded?.(result);
    } catch (err) {
      setError(err.message ?? 'Could not send this order to the kitchen');
    } finally {
      setSending(false);
    }
  }

  const nothingToCook = byStation.size === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={`Send ${order.orderNumber} to the kitchen`}
      description={`${order.customerName} · ${order.items.length} item${order.items.length === 1 ? '' : 's'} · ${formatCurrency(order.total)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button leftIcon={Send} onClick={submit} isLoading={isSending} disabled={nothingToCook}>
            Send to {byStation.size > 1 ? `${byStation.size} stations` : 'the kitchen'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {stations.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Send everything to</span>
            {stations.map((station) => (
              <button
                key={station.id}
                type="button"
                onClick={() => sendAllTo(station.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3 py-1 text-xs font-semibold hover:border-gold hover:text-gold"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: station.color }}
                  aria-hidden="true"
                />
                {station.name}
              </button>
            ))}
          </div>
        )}

        <ul className="divide-y divide-border rounded-xl border border-border">
          {order.items.map((item) => {
            const value = assignment[item.index] ?? NONE;
            const station = stations.find((s) => s.id === value);
            return (
              <li key={item.index} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
                <span className="min-w-[4.5rem] shrink-0 rounded-md bg-surface-raised px-2 py-1 text-center text-sm font-bold tabular-nums">
                  {formatQuantity(item.quantity, item.unit)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                <label className="sr-only" htmlFor={`station-${item.index}`}>
                  Station for {item.name}
                </label>
                <div className="relative w-full sm:w-52">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                    style={{ background: station?.color ?? 'transparent' }}
                    aria-hidden="true"
                  />
                  <select
                    id={`station-${item.index}`}
                    value={value}
                    onChange={(e) => setAssignment((a) => ({ ...a, [item.index]: e.target.value }))}
                    className={cn(
                      'h-9 w-full cursor-pointer rounded-lg border border-border-strong bg-surface pl-8 pr-3 text-sm',
                      'focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60',
                      value === NONE && 'text-muted-foreground',
                    )}
                  >
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value={NONE}>No preparation needed</option>
                  </select>
                </div>
              </li>
            );
          })}
        </ul>

        {byStation.size > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <ChefHat className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
            {[...byStation.entries()].map(([id, count]) => (
              <span key={id}>
                <span className="font-semibold text-foreground">
                  {stations.find((s) => s.id === id)?.name}
                </span>
                : {count} item{count === 1 ? '' : 's'}
              </span>
            ))}
          </p>
        )}
        {nothingToCook && <p className="text-sm text-warning">Choose a station for at least one item.</p>}

        {order.address?.notes && (
          <p className="rounded-lg bg-surface-raised px-3 py-2 text-sm">
            <span className="font-semibold">Customer&apos;s note: </span>
            {order.address.notes}
          </p>
        )}

        <Textarea
          label="Note for the cooks (optional)"
          rows={2}
          maxLength={300}
          value={note}
          placeholder="Extra spicy, no onions, pack separately…"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

export default ForwardOrderDialog;
