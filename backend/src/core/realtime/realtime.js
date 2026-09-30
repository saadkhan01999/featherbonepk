/**
 * Real-time layer — Socket.IO.
 * ---------------------------------------------------------------------------
 * What travels over the socket: Signals, not data.
 *
 * Every event says "this thing changed" and carries just enough to decide
 * whether you care (an order number, a status, a terminal code). A client that
 * cares re-reads the record through the ordinary REST endpoint, which applies
 * the same authentication, permission checks and redaction as it always has.
 *
 * That is a deliberate security decision, not a shortcut. A socket that pushed
 * full order documents would be a second read path with its own idea of who may
 * see what — and the second copy of an access rule is the one that drifts. Here
 * the socket cannot leak anything the REST API would not already hand over,
 * because it does not carry it.
 *
 * Why SOCKET.IO rather than raw websockets or SSE: it falls back to HTTP long
 * polling on its own. Shared hosting and some proxies drop WebSocket upgrades;
 * with polling fallback the kitchen screen keeps working there, just with a
 * little more latency, instead of silently going stale.
 *
 * Mounted under the API prefix (`/api/v1/socket.io` by default). Whatever
 * already routes `/api` to this process — the Vite dev proxy, cPanel's
 * Passenger rules, Railway — routes the socket too, with no extra rule to
 * forget.
 *
 * Safe before init. Scripts and tests import services that emit; until
 * `initRealtime` runs, every emit is a no-op.
 */
import { Server } from 'socket.io';

import { env } from '../../config/env.config.js';
import { logger } from '../utils/logger.js';
import { verifyAccessToken, verifyPosToken } from '../utils/token.util.js';
import { PERMISSIONS, userCan } from '../constants/roles.js';
import { isAllowedOrigin } from '../../middleware/security.middleware.js';
import { loadActiveUser } from '../../middleware/auth.middleware.js';
import { kitchenIsOpen } from '../../modules/kitchen/kitchen.access.js';

/** Room names, defined once so an emitter and a joiner cannot disagree. */
export const ROOMS = Object.freeze({
  /** Everyone, signed in or not. Public settings changes. */
  PUBLIC: 'public',
  /** Staff who may read orders — back office Orders, Dashboard. */
  ORDERS: 'orders',
  /** Kitchen Display and the Order Status Board. */
  KITCHEN: 'kitchen',
  /** Anyone who may read the catalogue as staff, and every till. */
  CATALOG: 'catalog',
  /** Every signed-in back-office account — notification bell. */
  STAFF: 'staff',
  /** One till. */
  terminal: (code) => `pos:${String(code).toUpperCase()}`,
  /** One order, for the customer watching its tracking page. */
  order: (orderNumber) => `order:${String(orderNumber).toUpperCase()}`,
});

/** Event names, likewise. The frontend mirrors this list in services/realtime.js. */
export const EVENTS = Object.freeze({
  ORDER_CHANGED: 'order:changed',
  CATALOG_CHANGED: 'catalog:changed',
  STOCK_CHANGED: 'stock:changed',
  SETTINGS_CHANGED: 'settings:changed',
  TERMINAL_CHANGED: 'terminal:changed',
  NOTIFICATIONS_CHANGED: 'notifications:changed',
  PAGES_CHANGED: 'pages:changed',
});

/** A customer may watch a handful of orders at once; not an unbounded number. */
const MAX_ORDER_ROOMS = 5;

let io = null;

/**
 * Who is on the other end of this socket?
 *
 * Runs once, at the handshake. A token that fails is refused rather than
 * downgraded to anonymous: a staff screen quietly connected as a stranger would
 * receive no events and look frozen, with nothing saying why. Refused, the
 * client knows to refresh its token and reconnect.
 */
async function authenticate(socket, next) {
  const { token, kind } = socket.handshake.auth ?? {};

  /*
   * A kitchen screen (/kitchen, /display). Signed in with kitchen.view, or —
   * when Settings allows open kitchen screens — no account at all. Either way
   * it joins only the kitchen room: order signals, never customer details.
   */
  if (kind === 'kitchen') {
    if (token) {
      try {
        const user = await loadActiveUser(verifyAccessToken(token));
        if (!user.mustChangePassword && userCan(user, PERMISSIONS.KITCHEN_VIEW)) {
          socket.data.identity = { kind: 'kitchen', open: false, userId: String(user._id) };
          return next();
        }
      } catch {
        // Fall through to open access, if it is on.
      }
    }
    if (kitchenIsOpen()) {
      socket.data.identity = { kind: 'kitchen', open: true };
      return next();
    }
    const refused = new Error('Kitchen screen sign-in required');
    refused.data = { code: 'AUTH_FAILED', reason: 'KITCHEN_SIGN_IN' };
    return next(refused);
  }

  if (!token) {
    socket.data.identity = { kind: 'guest' };
    return next();
  }

  try {
    if (kind === 'pos') {
      const payload = verifyPosToken(token);
      const user = await loadActiveUser(payload);
      if (user.mustChangePassword) throw new Error('PASSWORD_CHANGE_REQUIRED');
      socket.data.identity = {
        kind: 'pos',
        userId: String(user._id),
        terminal: String(payload.terminal ?? '').toUpperCase(),
        store: payload.store ?? null,
      };
      return next();
    }

    const payload = verifyAccessToken(token);
    const user = await loadActiveUser(payload);
    socket.data.identity = {
      kind: 'web',
      userId: String(user._id),
      role: user.role,
      can: (permission) => userCan(user, permission),
    };
    return next();
  } catch (error) {
    // `data` reaches the client's connect_error handler, which is how it knows
    // to refresh rather than give up.
    const refused = new Error('Socket authentication failed');
    refused.data = { code: 'AUTH_FAILED', reason: error.message };
    return next(refused);
  }
}

/** Put a freshly authenticated socket into the rooms its identity entitles it to. */
function joinRooms(socket) {
  const identity = socket.data.identity;
  socket.join(ROOMS.PUBLIC);

  if (identity.kind === 'pos') {
    socket.join(ROOMS.terminal(identity.terminal));
    socket.join(ROOMS.CATALOG);
    return;
  }

  if (identity.kind === 'kitchen') {
    socket.join(ROOMS.KITCHEN);
    return;
  }

  if (identity.kind === 'web') {
    const { can } = identity;
    if (identity.role !== 'customer') socket.join(ROOMS.STAFF);
    if (can(PERMISSIONS.ORDER_VIEW)) socket.join(ROOMS.ORDERS);
    if (can(PERMISSIONS.KITCHEN_VIEW)) socket.join(ROOMS.KITCHEN);
    if (can(PERMISSIONS.PRODUCT_VIEW) || can(PERMISSIONS.INVENTORY_VIEW)) socket.join(ROOMS.CATALOG);
  }
}

/**
 * Attach Socket.IO to the HTTP server. Called once, from server.js.
 * @param {import('node:http').Server} httpServer
 */
export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    path: `${env.API_PREFIX}/socket.io`,
    serveClient: false,
    // Same allow-list as HTTP. A page from an unlisted origin could otherwise
    // open a socket with a stolen token and sit on the order stream.
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: false,
    },
    // Detect a dead till within ~30s rather than the default ~45s.
    pingInterval: 20_000,
    pingTimeout: 10_000,
  });

  io.use(authenticate);

  io.on('connection', (socket) => {
    joinRooms(socket);

    /*
     * Watching one order — the customer's confirmation / tracking page.
     *
     * Open to guests on purpose: the tracking page itself is guest-readable by
     * order number, and this room only ever carries a status word. Capped per
     * socket so a script cannot subscribe to every order number it can guess.
     */
    socket.on('order:watch', (orderNumber, ack) => {
      const room = ROOMS.order(orderNumber);
      const watched = [...socket.rooms].filter((r) => r.startsWith('order:'));
      if (typeof orderNumber !== 'string' || orderNumber.length > 40) return ack?.({ ok: false });
      if (watched.length >= MAX_ORDER_ROOMS && !socket.rooms.has(room)) return ack?.({ ok: false });
      socket.join(room);
      return ack?.({ ok: true });
    });

    socket.on('order:unwatch', (orderNumber) => socket.leave(ROOMS.order(orderNumber)));
  });

  logger.info(`Real-time channel ready at ${env.API_PREFIX}/socket.io`);
  return io;
}

/** Stop accepting sockets and disconnect the ones open. */
export async function closeRealtime() {
  if (!io) return;
  await new Promise((resolve) => io.close(() => resolve()));
  io = null;
}

/** Emit, or do nothing when there is no socket server (scripts, tests, boot). */
function emit(rooms, event, payload) {
  if (!io) return;
  try {
    const list = Array.isArray(rooms) ? rooms : [rooms];
    io.to(list).emit(event, { ...payload, at: new Date().toISOString() });
  } catch (error) {
    // A broadcast failing must never fail the write that triggered it.
    logger.warn('Real-time emit failed', { event, message: error.message });
  }
}

/** The public face of the module: one method per kind of change. */
export const realtime = {
  /**
   * An order was created or moved.
   * @param {object} order A saved order (document or lean).
   * @param {string} action e.g. 'created', 'status', 'payment', 'kitchen'
   */
  orderChanged(order, action = 'updated') {
    if (!order) return;

    const staffPayload = {
      action,
      id: String(order._id ?? order.id),
      orderNumber: order.orderNumber,
      ticketNumber: order.ticketNumber ?? null,
      channel: order.channel,
      orderType: order.orderType ?? null,
      status: order.status,
      paymentStatus: order.paymentStatus,
      terminalId: order.terminalId ?? null,
      store: order.store ? String(order.store) : null,
    };

    const rooms = [ROOMS.ORDERS, ROOMS.KITCHEN, ROOMS.STAFF];
    if (order.terminalId) rooms.push(ROOMS.terminal(order.terminalId));
    emit(rooms, EVENTS.ORDER_CHANGED, staffPayload);

    // The customer's room gets the status word and nothing else.
    emit(ROOMS.order(order.orderNumber), EVENTS.ORDER_CHANGED, {
      action,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
    });
  },

  /** Stock moved on these products (a sale, a return, an adjustment). */
  stockChanged(productIds = []) {
    const ids = [...new Set(productIds.map(String))];
    if (ids.length === 0) return;
    emit(ROOMS.CATALOG, EVENTS.STOCK_CHANGED, { productIds: ids });
  },

  /** A product or category was created, edited or removed. */
  catalogChanged(reason = 'updated', ids = {}) {
    emit([ROOMS.CATALOG, ROOMS.PUBLIC], EVENTS.CATALOG_CHANGED, { reason, ...ids });
  },

  /** Settings sections changed. Public, because public settings are public. */
  settingsChanged(sections = []) {
    emit(ROOMS.PUBLIC, EVENTS.SETTINGS_CHANGED, { sections });

    // Open kitchen screens closed in Settings: disconnect the ones that are not
    // signed in, now — not whenever they next happen to reconnect.
    if (io && sections.includes('kitchen') && !kitchenIsOpen()) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.identity?.kind === 'kitchen' && socket.data.identity.open) socket.disconnect(true);
      }
    }
  },

  /** A till's configuration changed — it should re-read its menu scope. */
  terminalChanged(code) {
    if (!code) return;
    emit([ROOMS.terminal(code), ROOMS.STAFF], EVENTS.TERMINAL_CHANGED, { code: String(code).toUpperCase() });
  },

  /** Something that feeds the notification bell moved. */
  notificationsChanged() {
    emit(ROOMS.STAFF, EVENTS.NOTIFICATIONS_CHANGED, {});
  },

  /** A custom page was published, edited or removed. */
  pagesChanged() {
    emit(ROOMS.PUBLIC, EVENTS.PAGES_CHANGED, {});
  },

  /** How many sockets are connected — for /health. */
  connectionCount() {
    return io ? io.engine.clientsCount : 0;
  },
};

export default realtime;
