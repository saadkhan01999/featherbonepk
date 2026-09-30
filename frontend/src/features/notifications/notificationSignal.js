/**
 * A one-line pub/sub between the Notifications page and the bell.
 * ---------------------------------------------------------------------------
 * The bell lives in the top bar and the page lives in the routed area, so they
 * are siblings with no shared parent below the app shell. When the page marks
 * everything read, the bell has to hear about it.
 *
 * Why not just let the poll catch up: it runs once a minute. The user clicks
 * the bell, reads the list, goes back — and the badge is still sitting there
 * showing a count they have just cleared. They click it again. Nothing they can
 * do makes it go away, because the fix is on a timer they cannot see. A stale
 * badge is precisely the complaint this feature exists to answer.
 *
 * Why not context or a store: this is one event with no payload and no state to
 * hold. A context provider wrapping the whole back office, re-rendering every
 * screen, to carry "something happened" would be more moving parts than the
 * problem has.
 */

const EVENT = 'fb:notifications-read';

/** Tell every listener that the unread count should be re-fetched. */
export function announceNotificationsRead() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * Listen for that. Returns an unsubscribe function, so a caller can hand the
 * return value straight back from a `useEffect`.
 */
export function onNotificationsRead(handler) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
