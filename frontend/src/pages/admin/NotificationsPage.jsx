import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ShieldAlert, AlertTriangle, Info, CheckCircle2, ArrowRight, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { cn } from '@/lib/utils.js';
import { announceNotificationsRead } from '@/features/notifications/notificationSignal.js';

/**
 * Notifications.
 * ---------------------------------------------------------------------------
 * Things that need attention right now: stock at zero, orders waiting, reviews
 * unmoderated, tills misconfigured.
 *
 * These are derived from live state, not stored messages — so an alert vanishes
 * the moment the problem is fixed, and there is nothing to dismiss. A stored
 * "low stock" message written on Tuesday would still be sitting here on Friday
 * after the delivery arrived, burying the ones that still matter.
 *
 * The consequence, stated on the page rather than hidden: no history. What is
 * remembered is which alerts you have already seen, so the bell can stop
 * nagging — opening this page marks them read, and the badge returns only when
 * something new appears or an existing count gets worse.
 */

const SEVERITY = {
  critical: {
    icon: ShieldAlert,
    ring: 'border-destructive/40 bg-destructive/5',
    chip: 'bg-destructive/10 text-destructive',
    label: 'Needs attention now',
  },
  warning: {
    icon: AlertTriangle,
    ring: 'border-warning/40 bg-warning/5',
    chip: 'bg-warning/10 text-warning',
    label: 'Worth looking at',
  },
  info: {
    icon: Info,
    ring: 'border-border bg-surface',
    chip: 'bg-surface-hover text-muted-foreground',
    label: 'For information',
  },
};

export function NotificationsPage() {
  const { data: items, isLoading, error, reload } = useResource(() => apiClient.get('/notifications'), []);

  /*
   * Seeing the list is reading it.
   *
   * No "mark all read" button, because there is nothing for it to do that
   * arriving here has not already done — and a button that must be pressed to
   * silence a badge is a chore invented by the software.
   *
   * Fires once per visit, not once per render: `useResource` re-runs on reload,
   * and re-posting on every one would fight the user's own refresh. The ref is
   * what makes it once — a bare dependency array would still re-fire whenever
   * React remounts the route.
   */
  const markedRead = useRef(false);

  useEffect(() => {
    if (markedRead.current || isLoading || error) return;
    markedRead.current = true;

    apiClient
      .post('/notifications/read')
      // Tell the bell immediately; waiting for its next poll leaves a badge the
      // user has visibly just cleared.
      .then(announceNotificationsRead)
      .catch(() => {
        // Non-fatal. The list is still readable; the badge simply clears on the
        // next poll instead. Allow a retry on the next visit.
        markedRead.current = false;
      });
  }, [isLoading, error]);

  if (isLoading) return <SectionLoader label="Checking your business" />;

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
        {error.message ?? 'Could not load notifications.'}
      </div>
    );
  }

  const notifications = items ?? [];
  const urgent = notifications.filter((n) => n.severity !== 'info');

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Live checks against your catalogue, orders and tills. Fix the cause and the alert disappears —
            there is nothing to dismiss.
          </p>
        </div>
        <Button variant="outline" leftIcon={RefreshCw} onClick={reload}>
          Re-check
        </Button>
      </header>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-success/30 bg-success/5 p-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden="true" />
          <h2 className="mt-4 font-semibold">Nothing needs your attention</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Stock is healthy, no orders are waiting, and nothing is misconfigured.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {urgent.length > 0
              ? `${urgent.length} thing${urgent.length === 1 ? '' : 's'} to deal with, ${notifications.length - urgent.length} for information.`
              : `${notifications.length} informational notice${notifications.length === 1 ? '' : 's'}.`}
          </p>

          <ol className="space-y-3">
            {notifications.map((notification) => {
              const meta = SEVERITY[notification.severity] ?? SEVERITY.info;
              const Icon = meta.icon;

              return (
                <li key={notification.id} className={cn('flex gap-4 rounded-2xl border p-5', meta.ring)}>
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      meta.chip,
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{notification.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{notification.body}</p>

                    {notification.action && (
                      <Link
                        to={notification.action.href}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:underline"
                      >
                        {notification.action.label}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>

                  <span className="hidden shrink-0 self-start text-xs text-muted-foreground sm:block">
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
        <p>
          You only see notifications for areas you have permission to act on — a cashier is not shown pending
          reviews, and someone without inventory access is not shown stock warnings.
        </p>
      </div>
    </div>
  );
}

export default NotificationsPage;
