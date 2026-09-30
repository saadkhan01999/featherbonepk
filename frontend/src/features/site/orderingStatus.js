import { useEffect } from 'react';
import { create } from 'zustand';

import { apiClient } from '@/services/apiClient.js';
import { EVENTS, useRealtimeEvent } from '@/services/realtime.js';

/**
 * Is the shop taking website orders right now?
 * ---------------------------------------------------------------------------
 * Asked of the server (`/settings/ordering-status`), which works it out from
 * the owner's weekly hours in Pakistan time — never from the visitor's clock,
 * which may be wrong or in another country. The server also refuses an order
 * placed while closed, so this is what the website shows, not what protects it.
 *
 * Kept fresh without a reload: re-read every minute, the moment the tab comes
 * back into view, exactly when the shop is due to open or close, and whenever
 * the owner changes the hours.
 */

export const useOrderingStore = create((set) => ({
  status: null,
  async refresh() {
    try {
      set({ status: await apiClient.get('/settings/ordering-status') });
    } catch {
      /* keep the last known status; the server still guards the order itself */
    }
  },
}));

let watchers = 0;
let stopWatching = null;

/** One shared timer however many components ask. */
function startWatching() {
  watchers += 1;
  if (stopWatching) return;

  const { refresh } = useOrderingStore.getState();
  refresh();

  const interval = setInterval(refresh, 60_000);
  const onVisible = () => !document.hidden && refresh();
  document.addEventListener('visibilitychange', onVisible);

  // Re-check exactly at the next opening or closing time.
  let edgeTimer = null;
  const unsubscribe = useOrderingStore.subscribe(({ status }) => {
    clearTimeout(edgeTimer);
    const edge = status?.isOpen ? status.closesAt : status?.opensAt;
    const wait = edge ? new Date(edge).getTime() - Date.now() + 1_500 : null;
    if (wait && wait > 0 && wait < 24 * 60 * 60 * 1000) edgeTimer = setTimeout(refresh, wait);
  });

  stopWatching = () => {
    clearInterval(interval);
    clearTimeout(edgeTimer);
    document.removeEventListener('visibilitychange', onVisible);
    unsubscribe();
    stopWatching = null;
  };
}

function releaseWatching() {
  watchers -= 1;
  if (watchers <= 0) {
    watchers = 0;
    stopWatching?.();
  }
}

/** The current status (null until the first answer). */
export function useOrderingStatus() {
  const status = useOrderingStore((s) => s.status);
  const refresh = useOrderingStore((s) => s.refresh);

  useEffect(() => {
    startWatching();
    return releaseWatching;
  }, []);

  useRealtimeEvent('guest', EVENTS.SETTINGS_CHANGED, (event) => {
    if (event?.sections?.includes('hours')) refresh();
  });

  return status;
}

/** "in 2 h 14 min", "in 5 min", "any minute now". */
export function timeUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (minutes <= 1) return 'any minute now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
