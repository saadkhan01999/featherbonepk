import { create } from 'zustand';

import { kitchenApi } from './kitchen.api.js';

/**
 * Kitchen state (Zustand).
 * ---------------------------------------------------------------------------
 * One store for the Kitchen Display and the Order Board: the configuration,
 * the live tickets, and the actions a cook takes on them.
 *
 * The server is the source of truth. A button press moves the card at once
 * (optimistically — a cook must not wait on the network to see their tap
 * land), the request goes out, and the list is then re-read. If the server
 * refuses — another screen already accepted that ticket — the re-read puts
 * the card where it really is and the refusal is shown.
 *
 * New-ticket detection lives here, not in the page: each load compares the
 * ticket ids against the previous load and records the ones that appeared.
 * The page plays the chime and highlights them. The very first load is never
 * "new" — opening the screen at 1pm must not ring for every ticket since 12.
 */

const EMPTY_COUNTS = { new: 0, preparing: 0, ready: 0, completed: 0 };

/** Where a ticket goes after each action, for the optimistic move. */
const NEXT_STAGE = {
  accept: { stage: 'preparing', status: 'preparing' },
  ready: { stage: 'ready', status: 'ready' },
};

function countsOf(tickets, completed) {
  return {
    new: tickets.filter((t) => t.stage === 'new').length,
    preparing: tickets.filter((t) => t.stage === 'preparing').length,
    ready: tickets.filter((t) => t.stage === 'ready').length,
    completed: completed.length,
  };
}

export const useKitchenStore = create((set, get) => ({
  // --- configuration (/settings/kitchen-config) ---
  config: null,
  configError: null,

  // --- tickets (/kitchen/tickets) ---
  tickets: [],
  completed: [],
  counts: EMPTY_COUNTS,
  status: 'idle', // idle | loading | ready | error
  error: null,
  syncedAt: null,
  scope: { store: '', channel: 'all', station: '' },

  /** ids that appeared since the previous load, and when — for the chime + glow. */
  arrivals: { ids: [], at: 0 },
  /** ids that turned ready since the previous load. */
  readied: { ids: [], at: 0 },

  /** ticket id → action in flight, so a button shows its spinner and cannot double-fire. */
  busy: {},
  /** The last refused action, shown as a banner. */
  notice: null,

  // --- order board (/kitchen/board) ---
  board: null,
  boardError: null,

  async loadConfig() {
    try {
      const config = await kitchenApi.config();
      set({ config, configError: null });
      return config;
    } catch (error) {
      set({ configError: error });
      return null;
    }
  },

  setScope(scope) {
    set((state) => ({
      scope: { ...state.scope, ...scope },
      tickets: [],
      completed: [],
      counts: EMPTY_COUNTS,
      syncedAt: null,
    }));
    return get().loadTickets();
  },

  async loadTickets() {
    const { scope, syncedAt, tickets: previous, status } = get();
    if (status === 'idle') set({ status: 'loading' });

    try {
      const data = await kitchenApi.tickets(scope);
      const before = new Set(previous.map((t) => t.id));
      const readyBefore = new Set(previous.filter((t) => t.stage === 'ready').map((t) => t.id));
      const isFirst = !syncedAt;

      const appeared = isFirst ? [] : data.tickets.filter((t) => !before.has(t.id)).map((t) => t.id);
      const nowReady = isFirst
        ? []
        : data.tickets.filter((t) => t.stage === 'ready' && !readyBefore.has(t.id)).map((t) => t.id);

      set((state) => ({
        tickets: data.tickets,
        completed: data.completed,
        counts: data.counts ?? countsOf(data.tickets, data.completed),
        status: 'ready',
        error: null,
        syncedAt: Date.now(),
        ...(appeared.length && { arrivals: { ids: appeared, at: Date.now() } }),
        ...(nowReady.length && { readied: { ids: nowReady, at: Date.now() } }),
        // A ticket that finished while its request was in flight is no longer busy.
        busy: Object.fromEntries(
          Object.entries(state.busy).filter(([id]) => data.tickets.some((t) => t.id === id)),
        ),
      }));
    } catch (error) {
      set({ status: get().syncedAt ? 'ready' : 'error', error });
    }
  },

  /**
   * Accept / Done / Served.
   * @param {string} id
   * @param {'accept'|'ready'|'serve'} action
   */
  async act(id, action) {
    if (get().busy[id]) return;
    const ticket = get().tickets.find((t) => t.id === id);
    if (!ticket) return;

    // Optimistic move.
    set((state) => {
      let tickets = state.tickets;
      let completed = state.completed;
      if (action === 'serve') {
        tickets = tickets.filter((t) => t.id !== id);
        completed = [{ ...ticket, stage: 'done', servedAt: new Date().toISOString() }, ...completed];
      } else {
        // On a station screen only this station's stage moves; the order's own
        // status comes back from the server once every station is done.
        const move = state.scope.station ? { stage: NEXT_STAGE[action].stage } : NEXT_STAGE[action];
        tickets = tickets.map((t) => (t.id === id ? { ...t, ...move } : t));
      }
      return {
        tickets,
        completed,
        counts: countsOf(tickets, completed),
        busy: { ...state.busy, [id]: action },
        notice: null,
        // The cook's own tap is not an arrival to announce.
        readied: action === 'ready' ? { ids: [], at: state.readied.at } : state.readied,
      };
    });

    try {
      await kitchenApi[action](id, get().scope.station || undefined);
    } catch (error) {
      set({ notice: { tone: 'error', text: error.message ?? 'That did not go through', at: Date.now() } });
    } finally {
      set((state) => {
        const busy = { ...state.busy };
        delete busy[id];
        return { busy };
      });
      // Re-read either way: on success it confirms, on refusal it corrects.
      await get().loadTickets();
      // The re-read after our own "Done" must not ring the ready bell for it.
      if (action === 'ready') {
        set((state) => ({
          readied: { ids: state.readied.ids.filter((x) => x !== id), at: state.readied.at },
        }));
      }
    }
  },

  dismissNotice: () => set({ notice: null }),

  async loadBoard(store) {
    try {
      const board = await kitchenApi.board({ store });
      const previous = get().board;
      const readyBefore = new Set((previous?.ready ?? []).map((o) => o.id));
      const nowReady = previous ? board.ready.filter((o) => !readyBefore.has(o.id)).map((o) => o.id) : [];

      set({
        board,
        boardError: null,
        ...(nowReady.length && { readied: { ids: nowReady, at: Date.now() } }),
      });
    } catch (error) {
      set({ boardError: error });
    }
  },
}));

export default useKitchenStore;
