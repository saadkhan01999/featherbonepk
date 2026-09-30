import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowDownLeft, ArrowUpRight, History, Lock, Unlock, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { Modal } from '@/components/ui/Modal.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { posClient } from '@/services/apiClient.js';
import { formatCurrency, formatDateTime, formatTime } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';

/**
 * The till's cash drawer: open a shift with the float, record cash taken in or
 * out (with a reason), and close against a physical count. The server works
 * out what should be in the drawer; the count is compared with it and any
 * difference is recorded, never corrected.
 */
export function ShiftModal({ isOpen, onClose, onChanged }) {
  const [shift, setShift] = useState(undefined); // undefined: loading · null: no open shift
  const [tab, setTab] = useState('drawer');
  const [history, setHistory] = useState(null);
  const [action, setAction] = useState(null); // 'pay_in' | 'pay_out' | 'close'
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [isBusy, setBusy] = useState(false);
  const [closedShift, setClosedShift] = useState(null);

  const load = useCallback(async () => {
    try {
      setShift(await posClient.get('/pos/shift'));
    } catch (err) {
      setError(err.message);
      setShift(null);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTab('drawer');
    setAction(null);
    setClosedShift(null);
    setError(null);
    setShift(undefined);
    load();
  }, [isOpen, load]);

  useEffect(() => {
    if (isOpen && tab === 'history' && !history) {
      posClient
        .get('/pos/shift/history', { params: { limit: 15 } })
        .then(setHistory)
        .catch((err) => setError(err.message));
    }
  }, [isOpen, tab, history]);

  const startAction = (next) => {
    setAction(next);
    setAmount('');
    setReason('');
    setError(null);
  };

  async function submit(event) {
    event.preventDefault();
    const value = Number(amount);
    const opening = !shift;
    // A float or a count may be zero; cash in or out must be a real amount.
    if (
      amount === '' ||
      !Number.isFinite(value) ||
      value < 0 ||
      (!opening && action !== 'close' && value <= 0)
    ) {
      setError('Enter an amount in rupees.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (opening) {
        await posClient.post('/pos/shift/open', { openingFloat: value });
        // Re-read: the live figures (what should be in the drawer) come from /pos/shift.
        await load();
      } else if (action === 'close') {
        const closed = await posClient.post('/pos/shift/close', {
          countedCash: value,
          note: reason || undefined,
        });
        setClosedShift(closed);
        setShift(null);
        setHistory(null);
      } else {
        setShift(await posClient.post('/pos/shift/movement', { type: action, amount: value, reason }));
      }
      setAction(null);
      setAmount('');
      setReason('');
      onChanged?.();
    } catch (err) {
      setError(err.message ?? 'That did not go through');
    } finally {
      setBusy(false);
    }
  }

  const live = shift?.liveSummary;
  const amountLabel = {
    open: 'Cash in the drawer now',
    pay_in: 'Cash added to the drawer',
    pay_out: 'Cash taken from the drawer',
    close: 'Cash counted in the drawer',
  }[action ?? 'open'];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Cash drawer"
      description="This till's shift and cash."
    >
      <div className="space-y-4">
        <div
          role="group"
          aria-label="View"
          className="flex w-fit rounded-lg border border-border-strong p-0.5"
        >
          {[
            { key: 'drawer', label: 'Drawer', icon: Wallet },
            { key: 'history', label: 'Past shifts', icon: History },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
                tab === t.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {tab === 'history' ? (
          <ShiftHistory shifts={history} />
        ) : shift === undefined ? (
          <SectionLoader label="Loading the drawer" />
        ) : closedShift ? (
          <ClosedSummary shift={closedShift} onNew={() => setClosedShift(null)} />
        ) : !shift ? (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <Unlock className="h-5 w-5 text-gold" aria-hidden="true" />
              <p className="font-semibold">No shift is open on this till</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Count the cash in the drawer and open a shift. Cash sales, cash in and cash out are then added
              up, so the drawer can be checked when you close.
            </p>
            <Input
              label="Opening cash (float)"
              type="number"
              inputMode="numeric"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5000"
              autoFocus
            />
            <Button type="submit" isLoading={isBusy} leftIcon={Unlock}>
              Open shift
            </Button>
          </form>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Opened by <span className="font-medium text-foreground">{shift.cashierName}</span> at{' '}
              {formatTime(shift.openedAt)}
            </p>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {[
                ['Opening cash', shift.openingFloat],
                ['Cash sales', live?.cashRevenue],
                ['Card & wallet sales', live?.nonCashRevenue],
                ['Cash in', shift.paidIn],
                ['Cash out', shift.paidOut],
                [`Sales (${live?.salesCount ?? 0})`, live?.grossRevenue],
              ].map(([label, value]) => (
                <div key={label} className="bg-surface p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{formatCurrency(value ?? 0)}</dd>
                </div>
              ))}
            </dl>

            <div className="flex items-center justify-between rounded-xl border border-gold/40 bg-gold/10 px-4 py-3">
              <span className="text-sm font-medium">Should be in the drawer</span>
              <span className="text-xl font-black tabular-nums text-gold">
                {formatCurrency(shift.expectedCash)}
              </span>
            </div>

            {action ? (
              <form onSubmit={submit} className="space-y-3 rounded-xl border border-border p-4">
                <Input
                  label={amountLabel}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                {action !== 'close' ? (
                  <Input
                    label="Reason"
                    value={reason}
                    maxLength={200}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={
                      action === 'pay_in' ? 'Change from the bank…' : 'Paid the supplier, bought ice…'
                    }
                  />
                ) : (
                  <Input
                    label="Note (optional)"
                    value={reason}
                    maxLength={300}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Anything the manager should know"
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    isLoading={isBusy}
                    variant={action === 'close' ? 'destructive' : 'primary'}
                  >
                    {action === 'close' ? 'Close shift' : 'Record'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setAction(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" leftIcon={ArrowDownLeft} onClick={() => startAction('pay_in')}>
                  Cash in
                </Button>
                <Button variant="secondary" leftIcon={ArrowUpRight} onClick={() => startAction('pay_out')}>
                  Cash out
                </Button>
                <Button
                  variant="outline"
                  leftIcon={Lock}
                  onClick={() => startAction('close')}
                  className="ml-auto"
                >
                  Close shift
                </Button>
              </div>
            )}

            {shift.movements?.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cash in / out this shift
                </p>
                <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                  {shift.movements.map((m, index) => (
                    <li key={index} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{formatTime(m.at)}</span>
                      <span className="min-w-0 flex-1 truncate">{m.reason}</span>
                      <span
                        className={cn(
                          'shrink-0 font-semibold tabular-nums',
                          m.type === 'pay_in' ? 'text-success' : 'text-warning',
                        )}
                      >
                        {m.type === 'pay_in' ? '+' : '−'}
                        {formatCurrency(m.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Variance({ value }) {
  if (value === 0) return <span className="font-semibold text-success">Balanced</span>;
  return (
    <span className={cn('font-semibold', value > 0 ? 'text-warning' : 'text-destructive')}>
      {value > 0 ? 'Over by ' : 'Short by '}
      {formatCurrency(Math.abs(value))}
    </span>
  );
}

function ClosedSummary({ shift, onNew }) {
  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <Lock className="h-5 w-5 text-gold" aria-hidden="true" />
        <p className="font-semibold">Shift closed</p>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Expected</dt>
          <dd className="font-semibold tabular-nums">{formatCurrency(shift.expectedCash)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Counted</dt>
          <dd className="font-semibold tabular-nums">{formatCurrency(shift.countedCash)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Difference</dt>
          <dd>
            <Variance value={shift.variance} />
          </dd>
        </div>
      </dl>
      <Button variant="secondary" leftIcon={Unlock} onClick={onNew}>
        Open the next shift
      </Button>
    </div>
  );
}

function ShiftHistory({ shifts }) {
  if (!shifts) return <SectionLoader label="Loading past shifts" />;
  if (!shifts.length)
    return <p className="py-8 text-center text-sm text-muted-foreground">No closed shifts yet.</p>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
      {shifts.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{s.cashierName}</span>
            <span className="block text-xs text-muted-foreground">
              {formatDateTime(s.openedAt)} – {formatTime(s.closedAt)}
            </span>
          </span>
          <span className="tabular-nums">{formatCurrency(s.countedCash)}</span>
          <Variance value={s.variance} />
        </li>
      ))}
    </ul>
  );
}

export default ShiftModal;
