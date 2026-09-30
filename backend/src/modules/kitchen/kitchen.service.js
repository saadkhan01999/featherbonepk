/**
 * Kitchen tickets, preparation stations and the counter Order Board.
 *
 * A ticket is the order itself (no copy to keep in sync): the kitchen screens
 * read live orders that have a ticket number, and every button moves the order
 * through orderService.transition, so the till, the Order Board, the back
 * office and the customer's tracking page all see the same state.
 *
 * Stations: each line of a fired order belongs to a station ("Kitchen",
 * "Chicken Counter"…) and each station accepts and completes its own share.
 * The order is preparing once any station starts and ready when every station
 * is done. The all-stations view acts on the whole order at once.
 *
 *   Confirmed  "New"        fired from a till, or forwarded from the back office
 *   preparing  "Preparing"  a station accepted
 *   ready      "Ready"      every station is done — shows on the Order Board
 *   completed  "Served"     handed over (a website order goes OUT_FOR_DELIVERY)
 *
 * Live means fired in the last 24 hours; closeStaleTickets closes forgotten
 * paid till tickets after the configured number of hours.
 */
import mongoose from 'mongoose';

import { ApiError } from '../../core/errors/ApiError.js';
import { logger } from '../../core/utils/logger.js';
import { realtime } from '../../core/realtime/realtime.js';
import { Order } from '../orders/order.model.js';
import { Terminal } from '../pos/terminal.model.js';
import { Store } from '../stores/store.model.js';
import { UNITS } from '../catalog/product.model.js';
import { assignTicket, kitchenRules, orderService } from '../orders/order.service.js';
import { stationService } from '../stations/station.service.js';
import { kitchenSettings } from '../settings/settings.service.js';
import { resolveRange } from '../reports/report.service.js';
import { ORDER_STATUS, PAYMENT_STATUS, ORDER_TYPE, KITCHEN_ACTIVE } from '../../core/constants/payments.js';

const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How the kitchen names each status. */
export const KITCHEN_STAGE = Object.freeze({
  [ORDER_STATUS.CONFIRMED]: 'new',
  [ORDER_STATUS.PREPARING]: 'preparing',
  [ORDER_STATUS.READY]: 'ready',
});

/** One station's stage on an order. */
function stationStage(work, orderStatus) {
  if (!KITCHEN_ACTIVE.includes(orderStatus)) return 'done';
  if (work.readyAt || orderStatus === ORDER_STATUS.READY) return 'ready';
  if (work.acceptedAt) return 'preparing';
  return 'new';
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** An order fired before stations existed belongs to the catch-all station. */
const isUnrouted = (order) => !order.kitchen?.stations?.length;

/**
 * Everything a kitchen card or print-out draws.
 * @param {object} [station] when given, the card shows only that station's lines and progress
 */
function toTicket(order, names = {}, station = null) {
  const orderType = order.orderType ?? (order.channel === 'pos' ? ORDER_TYPE.TAKE_AWAY : ORDER_TYPE.DELIVERY);
  const work = order.kitchen?.stations ?? [];
  const mine = station ? work.find((w) => sameId(w.station, station._id)) : null;

  const items = (order.items ?? []).map((item, index) => ({
    index,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    unitLabel: UNITS[item.unit]?.label ?? item.unit,
    isWeighed: UNITS[item.unit]?.isWeight ?? false,
    station: item.station ? String(item.station) : null,
    stationName: item.stationName ?? null,
  }));
  const shown = station && !isUnrouted(order) ? items.filter((i) => sameId(i.station, station._id)) : items;

  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    ticketNumber: order.ticketNumber,
    channel: order.channel,
    orderType,
    tableNumber: order.tableNumber ?? null,
    terminalId: order.terminalId ?? null,
    terminalName: order.terminalId ? (names.terminals?.get(order.terminalId) ?? order.terminalId) : null,
    storeName: order.store ? (names.stores?.get(String(order.store)) ?? null) : null,
    customerName: order.customerName ?? null,
    kitchenNote: order.kitchenNote ?? null,
    deliveryNote: order.deliveryAddress?.notes ?? null,
    forwardedBy: order.kitchen?.forwardedBy ?? null,
    items: shown,
    /** Every station on the order and how far each has got — the all-stations view shows these. */
    stations: work.map((w) => ({
      id: String(w.station),
      name: w.name,
      color: w.color ?? null,
      stage: stationStage(w, order.status),
    })),
    status: order.status,
    stage: mine ? stationStage(mine, order.status) : (KITCHEN_STAGE[order.status] ?? 'done'),
    paymentStatus: order.paymentStatus,
    total: order.total,
    firedAt: mine?.firedAt ?? order.kitchen?.firedAt ?? order.createdAt,
    acceptedAt: mine ? mine.acceptedAt : (order.kitchen?.acceptedAt ?? null),
    acceptedBy: mine ? mine.acceptedBy : (order.kitchen?.acceptedBy ?? null),
    readyAt: mine ? mine.readyAt : (order.kitchen?.readyAt ?? null),
    readyBy: mine ? mine.readyBy : (order.kitchen?.readyBy ?? null),
    servedAt: order.kitchen?.servedAt ?? null,
  };
}

/** Terminal and store names for a batch of orders, in two queries. */
async function namesFor(orders) {
  const terminalCodes = [...new Set(orders.map((o) => o.terminalId).filter(Boolean))];
  const storeIds = [...new Set(orders.map((o) => o.store && String(o.store)).filter(Boolean))];

  const [terminals, stores] = await Promise.all([
    terminalCodes.length
      ? Terminal.find({ code: { $in: terminalCodes } })
          .select('code name')
          .lean()
      : [],
    storeIds.length
      ? Store.find({ _id: { $in: storeIds } })
          .select('name')
          .lean()
      : [],
  ]);

  return {
    terminals: new Map(terminals.map((t) => [t.code, t.name])),
    stores: new Map(stores.map((s) => [String(s._id), s.name])),
  };
}

/**
 * Which tickets a kitchen screen shows.
 * @param {object} options
 * @param {string} [options.store]    one counter's till tickets (website orders still shown unless channel=pos)
 * @param {'all'|'pos'|'online'} [options.channel]
 * @param {object} [options.station]  one station's work
 */
function scopeFilter({ store, channel = 'all', station = null } = {}) {
  const rules = kitchenSettings();
  const clauses = [{ ticketNumber: { $ne: null } }];

  const wantsOnline = channel !== 'pos' && rules.websiteOrders !== 'off';
  const wantsPos = channel !== 'online';

  if (!wantsOnline && !wantsPos) return null;
  if (!wantsOnline) clauses.push({ channel: 'pos' });
  if (!wantsPos) clauses.push({ channel: 'online' });

  if (store && mongoose.isValidObjectId(store)) {
    clauses.push({
      $or: [{ channel: 'online' }, { store: new mongoose.Types.ObjectId(String(store)) }],
    });
  }

  if (station) {
    clauses.push(
      station.isDefault
        ? { $or: [{ 'kitchen.stations.station': station._id }, { 'kitchen.stations.0': { $exists: false } }] }
        : { 'kitchen.stations.station': station._id },
    );
  }

  return clauses;
}

const EMPTY_COUNTS = Object.freeze({ new: 0, preparing: 0, ready: 0, completed: 0 });

export const kitchenService = {
  /** Live tickets, oldest first, plus today's finished ones and the counts for the tabs. */
  async listTickets({ store, channel = 'all', station: stationKey } = {}) {
    const station = await stationService.resolve(stationKey);
    const clauses = scopeFilter({ store, channel, station });
    if (!clauses) return { tickets: [], completed: [], counts: { ...EMPTY_COUNTS } };

    const since = new Date(Date.now() - LIVE_WINDOW_MS);
    const { from: todayStart } = resolveRange({ preset: 'today' });

    const [live, completed] = await Promise.all([
      Order.find({
        $and: [...clauses, { status: { $in: KITCHEN_ACTIVE } }, { 'kitchen.firedAt': { $gte: since } }],
      })
        .sort({ 'kitchen.firedAt': 1 })
        .limit(200)
        .lean(),
      Order.find({
        $and: [
          ...clauses,
          { status: { $nin: [...KITCHEN_ACTIVE, ORDER_STATUS.CANCELLED] } },
          { 'kitchen.readyAt': { $gte: todayStart } },
        ],
      })
        .sort({ 'kitchen.readyAt': -1 })
        .limit(60)
        .lean(),
    ]);

    const names = await namesFor([...live, ...completed]);
    const tickets = live.map((order) => toTicket(order, names, station));

    return {
      station: station ? { id: String(station._id), name: station.name, slug: station.slug } : null,
      tickets,
      completed: completed.map((order) => toTicket(order, names, station)),
      counts: {
        new: tickets.filter((t) => t.stage === 'new').length,
        preparing: tickets.filter((t) => t.stage === 'preparing').length,
        ready: tickets.filter((t) => t.stage === 'ready').length,
        completed: completed.length,
      },
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * The counter pickup board: numbers only, grouped by stage. Only orders a
   * customer collects (dine-in and take-away from the tills) — deliveries never
   * go on a public screen.
   */
  async board({ store } = {}) {
    const rules = kitchenSettings();
    const since = new Date(Date.now() - LIVE_WINDOW_MS);
    const readyCutoff = new Date(Date.now() - rules.display.readyMinutes * 60 * 1000);

    const filter = {
      channel: 'pos',
      ticketNumber: { $ne: null },
      'kitchen.firedAt': { $gte: since },
      $or: [
        { status: { $in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING] } },
        { status: ORDER_STATUS.READY, 'kitchen.readyAt': { $gte: readyCutoff } },
      ],
      ...(store && mongoose.isValidObjectId(store) && { store: new mongoose.Types.ObjectId(String(store)) }),
    };

    const orders = await Order.find(filter)
      .select('ticketNumber orderType tableNumber status kitchen createdAt')
      .sort({ 'kitchen.firedAt': 1 })
      .limit(120)
      .lean();

    const shape = (order) => ({
      id: String(order._id),
      ticketNumber: order.ticketNumber,
      orderType: order.orderType ?? ORDER_TYPE.TAKE_AWAY,
      tableNumber: order.tableNumber ?? null,
      firedAt: order.kitchen?.firedAt ?? order.createdAt,
      readyAt: order.kitchen?.readyAt ?? null,
    });

    return {
      title: rules.display.title,
      message: rules.display.message,
      preparing: orders.filter((o) => o.status !== ORDER_STATUS.READY).map(shape),
      // Most recently ready first: that is the number people are looking for.
      ready: orders
        .filter((o) => o.status === ORDER_STATUS.READY)
        .map(shape)
        .sort((a, b) => new Date(b.readyAt) - new Date(a.readyAt)),
      generatedAt: new Date().toISOString(),
    };
  },

  /** A live ticket by id, or a plain 404. */
  async ticket(id) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid ticket');
    const order = await Order.findById(id).lean();
    if (!order || !order.ticketNumber) throw ApiError.notFound('Ticket');
    return order;
  },

  /** Move the whole order, tolerating another screen having just done the same. */
  async advance(order, status, actor, note, { moveStations = true } = {}) {
    try {
      await orderService.transition(order.orderNumber, status, {
        note,
        actorId: actor.id,
        actorName: actor.fullName,
        moveStations,
      });
    } catch (error) {
      if (error?.code !== 'ORDER_CHANGED') throw error;
    }
  },

  /** The station's share of this order, or null when the whole order is meant. */
  async workFor(order, stationKey) {
    if (!stationKey) return null;
    const station = await stationService.resolve(stationKey);
    if (isUnrouted(order) && station.isDefault) return null; // an older ticket: the whole order is the catch-all's
    const work = (order.kitchen?.stations ?? []).find((w) => sameId(w.station, station._id));
    if (!work) throw ApiError.badRequest(`Ticket #${order.ticketNumber} has nothing for ${station.name}.`);
    return { station, work };
  },

  /** Record one station's step with a conditional update, so two screens cannot both win. */
  async updateWork(order, station, match, set) {
    const result = await Order.updateOne(
      {
        _id: order._id,
        status: { $in: KITCHEN_ACTIVE },
        'kitchen.stations': { $elemMatch: { station: station._id, ...match } },
      },
      { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`kitchen.stations.$.${k}`, v])) },
    );
    return result.modifiedCount > 0;
  },

  async respond(orderId, station) {
    const fresh = await Order.findById(orderId).lean();
    realtime.orderChanged(fresh, 'kitchen');
    return toTicket(fresh, {}, station);
  },

  /** New → Preparing, for one station or the whole order. */
  async accept(id, actor, { station: stationKey } = {}) {
    const order = await this.ticket(id);
    const target = await this.workFor(order, stationKey);

    if (!target) {
      if (order.status !== ORDER_STATUS.CONFIRMED) {
        throw ApiError.conflict(
          `Ticket #${order.ticketNumber} is already ${KITCHEN_STAGE[order.status] ?? order.status}.`,
        );
      }
      await this.advance(order, ORDER_STATUS.PREPARING, actor, `Accepted by the kitchen (${actor.fullName})`);
      return this.respond(order._id, null);
    }

    const { station, work } = target;
    if (work.acceptedAt || work.readyAt) {
      throw ApiError.conflict(`${station.name} has already started ticket #${order.ticketNumber}.`);
    }
    const moved = await this.updateWork(
      order,
      station,
      { acceptedAt: null },
      { acceptedAt: new Date(), acceptedBy: actor.fullName },
    );
    if (!moved) throw ApiError.conflict(`${station.name} has already started ticket #${order.ticketNumber}.`);

    if (order.status === ORDER_STATUS.CONFIRMED) {
      await this.advance(
        order,
        ORDER_STATUS.PREPARING,
        actor,
        `${station.name} started (${actor.fullName})`,
        {
          moveStations: false,
        },
      );
    }
    return this.respond(order._id, station);
  },

  /**
   * Done → Ready, for one station or the whole order. Allowed straight from New:
   * a cold drink needs no preparing. The order becomes ready when the last
   * station finishes.
   */
  async markReady(id, actor, { station: stationKey } = {}) {
    const order = await this.ticket(id);
    const target = await this.workFor(order, stationKey);

    if (!target) {
      if (![ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING].includes(order.status)) {
        throw ApiError.conflict(
          `Ticket #${order.ticketNumber} is already ${KITCHEN_STAGE[order.status] ?? order.status}.`,
        );
      }
      if (order.status === ORDER_STATUS.CONFIRMED) {
        await this.advance(
          order,
          ORDER_STATUS.PREPARING,
          actor,
          `Accepted by the kitchen (${actor.fullName})`,
        );
      }
      await this.advance(order, ORDER_STATUS.READY, actor, `Ready — marked by ${actor.fullName}`);
      return this.respond(order._id, null);
    }

    const { station, work } = target;
    if (work.readyAt || order.status === ORDER_STATUS.READY) {
      throw ApiError.conflict(`${station.name} has already finished ticket #${order.ticketNumber}.`);
    }
    const now = new Date();
    const moved = await this.updateWork(
      order,
      station,
      { readyAt: null },
      {
        readyAt: now,
        readyBy: actor.fullName,
        ...(!work.acceptedAt && { acceptedAt: now, acceptedBy: actor.fullName }),
      },
    );
    if (!moved)
      throw ApiError.conflict(`${station.name} has already finished ticket #${order.ticketNumber}.`);

    const fresh = await Order.findById(order._id).lean();
    const allDone = (fresh.kitchen?.stations ?? []).every((w) => w.readyAt);

    if (fresh.status === ORDER_STATUS.CONFIRMED) {
      await this.advance(
        fresh,
        ORDER_STATUS.PREPARING,
        actor,
        `${station.name} started (${actor.fullName})`,
        {
          moveStations: false,
        },
      );
    }
    if (allDone) {
      await this.advance(
        fresh,
        ORDER_STATUS.READY,
        actor,
        `Ready — ${station.name} finished last (${actor.fullName})`,
      );
    }
    return this.respond(order._id, station);
  },

  /** Ready → handed over: a till order is COMPLETED, a website order goes OUT FOR DELIVERY. */
  async serve(id, actor) {
    const order = await this.ticket(id);
    if (order.status !== ORDER_STATUS.READY) {
      throw ApiError.conflict(`Ticket #${order.ticketNumber} is not ready yet.`);
    }
    const next = order.channel === 'online' ? ORDER_STATUS.OUT_FOR_DELIVERY : ORDER_STATUS.COMPLETED;
    const updated = await orderService.transition(order.orderNumber, next, {
      note:
        next === ORDER_STATUS.COMPLETED
          ? `Served — ${actor.fullName}`
          : `Handed to the rider — ${actor.fullName}`,
      actorId: actor.id,
      actorName: actor.fullName,
    });
    return toTicket(updated);
  },

  /* ---------------------------------------------------------------------- */
  /* Back office: website orders waiting to be forwarded                     */
  /* ---------------------------------------------------------------------- */

  /** Confirmed website orders nobody has sent to the kitchen yet, oldest first, with a suggested station per line. */
  async incoming() {
    const rules = kitchenRules();
    const [orders, awaitingPayment, stations] = await Promise.all([
      Order.find({ channel: 'online', status: ORDER_STATUS.CONFIRMED, 'kitchen.firedAt': null })
        .sort({ createdAt: 1 })
        .limit(50)
        .lean(),
      Order.countDocuments({
        channel: 'online',
        status: ORDER_STATUS.PENDING,
        paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.AWAITING_VERIFICATION] },
      }),
      stationService.active(),
    ]);

    const suggested = await stationService.routeLines(
      orders.flatMap((o) => o.items ?? []),
      stations,
    );
    let cursor = 0;

    return {
      mode: rules.websiteOrders,
      kitchenEnabled: rules.enabled,
      awaitingPayment,
      stations: stations.map((s) => ({
        id: String(s._id),
        name: s.name,
        color: s.color,
        isDefault: s.isDefault,
      })),
      orders: orders.map((order) => ({
        id: String(order._id),
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        customerName: order.customerName,
        customerPhone: order.customerPhone ?? null,
        address: order.deliveryAddress
          ? {
              line1: order.deliveryAddress.line1 ?? null,
              area: order.deliveryAddress.area ?? null,
              city: order.deliveryAddress.city ?? null,
              notes: order.deliveryAddress.notes ?? null,
            }
          : null,
        paymentMethod: order.paymentMethod ?? null,
        paymentStatus: order.paymentStatus,
        total: order.total,
        kitchenNote: order.kitchenNote ?? null,
        items: (order.items ?? []).map((item, index) => {
          const station = suggested[cursor++];
          return {
            index,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            unitLabel: UNITS[item.unit]?.label ?? item.unit,
            suggestedStation: station ? String(station._id) : null,
          };
        }),
      })),
    };
  },

  /**
   * Send a website order to the stations.
   * @param {object} body
   * @param {Array<{index: number, station: string|null}>} [body.lines] null = needs no preparing; omitted lines follow their category
   * @param {string} [body.kitchenNote]
   */
  async forward(orderNumber, { lines = [], kitchenNote } = {}, actor) {
    const order = await Order.findOne({ orderNumber: String(orderNumber).toUpperCase() });
    if (!order) throw ApiError.notFound('Order');
    if (order.channel !== 'online') {
      throw ApiError.badRequest(
        'Only website orders are forwarded — till orders go to the kitchen from the till.',
      );
    }
    const rules = kitchenRules();
    if (!rules.enabled) {
      throw ApiError.badRequest('The kitchen screens are switched off in Settings → Kitchen Display.');
    }
    if (rules.websiteOrders === 'off') {
      throw ApiError.badRequest(
        'Website orders are set never to go to the kitchen screens (Settings → Kitchen Display → Website orders).',
      );
    }
    if (order.kitchen?.firedAt) {
      throw ApiError.conflict(
        `Order ${order.orderNumber} is already with the kitchen (ticket #${order.ticketNumber}).`,
      );
    }
    if (order.status !== ORDER_STATUS.CONFIRMED) {
      throw ApiError.conflict(
        order.status === ORDER_STATUS.PENDING
          ? 'Confirm this order (or its payment) before sending it to the kitchen.'
          : `Order ${order.orderNumber} is ${order.status.replace(/_/g, ' ')} and cannot be forwarded.`,
      );
    }

    const stations = await stationService.active();
    const byId = new Map(stations.map((s) => [String(s._id), s]));
    const assignments = await stationService.routeLines(order.items, stations);

    const details = [];
    for (const [position, line] of lines.entries()) {
      if (!Number.isInteger(line.index) || line.index < 0 || line.index >= order.items.length) {
        details.push({ field: `lines.${position}.index`, message: 'Unknown item' });
      } else if (line.station === null || line.station === 'none') {
        assignments[line.index] = null;
      } else if (byId.has(String(line.station))) {
        assignments[line.index] = byId.get(String(line.station));
      } else {
        details.push({ field: `lines.${position}.station`, message: 'Unknown or switched-off station' });
      }
    }
    if (details.length) throw ApiError.validation(details);
    if (!assignments.some(Boolean)) {
      throw ApiError.badRequest('Send at least one item to a station.');
    }

    await assignTicket(order, { assignments });
    const names = order.kitchen.stations.map((s) => s.name);
    const now = new Date();

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: ORDER_STATUS.CONFIRMED, 'kitchen.firedAt': null },
      {
        $set: {
          ticketNumber: order.ticketNumber,
          ticketDate: order.ticketDate,
          items: order.items,
          'kitchen.firedAt': now,
          'kitchen.stations': order.kitchen.stations,
          'kitchen.forwardedBy': actor.fullName,
          ...(kitchenNote !== undefined && { kitchenNote: kitchenNote.trim() || null }),
        },
        $push: {
          timeline: {
            status: ORDER_STATUS.CONFIRMED,
            at: now,
            note: `Forwarded to ${names.join(' and ')} by ${actor.fullName}`,
          },
        },
      },
      { new: true },
    ).lean();

    if (!updated) {
      throw ApiError.conflict(
        'Someone else just forwarded or changed this order. Refresh to see where it is.',
        {
          code: 'ORDER_CHANGED',
        },
      );
    }

    realtime.orderChanged(updated, 'forwarded');
    realtime.notificationsChanged();
    logger.info('Website order forwarded', {
      orderNumber: updated.orderNumber,
      stations: names,
      by: actor.id,
    });

    return {
      orderNumber: updated.orderNumber,
      ticketNumber: updated.ticketNumber,
      stations: names,
      ticket: toTicket(updated),
    };
  },

  /**
   * Close paid till tickets nobody marked served once they pass the configured
   * age (called by the reservation sweeper). Paid only: an open unpaid tab is
   * money owed. A direct conditional update rather than `transition`, so no
   * fake kitchen history is written.
   */
  async closeStaleTickets({ now = new Date() } = {}) {
    const hours = kitchenSettings().autoCompleteHours;
    const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const stale = await Order.find({
      channel: 'pos',
      status: { $in: KITCHEN_ACTIVE },
      paymentStatus: PAYMENT_STATUS.PAID,
      'kitchen.firedAt': { $lte: cutoff },
    })
      .select('_id')
      .limit(200)
      .lean();

    let closed = 0;
    for (const { _id } of stale) {
      const updated = await Order.findOneAndUpdate(
        { _id, status: { $in: KITCHEN_ACTIVE }, paymentStatus: PAYMENT_STATUS.PAID },
        {
          $set: { status: ORDER_STATUS.COMPLETED, 'kitchen.servedAt': now },
          $push: {
            timeline: {
              status: ORDER_STATUS.COMPLETED,
              at: now,
              note: `Closed automatically — not marked served within ${hours} hours`,
            },
          },
        },
        { new: true },
      ).lean();
      if (updated) {
        closed += 1;
        realtime.orderChanged(updated, 'status');
      }
    }

    if (closed) logger.info(`Closed ${closed} forgotten kitchen ticket(s)`);
    return { closed };
  },
};

export default kitchenService;
