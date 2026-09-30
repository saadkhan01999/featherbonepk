import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Calendar, Store as StoreIcon, Monitor, Boxes, BarChart3, Filter } from 'lucide-react';

import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { ExportButtons, ReportView, ReportViewerModal } from '@/components/reports/ReportView.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { reportsApi } from '@/features/reports/reports.api.js';
import { useReportViewer } from '@/features/reports/useReportViewer.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { formatDateTime, toDateInputValue } from '@/lib/format.js';
import { fadeUp } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * Reports & Analytics.
 * ---------------------------------------------------------------------------
 * Pick a report, choose whose figures (the whole business, the website, every
 * till together, or one till) and the period, then View it here or take it
 * away as CSV or PDF.
 *
 * Everything on this screen is rendered from what the server says about the
 * report — its filters, its columns, its totals — so a report added on the
 * backend appears here correctly formatted and exportable, and the screen, the
 * spreadsheet and the PDF cannot disagree.
 */

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'quarter', label: '90 days' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Custom' },
];

const STOCK_OPTIONS = [
  { value: 'active', label: 'On sale' },
  { value: 'all', label: 'All products' },
  { value: 'low', label: 'Running low' },
  { value: 'out', label: 'Out of stock' },
  { value: 'in', label: 'Well stocked' },
  { value: 'inactive', label: 'Archived' },
];

const MOVEMENT_OPTIONS = [
  { value: 'all', label: 'All movements' },
  { value: 'sale', label: 'Sales' },
  { value: 'return', label: 'Returns' },
  { value: 'adjustment', label: 'Adjustments' },
  { value: 'opening', label: 'Opening stock' },
];

const GROUPS = [
  { key: 'sales', label: 'Sales', icon: BarChart3 },
  { key: 'inventory', label: 'Inventory', icon: Boxes },
];

export function ReportsPage() {
  const { can } = useAuth();
  const canExport = can('report.export');
  const [query, setQuery] = useSearchParams();

  const { data: catalogue } = useResource(() => reportsApi.catalogue(), []);
  const { data: storeList } = useResource(() => apiClient.get('/stores').catch(() => []), []);
  const { data: terminalList } = useResource(() => apiClient.get('/terminals').catch(() => []), []);
  const { data: categoryList } = useResource(
    () => apiClient.get('/admin/catalog/categories').catch(() => []),
    [],
  );
  const stores = storeList ?? [];
  const terminals = terminalList ?? [];
  const categories = categoryList ?? [];

  // The chosen report and scope live in the URL, so a link to "Till 2, this month" works.
  const reportId = query.get('report') ?? 'sales-overview';
  const scopeValue = query.get('scope') ?? 'all';
  const setParam = (key, value) => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    setQuery(next, { replace: true });
  };

  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState(() => ({
    from: toDateInputValue(new Date(Date.now() - 29 * 86_400_000)),
    to: toDateInputValue(new Date()),
  }));
  // '' means every counter. A manager assigned to one store is confined by the
  // server regardless of what this holds — the control narrows, it never grants.
  const [store, setStore] = useState('');
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState('active');
  const [movement, setMovement] = useState('all');

  const current = catalogue?.find((r) => r.id === reportId) ?? catalogue?.[0];
  const filters = new Set(current?.filters ?? []);

  // "terminal:TILL-01" → scope=terminal&terminal=TILL-01
  const [scope, terminal] = scopeValue.startsWith('terminal:')
    ? ['terminal', scopeValue.slice(9)]
    : [scopeValue, null];

  const params = useMemo(() => {
    const p = {};
    if (filters.has('range')) {
      p.preset = preset;
      if (preset === 'custom') Object.assign(p, custom);
    }
    if (filters.has('scope')) {
      p.scope = scope;
      if (terminal) p.terminal = terminal;
    }
    if (filters.has('store') && store) p.store = store;
    if (filters.has('category') && category) p.category = category;
    if (filters.has('stock')) p.stock = stock;
    if (filters.has('movement')) p.movement = movement;
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, preset, custom, scope, terminal, store, category, stock, movement]);

  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await reportsApi.run(current.id, params));
    } catch (err) {
      setError(err);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [current, params]);

  useEffect(() => {
    load();
  }, [load]);

  const viewer = useReportViewer();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports &amp; Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Pakistan time. Sales figures count paid orders and exclude cancellations and refunds.
          </p>
        </div>

        {current && (
          <ExportButtons
            reportId={current.id}
            params={params}
            canExport={canExport}
            onView={() => viewer.open(current.id, params)}
          />
        )}
      </header>

      {/* --- Report picker, grouped --- */}
      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        {GROUPS.map((group) => {
          const reports = (catalogue ?? []).filter((r) => r.group === group.key);
          if (!reports.length) return null;
          return (
            <div key={group.key} className="flex flex-wrap items-center gap-2">
              <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <group.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {group.label}
              </span>
              {reports.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setParam('report', item.id)}
                  aria-pressed={current?.id === item.id}
                  title={item.description}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    current?.id === item.id
                      ? 'bg-gold-gradient text-gold-foreground'
                      : 'border border-border-strong text-muted-foreground hover:border-gold/50 hover:text-foreground',
                  )}
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {current && <p className="text-sm text-muted-foreground">{current.description}</p>}

      {/* --- Filters: only what this report understands --- */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />

        {filters.has('scope') && (
          <label className="flex items-center gap-2 text-sm">
            <Monitor className="h-4 w-4 text-gold" aria-hidden="true" />
            <span className="sr-only">Whose sales</span>
            <select
              value={scopeValue}
              onChange={(e) => setParam('scope', e.target.value === 'all' ? '' : e.target.value)}
              className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm font-medium focus:border-gold focus:outline-none"
            >
              <option value="all">Whole business (website + all tills)</option>
              <option value="online">Website only</option>
              <option value="pos">All tills combined</option>
              {terminals.length > 0 && (
                <optgroup label="One till">
                  {terminals.map((t) => (
                    <option key={t.id} value={`terminal:${t.code}`}>
                      {t.code} — {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}

        {filters.has('range') && (
          <div
            role="group"
            aria-label="Report period"
            className="flex flex-wrap rounded-lg border border-border-strong p-0.5"
          >
            {RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => setPreset(range.key)}
                aria-pressed={preset === range.key}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  preset === range.key
                    ? 'bg-gold-gradient text-gold-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        )}

        {filters.has('store') && stores.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <StoreIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Counter</span>
            <select
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none"
            >
              <option value="">All counters</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {filters.has('category') && categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
            className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {filters.has('stock') && (
          <select
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            aria-label="Stock status"
            className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none"
          >
            {STOCK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {filters.has('movement') && (
          <select
            value={movement}
            onChange={(e) => setMovement(e.target.value)}
            aria-label="Movement type"
            className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none"
          >
            {MOVEMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {filters.has('range') && preset === 'custom' && (
          <motion.div {...fadeUp} className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom((p) => ({ ...p, from: e.target.value }))}
              aria-label="From date"
              className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none"
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              value={custom.to}
              min={custom.from}
              onChange={(e) => setCustom((p) => ({ ...p, to: e.target.value }))}
              aria-label="To date"
              className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none"
            />
          </motion.div>
        )}
      </div>

      {report && (
        <p className="text-xs text-muted-foreground">
          {[report.scope?.label, report.range?.display, `generated ${formatDateTime(report.generatedAt)}`]
            .filter(Boolean)
            .join(' · ')}
          {report.storeScoped && ' · one counter only — website orders are not included'}
        </p>
      )}

      {isLoading && !report ? (
        <SectionLoader label="Running report" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : report ? (
        <div className={cn('transition-opacity', isLoading && 'opacity-60')}>
          <ReportView report={report} />
        </div>
      ) : null}

      <ReportViewerModal {...viewer} onClose={viewer.close} canExport={canExport} />
    </div>
  );
}

export default ReportsPage;
