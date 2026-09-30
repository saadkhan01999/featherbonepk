import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  Plus,
  Minus,
  X,
  Trash2,
  Printer,
  Percent,
  PauseCircle,
  Layers,
  User,
  AlertCircle,
  PackageX,
  Wallet,
  LogOut,
  ChefHat,
  ClipboardList,
  StickyNote,
  UtensilsCrossed,
  ShoppingBag,
  BellRing,
  CircleCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Spinner } from '@/components/ui/Spinner.jsx';
import { PosSlip } from '@/pages/pos/PosSlip.jsx';
import { PaymentModal } from '@/components/pos/PaymentModal.jsx';
import { OpenTicketsModal } from '@/components/pos/OpenTicketsModal.jsx';
import { ShiftModal } from '@/components/pos/ShiftModal.jsx';
import { usePrintJob } from '@/components/common/PrintPortal.jsx';
import { KitchenTicketSlip } from '@/components/kitchen/KitchenTicketSlip.jsx';
import { usePosCart } from '@/features/pos/usePosCart.js';
import { usePosStore } from '@/features/pos/posStore.js';
import { useClickSound } from '@/features/pos/useClickSound.js';
import { usePosAuth } from '@/features/pos/posAuth.jsx';
import { orderTypeLine } from '@/features/kitchen/labels.js';
import { posClient } from '@/services/apiClient.js';
import { EVENTS, useConnectionStore, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { applySurfaceTheme } from '@/lib/theme.js';
import { playChime, unlockAudio } from '@/lib/chime.js';
import { useNow } from '@/lib/useNow.js';
import { formatCurrency, formatQuantity, formatRelativeTime } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';

/**
 * POS billing terminal.
 * ---------------------------------------------------------------------------
 * Menu on the left, the bill on the right, totals and actions pinned.
 *
 * Two ways to finish a bill:
 *
 *   Send to kitchen   The order goes to the Kitchen Display as a numbered
 *                     ticket, unpaid — dine-in, or "pay when you collect".
 *                     It waits under Open tickets until it is paid.
 *   Charge            Paid now. With "fire paid orders" on (Settings →
 *                     Kitchen) it also goes to the kitchen, numbered, so the
 *                     customer can watch for their number on the board.
 *
 * When the kitchen taps Done, this till chimes and shows "#42 is ready" — the
 * ticket is the order, so there is nothing to poll or reconcile.
 *
 * Design constraints specific to a till:
 *  • The page never scrolls. Grid and bill scroll independently, so the total
 *    and the pay button can never be pushed off screen mid-transaction.
 *  • The scan field holds focus and reclaims it after every action — a barcode
 *    gun is just a keyboard, and a scan sent to an unfocused page is lost.
 *  • Touch targets are oversized; a cashier taps at speed without looking.
 *  • Everything the till shows is live: a price, stock level, menu scope,
 *    tax rate or receipt setting changed in the back office arrives over the
 *    socket and is re-read, without a reload.
 */
export function PosTerminalPage() {
  const { session, signOut } = usePosAuth();

  // --- Till state (Zustand) ------------------------------------------------
  const terminal = usePosStore((s) => s.terminal);
  const config = usePosStore((s) => s.config);
  const categories = usePosStore((s) => s.categories);
  const products = usePosStore((s) => s.products);
  const menuStatus = usePosStore((s) => s.menuStatus);
  const openOrders = usePosStore((s) => s.openOrders);
  const readyAlerts = usePosStore((s) => s.readyAlerts);
  const parked = usePosStore((s) => s.parked);
  const actions = usePosStore.getState();

  /*
   * GST comes from business settings, not a constant — a till billing the
   * wrong tax is a compliance problem. The default below only covers the
   * moment before /settings/pos-config answers.
   */
  const pricing = config?.pricing ?? { taxRate: 0.05, taxLabel: 'GST' };
  const posRules = config?.pos;
  const kitchenOn = Boolean(config?.kitchen?.enabled);
  const business = config?.business ?? null;
  const canDiscount = Boolean(terminal?.permissions?.discount);

  const cart = usePosCart({
    taxRate: pricing.taxRate,
    defaultOrderType: posRules?.defaultOrderType ?? 'take_away',
  });

  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [scanError, setScanError] = useState(null);
  /* Audible confirmation at the counter — see useClickSound for why. */
  const beep = useClickSound();
  const [isDiscountOpen, setDiscountOpen] = useState(false);
  const [isPaymentOpen, setPaymentOpen] = useState(false);
  const [isSlipOpen, setSlipOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [isParkedOpen, setParkedOpen] = useState(false);
  const [isTicketsOpen, setTicketsOpen] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  /** Is a cash-drawer shift open on this till? null until known. */
  const [shiftOpen, setShiftOpen] = useState(null);
  const checkShift = useCallback(async () => {
    try {
      setShiftOpen(Boolean(await posClient.get('/pos/shift')));
    } catch {
      setShiftOpen(null);
    }
  }, []);
  useEffect(() => {
    checkShift();
  }, [checkShift]);
  const [isCustomerOpen, setCustomerOpen] = useState(false);
  const [isNoteOpen, setNoteOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const [isFiring, setFiring] = useState(false);
  const [saleError, setSaleError] = useState(null);
  const [toast, setToast] = useState(null);
  /** An open ticket being paid (from Open tickets), or null for the current bill. */
  const [payingTicket, setPayingTicket] = useState(null);
  /** Today's takings on this till. */
  const [takings, setTakings] = useState(null);

  const scanRef = useRef(null);
  /**
   * Idempotency key for the bill in progress. A ref, not state — regenerating
   * it on re-render would defeat the whole point of having one.
   */
  const saleRefRef = useRef(null);
  const printJob = usePrintJob();
  const connection = useConnectionStore((s) => s.pos);
  const now = useNow(15_000);

  /** Return focus to the scan field — called after every interaction. */
  const refocusScanner = useCallback(() => {
    requestAnimationFrame(() => scanRef.current?.focus());
  }, []);

  const flash = useCallback((text, tone = 'success') => {
    setToast({ text, tone, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(id);
  }, [toast]);

  /** Today's takings on this terminal — never fatal. */
  const refreshTakings = useCallback(async () => {
    try {
      setTakings(await posClient.get('/pos/summary'));
    } catch {
      /* The strip simply omits the figure. */
    }
  }, []);

  // --- Load everything the till needs ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      /*
       * `/pos/*`, not `/catalog/*`: scoped to this counter and this till's menu
       * (Back office → POS / Tills → Menu). The scope comes from the POS token
       * and the terminal record — there is no parameter to tamper with.
       */
      await Promise.all([
        actions.loadMenu(),
        actions.loadConfig(),
        actions.loadTerminal(),
        actions.loadOpenOrders(),
      ]);
      void refreshTakings();
      if (!cancelled) refocusScanner();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    actions.loadParked(session?.terminalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.terminalId]);

  useEffect(() => {
    if (menuStatus === 'error') setScanError('Could not load the menu. Check the connection and refresh.');
  }, [menuStatus]);

  // The till's own light/dark choice (Settings → Theme → POS).
  useEffect(() => {
    if (config?.theme) applySurfaceTheme('pos', config.theme);
  }, [config?.theme]);

  // A fresh bill starts as the till's default order type.
  const defaultOrderType = posRules?.defaultOrderType;
  useEffect(() => {
    if (defaultOrderType && cart.isEmpty) cart.setOrderType(defaultOrderType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOrderType]);

  // --- Live updates ------------------------------------------------------------
  const refreshOpen = useDebouncedCallback(() => {
    actions.loadOpenOrders();
    refreshTakings();
  }, 300);
  const refreshStock = useDebouncedCallback(() => actions.refreshProducts(), 600);
  const reloadMenu = useDebouncedCallback(() => actions.loadMenu(), 400);

  useRealtimeEvent('pos', EVENTS.ORDER_CHANGED, (event) => {
    refreshOpen();
    // The kitchen tapped Done on one of this till's tickets.
    if (event?.action === 'status' && event.status === 'ready' && event.ticketNumber != null) {
      actions.pushReady({ id: event.id, ticketNumber: event.ticketNumber, orderType: event.orderType });
      playChime('ready');
    }
  });
  useRealtimeEvent('pos', EVENTS.STOCK_CHANGED, refreshStock);
  useRealtimeEvent('pos', EVENTS.CATALOG_CHANGED, reloadMenu);
  useRealtimeEvent('pos', EVENTS.TERMINAL_CHANGED, () => {
    // The menu scope or name of this till changed in the back office.
    actions.loadTerminal();
    reloadMenu();
  });
  useRealtimeEvent('pos', EVENTS.SETTINGS_CHANGED, () => actions.loadConfig());

  // Events missed while offline are not replayed; re-read on reconnect.
  useEffect(() => {
    if (connection === 'online') refreshOpen();
  }, [connection, refreshOpen]);

  // Other tills at this counter do not signal this one — a slow poll covers them.
  useEffect(() => {
    const id = setInterval(() => actions.loadOpenOrders(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Visible products --------------------------------------------------
  const visibleProducts = useMemo(() => {
    let list = products;
    if (activeCategory !== 'all') {
      list = list.filter((p) => (p.category?._id ?? p.category?.id ?? p.category) === activeCategory);
    }
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(term) || p.sku?.toLowerCase().includes(term));
    }
    return list;
  }, [products, activeCategory, search]);

  /**
   * Handle a scan (or a typed code + Enter).
   *
   * Resolves the literal field value server-side against barcode/SKU only. It
   * never falls back to the filtered grid: a gun types and submits in ~40ms,
   * so a list rendered from the previous input could bill the wrong item.
   */
  const handleScan = useCallback(
    async (event) => {
      event.preventDefault();
      const code = search.trim();
      if (!code) return;

      setScanError(null);
      try {
        const product = await posClient.get('/pos/products/resolve', { params: { code } });
        cart.addItem(product, 1);
        beep('ok');
        setSearch('');
      } catch (error) {
        setScanError(error.message ?? 'Item not found');
        // A different tone: a failed scan that sounds like a good one is worse than silence.
        beep('error');
      } finally {
        refocusScanner();
      }
    },
    [search, cart, refocusScanner, beep],
  );

  function addProduct(product) {
    unlockAudio();
    if (product.stockStatus === 'out_of_stock') {
      beep('error');
      return;
    }
    cart.addItem(product, 1);
    beep('ok');
    setScanError(null);
    refocusScanner();
  }

  // --- Parked bills (kept per terminal across reloads) ---------------------------
  function holdBill() {
    if (cart.isEmpty) return;
    actions.park({ state: cart.snapshot, total: cart.totals.total, customer: cart.customer?.name ?? null });
    cart.clear();
    saleRefRef.current = null;
    refocusScanner();
  }

  function resumeBill(bill) {
    if (!cart.isEmpty) holdBill();
    cart.restore(bill.state);
    actions.unpark(bill.id);
    refocusScanner();
  }

  /** The body shared by "Charge" and "Send to kitchen". */
  function billBody() {
    const ref = saleRefRef.current ?? (saleRefRef.current = crypto.randomUUID());
    return {
      saleRef: ref,
      items: cart.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      discount: cart.totals.discount,
      orderType: cart.orderType,
      ...(cart.orderType === 'dine_in' &&
        cart.tableNumber.trim() && { tableNumber: cart.tableNumber.trim() }),
      ...(cart.kitchenNote.trim() && { kitchenNote: cart.kitchenNote.trim() }),
      ...(cart.customer?.name && { customer: cart.customer }),
    };
  }

  /** Dine-in with "ask for the table" on needs a table before it leaves the till. */
  function checkTable() {
    if (cart.orderType === 'dine_in' && posRules?.askTable && !cart.tableNumber.trim()) {
      setScanError('Enter the table number for this dine-in order.');
      beep('error');
      return false;
    }
    return true;
  }

  /** Print a kitchen ticket for a slip the server returned. */
  const printKitchenTicket = useCallback(
    (slip) =>
      printJob.print(
        <KitchenTicketSlip
          ticket={{
            ticketNumber: slip.ticketNumber,
            orderNumber: slip.invoiceNumber,
            orderType: slip.orderType,
            tableNumber: slip.tableNumber,
            channel: 'pos',
            terminalName: terminal?.name ?? slip.terminalId,
            firedAt: slip.at,
            customerName: slip.customer && slip.customer !== 'Walk-in Customer' ? slip.customer : null,
            kitchenNote: slip.kitchenNote,
            items: slip.lines.map((l) => ({
              name: l.name,
              quantity: l.quantity,
              unitLabel: l.unitLabel,
              isWeighed: l.isWeighed,
            })),
          }}
          business={business}
          paperWidth={posRules?.receipt?.paperWidth}
          bold={posRules?.receipt?.bold ?? true}
        />,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terminal?.name, business, posRules?.receipt],
  );

  const printReceipt = useCallback(
    (slip) => printJob.print(<PosSlip sale={slip} business={business} receipt={posRules?.receipt} />),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [business, posRules?.receipt],
  );

  /**
   * Send to kitchen — an unpaid, numbered ticket. The bill clears for the next
   * customer; the ticket waits under Open tickets until it is paid.
   */
  async function sendToKitchen() {
    if (cart.isEmpty || isFiring || !checkTable()) return;
    setFiring(true);
    setScanError(null);
    try {
      const slip = await posClient.post('/pos/orders', billBody());
      saleRefRef.current = null;
      beep('ok');
      flash(`Ticket #${slip.ticketNumber} sent to the kitchen — ${orderTypeLine(slip)}`);
      if (posRules?.kitchenTicketPrint) printKitchenTicket(slip);
      cart.clear();
      void actions.refreshProducts();
      void actions.loadOpenOrders();
    } catch (error) {
      setScanError(error.message ?? 'Could not send this order to the kitchen.');
      beep('error');
    } finally {
      setFiring(false);
      refocusScanner();
    }
  }

  /**
   * Charge — record the sale, then show the slip the server returns (never one
   * built from local state: the printed figures must be the ledger's).
   */
  async function chargeSale({ paymentMethod, tendered }) {
    setSaving(true);
    setSaleError(null);

    try {
      let slip;
      if (payingTicket) {
        slip = await posClient.post(`/pos/orders/${payingTicket.id}/pay`, {
          paymentMethod,
          ...(tendered !== undefined && { tendered }),
        });
      } else {
        if (cart.isEmpty) return;
        slip = await posClient.post('/pos/sales', {
          ...billBody(),
          paymentMethod,
          ...(tendered !== undefined && { tendered }),
        });
        // Consumed — the next sale needs its own key.
        saleRefRef.current = null;
      }

      setCompletedSale({ ...slip, fromTicket: Boolean(payingTicket) });
      setPaymentOpen(false);
      setSlipOpen(true);
      // A paid ticket that went to the kitchen gets its kitchen copy printed
      // automatically when the owner has asked for kitchen tickets.
      if (!payingTicket && slip.ticketNumber != null && posRules?.kitchenTicketPrint)
        printKitchenTicket(slip);
      setPayingTicket(null);
      void actions.refreshProducts();
      void actions.loadOpenOrders();
      void refreshTakings();
    } catch (error) {
      setSaleError(error.message ?? 'Could not record this sale. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  /*
   * Tighter type for the till — see `.pos-dense` in index.css. On <body>
   * because the payment dialog and slip render through portals.
   */
  useEffect(() => {
    document.body.classList.add('pos-dense');
    return () => document.body.classList.remove('pos-dense');
  }, []);

  /** Dismiss the slip and start the next bill. */
  function completeSale() {
    setSlipOpen(false);
    if (!completedSale?.fromTicket) cart.clear();
    setCompletedSale(null);
    refocusScanner();
  }

  const unpaidCount = openOrders.filter((o) => o.paymentStatus !== 'paid').length;
  const readyCount = openOrders.filter((o) => o.status === 'ready').length;
  const paymentContext = payingTicket
    ? [orderTypeLine(payingTicket), payingTicket.customer].filter(Boolean).join(' · ')
    : [orderTypeLine({ orderType: cart.orderType, tableNumber: cart.tableNumber }), cart.customer?.name]
        .filter(Boolean)
        .join(' · ');

  return (
    // h-screen + overflow-hidden: the shell itself must never scroll.
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* ---------------- Top bar ---------------- */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="hidden items-center gap-2 pr-1 sm:flex">
          {business?.logoUrl ? (
            <img src={mediaUrl(business.logoUrl)} alt="" className="h-9 w-9 rounded-lg object-contain" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gold-gradient text-sm font-black text-gold-foreground">
              {(business?.name ?? 'F').charAt(0)}
            </span>
          )}
          <div className="hidden leading-tight xl:block">
            <p className="text-sm font-bold">{terminal?.name ?? session?.terminalId}</p>
            <p className="text-[10px] text-muted-foreground">
              {terminal?.store?.name ?? business?.name}
              {terminal?.menuMode && terminal.menuMode !== 'all' && ' · custom menu'}
            </p>
          </div>
        </div>

        <form onSubmit={handleScan} className="relative min-w-[180px] flex-1 basis-full sm:basis-auto">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={scanRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setScanError(null);
            }}
            placeholder="Scan barcode or search item…"
            aria-label="Scan barcode or search item"
            className={cn(
              'h-11 w-full rounded-xl border bg-background pl-10 pr-3 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring/60',
              scanError ? 'border-destructive' : 'border-border-strong focus:border-gold',
            )}
          />
        </form>

        {/* On a phone the toolbar is icons only, one row; the words return from `sm` up. */}
        <div className="flex w-full items-center gap-2 overflow-x-auto sm:w-auto sm:flex-wrap sm:overflow-visible">
          <Button
            variant="secondary"
            leftIcon={ClipboardList}
            onClick={() => setTicketsOpen(true)}
            aria-label="Open tickets"
            className="shrink-0"
          >
            <span className="hidden sm:inline">Open tickets</span>
            {openOrders.length > 0 && (
              <Badge variant={readyCount ? 'success' : 'gold'} size="sm" className="ml-1">
                {openOrders.length}
              </Badge>
            )}
          </Button>

          <Button
            variant="secondary"
            leftIcon={PauseCircle}
            onClick={holdBill}
            disabled={cart.isEmpty}
            aria-label="Hold bill"
            className="shrink-0"
          >
            <span className="hidden sm:inline">Hold</span>
          </Button>

          <Button
            variant="secondary"
            leftIcon={Layers}
            onClick={() => setParkedOpen(true)}
            disabled={parked.length === 0}
            aria-label="Parked bills"
            className="shrink-0"
          >
            <span className="hidden sm:inline">Parked</span>
            {parked.length > 0 && (
              <Badge variant="gold" size="sm" className="ml-1">
                {parked.length}
              </Badge>
            )}
          </Button>

          <Button
            variant="secondary"
            leftIcon={Wallet}
            onClick={() => setDrawerOpen(true)}
            aria-label={shiftOpen ? 'Cash drawer — shift open' : 'Cash drawer — no shift open'}
            className="shrink-0"
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                shiftOpen ? 'bg-success' : shiftOpen === false ? 'bg-warning' : 'bg-muted-foreground',
              )}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Drawer</span>
          </Button>

          <Button
            variant="outline"
            leftIcon={User}
            onClick={() => setCustomerOpen(true)}
            aria-label="Customer"
            className="min-w-0 shrink"
          >
            <span className="max-w-[9rem] truncate">{cart.customer?.name ?? 'Walk-in'}</span>
          </Button>

          {/* Who is on the till, whether it is live, and how to hand over. */}
          <div className="ml-auto flex shrink-0 items-center gap-2 border-l border-border pl-2 sm:ml-0">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                connection === 'online'
                  ? 'bg-success'
                  : connection === 'connecting'
                    ? 'bg-warning'
                    : 'bg-destructive',
              )}
              title={connection === 'online' ? 'Live' : 'Reconnecting — sales still work'}
              aria-label={connection === 'online' ? 'Connected' : 'Reconnecting'}
            />
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-xs font-semibold">
                {session?.cashierName ?? 'Cashier'} ·{' '}
                {new Date(now).toLocaleTimeString('en-PK', {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'Asia/Karachi',
                })}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {session?.terminalId ?? 'TILL-01'}
                {takings && ` · ${formatCurrency(takings.revenue)} today`}
                {unpaidCount > 0 && ` · ${unpaidCount} unpaid`}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} title="Hand over the till">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Sign out of this terminal</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Scan / send failure — announced, and never silently ignored. */}
      <AnimatePresence>
        {scanError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            role="alert"
            className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span className="text-sm text-destructive">{scanError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ---------------- Products ---------------- */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Menu items">
          {/* One swipeable row on a phone, so the menu keeps the screen; wraps from `sm` up. */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-4 py-2 sm:flex-wrap">
            <CategoryTab active={activeCategory === 'all'} onClick={() => setActiveCategory('all')}>
              All Items
            </CategoryTab>
            {categories.map((category) => {
              const id = category._id ?? category.id;
              return (
                <CategoryTab key={id} active={activeCategory === id} onClick={() => setActiveCategory(id)}>
                  {category.name}
                </CategoryTab>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {menuStatus === 'loading' ? (
              <div className="flex h-full items-center justify-center">
                <Spinner size="lg" label="Loading menu" />
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <PackageX className="h-10 w-10" aria-hidden="true" />
                <p className="text-sm">
                  {search
                    ? `No items match “${search}”`
                    : 'Nothing on this till’s menu yet — assign items in Back office → POS / Tills.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
                {visibleProducts.map((product) => (
                  <ProductTile key={product.id} product={product} onSelect={addProduct} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ---------------- Current order ---------------- */}
        <aside
          className="flex max-h-[60vh] w-full shrink-0 flex-col border-t border-border bg-surface lg:max-h-none lg:max-w-[480px] lg:border-l lg:border-t-0"
          aria-label="Current order"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <h2 className="font-semibold tracking-tight">Current Order</h2>
            {/* Take away / Dine in — goes on the kitchen ticket and the board. */}
            <div
              role="radiogroup"
              aria-label="Order type"
              className="flex rounded-lg border border-border-strong p-0.5"
            >
              {[
                { value: 'take_away', label: 'Take away', icon: ShoppingBag },
                { value: 'dine_in', label: 'Dine in', icon: UtensilsCrossed },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={cart.orderType === option.value}
                  onClick={() => {
                    cart.setOrderType(option.value);
                    refocusScanner();
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                    cart.orderType === option.value
                      ? 'bg-gold-gradient text-gold-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {(cart.orderType === 'dine_in' || isNoteOpen || cart.kitchenNote) && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              {cart.orderType === 'dine_in' && (
                <label className="flex items-center gap-2 text-xs font-medium">
                  Table
                  <input
                    value={cart.tableNumber}
                    onChange={(e) => cart.setTableNumber(e.target.value)}
                    placeholder={posRules?.askTable ? 'Required' : 'Optional'}
                    inputMode="numeric"
                    className="h-8 w-20 rounded-md border border-border-strong bg-background px-2 text-sm font-bold focus:border-gold focus:outline-none"
                  />
                </label>
              )}
              {(isNoteOpen || cart.kitchenNote) && (
                <input
                  value={cart.kitchenNote}
                  onChange={(e) => cart.setKitchenNote(e.target.value)}
                  placeholder="Note for the kitchen — e.g. no chilli"
                  aria-label="Note for the kitchen"
                  maxLength={300}
                  className="h-8 min-w-[10rem] flex-1 rounded-md border border-border-strong bg-background px-2 text-sm focus:border-gold focus:outline-none"
                />
              )}
            </div>
          )}

          <div className="grid shrink-0 grid-cols-[1fr_auto_auto] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Item · {cart.totals.itemCount}</span>
            <span className="w-24 text-center">Qty</span>
            <span className="w-20 text-right">Total</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.isEmpty ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
                <Search className="h-8 w-8" aria-hidden="true" />
                <p className="text-sm">Scan an item or tap the menu to start a bill</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {cart.lines.map((line, index) => (
                  <OrderLine
                    key={line.productId}
                    line={line}
                    lineTotal={cart.totals.lineTotals[index]}
                    onQuantity={(q) => cart.setQuantity(line.productId, q, line.isWeighed)}
                    onRemove={() => cart.removeItem(line.productId)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Totals + actions — pinned, never scrolled away. */}
          <div className="shrink-0 border-t border-border p-4">
            <dl className="space-y-1 text-sm">
              <TotalRow label="Subtotal" value={cart.totals.subtotal} />
              {cart.totals.discount > 0 && (
                <TotalRow label="Discount (−)" value={cart.totals.discount} muted />
              )}
              <TotalRow
                label={`Tax (${pricing.taxLabel ?? 'GST'} ${(cart.totals.taxRate * 100).toFixed((cart.totals.taxRate * 100) % 1 === 0 ? 0 : 2)}%)`}
                value={cart.totals.tax}
              />
            </dl>

            <div className="mt-2.5 flex items-baseline justify-between border-t border-border pt-2.5">
              <span className="font-semibold">Total Payable</span>
              <span className="text-2xl font-bold tabular-nums text-gold">
                {formatCurrency(cart.totals.total)}
              </span>
            </div>

            <div className={cn('mt-3 grid gap-2', canDiscount ? 'grid-cols-3' : 'grid-cols-2')}>
              {canDiscount && (
                <Button
                  variant="secondary"
                  leftIcon={Percent}
                  onClick={() => setDiscountOpen(true)}
                  disabled={cart.isEmpty}
                >
                  Discount
                </Button>
              )}
              <Button
                variant="secondary"
                leftIcon={StickyNote}
                onClick={() => setNoteOpen((open) => !open)}
                aria-pressed={isNoteOpen || Boolean(cart.kitchenNote)}
              >
                Note
              </Button>
              <Button
                variant="destructive"
                leftIcon={Trash2}
                // Confirmed: a mis-tap during a queue would lose the whole bill.
                onClick={() => setConfirmClear(true)}
                disabled={cart.isEmpty}
              >
                Clear
              </Button>
            </div>

            <div className={cn('mt-2 grid gap-2', kitchenOn ? 'grid-cols-2' : 'grid-cols-1')}>
              {kitchenOn && (
                <Button
                  size="pos"
                  variant="secondary"
                  leftIcon={ChefHat}
                  onClick={sendToKitchen}
                  isLoading={isFiring}
                  loadingText="Sending…"
                  disabled={cart.isEmpty}
                  title="Send to the kitchen now, take payment later"
                >
                  Send to kitchen
                </Button>
              )}
              <Button
                size="pos"
                leftIcon={Wallet}
                onClick={() => {
                  if (!checkTable()) return;
                  setSaleError(null);
                  setPayingTicket(null);
                  setPaymentOpen(true);
                }}
                disabled={cart.isEmpty}
              >
                Charge {formatCurrency(cart.totals.total)}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* ---------------- "#42 is ready" from the kitchen ---------------- */}
      <div
        className="pointer-events-none fixed right-3 top-16 z-40 flex w-80 flex-col gap-2"
        aria-live="polite"
      >
        <AnimatePresence>
          {readyAlerts.map((alert) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              className="pointer-events-auto flex items-center gap-3 rounded-xl border-2 border-success bg-surface p-3 shadow-elevated"
            >
              <BellRing className="h-6 w-6 shrink-0 text-success" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">Ticket #{alert.ticketNumber} is ready</p>
                <p className="text-xs text-muted-foreground">
                  {orderTypeLine(alert)} — hand it over and mark served
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  actions.dismissReady(alert.id);
                  setTicketsOpen(true);
                }}
                className="rounded-md bg-success px-2 py-1 text-xs font-bold text-success-foreground"
              >
                View
              </button>
              <button
                type="button"
                onClick={() => actions.dismissReady(alert.id)}
                aria-label="Dismiss"
                className="rounded p-1 text-muted-foreground hover:bg-surface-hover"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ---------------- Toast ---------------- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.at}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            role="status"
            className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-success/50 bg-surface px-4 py-3 text-sm font-semibold shadow-elevated"
          >
            <CircleCheck className="h-5 w-5 text-success" aria-hidden="true" />
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Dialogs ---------------- */}
      <Modal isOpen={isParkedOpen} onClose={() => setParkedOpen(false)} title="Parked bills" size="sm">
        <ul className="divide-y divide-border">
          {parked.map((bill, index) => {
            const count = bill.state?.lines?.length ?? 0;
            return (
              <li key={bill.id}>
                <button
                  type="button"
                  onClick={() => {
                    resumeBill(bill);
                    setParkedOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-1 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <span>
                    <span className="block font-medium">{bill.customer ?? `Bill ${index + 1}`}</span>
                    <span className="block text-xs text-muted-foreground">
                      {count} item{count === 1 ? '' : 's'} · {orderTypeLine(bill.state ?? {})} · parked{' '}
                      {formatRelativeTime(bill.at)}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-gold">
                    {formatCurrency(bill.total)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>

      <ShiftModal
        isOpen={isDrawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          checkShift();
        }}
        onChanged={checkShift}
      />

      <OpenTicketsModal
        isOpen={isTicketsOpen}
        onClose={() => {
          setTicketsOpen(false);
          refocusScanner();
        }}
        orders={openOrders}
        terminalId={session?.terminalId}
        canCancel={Boolean(terminal?.permissions?.cancelOrders)}
        onChanged={() => {
          actions.loadOpenOrders();
          refreshTakings();
          actions.refreshProducts();
        }}
        onPay={(ticket) => {
          setTicketsOpen(false);
          setSaleError(null);
          setPayingTicket(ticket);
          setPaymentOpen(true);
        }}
        onPrintBill={printReceipt}
        onPrintKitchen={printKitchenTicket}
        onFlash={flash}
      />

      <ConfirmDialog
        isOpen={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          cart.clear();
          saleRefRef.current = null;
          setConfirmClear(false);
          refocusScanner();
        }}
        title="Clear this bill?"
        message={`This removes all ${cart.lines.length} line${cart.lines.length === 1 ? '' : 's'}. Park the bill instead if the customer is coming back.`}
        confirmLabel="Clear bill"
      />

      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => {
          setPaymentOpen(false);
          setSaleError(null);
          setPayingTicket(null);
          refocusScanner();
        }}
        title={
          payingTicket
            ? `Pay ticket #${payingTicket.ticketNumber ?? payingTicket.invoiceNumber}`
            : 'Take Payment'
        }
        context={paymentContext}
        total={payingTicket ? payingTicket.total : cart.totals.total}
        onConfirm={chargeSale}
        isSaving={isSaving}
        error={saleError}
        counterPayments={config?.counterPayments}
        quickCash={posRules?.quickCash}
      />

      <DiscountModal
        isOpen={isDiscountOpen}
        onClose={() => {
          setDiscountOpen(false);
          refocusScanner();
        }}
        subtotal={cart.totals.subtotal}
        current={cart.saleDiscount}
        onApply={(amount) => {
          cart.setSaleDiscount(amount);
          setDiscountOpen(false);
          refocusScanner();
        }}
      />

      <CustomerModal
        isOpen={isCustomerOpen}
        onClose={() => {
          setCustomerOpen(false);
          refocusScanner();
        }}
        current={cart.customer}
        onSave={(customer) => {
          cart.setCustomer(customer);
          setCustomerOpen(false);
          refocusScanner();
        }}
      />

      {/* ---------------- Receipt ---------------- */}
      <Modal
        isOpen={isSlipOpen}
        onClose={() => setSlipOpen(false)}
        title={
          completedSale?.ticketNumber != null ? `Receipt — ticket #${completedSale.ticketNumber}` : 'Receipt'
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" leftIcon={Printer} onClick={() => printReceipt(completedSale)}>
              Print receipt
            </Button>
            {completedSale?.ticketNumber != null && (
              <Button variant="outline" leftIcon={ChefHat} onClick={() => printKitchenTicket(completedSale)}>
                Kitchen copy
              </Button>
            )}
            <Button variant="success" onClick={completeSale}>
              New sale
            </Button>
          </>
        }
      >
        {completedSale && (
          <div className="no-print space-y-3">
            {completedSale.ticketNumber != null && completedSale.status !== 'completed' && (
              <p className="rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-center text-sm font-semibold text-info">
                Sent to the kitchen as ticket #{completedSale.ticketNumber} — this till chimes when it is
                ready.
              </p>
            )}
            <PosSlip sale={completedSale} business={business} receipt={posRules?.receipt} />
          </div>
        )}
      </Modal>

      {printJob.portal}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Sub-components                                                            */
/* ------------------------------------------------------------------------ */

function CategoryTab({ active, children, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-gold-gradient text-gold-foreground'
          : 'bg-surface-raised text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function ProductTile({ product, onSelect }) {
  const isOut = product.stockStatus === 'out_of_stock';

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      disabled={isOut}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left transition-all',
        isOut
          ? 'cursor-not-allowed opacity-45'
          : 'hover:border-gold/50 hover:shadow-elevated active:scale-[0.98]',
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-surface-hover">
        {product.image ? (
          <img src={mediaUrl(product.image)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-hover to-surface text-2xl font-bold text-gold/40">
            {product.name.charAt(0)}
          </div>
        )}

        {product.discountPercent > 0 && (
          <Badge variant="solid-destructive" size="sm" className="absolute left-2 top-2">
            {product.discountPercent}% OFF
          </Badge>
        )}
        {product.stockStatus === 'low' && (
          <Badge variant="warning" size="sm" className="absolute bottom-2 left-2">
            Low
          </Badge>
        )}
        {isOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs font-semibold uppercase tracking-wide text-destructive">
            Out of stock
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between gap-0.5 p-2">
        <p className="line-clamp-2 text-xs font-medium leading-tight">{product.name}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-bold tabular-nums text-gold">
            {formatCurrency(product.effectivePrice)}
          </span>
          <span className="text-[10px] text-muted-foreground">/{product.unitLabel}</span>
        </div>
      </div>
    </button>
  );
}

function OrderLine({ line, lineTotal, onQuantity, onRemove }) {
  // Weighed goods step by 0.5 kg; countable goods by 1.
  const step = line.isWeighed ? 0.5 : 1;

  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{line.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatQuantity(line.quantity, line.unit)} × {formatCurrency(line.unitPrice)}
          {line.isWeighed && `/${line.unitLabel}`}
        </p>
      </div>

      <div className="flex w-24 items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => onQuantity(line.quantity - step)}
          aria-label={`Decrease ${line.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-raised text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="w-9 text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
        <button
          type="button"
          onClick={() => onQuantity(line.quantity + step)}
          aria-label={`Increase ${line.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-raised text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex w-20 items-center justify-end gap-1.5">
        <span className="text-sm font-semibold tabular-nums">{formatCurrency(lineTotal)}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${line.name}`}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function TotalRow({ label, value, muted = false }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', muted && 'text-muted-foreground')}>{formatCurrency(value)}</dd>
    </div>
  );
}

function DiscountModal({ isOpen, onClose, subtotal, current, onApply }) {
  const [value, setValue] = useState(String(current ?? 0));

  useEffect(() => {
    if (isOpen) setValue(String(current ?? 0));
  }, [isOpen, current]);

  const amount = Math.max(0, Math.min(Number(value) || 0, subtotal));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Apply Discount"
      description="Applied to the whole bill, before tax."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(amount)}>Apply {formatCurrency(amount)}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="discount-amount" className="text-sm font-medium">
            Discount amount (Rs.)
          </label>
          <input
            id="discount-amount"
            type="number"
            min={0}
            max={subtotal}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            className="mt-1.5 h-12 w-full rounded-lg border border-border-strong bg-surface px-3.5 text-lg font-semibold tabular-nums focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60"
          />
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[5, 10, 15, 20].map((percent) => (
            <Button
              key={percent}
              variant="secondary"
              size="sm"
              onClick={() => setValue(String(Math.round((subtotal * percent) / 100)))}
            >
              {percent}%
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Subtotal is {formatCurrency(subtotal)} — a discount cannot exceed it.
        </p>
      </div>
    </Modal>
  );
}

/** Name and phone for the slip and the kitchen ticket — "Walk-in" when left empty. */
function CustomerModal({ isOpen, onClose, current, onSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(current?.name ?? '');
      setPhone(current?.phone ?? '');
    }
  }, [isOpen, current]);

  const save = (event) => {
    event.preventDefault();
    const trimmed = { name: name.trim(), phone: phone.trim() };
    onSave(trimmed.name ? { name: trimmed.name, ...(trimmed.phone && { phone: trimmed.phone }) } : null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Customer"
      description="Printed on the receipt and the kitchen ticket. Leave empty for a walk-in."
      size="sm"
    >
      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm font-medium">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            className="mt-1 h-11 w-full rounded-lg border border-border-strong bg-surface px-3 focus:border-gold focus:outline-none"
          />
        </label>
        <label className="block text-sm font-medium">
          Phone
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
            inputMode="tel"
            className="mt-1 h-11 w-full rounded-lg border border-border-strong bg-surface px-3 focus:border-gold focus:outline-none"
          />
        </label>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={() => onSave(null)}>
            Walk-in
          </Button>
          <Button type="submit" className="flex-1">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default PosTerminalPage;
