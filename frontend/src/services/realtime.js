import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { create } from 'zustand';

import { config } from '@/config/env.js';
import { getAccessToken, refreshSession, posSession } from '@/services/apiClient.js';

/**
 * Live updates from the API (Socket.IO).
 * ---------------------------------------------------------------------------
 * The socket carries signals, not data. An event says "order FB-… is now
 * ready" or "stock moved on these products"; the screen that cares then
 * re-reads through the ordinary REST API, with the ordinary permission checks.
 * So nothing can reach a screen over the socket that the API would not already
 * hand it — see backend core/realtime/realtime.js.
 *
 * Three identities, three sockets — mirroring the token families:
 *
 *   guest    the storefront: settings, pages, the order a customer is tracking
 *   web      a signed-in staff session: orders, kitchen, catalogue, bell
 *   pos      a till: its own tickets, stock, its menu scope
 *   kitchen  the Kitchen Display and Order Board — signed in, or an open
 *            kitchen screen with no account (Settings → Kitchen Display)
 *
 * The token is read fresh on every (re)connect through `auth` as a function —
 * a 15-minute access token captured once would lock the socket out of every
 * reconnect after the first quarter hour.
 */

/** Must match events in backend core/realtime/realtime.js. */
export const EVENTS = Object.freeze({
  ORDER_CHANGED: 'order:changed',
  CATALOG_CHANGED: 'catalog:changed',
  STOCK_CHANGED: 'stock:changed',
  SETTINGS_CHANGED: 'settings:changed',
  TERMINAL_CHANGED: 'terminal:changed',
  NOTIFICATIONS_CHANGED: 'notifications:changed',
  PAGES_CHANGED: 'pages:changed',
});

/** Connection state per identity — drives the "● Online" dots. */
export const useConnectionStore = create(() => ({
  guest: 'idle',
  web: 'idle',
  pos: 'idle',
  kitchen: 'idle',
}));

const setStatus = (kind, status) => useConnectionStore.setState({ [kind]: status });

/** Origin + path for the socket, derived from the API base so they cannot disagree. */
function endpoint() {
  const url = new URL(config.apiUrl, window.location.origin);
  return { origin: url.origin, path: `${url.pathname.replace(/\/+$/, '')}/socket.io` };
}

const sockets = { guest: null, web: null, pos: null, kitchen: null };

/*
 * Does this API have a live channel at all?
 *
 * Not every host can run one. On Vercel the API is a set of functions that
 * cannot hold a socket open, so nothing answers at /socket.io — the request
 * reaches the API's ordinary 404 handler instead. That answer is a fact about
 * the deployment, not a blip, and retrying it is pure cost: every open tab would
 * call the API about twelve times a minute, forever, and on a platform billed
 * per invocation a kitchen screen left open all day would spend the month's
 * allowance on its own.
 *
 * So the first 404 ends every socket for the rest of the page's life. Each
 * status goes to 'offline', which is what the screens already handle: the
 * Kitchen Display and Order Board poll, the till polls, and the screens that
 * relied on the socket alone poll through usePollWhileOffline below.
 *
 * Only a 404 means this. A refused WebSocket, a 5xx, a timeout or a network
 * drop are all transient, and keep the normal backoff.
 */
let channelMissing = false;

/** The handshake was answered by the API itself — "no such route". */
const isMissingChannel = (error) => error?.description === 404;

function giveUpOnLiveChannel() {
  if (channelMissing) return;
  channelMissing = true;
  for (const [kind, socket] of Object.entries(sockets)) {
    if (!socket) continue;
    socket.io.reconnection(false);
    socket.disconnect();
    setStatus(kind, 'offline');
  }
}

function createSocket(kind) {
  const { origin, path } = endpoint();

  const socket = io(origin, {
    path,
    // A socket created after the channel was found missing never dials out.
    autoConnect: !channelMissing,
    reconnection: !channelMissing,
    // WebSocket first; long polling when a proxy refuses the upgrade.
    transports: ['websocket', 'polling'],
    /*
     * Without this the fallback above never happens. engine.io-client only
     * tries the FIRST transport unless tryAllTransports is set (it defaults to
     * false): a failed WebSocket is retried as a WebSocket, forever, and the
     * second entry in the list is never reached. On shared hosting that drops
     * the upgrade — cPanel behind some Apache/LiteSpeed setups — the Kitchen
     * Display, Order Board and live order updates would sit on "connecting"
     * indefinitely while every REST call works. With it, a refused WebSocket
     * falls through to long polling on the same attempt.
     */
    tryAllTransports: true,
    auth: (cb) => {
      if (kind === 'web') cb({ token: getAccessToken(), kind: 'web' });
      else if (kind === 'pos') cb({ token: posSession.token, kind: 'pos' });
      // A kitchen screen sends its staff token when there is one (then its
      // actions carry a name) and connects without one when the screens are open.
      else if (kind === 'kitchen')
        cb({ ...(getAccessToken() && { token: getAccessToken() }), kind: 'kitchen' });
      else cb({});
    },
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    // A till or kitchen screen must keep trying for as long as it is open.
    reconnectionAttempts: Infinity,
  });

  setStatus(kind, channelMissing ? 'offline' : 'connecting');

  socket.on('connect', () => setStatus(kind, 'online'));
  socket.on('disconnect', () => setStatus(kind, 'offline'));
  socket.io.on('reconnect_attempt', () => setStatus(kind, 'connecting'));

  let refreshing = false;
  socket.on('connect_error', async (error) => {
    setStatus(kind, 'offline');

    if (isMissingChannel(error)) {
      giveUpOnLiveChannel();
      return;
    }

    /*
     * An expired staff token: refresh it once through the same single-flight
     * refresh the HTTP client uses (rotating refresh tokens must never be
     * exchanged twice at once), then try again. Anything else is left to the
     * socket's own backoff.
     */
    const canRefresh = kind === 'web' || (kind === 'kitchen' && getAccessToken());
    if (canRefresh && error?.data?.code === 'AUTH_FAILED' && !refreshing) {
      refreshing = true;
      try {
        await refreshSession();
        socket.connect();
      } catch {
        // The session is really over; the HTTP layer will send them to sign in.
      } finally {
        refreshing = false;
      }
    }
  });

  return socket;
}

/** The socket for an identity, created on first use. */
export function getSocket(kind = 'guest') {
  if (!sockets[kind]) sockets[kind] = createSocket(kind);
  return sockets[kind];
}

/**
 * Reconnect an existing socket with fresh credentials — after a sign-in, or
 * when a different person signs in on the same browser.
 *
 * The same socket instance is kept, deliberately: components subscribed with
 * `useRealtimeEvent` hold listeners on it, and replacing the instance would
 * leave them listening to a dead socket while the new one talked to nobody.
 */
export function reconnectSocket(kind) {
  const socket = sockets[kind];
  if (!socket || channelMissing) return;
  socket.disconnect();
  socket.connect();
}

/** Stop a socket without discarding it — on sign-out. `reconnectSocket` resumes it. */
export function disconnectSocket(kind) {
  const socket = sockets[kind];
  if (!socket) return;
  socket.disconnect();
  setStatus(kind, 'idle');
}

/**
 * Subscribe a component to one event on one socket.
 *
 * The handler is held in a ref, so an inline arrow does not resubscribe on
 * every render — and the latest closure is always the one called.
 */
export function useRealtimeEvent(kind, event, handler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = getSocket(kind);
    const listener = (payload) => handlerRef.current?.(payload);
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }, [kind, event, enabled]);
}

/**
 * Re-read on a timer for as long as this identity's live channel is not
 * connected — the Kitchen Display's "polling safety net", for any screen.
 *
 * A screen that refreshes only when a socket event arrives is frozen without
 * one: during an outage, on a host with no live channel (Vercel), or behind a
 * network that drops WebSockets. With this it stays current, just less
 * promptly. While the socket is online the timer does not run at all, so a
 * healthy deployment pays nothing for it. A hidden tab skips its ticks: no one
 * is looking, and every tick is a request.
 *
 * @param {'guest'|'web'|'pos'|'kitchen'} kind
 * @param {() => void} callback  the screen's own reload
 * @param {number} intervalMs
 * @param {boolean} [enabled]    e.g. false once an order can no longer change
 */
export function usePollWhileOffline(kind, callback, intervalMs, enabled = true) {
  const live = useConnectionStore((s) => s[kind] === 'online');
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || live) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      callbackRef.current?.();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, live, intervalMs]);
}

/**
 * Run `callback` at most once per `wait` ms, however many events arrive.
 *
 * A busy lunch fires a dozen order events a minute; each should not trigger its
 * own re-fetch. The first event schedules one read; the rest join it.
 */
export function useDebouncedCallback(callback, wait = 400) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  return useRef((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => callbackRef.current?.(...args), wait);
  }).current;
}

/** Ask the server to send this order's status changes to this browser. */
export function watchOrder(orderNumber) {
  const socket = getSocket('guest');
  const join = () => socket.emit('order:watch', orderNumber);
  if (socket.connected) join();
  // Rooms do not survive a reconnect — rejoin every time.
  socket.on('connect', join);
  return () => {
    socket.off('connect', join);
    socket.emit('order:unwatch', orderNumber);
  };
}
