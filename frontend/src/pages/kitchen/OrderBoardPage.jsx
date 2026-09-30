import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, ChefHat, Maximize, Minimize, Volume2, VolumeX } from 'lucide-react';

import { PageLoader } from '@/components/ui/Spinner.jsx';
import { useKitchenStore } from '@/features/kitchen/kitchenStore.js';
import { ORDER_TYPE_LABEL } from '@/features/kitchen/labels.js';
import { EVENTS, useConnectionStore, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { applySurfaceTheme } from '@/lib/theme.js';
import { isAudioLocked, playChime, unlockAudio } from '@/lib/chime.js';
import { useNow } from '@/lib/useNow.js';
import { mediaUrl } from '@/lib/media.js';
import { cn } from '@/lib/utils.js';
import { ROUTES } from '@/constants/routes.js';

/**
 * Order Status Board — /display
 * ---------------------------------------------------------------------------
 * The "main display" above the counter. The video is the big thing (80% of the
 * screen by default — Settings → Order Board Screen → Video size); the order
 * numbers live in a slim strip beside it:
 *
 *   wide screen (TV, laptop)               tall screen (portrait TV, phone)
 *   ┌───────────────────────────┬──────┐   ┌──────────────────────┐
 *   │                           │PREP. │   │                      │
 *   │                           │41 43 │   │    the owner's       │
 *   │     the owner's video     ├──────┤   │      video(s)        │
 *   │          (80%)            │READY │   │        (80%)         │
 *   │                           │42 45 │   ├──────────┬───────────┤
 *   └───────────────────────────┴──────┘   │PREP 41 43│READY 42 45│
 *                                           └──────────┴───────────┘
 *
 * A number moves from Preparing to Ready the instant a cook taps Done, with a
 * chime and a large "#42 is ready" call-out, and leaves when the order is
 * served (or after the minutes set in Settings, so an uncollected order does
 * not stay up all afternoon). Without videos the two lists share the screen.
 *
 * One layout for every screen. The split is proportional, with a floor so a
 * small screen always keeps room to read the numbers; headings and tiles are
 * sized from the space each list really has (measured), not from fixed pixels,
 * so the same page fills a phone, a laptop and a 56-inch TV. The tiles shrink
 * as the lists grow, so a busy lunch still fits without scrolling.
 *
 * Only till orders appear — dine-in and take-away. Website deliveries are not
 * collected at the counter. `?store=<id>` limits the board to one counter.
 */

const SOUND_KEY = 'fb-board-sound';
const CALLOUT_MS = 7_000;

export function OrderBoardPage() {
  const [query] = useSearchParams();
  const location = useLocation();
  const store = query.get('store') ?? '';

  const config = useKitchenStore((s) => s.config);
  const board = useKitchenStore((s) => s.board);
  const boardError = useKitchenStore((s) => s.boardError);
  const readied = useKitchenStore((s) => s.readied);
  const { loadConfig, loadBoard } = useKitchenStore.getState();
  const connection = useConnectionStore((s) => s.kitchen);
  const now = useNow(1000);
  const landscape = useIsLandscape();

  // --- Config + theme ----------------------------------------------------------
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config?.theme) applySurfaceTheme('kitchen', config.theme);
  }, [config?.theme]);

  useRealtimeEvent('kitchen', EVENTS.SETTINGS_CHANGED, (event) => {
    // `display` is the board's own tab; `content` holds the story video it may fall back to.
    if (event?.sections?.some((s) => ['kitchen', 'display', 'content', 'theme', 'business'].includes(s))) {
      loadConfig();
      loadBoard(store);
    }
  });

  // --- The board: live, with a safety-net poll ----------------------------------
  useEffect(() => {
    loadBoard(store);
  }, [store, loadBoard]);

  const refresh = useDebouncedCallback(() => loadBoard(store), 250);
  useRealtimeEvent('kitchen', EVENTS.ORDER_CHANGED, (event) => {
    if (!event || event.channel === 'pos') refresh();
  });

  useEffect(() => {
    if (connection === 'online') refresh();
  }, [connection, refresh]);

  // Also re-read every 30s: it drops ready numbers that have timed out, which
  // no order event announces.
  useEffect(() => {
    const id = setInterval(() => loadBoard(store), 30_000);
    return () => clearInterval(id);
  }, [store, loadBoard]);

  // --- Sound + the "is ready" call-out -------------------------------------------
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [audioLocked, setAudioLocked] = useState(isAudioLocked);

  const toggleSound = () => {
    unlockAudio();
    setAudioLocked(false);
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (next) playChime('ready');
  };

  const [callout, setCallout] = useState(null);
  useEffect(() => {
    if (!readied.ids.length || !board) return undefined;
    const newest = board.ready.find((o) => readied.ids.includes(o.id));
    if (!newest) return undefined;
    if (sound) playChime('ready');
    setCallout(newest);
    const id = setTimeout(() => setCallout(null), CALLOUT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readied.at]);

  // --- Fullscreen + hide the cursor when idle -------------------------------------
  const [isFullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(null);
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 3_000);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(idleTimer.current);
  }, []);

  const onPointer = () => {
    wake();
    if (audioLocked) {
      unlockAudio();
      setTimeout(() => setAudioLocked(isAudioLocked()), 50);
    }
  };

  const recentlyReady = useMemo(
    () =>
      new Set(
        (board?.ready ?? []).filter((o) => now - new Date(o.readyAt).getTime() < 60_000).map((o) => o.id),
      ),
    [board, now],
  );

  // --- Videos from Settings; a video that cannot play is dropped, not shown black --------
  const display = config?.kitchen?.display;
  const [brokenVideos, setBrokenVideos] = useState(() => new Set());
  const videos = useMemo(
    () => (display?.videos ?? []).map((v) => v.video).filter((src) => src && !brokenVideos.has(src)),
    [display?.videos, brokenVideos],
  );
  const markBroken = useCallback((src) => setBrokenVideos((prev) => new Set(prev).add(src)), []);

  // Screens closed in Settings and nobody signed in: sign in, then come back.
  if (boardError?.status === 401) {
    return (
      <Navigate to={ROUTES.STAFF_LOGIN} state={{ from: `${location.pathname}${location.search}` }} replace />
    );
  }
  if (!board && !boardError) return <PageLoader label="Opening the order board" />;

  const business = config?.business;
  const title = board?.title || display?.title || 'Order status';
  const message = board?.message || display?.message;
  const hasVideo = videos.length > 0;
  const videoLeft = display?.videoSide === 'left';
  const share = Math.min(85, Math.max(50, Number(display?.videoShare) || 80));

  const preparing = board?.preparing ?? [];
  const ready = board?.ready ?? [];

  /*
   * The split. `fr` keeps the owner's proportion on any screen; the orders'
   * minimum (a floor, not a share) keeps the numbers readable on a small
   * laptop or a phone, where 20% alone would be a sliver.
   */
  const videoTrack = `minmax(0, ${share}fr)`;
  const ordersTrack = `minmax(${landscape ? 'min(12.5rem, 45vw)' : 'min(9.5rem, 40vh)'}, ${100 - share}fr)`;
  const splitStyle = landscape
    ? {
        gridTemplateRows: 'minmax(0, 1fr)',
        gridTemplateColumns: videoLeft ? `${videoTrack} ${ordersTrack}` : `${ordersTrack} ${videoTrack}`,
      }
    : { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: `${videoTrack} ${ordersTrack}` };
  // Grid order: which cell each part takes.
  const videoFirst = !landscape || videoLeft;

  return (
    <div
      className={cn(
        'relative flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground',
        idle && 'cursor-none',
      )}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
    >
      {/* ================= Header ================= */}
      <header className="flex shrink-0 items-center gap-[1.5vmin] border-b border-border bg-surface px-[3vmin] py-[1.3vmin]">
        <div className="flex min-w-0 flex-1 items-center gap-[1.4vmin]">
          {business?.logoUrl ? (
            <img
              src={mediaUrl(business.logoUrl)}
              alt=""
              className="h-[clamp(34px,7vmin,220px)] w-[clamp(34px,7vmin,220px)] rounded-[1.4vmin] object-contain"
            />
          ) : (
            <span className="grid h-[clamp(34px,7vmin,220px)] w-[clamp(34px,7vmin,220px)] place-items-center rounded-[1.4vmin] bg-gold-gradient text-gold-foreground">
              <ChefHat className="h-1/2 w-1/2" aria-hidden="true" />
            </span>
          )}
          <span className="hidden truncate text-[clamp(0.95rem,3vmin,6rem)] font-bold sm:landscape:inline">
            {business?.name}
          </span>
        </div>

        <h1 className="min-w-0 max-w-[55vw] truncate text-center text-[clamp(1.05rem,4.4vmin,9rem)] font-black uppercase leading-tight tracking-[0.12em]">
          {title}
        </h1>

        <div className="flex flex-1 items-center justify-end gap-[1vmin]">
          <span className="whitespace-nowrap text-[clamp(1rem,3.8vmin,8rem)] font-bold tabular-nums">
            {new Date(now).toLocaleTimeString('en-PK', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'Asia/Karachi',
            })}
          </span>
          <div
            className={cn(
              'flex items-center gap-1 transition-opacity',
              idle && 'pointer-events-none opacity-0',
            )}
          >
            <HeaderButton label={sound ? 'Mute' : 'Turn sound on'} onClick={toggleSound}>
              {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </HeaderButton>
            <HeaderButton
              label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              onClick={() =>
                document.fullscreenElement
                  ? document.exitFullscreen?.()
                  : document.documentElement.requestFullscreen?.().catch(() => {})
              }
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </HeaderButton>
          </div>
        </div>
      </header>

      {/* ================= Body ================= */}
      <main
        className={cn(
          'grid min-h-0 flex-1 gap-[1.2vmin] p-[1.2vmin]',
          // Without a video the two lists share the screen (Ready gets more).
          // `minmax(0, …)` tracks: a track must never grow to fit its tiles,
          // or the tiles measure the grown track and the page overflows.
          !hasVideo &&
            'grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,2fr)_minmax(0,3fr)] landscape:grid-rows-1 landscape:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]',
        )}
        style={hasVideo ? splitStyle : undefined}
      >
        {hasVideo ? (
          <>
            {/* Wide screen: Preparing above Ready. Tall screen: side by side, under the video. */}
            <div
              className={cn(
                'grid min-h-0 min-w-0 gap-[1.2vmin]',
                landscape
                  ? 'grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,2fr)_minmax(0,3fr)]'
                  : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]',
                videoFirst ? 'order-2' : 'order-1',
              )}
            >
              <Column
                heading="Preparing"
                sub="We're on it"
                tone="preparing"
                orders={preparing}
                empty="None right now"
              />
              <Column
                heading="Ready"
                sub="Please collect"
                tone="ready"
                orders={ready}
                highlight={recentlyReady}
                empty="None waiting"
              />
            </div>
            <VideoPanel
              videos={videos}
              fit={display?.videoFit}
              withSound={Boolean(display?.videoSound) && sound && !audioLocked}
              onBroken={markBroken}
              className={videoFirst ? 'order-1' : 'order-2'}
            />
          </>
        ) : (
          <>
            <Column
              heading="Preparing"
              sub="We're on it"
              tone="preparing"
              orders={preparing}
              empty="No orders in the kitchen"
            />
            <Column
              heading="Ready"
              sub="Please collect at the counter"
              tone="ready"
              orders={ready}
              highlight={recentlyReady}
              empty="Nothing waiting for collection"
            />
          </>
        )}
      </main>

      {/* ================= Footer ================= */}
      <footer className="flex shrink-0 items-center gap-[2vmin] overflow-hidden border-t border-border bg-surface px-[3vmin] py-[1.1vmin] text-[clamp(0.9rem,2.6vmin,5rem)]">
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-[0.75em] font-semibold',
            connection === 'online' ? 'text-success' : 'text-warning',
          )}
        >
          <span
            className={cn(
              'h-[0.6em] w-[0.6em] rounded-full',
              connection === 'online' ? 'bg-success' : 'bg-warning',
            )}
          />
          {connection === 'online' ? 'Live' : 'Reconnecting'}
        </span>
        {message ? (
          <div className="relative flex-1 overflow-hidden">
            <p className="board-marquee whitespace-nowrap font-medium text-muted-foreground">{message}</p>
          </div>
        ) : (
          <span className="flex-1" />
        )}
        {audioLocked && sound && (
          <span className="shrink-0 text-[0.7em] text-muted-foreground">Tap the screen to enable sound</span>
        )}
      </footer>

      {/* ================= "#42 is ready" call-out ================= */}
      <AnimatePresence>
        {callout && (
          <motion.div
            key={callout.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 grid place-items-center bg-background/80 backdrop-blur-sm"
            onClick={() => setCallout(null)}
            role="alert"
          >
            <motion.div
              initial={{ scale: 0.7, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="rounded-[3vmin] border-4 border-success bg-surface px-[7vmin] py-[5vmin] text-center shadow-2xl"
            >
              <BellRing className="mx-auto h-[8vmin] w-[8vmin] text-success" aria-hidden="true" />
              <p className="mt-[1.5vmin] text-[clamp(1rem,3.4vmin,7rem)] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Order
              </p>
              <p className="text-[clamp(4.5rem,24vmin,40rem)] font-black leading-none tabular-nums text-success">
                {callout.ticketNumber}
              </p>
              <p className="mt-[1vmin] text-[clamp(1.4rem,5vmin,10rem)] font-black uppercase">is ready</p>
              {callout.orderType === 'dine_in' && callout.tableNumber && (
                <p className="mt-[1vmin] text-[clamp(1rem,3vmin,6rem)] text-muted-foreground">
                  Table {callout.tableNumber}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * Fit every number, as large as possible.
 * ---------------------------------------------------------------------------
 * Measures the space a list actually has (it differs between a phone, a
 * laptop, a portrait TV and a 56-inch landscape one) and tries every column
 * count, keeping the one that gives the largest tile while still showing every
 * order — a number that does not fit on screen is a customer who never hears
 * their order is ready. Re-measured whenever the space or the count changes.
 */
const TILE_ASPECT = 0.78; // height ÷ width

function useFitGrid(count) {
  const ref = useRef(null);
  const [fit, setFit] = useState({ cols: 1, width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || count === 0) return undefined;

    const measure = () => {
      const style = getComputedStyle(el);
      const gap = parseFloat(style.columnGap) || 0;
      const W = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const H = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (W <= 0 || H <= 0) return;

      // One or two orders should read big, not fill a wall.
      const cap = Math.min(window.innerWidth, window.innerHeight) * 0.34;
      let best = { cols: 1, width: 0 };
      for (let cols = 1; cols <= count; cols += 1) {
        const rows = Math.ceil(count / cols);
        const byWidth = (W - gap * (cols - 1)) / cols;
        const byHeight = (H - gap * (rows - 1)) / rows / TILE_ASPECT;
        const width = Math.min(byWidth, byHeight, cap);
        if (width > best.width) best = { cols, width };
      }
      const width = Math.max(40, Math.floor(best.width));
      setFit({ cols: best.cols, width, height: Math.floor(width * TILE_ASPECT) });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);

  return [ref, fit];
}

/** Is the screen wider than it is tall? Follows rotation and window resizes. */
function useIsLandscape() {
  const query = '(orientation: landscape)';
  const [landscape, setLandscape] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const onChange = () => setLandscape(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return landscape;
}

/**
 * Width of a line of text at 1px font size, measured with the page's own font
 * (Inter), so a heading or a number can be sized to fill exactly the width it
 * has. Cached; cleared once the web font has loaded.
 */
const textWidths = new Map();
let measureContext = null;

function widthPerPx(text, { weight = 900, tracking = 0, uppercase = false } = {}) {
  const shown = uppercase ? String(text).toUpperCase() : String(text);
  const key = `${weight}|${tracking}|${shown}`;
  if (!textWidths.has(key)) {
    measureContext ??= document.createElement('canvas').getContext('2d');
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    measureContext.font = `${weight} 100px ${family}`;
    textWidths.set(key, measureContext.measureText(shown).width / 100 + tracking * shown.length);
  }
  return textWidths.get(key);
}

/** Re-render once web fonts are ready, so measurements use the real font. */
function useFontsReady() {
  const [ready, setReady] = useState(() => document.fonts?.status === 'loaded');
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      textWidths.clear();
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** The element's current size, kept up to date. */
function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function Column({ heading, sub, tone, orders, highlight, empty, className }) {
  const isReady = tone === 'ready';
  const [boxRef, box] = useElementSize();
  const [gridRef, fit] = useFitGrid(orders.length);
  useFontsReady();

  /*
   * TEXT FITS THE SPACE IT HAS. The heading is sized so the word, the count and
   * the padding exactly fill this list's width — as large as a 56-inch TV
   * allows, and never overflowing a slim strip beside the video — and never
   * taller than about a fifth of the list, so the numbers keep the room.
   */
  const countText = String(orders.length);
  const headingUnits =
    widthPerPx(heading, { weight: 900, tracking: 0.025, uppercase: true }) + // the word
    1.0 + // padding, half a font-size each side
    0.3 + // gap
    0.8 * (widthPerPx(countText, { weight: 900 }) + 0.9); // the count pill (0.8em, 0.45em padding)
  const headingPx = box.width
    ? Math.round(clamp(Math.min((box.width * 0.96) / headingUnits, box.height * 0.12), 14, 220))
    : 20;
  const showSub = headingPx >= 20 && box.height >= headingPx * 5;

  // One size for every number in the list, from the widest one, so tiles read evenly.
  const widestNumber = orders.reduce(
    (max, o) => Math.max(max, widthPerPx(o.ticketNumber ?? '', { weight: 900 })),
    widthPerPx('88', { weight: 900 }),
  );
  const labels = orders.map((o) =>
    o.orderType === 'dine_in' && o.tableNumber
      ? `Table ${o.tableNumber}`
      : (ORDER_TYPE_LABEL[o.orderType] ?? ''),
  );
  const widestLabel = labels.reduce(
    (max, text) => Math.max(max, widthPerPx(text, { weight: 600, tracking: 0.025, uppercase: true })),
    0,
  );
  const labelPx = widestLabel ? Math.floor(Math.min(fit.height * 0.13, (fit.width * 0.86) / widestLabel)) : 0;
  const showLabel = labelPx >= 12 && fit.height >= 80;
  const numberPx = Math.floor(
    Math.max(16, Math.min((fit.width * 0.84) / widestNumber, fit.height * (showLabel ? 0.56 : 0.72))),
  );

  return (
    <section
      ref={boxRef}
      aria-label={heading}
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.6vmin] border-2',
        isReady ? 'border-success/60 bg-success/5' : 'border-warning/40 bg-warning/5',
        className,
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-2',
          isReady ? 'bg-success text-success-foreground' : 'bg-warning text-warning-foreground',
        )}
        style={{ padding: `${Math.round(headingPx * 0.32)}px ${Math.round(headingPx * 0.5)}px` }}
      >
        <div className="min-w-0">
          <h2
            className="truncate font-black uppercase leading-none tracking-wide"
            style={{ fontSize: headingPx }}
          >
            {heading}
          </h2>
          {showSub && (
            <p
              className="mt-[0.25em] truncate font-semibold opacity-90"
              style={{ fontSize: Math.max(11, Math.round(headingPx * 0.38)) }}
            >
              {sub}
            </p>
          )}
        </div>
        <span
          className="shrink-0 rounded-full bg-black/15 px-[0.45em] font-black tabular-nums leading-tight"
          style={{ fontSize: Math.round(headingPx * 0.8) }}
          aria-label={`${orders.length} orders`}
        >
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <p
          className="grid flex-1 place-items-center p-[0.6em] text-center text-muted-foreground"
          style={{ fontSize: Math.max(13, Math.round(headingPx * 0.42)) }}
        >
          {empty}
        </p>
      ) : (
        <ul
          ref={gridRef}
          className="grid min-h-0 flex-1 content-center justify-center gap-[1vmin] overflow-hidden p-[1.1vmin]"
          style={{
            gridTemplateColumns: `repeat(${fit.cols}, ${fit.width}px)`,
            gridAutoRows: `${fit.height}px`,
          }}
        >
          <AnimatePresence initial={false}>
            {orders.map((order) => {
              const fresh = highlight?.has(order.id);
              return (
                <motion.li
                  key={order.id}
                  layout
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  className={cn(
                    'flex flex-col items-center justify-center overflow-hidden rounded-[1.6vmin] border-2 bg-surface',
                    isReady ? 'border-success/50' : 'border-border',
                    fresh && 'board-glow border-success',
                  )}
                >
                  <span
                    className={cn(
                      'font-black leading-none tabular-nums',
                      isReady ? 'text-success' : 'text-foreground',
                    )}
                    // Measured to fill the tile's width and height on any screen.
                    style={{ fontSize: numberPx }}
                  >
                    {order.ticketNumber}
                  </span>
                  {/* Too small to read? Then the number alone says it. */}
                  <span
                    className={cn(
                      'mt-[0.35em] max-w-full truncate px-1 font-semibold uppercase tracking-wide text-muted-foreground',
                      !showLabel && 'hidden',
                    )}
                    style={{ fontSize: labelPx || 11 }}
                  >
                    {order.orderType === 'dine_in' && order.tableNumber
                      ? `Table ${order.tableNumber}`
                      : ORDER_TYPE_LABEL[order.orderType]}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

/**
 * The owner's videos, one after another on a loop.
 * Muted unless sound is switched on in Settings and someone has tapped the
 * screen (browsers refuse sound before that). A file that cannot play is
 * reported and skipped, so the board never shows a black rectangle.
 */
function VideoPanel({ videos, fit = 'cover', withSound, onBroken, className }) {
  const [index, setIndex] = useState(0);
  const src = videos[index % videos.length];
  const videoRef = useRef(null);

  useEffect(() => {
    if (index >= videos.length) setIndex(0);
  }, [videos.length, index]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !withSound;
    video.play().catch(() => {
      // Sound refused before a tap: play silently instead of not at all.
      video.muted = true;
      video.play().catch(() => {});
    });
  }, [src, withSound]);

  return (
    <section
      aria-label="Video"
      className={cn(
        'relative min-h-0 overflow-hidden rounded-[2vmin] border-2 border-border bg-black',
        className,
      )}
    >
      <AnimatePresence mode="wait">
        <motion.video
          key={src}
          ref={videoRef}
          src={mediaUrl(src)}
          autoPlay
          muted
          playsInline
          // One clip loops on its own; a playlist moves on when each ends.
          loop={videos.length === 1}
          onEnded={() => setIndex((i) => (i + 1) % videos.length)}
          onError={() => onBroken(src)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className={cn(
            'absolute inset-0 h-full w-full',
            fit === 'contain' ? 'object-contain' : 'object-cover',
          )}
        />
      </AnimatePresence>
    </section>
  );
}

function HeaderButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-surface-hover hover:text-foreground"
    >
      {children}
    </button>
  );
}

export default OrderBoardPage;
