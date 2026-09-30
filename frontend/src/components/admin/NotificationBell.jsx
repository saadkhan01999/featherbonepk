import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';

import { apiClient } from '@/services/apiClient.js';
import { ROUTES } from '@/constants/routes.js';
import { cn } from '@/lib/utils.js';
import { onNotificationsRead } from '@/features/notifications/notificationSignal.js';
import { EVENTS, getSocket } from '@/services/realtime.js';

/**
 * The notification bell in the top bar.
 * ---------------------------------------------------------------------------
 * This was a `<button>` with no click handler and a gold dot rendered
 * unconditionally — so it went nowhere, and it claimed there was something to
 * see whether or not anything needed attention. Both halves were decoration.
 *
 * Now it links to the Notifications screen and shows the real count. When
 * nothing needs doing, there is no dot: a badge that is always lit teaches
 * people to ignore it, which costs you the one time it matters.
 *
 * It polls rather than holding a socket open. A count that is a minute stale is
 * fine — these are "you are low on naan", not "the building is on fire" — and a
 * websocket per signed-in admin is a lot of machinery for one integer.
 */

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const [count, setCount] = useState({ total: 0, unread: 0, urgent: 0 });

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const data = await apiClient.get('/notifications/count');
        if (!cancelled && data) setCount(data);
      } catch {
        // Non-fatal: a failed count must never break the shell around it. The
        // bell simply keeps its last known value.
      }
    };

    /*
     * Poll only while the tab is visible.
     *
     * A back-office tab left open all day in the background was asking the
     * server for a count nobody could see, once a minute, forever — and on a
     * hosted database each of those is a real query. Nothing is lost by
     * pausing: the moment the tab is looked at again, `read()` runs immediately,
     * so what the user sees on return is fresh rather than a minute stale.
     */
    let timer = null;

    const start = () => {
      if (timer) return;
      read();
      timer = setInterval(read, POLL_INTERVAL_MS);
    };

    const stop = () => {
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Opening the list clears the badge now, not at the next poll.
    const unsubscribe = onNotificationsRead(read);

    // Live: the server signals when an alert is raised (a new order, low stock,
    // a kitchen ticket) — the poll above is only the fallback.
    const socket = getSocket('web');
    socket.on(EVENTS.NOTIFICATIONS_CHANGED, read);
    socket.on(EVENTS.ORDER_CHANGED, read);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
      socket.off(EVENTS.NOTIFICATIONS_CHANGED, read);
      socket.off(EVENTS.ORDER_CHANGED, read);
    };
  }, []);

  /*
   * The badge counts unread alerts: opening the list clears it, and it returns
   * only when something new appears or a count gets worse.
   */
  const { total, unread = 0, urgent = 0 } = count;
  const label =
    unread === 0
      ? total === 0
        ? 'Notifications — nothing needs attention'
        : `Notifications — ${total} item${total === 1 ? '' : 's'}, all read`
      : `Notifications — ${unread} new${urgent > 0 ? `, ${urgent} urgent` : ''}`;

  return (
    <Link
      to={ROUTES.ADMIN_NOTIFICATIONS}
      aria-label={label}
      title={label}
      className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />

      {unread > 0 && (
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums',
            // Urgent items are red; purely informational ones are gold. The
            // colour is the whole point — it says whether to look now or later.
            urgent > 0 ? 'bg-destructive text-white' : 'bg-gold text-gold-foreground',
          )}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

export default NotificationBell;
