import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChefHat,
  Check,
  CheckCheck,
  Clock,
  Globe,
  Hand,
  LogOut,
  Maximize,
  Minimize,
  Monitor,
  Printer,
  RefreshCw,
  StickyNote,
  Volume2,
  VolumeX,
  X,
  AlertTriangle,
  Tv,
  LayoutDashboard,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { PageLoader } from '@/components/ui/Spinner.jsx';
import { usePrintJob } from '@/components/common/PrintPortal.jsx';
import { KitchenTicketSlip } from '@/components/kitchen/KitchenTicketSlip.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useKitchenStore } from '@/features/kitchen/kitchenStore.js';
import { kitchenQuantity, orderTypeLine, STAGE_LABEL } from '@/features/kitchen/labels.js';
import { EVENTS, useConnectionStore, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { applySurfaceTheme } from '@/lib/theme.js';
import { isAudioLocked, playChime, unlockAudio } from '@/lib/chime.js';
import { formatElapsed, useNow } from '@/lib/useNow.js';
import { formatTime } from '@/lib/format.js';
import { mediaUrl } from '@/lib/media.js';
import { ROUTES } from '@/constants/routes.js';
import { cn } from '@/lib/utils.js';

/**
 * Kitchen Display (KDS) — /kitchen
 * ---------------------------------------------------------------------------
 * The screen on the kitchen wall. Every order a till sends ("Send to kitchen",
 * or paid with auto-fire on) and every website order staff forward from the
 * dashboard arrives here within a second, oldest first:
 *
 *   NEW ──Accept──▶ PREPARING ──Done──▶ READY ──Served──▶ (off the screen)
 *
 * "Done" on a new ticket goes straight to Ready — a bottle of water needs no
 * preparing. Ready shows at once on the till that sent it and on the counter
 * Order Board (/display), and a website customer's tracking page moves too:
 * the ticket is the order, so there is nothing to keep in sync.
 *
 * Each card carries a running clock that turns amber at the "warn" minutes and
 * red at the "late" minutes from Settings → Kitchen. New tickets chime (once
 * someone has tapped the screen — browsers block sound until then).
 *
 * ACCESS: no login by default — opening /kitchen shows the orders. Settings →
 * Kitchen Display → "Open the kitchen screens without signing in" switches that
 * off, and then this page sends you to sign in with a kitchen account.
 *
 * Stations: `?station=chicken-counter` turns this into one station's screen —
 * only its items, and Accept / Done move only its share. The order is Ready
 * when every station is done. Without it, the screen shows every station and
 * the buttons move the whole order.
 *
 * URL options, for a screen that should always open the same way:
 *   ?station=<slug>       one preparation station (Kitchen Stations in the back office)
 *   ?channel=pos|online   only till orders, or only website orders
 *   ?store=<id>           one counter's tills (website orders still show)
 */

const TABS = [
  { key: 'active', label: 'All live' },
  { key: 'new', label: 'New' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
];

const CHANNELS = [
  { key: 'all', label: 'All orders', icon: ChefHat },
  { key: 'pos', label: 'Tills', icon: Monitor },
  { key: 'online', label: 'Website', icon: Globe },
];

const STAGE_STYLE = {
  new: { bar: 'bg-info text-info-foreground', ring: 'border-info/60', chip: 'bg-info/15 text-info' },
  preparing: {
    bar: 'bg-warning text-warning-foreground',
    ring: 'border-warning/60',
    chip: 'bg-warning/15 text-warning',
  },
  ready: {
    bar: 'bg-success text-success-foreground',
    ring: 'border-success/60',
    chip: 'bg-success/15 text-success',
  },
  done: {
    bar: 'bg-surface-raised text-muted-foreground',
    ring: 'border-border',
    chip: 'bg-surface-raised text-muted-foreground',
  },
};

const SOUND_KEY = 'fb-kitchen-sound';

export function KitchenDisplayPage() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [query, setQuery] = useSearchParams();
  const store = query.get('store') ?? '';
  const channel = CHANNELS.some((c) => c.key === query.get('channel')) ? query.get('channel') : 'all';
  const stationSlug = query.get('station') ?? '';
  const [tab, setTab] = useState('active');

  const config = useKitchenStore((s) => s.config);
  const configError = useKitchenStore((s) => s.configError);
  const tickets = useKitchenStore((s) => s.tickets);
  const completed = useKitchenStore((s) => s.completed);
  const counts = useKitchenStore((s) => s.counts);
  const status = useKitchenStore((s) => s.status);
  const error = useKitchenStore((s) => s.error);
  const syncedAt = useKitchenStore((s) => s.syncedAt);
  const busy = useKitchenStore((s) => s.busy);
  const notice = useKitchenStore((s) => s.notice);
  const arrivals = useKitchenStore((s) => s.arrivals);
  const { loadConfig, loadTickets, setScope, act, dismissNotice } = useKitchenStore.getState();

  const rules = config?.kitchen;
  // What this screen may do comes from the server: an open screen can press
  // every button; a signed-in account needs kitchen.manage.
  const access = config?.access;
  const canManage = Boolean(access?.canManage);
  const now = useNow(1000);
  const connection = useConnectionStore((s) => s.kitchen);

  // --- Configuration + theme -------------------------------------------------
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config?.theme) applySurfaceTheme('kitchen', config.theme);
  }, [config?.theme]);

  useRealtimeEvent('kitchen', EVENTS.SETTINGS_CHANGED, (event) => {
    if (event?.sections?.some((s) => ['kitchen', 'theme', 'business', 'stations'].includes(s))) loadConfig();
  });

  // --- Tickets: load, live, and a polling safety net --------------------------
  useEffect(() => {
    setScope({ store, channel, station: stationSlug });
  }, [store, channel, stationSlug, setScope]);

  const refresh = useDebouncedCallback(loadTickets, 250);
  useRealtimeEvent('kitchen', EVENTS.ORDER_CHANGED, refresh);

  // Events missed while the connection was down are not replayed — re-read on reconnect.
  useEffect(() => {
    if (connection === 'online') refresh();
  }, [connection, refresh]);

  useEffect(() => {
    const id = setInterval(loadTickets, connection === 'online' ? 60_000 : 15_000);
    return () => clearInterval(id);
  }, [connection, loadTickets]);

  // --- Sound -----------------------------------------------------------------
  const [soundOn, setSoundOn] = useState(() => {
    try {
      const saved = localStorage.getItem(SOUND_KEY);
      return saved == null ? null : saved === '1';
    } catch {
      return null;
    }
  });
  // Until the cook chooses, follow the owner's default from Settings → Kitchen.
  const sound = soundOn ?? rules?.soundAlerts ?? true;
  const [audioLocked, setAudioLocked] = useState(isAudioLocked);

  const toggleSound = () => {
    unlockAudio();
    setAudioLocked(false);
    const next = !sound;
    setSoundOn(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (next) playChime('order');
  };

  // Any tap on the screen unlocks audio.
  const onFirstTap = () => {
    if (!audioLocked) return;
    unlockAudio();
    setTimeout(() => setAudioLocked(isAudioLocked()), 50);
  };

  useEffect(() => {
    if (sound && arrivals.ids.length) playChime('order');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivals.at]);

  // A ticket crossing the "late" line rings once.
  const lateIds = useMemo(() => {
    if (!rules) return [];
    return tickets
      .filter((t) => t.stage !== 'ready' && now - new Date(t.firedAt).getTime() >= rules.lateMinutes * 60_000)
      .map((t) => t.id);
  }, [tickets, now, rules]);
  const knownLate = useRef(new Set());
  useEffect(() => {
    const fresh = lateIds.filter((id) => !knownLate.current.has(id));
    knownLate.current = new Set(lateIds);
    if (fresh.length && sound && syncedAt) playChime('alert');
  }, [lateIds, sound, syncedAt]);

  // --- Fullscreen --------------------------------------------------------------
  const [isFullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // --- Printing a ticket ---------------------------------------------------------
  const printJob = usePrintJob();
  const printTicket = useCallback(
    (ticket) => printJob.print(<KitchenTicketSlip ticket={ticket} business={config?.business} />),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config?.business],
  );

  // --- What the current tab shows ------------------------------------------------
  const visible = useMemo(() => {
    if (tab === 'completed') return completed;
    if (tab === 'active') return tickets;
    return tickets.filter((t) => t.stage === tab);
  }, [tab, tickets, completed]);

  const averageMinutes = useMemo(() => {
    const done = completed.filter((t) => t.readyAt && t.firedAt);
    if (!done.length) return null;
    const total = done.reduce((sum, t) => sum + (new Date(t.readyAt) - new Date(t.firedAt)), 0);
    return Math.round(total / done.length / 60_000);
  }, [completed]);

  const setChannel = (key) => {
    const next = new URLSearchParams(query);
    if (key === 'all') next.delete('channel');
    else next.set('channel', key);
    setQuery(next, { replace: true });
  };

  const setStation = (slug) => {
    const next = new URLSearchParams(query);
    if (slug) next.set('station', slug);
    else next.delete('station');
    setQuery(next, { replace: true });
  };

  // Screens closed in Settings and nobody signed in: go and sign in, then come back.
  if (configError?.status === 401) {
    return (
      <Navigate to={ROUTES.STAFF_LOGIN} state={{ from: `${location.pathname}${location.search}` }} replace />
    );
  }
  if (configError?.status === 403) return <Navigate to={ROUTES.UNAUTHORIZED} replace />;
  if (!config && !configError) return <PageLoader label="Opening the kitchen display" />;

  const business = config?.business;
  const enabled = rules?.enabled !== false;
  const stations = config?.stations ?? [];
  const station = stations.find((s) => s.slug === stationSlug) ?? null;
  const stationMissing = Boolean(stationSlug) && config && !station;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" onPointerDown={onFirstTap}>
      {/* ================= Header ================= */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {business?.logoUrl ? (
              <img src={mediaUrl(business.logoUrl)} alt="" className="h-9 w-9 rounded-lg object-contain" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-gold-gradient text-gold-foreground">
                <ChefHat className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <h1 className="flex items-center gap-2 truncate text-base font-bold">
                {station && (
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: station.color }} />
                )}
                {station ? station.name : 'Kitchen Display'}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {station ? `${business?.name ?? ''} · station screen` : business?.name}
              </p>
            </div>
          </div>

          {/* Stage counters — the numbers a head chef glances at. */}
          <div className="flex items-center gap-1.5" aria-label="Tickets by stage">
            {['new', 'preparing', 'ready'].map((stage) => (
              <span
                key={stage}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums',
                  STAGE_STYLE[stage].chip,
                )}
              >
                {counts[stage]} <span className="font-medium">{STAGE_LABEL[stage]}</span>
              </span>
            ))}
            {averageMinutes != null && (
              <span className="hidden rounded-lg bg-surface-raised px-2.5 py-1 text-sm text-muted-foreground lg:inline">
                Avg {averageMinutes} min today
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <div
              role="group"
              aria-label="Which orders"
              className="hidden rounded-lg border border-border-strong p-0.5 md:flex"
            >
              {CHANNELS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setChannel(c.key)}
                  aria-pressed={channel === c.key}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold',
                    channel === c.key
                      ? 'bg-gold-gradient text-gold-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <c.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {c.label}
                </button>
              ))}
            </div>

            <ConnectionDot status={connection} syncedAt={syncedAt} />
            <Clock12 now={now} />

            <IconButton
              label={sound ? 'Mute new-order sound' : 'Turn on new-order sound'}
              onClick={toggleSound}
            >
              {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </IconButton>
            <IconButton label="Refresh now" onClick={loadTickets}>
              <RefreshCw className={cn('h-5 w-5', status === 'loading' && 'animate-spin')} />
            </IconButton>
            <IconButton
              label="Open the order board"
              as={Link}
              to={ROUTES.ORDER_BOARD}
              target="_blank"
              rel="noopener"
            >
              <Tv className="h-5 w-5" />
            </IconButton>
            <IconButton label={isFullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </IconButton>
            {access?.signedIn && user?.role !== 'kitchen' && (
              <IconButton label="Back office" as={Link} to={ROUTES.ADMIN}>
                <LayoutDashboard className="h-5 w-5" />
              </IconButton>
            )}
            {access?.signedIn && (
              <IconButton label={`Sign out ${user?.fullName ?? ''}`} onClick={signOut}>
                <LogOut className="h-5 w-5" />
              </IconButton>
            )}
          </div>
        </div>

        {/* Stations — only when there is more than one */}
        {stations.length > 1 && (
          <div
            className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2"
            role="group"
            aria-label="Station"
          >
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Station
            </span>
            {[{ slug: '', name: 'All stations', color: null }, ...stations].map((s) => (
              <button
                key={s.slug || 'all'}
                type="button"
                onClick={() => setStation(s.slug)}
                aria-pressed={stationSlug === s.slug}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                  stationSlug === s.slug
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border-strong text-muted-foreground hover:text-foreground',
                )}
              >
                {s.color && <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />}
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* Tabs */}
        <nav className="flex gap-1 overflow-x-auto px-4 pb-2" aria-label="Ticket stages">
          {TABS.map((t) => {
            const count =
              t.key === 'active' ? tickets.length : t.key === 'completed' ? counts.completed : counts[t.key];
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors',
                  tab === t.key
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'min-w-6 rounded-full px-1.5 text-xs tabular-nums',
                    tab === t.key ? 'bg-background/20' : 'bg-surface-raised',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* ================= Banners ================= */}
      <div className="space-y-2 px-4 pt-3 empty:hidden">
        {!enabled && (
          <Banner tone="warning" icon={AlertTriangle}>
            The kitchen flow is switched off in Settings → Kitchen, so tills are not sending tickets here.
          </Banner>
        )}
        {configError && (
          <Banner tone="error" icon={AlertTriangle}>
            Could not load the kitchen settings: {configError.message}
          </Banner>
        )}
        {stationMissing && (
          <Banner tone="warning" icon={AlertTriangle}>
            This screen is set to a station that no longer exists or is switched off. Choose a station above.
          </Banner>
        )}
        {error && (
          <Banner tone="error" icon={AlertTriangle}>
            {error.message} — showing the last tickets received. Retrying automatically.
          </Banner>
        )}
        {notice && (
          <Banner tone="error" icon={AlertTriangle} onClose={dismissNotice}>
            {notice.text}
          </Banner>
        )}
        {sound && audioLocked && (
          <Banner tone="info" icon={Hand}>
            Tap anywhere on the screen to turn on the new-order sound.
          </Banner>
        )}
        {config && !canManage && (
          <Banner tone="info" icon={Hand}>
            View only — your account can see tickets but not accept or complete them.
          </Banner>
        )}
      </div>

      {/* ================= Tickets ================= */}
      <main className="flex-1 p-4">
        {status === 'loading' && !syncedAt ? (
          <PageLoader label="Loading tickets" />
        ) : visible.length === 0 ? (
          <EmptyKitchen tab={tab} />
        ) : (
          <motion.div
            layout
            className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] items-start gap-3"
          >
            <AnimatePresence initial={false}>
              {visible.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  stationId={station?.id ?? null}
                  now={now}
                  rules={rules}
                  canManage={canManage}
                  busyAction={busy[ticket.id]}
                  isFresh={arrivals.ids.includes(ticket.id) && now - arrivals.at < 12_000}
                  onAct={act}
                  onPrint={printTicket}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>

      {printJob.portal}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

const TicketCard = memo(function TicketCard({
  ticket,
  stationId,
  now,
  rules,
  canManage,
  busyAction,
  isFresh,
  onAct,
  onPrint,
}) {
  const [struck, setStruck] = useState(() => new Set());
  const style = STAGE_STYLE[ticket.stage] ?? STAGE_STYLE.done;
  const isDone = ticket.stage === 'done';
  const isReady = ticket.stage === 'ready';
  // On a station screen this station can be done while others are still cooking.
  const orderReady = ticket.status === 'ready';
  const waitingFor = (ticket.stations ?? []).filter(
    (s) => s.id !== stationId && s.stage !== 'ready' && s.stage !== 'done',
  );

  const fired = new Date(ticket.firedAt).getTime();
  const age = now - fired;
  const warn = (rules?.warnMinutes ?? 10) * 60_000;
  const late = (rules?.lateMinutes ?? 20) * 60_000;
  const isLate = !isReady && !isDone && age >= late;
  const isWarn = !isReady && !isDone && !isLate && age >= warn;

  const toggleItem = (index) =>
    setStruck((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const source =
    ticket.channel === 'online' ? 'Website' : (ticket.terminalName ?? ticket.terminalId ?? 'Till');

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.18 }}
      aria-label={`Ticket ${ticket.ticketNumber}, ${STAGE_LABEL[ticket.stage] ?? ticket.stage}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border-2 bg-surface shadow-panel',
        isLate ? 'border-destructive' : style.ring,
        isFresh && 'ring-4 ring-info/50',
        isDone && 'opacity-80',
      )}
    >
      {/* --- Header: number, type, clock --- */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2',
          isLate ? 'bg-destructive text-destructive-foreground' : style.bar,
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black leading-none tabular-nums">#{ticket.ticketNumber}</span>
          <span className="text-xs font-bold uppercase tracking-wide">
            {STAGE_LABEL[ticket.stage] ?? ticket.stage}
          </span>
        </div>
        <div className="text-right leading-tight">
          {isDone ? (
            <span className="text-sm font-bold">{formatTime(ticket.servedAt ?? ticket.readyAt)}</span>
          ) : (
            <span
              className={cn(
                'flex items-center gap-1 text-lg font-black tabular-nums',
                isLate && 'animate-pulse',
              )}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              {formatElapsed(age)}
            </span>
          )}
          {isLate && <span className="block text-[10px] font-bold uppercase">Late</span>}
          {isWarn && <span className="block text-[10px] font-bold uppercase">Running long</span>}
        </div>
      </div>

      {/* --- Who / where --- */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2 text-sm">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide',
            ticket.orderType === 'dine_in'
              ? 'bg-gold/20 text-gold'
              : ticket.orderType === 'delivery'
                ? 'bg-info/15 text-info'
                : 'bg-surface-raised text-foreground',
          )}
        >
          {orderTypeLine(ticket)}
        </span>
        <span className="text-muted-foreground">
          {source} · {formatTime(ticket.firedAt)}
        </span>
        {ticket.paymentStatus !== 'paid' && (
          <span className="rounded-md border border-warning/50 px-1.5 text-[10px] font-bold uppercase text-warning">
            Unpaid
          </span>
        )}
        {ticket.customerName && (
          <span className="w-full truncate text-xs text-muted-foreground">{ticket.customerName}</span>
        )}
      </div>

      {/* --- Stations on this order and how far each has got --- */}
      {ticket.stations?.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-1.5">
          {ticket.stations.map((s) => (
            <span
              key={s.id}
              className={cn(
                'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                s.id === stationId ? 'bg-foreground text-background' : STAGE_STYLE[s.stage]?.chip,
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color ?? 'currentColor' }} />
              {s.name} · {STAGE_LABEL[s.stage] ?? s.stage}
            </span>
          ))}
        </div>
      )}

      {/* --- Items: tap to tick off --- */}
      <ul className="flex-1 divide-y divide-border/60 px-1 py-1">
        {ticket.items.map((item, index) => {
          const done = struck.has(index);
          return (
            <li key={`${item.name}-${index}`}>
              <button
                type="button"
                onClick={() => toggleItem(index)}
                disabled={isDone}
                aria-pressed={done}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover disabled:hover:bg-transparent',
                  done && 'opacity-45',
                )}
              >
                <span className="min-w-[2.75rem] shrink-0 rounded-md bg-surface-raised px-1.5 py-0.5 text-center text-base font-black tabular-nums">
                  {kitchenQuantity(item)}
                </span>
                <span className={cn('pt-0.5 text-base font-semibold leading-snug', done && 'line-through')}>
                  {item.name}
                  {!stationId && ticket.stations?.length > 1 && item.stationName && (
                    <span className="ml-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground">
                      → {item.stationName}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {(ticket.kitchenNote || ticket.deliveryNote) && (
        <div className="mx-3 mb-2 space-y-1">
          {ticket.kitchenNote && (
            <p className="flex gap-1.5 rounded-lg border border-warning/50 bg-warning/10 px-2 py-1.5 text-sm font-bold text-warning">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {ticket.kitchenNote}
            </p>
          )}
          {ticket.deliveryNote && (
            <p className="rounded-lg bg-surface-raised px-2 py-1.5 text-xs text-muted-foreground">
              Customer: {ticket.deliveryNote}
            </p>
          )}
        </div>
      )}

      {/* --- Who touched it --- */}
      {(ticket.acceptedBy || ticket.readyBy) && (
        <p className="px-3 pb-1.5 text-[11px] text-muted-foreground">
          {ticket.acceptedBy && `Accepted by ${ticket.acceptedBy}`}
          {ticket.acceptedBy && ticket.readyBy && ' · '}
          {ticket.readyBy && `Done by ${ticket.readyBy}`}
          {isReady &&
            ticket.readyAt &&
            ` · ${Math.max(1, Math.round((new Date(ticket.readyAt) - fired) / 60_000))} min`}
        </p>
      )}

      {/* --- Actions --- */}
      <div className="flex gap-2 border-t border-border p-2">
        {canManage && ticket.stage === 'new' && (
          <>
            <Button
              size="lg"
              className="flex-1"
              leftIcon={Check}
              isLoading={busyAction === 'accept'}
              disabled={Boolean(busyAction)}
              onClick={() => onAct(ticket.id, 'accept')}
            >
              Accept
            </Button>
            <Button
              size="lg"
              variant="secondary"
              leftIcon={CheckCheck}
              isLoading={busyAction === 'ready'}
              disabled={Boolean(busyAction)}
              onClick={() => onAct(ticket.id, 'ready')}
              title="Mark ready straight away — nothing to prepare"
            >
              Done
            </Button>
          </>
        )}
        {canManage && ticket.stage === 'preparing' && (
          <Button
            size="lg"
            variant="success"
            className="flex-1"
            leftIcon={CheckCheck}
            isLoading={busyAction === 'ready'}
            disabled={Boolean(busyAction)}
            onClick={() => onAct(ticket.id, 'ready')}
          >
            Done — ready
          </Button>
        )}
        {canManage && isReady && !orderReady && (
          <span className="flex flex-1 items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            Done here — waiting for {waitingFor.map((s) => s.name).join(' and ') || 'the other stations'}
          </span>
        )}
        {canManage && isReady && orderReady && (
          <Button
            size="lg"
            variant="outline"
            className="flex-1"
            leftIcon={Check}
            isLoading={busyAction === 'serve'}
            disabled={Boolean(busyAction)}
            onClick={() => onAct(ticket.id, 'serve')}
          >
            {ticket.channel === 'online' ? 'Handed to rider' : 'Served'}
          </Button>
        )}
        {(isDone || !canManage) && (
          <span className="flex flex-1 items-center px-1 text-sm text-muted-foreground">
            {isDone ? `${STAGE_LABEL.done} · ${ticket.orderNumber}` : STAGE_LABEL[ticket.stage]}
          </span>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Print ticket ${ticket.ticketNumber}`}
          onClick={() => onPrint(ticket)}
        >
          <Printer className="h-5 w-5" />
        </Button>
      </div>
    </motion.article>
  );
});

function IconButton({ label, children, as: Component = 'button', ...props }) {
  return (
    <Component
      {...(Component === 'button' && { type: 'button' })}
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      {...props}
    >
      {children}
    </Component>
  );
}

function ConnectionDot({ status, syncedAt }) {
  const online = status === 'online';
  const label = online ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline — polling';
  return (
    <span
      className="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground sm:flex"
      title={syncedAt ? `Last updated ${new Date(syncedAt).toLocaleTimeString()}` : undefined}
    >
      <span
        className={cn(
          'h-2.5 w-2.5 rounded-full',
          online ? 'bg-success' : status === 'connecting' ? 'bg-warning' : 'bg-destructive',
        )}
      />
      {label}
    </span>
  );
}

function Clock12({ now }) {
  return (
    <span className="hidden px-1 text-lg font-bold tabular-nums sm:inline">
      {new Date(now).toLocaleTimeString('en-PK', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Karachi',
      })}
    </span>
  );
}

const BANNER_TONE = {
  info: 'border-info/40 bg-info/10 text-info',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
};

function Banner({ tone = 'info', icon: Icon, onClose, children }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium',
        BANNER_TONE[tone],
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1">{children}</span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="rounded p-0.5 hover:bg-foreground/10"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function EmptyKitchen({ tab }) {
  const text = {
    active: ['All clear', 'Till orders and forwarded website orders appear here the moment they are sent.'],
    new: ['No new tickets', 'Everything that came in has been picked up.'],
    preparing: ['Nothing on the go', 'Accepted tickets show here while they are being prepared.'],
    ready: ['Nothing waiting', 'Tickets marked Done wait here until they are served.'],
    completed: ['Nothing finished yet today', 'Served tickets are listed here until midnight.'],
  }[tab];

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-surface-raised">
        <ChefHat className="h-8 w-8 text-gold" aria-hidden="true" />
      </span>
      <h2 className="text-xl font-bold">{text[0]}</h2>
      <p className="max-w-sm text-muted-foreground">{text[1]}</p>
    </div>
  );
}

export default KitchenDisplayPage;
