import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Boxes,
  AlertTriangle,
  PackageX,
  Wallet,
  ImageOff,
  History,
  SlidersHorizontal,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  Radio,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal } from '@/components/ui/Modal.jsx';
import { Input, Select, Textarea } from '@/components/ui/Input.jsx';
import { SectionLoader, Spinner } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { StatTile } from '@/components/ui/StatTile.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { StatusBanner, useFlash } from '@/components/admin/CatalogShared.jsx';
import { ExportButtons, ReportViewerModal } from '@/components/reports/ReportView.jsx';
import { adminCatalogApi } from '@/features/catalog/adminCatalog.api.js';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { reportsApi } from '@/features/reports/reports.api.js';
import { useReportViewer } from '@/features/reports/useReportViewer.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { apiClient } from '@/services/apiClient.js';
import { EVENTS, useRealtimeEvent, useDebouncedCallback } from '@/services/realtime.js';
import {
  formatCurrency,
  formatNumber,
  formatQuantity,
  formatDateTime,
  toDateInputValue,
} from '@/lib/format.js';
import { staggerContainer } from '@/lib/motion.js';
import { cn, useDebouncedValue } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';

/**
 * Inventory management.
 * ---------------------------------------------------------------------------
 * Live stock across the menu, the ledger behind every figure, and the stock
 * reports as View / CSV / PDF.
 *
 *  • Search and filters run on the server, across the whole catalogue.
 *  • The tiles come from the server's stock report, not the rows on screen.
 *  • Stock changes are adjustments with a reason (count, delivery, write-off),
 *    recorded in the ledger with who and when.
 *  • Live: a sale at any till or on the website updates the figures.
 */

const STATUS = {
  in_stock: { label: 'In Stock', variant: 'success' },
  medium: { label: 'Medium', variant: 'warning' },
  low: { label: 'Low', variant: 'warning' },
  out_of_stock: { label: 'Out of Stock', variant: 'destructive' },
};

/** Tabs → the product list's `status` and the stock report's `stock`. */
const FILTERS = [
  { key: 'all', label: 'All Items', status: 'all', stock: 'all' },
  { key: 'active', label: 'On Sale', status: 'active', stock: 'active' },
  { key: 'low', label: 'Low & Out', status: 'low-stock', stock: 'low' },
  { key: 'inactive', label: 'Archived', status: 'inactive', stock: 'inactive' },
];

const MOVEMENT_TYPES = [
  { value: 'all', label: 'All movements' },
  { value: 'sale', label: 'Sales' },
  { value: 'return', label: 'Returns' },
  { value: 'adjustment', label: 'Adjustments' },
  { value: 'opening', label: 'Opening stock' },
];

const ADJUST_MODES = [
  { value: 'set', label: 'Stock count', hint: 'Enter what you counted on the shelf.', icon: ClipboardCheck },
  { value: 'add', label: 'Received', hint: 'A delivery — added to what is there.', icon: ArrowDownToLine },
  {
    value: 'remove',
    label: 'Write off',
    hint: 'Spoiled, damaged or used — taken away.',
    icon: ArrowUpFromLine,
  },
];

export function InventoryPage() {
  const { can } = useAuth();
  const canAdjust = can('inventory.adjust');
  const canExport = can('report.export');

  const [filterKey, setFilterKey] = useState('all');
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);

  const [adjusting, setAdjusting] = useState(null); // product
  const [historyOf, setHistoryOf] = useState(null); // product
  const [movementsOpen, setMovementsOpen] = useState(false);
  const { notice, flash } = useFlash();

  // --- The list: paged, searched and filtered by the server -------------------
  const {
    rows: products,
    meta,
    isLoading,
    error,
    reload,
    goToPage,
  } = usePagedResource(
    ({ page, limit }) =>
      adminCatalogApi.listProducts({
        page,
        limit,
        status: filter.status,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(category && { category }),
      }),
    [filter.status, debouncedSearch, category],
  );

  // --- Whole-catalogue figures, from the stock report --------------------------
  const stockParams = { stock: filter.stock, ...(category && { category }) };
  const [kpis, setKpis] = useState(null);
  const loadKpis = useCallback(async () => {
    try {
      const report = await reportsApi.run('inventory-stock', { stock: 'all', ...(category && { category }) });
      setKpis(Object.fromEntries(report.kpis.map((k) => [k.key, k.value])));
    } catch {
      setKpis(null);
    }
  }, [category]);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    adminCatalogApi
      .listCategories()
      .then((list) => setCategories(list ?? []))
      .catch(() => {});
  }, []);

  // --- Live: any sale, return or adjustment anywhere ---------------------------
  const refreshLive = useDebouncedCallback(() => {
    reload();
    loadKpis();
  }, 600);
  useRealtimeEvent('web', EVENTS.STOCK_CHANGED, refreshLive);
  useRealtimeEvent('web', EVENTS.CATALOG_CHANGED, refreshLive);

  const viewer = useReportViewer();

  if (isLoading && products.length === 0) return <SectionLoader label="Loading inventory" />;
  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
        {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Management</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Radio className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            Live stock — sales on the website and every till update this screen as they happen.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Stock report
          </span>
          <ExportButtons
            reportId="inventory-stock"
            params={stockParams}
            canExport={canExport}
            onView={() => viewer.open('inventory-stock', stockParams)}
          />
        </div>
      </header>

      <StatusBanner notice={notice} />

      {/* --- Whole-catalogue summary --- */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          icon={Boxes}
          label="Units in Stock"
          value={kpis ? formatNumber(kpis.units) : '—'}
          hint={kpis ? `${formatNumber(kpis.products)} products` : undefined}
        />
        <StatTile
          icon={Wallet}
          label="Stock Value"
          value={kpis ? formatCurrency(kpis.retail, { compact: true }) : '—'}
          hint={
            kpis?.cost !== undefined
              ? `at retail · ${formatCurrency(kpis.cost, { compact: true })} at cost`
              : 'at retail price'
          }
        />
        <StatTile
          icon={AlertTriangle}
          label="Running Low"
          value={kpis ? formatNumber(kpis.low) : '—'}
          tone="warning"
        />
        <StatTile
          icon={PackageX}
          label="Out of Stock"
          value={kpis ? formatNumber(kpis.out) : '—'}
          tone="destructive"
        />
      </motion.div>

      {/* --- Controls --- */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          placeholder="Search item, SKU or barcode…"
          label="Search inventory"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm focus:border-gold focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div
          role="group"
          aria-label="Stock filter"
          className="flex flex-wrap rounded-lg border border-border-strong p-0.5"
        >
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilterKey(option.key)}
              aria-pressed={filterKey === option.key}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                filterKey === option.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Button variant="outline" leftIcon={History} onClick={() => setMovementsOpen(true)}>
          Stock movements
        </Button>
      </div>

      {/* --- Table --- */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Stock levels by menu item</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                <th className="px-3 py-2.5 text-right font-medium">Reorder at</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Updated</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
                    {search || category || filterKey !== 'all'
                      ? 'Nothing matches those filters.'
                      : 'No products yet.'}
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const status = !product.isActive
                    ? { label: 'Archived', variant: 'default' }
                    : (STATUS[product.stockStatus] ?? STATUS.in_stock);

                  return (
                    <tr key={product.id} className="transition-colors hover:bg-surface-hover">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-3">
                          {product.image ? (
                            <img
                              src={mediaUrl(product.image)}
                              alt=""
                              loading="lazy"
                              className="h-9 w-9 rounded-lg object-cover"
                            />
                          ) : (
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-hover text-muted-foreground">
                              <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{product.name}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {[product.sku, product.barcode].filter(Boolean).join(' · ') || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{product.category?.name ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        {formatQuantity(product.stock, product.unit)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {product.lowStockThreshold}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(Math.max(0, product.stock) * product.price, { compact: true })}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant={status.variant} size="sm">
                          {status.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {formatDateTime(product.updatedAt)}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={History}
                            onClick={() => setHistoryOf(product)}
                          >
                            History
                          </Button>
                          {canAdjust && (
                            <Button
                              size="sm"
                              variant="outline"
                              leftIcon={SlidersHorizontal}
                              onClick={() => setAdjusting(product)}
                            >
                              Adjust
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination meta={meta} onPageChange={goToPage} label="products" />
        </div>
      </section>

      <AdjustStockModal
        product={adjusting}
        onClose={() => setAdjusting(null)}
        onDone={(message) => {
          flash('success', message);
          setAdjusting(null);
          reload();
          loadKpis();
        }}
        onError={(message) => flash('error', message)}
      />

      <HistoryModal product={historyOf} onClose={() => setHistoryOf(null)} />

      <MovementsModal
        isOpen={movementsOpen}
        onClose={() => setMovementsOpen(false)}
        categories={categories}
        canExport={canExport}
        onView={(params) => {
          setMovementsOpen(false);
          viewer.open('inventory-movements', params);
        }}
      />

      <ReportViewerModal {...viewer} onClose={viewer.close} canExport={canExport} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/** Count, delivery or write-off — each recorded in the ledger with a reason. */
function AdjustStockModal({ product, onClose, onDone, onError }) {
  const [mode, setMode] = useState('set');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setMode('set');
    setQuantity(String(product.stock));
    setNote('');
  }, [product]);

  if (!product) return null;

  const amount = Number(quantity);
  const valid = quantity !== '' && Number.isFinite(amount) && amount >= 0;
  const after = !valid
    ? null
    : mode === 'set'
      ? amount
      : mode === 'add'
        ? product.stock + amount
        : product.stock - amount;
  const selected = ADJUST_MODES.find((m) => m.value === mode);

  async function save(event) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      const result = await apiClient.post(`/inventory/products/${product.id}/adjust`, {
        mode,
        quantity: amount,
        ...(note.trim() && { note: note.trim() }),
      });
      onDone(result.message ?? 'Stock updated');
    } catch (err) {
      onError(err.message ?? 'Could not update stock');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Adjust stock — ${product.name}`}
      description={`Now ${formatQuantity(product.stock, product.unit)}`}
      size="md"
    >
      <form onSubmit={save} className="space-y-4">
        <div role="radiogroup" aria-label="Adjustment type" className="grid gap-2 sm:grid-cols-3">
          {ADJUST_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              onClick={() => {
                setMode(option.value);
                setQuantity(option.value === 'set' ? String(product.stock) : '');
              }}
              className={cn(
                'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-colors',
                mode === option.value
                  ? 'border-gold bg-gold/10'
                  : 'border-border-strong hover:border-gold/40',
              )}
            >
              <option.icon className="h-4 w-4 text-gold" aria-hidden="true" />
              <span className="text-sm font-semibold">{option.label}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>

        <Input
          label={
            mode === 'set' ? 'Counted quantity' : mode === 'add' ? 'Quantity received' : 'Quantity to remove'
          }
          type="number"
          min="0"
          step={['kg', 'g', 'ltr'].includes(product.unit) ? '0.5' : '1'}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          autoFocus
          required
        />

        <Textarea
          label="Reason"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            mode === 'remove'
              ? 'e.g. Dropped tray, expired'
              : mode === 'add'
                ? 'e.g. Supplier delivery #4471'
                : 'e.g. Evening stock take'
          }
          hint="Saved in the stock ledger with your name."
        />

        {after !== null && (
          <p
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              after < 0
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-border bg-surface-hover',
            )}
          >
            {selected.label}: {formatQuantity(product.stock, product.unit)} →{' '}
            <strong>{formatQuantity(Math.max(0, after), product.unit)}</strong>
            {after < 0 && ' — more than is in stock'}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving} loadingText="Saving…" disabled={!valid || after < 0}>
            Save adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const MOVEMENT_LABEL = {
  opening: 'Opening stock',
  sale: 'Sale',
  return: 'Returned',
  adjustment: 'Adjustment',
};

/** One product's ledger. */
function HistoryModal({ product, onClose }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!product) return;
    setRows(null);
    apiClient
      .get(`/inventory/products/${product.id}/history`, { params: { limit: 100 } })
      .then(setRows)
      .catch(() => setRows([]));
  }, [product]);

  if (!product) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Stock history — ${product.name}`}
      description="Every sale, return and adjustment, newest first."
      size="lg"
    >
      {!rows ? (
        <div className="flex justify-center py-10">
          <Spinner label="Loading history" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No movements recorded yet.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Movement</th>
                <th className="py-2 pr-3 text-right font-medium">Change</th>
                <th className="py-2 pr-3 text-right font-medium">Balance</th>
                <th className="py-2 font-medium">Reference / note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{formatDateTime(row.at)}</td>
                  <td className="py-2 pr-3">{MOVEMENT_LABEL[row.type] ?? row.type}</td>
                  <td
                    className={cn(
                      'py-2 pr-3 text-right font-semibold tabular-nums',
                      row.quantity < 0 ? 'text-destructive' : 'text-success',
                    )}
                  >
                    {row.quantity > 0 ? '+' : ''}
                    {formatNumber(row.quantity, 2)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.balanceAfter ?? '—'}</td>
                  <td className="py-2 text-xs">
                    <span className="font-mono">{row.reference ?? ''}</span>
                    {row.terminalId && <span className="text-muted-foreground"> · {row.terminalId}</span>}
                    {row.note && <span className="block text-muted-foreground">{row.note}</span>}
                    {row.actorName && <span className="block text-muted-foreground">by {row.actorName}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Pick a range and type, then View / CSV / PDF the ledger. */
function MovementsModal({ isOpen, onClose, categories, canExport, onView }) {
  const [preset, setPreset] = useState('week');
  const [from, setFrom] = useState(toDateInputValue(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(toDateInputValue(new Date()));
  const [movement, setMovement] = useState('all');
  const [category, setCategory] = useState('');

  const params = {
    preset,
    ...(preset === 'custom' && { from, to }),
    movement,
    ...(category && { category }),
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Stock movements report"
      description="The stock ledger for a period — every sale, return and adjustment with its balance."
      size="md"
      footer={
        <ExportButtons
          reportId="inventory-movements"
          params={params}
          canExport={canExport}
          onView={() => onView(params)}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Period" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="quarter">Last 90 days</option>
          <option value="year">Last 365 days</option>
          <option value="custom">Custom dates</option>
        </Select>
        <Select label="Movement" value={movement} onChange={(e) => setMovement(e.target.value)}>
          {MOVEMENT_TYPES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        {preset === 'custom' && (
          <>
            <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          containerClassName="sm:col-span-2"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}

export default InventoryPage;
