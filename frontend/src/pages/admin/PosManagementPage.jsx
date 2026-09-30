import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Monitor,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  MapPin,
  Clock,
  Store as StoreIcon,
  AlertCircle,
  CheckCircle2,
  CircleDot,
  BarChart3,
  UtensilsCrossed,
  ArrowRight,
  Search,
  ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Input.jsx';
import { SectionLoader, Spinner } from '@/components/ui/Spinner.jsx';
import { ReportViewerModal } from '@/components/reports/ReportView.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { adminCatalogApi } from '@/features/catalog/adminCatalog.api.js';
import { reportsApi } from '@/features/reports/reports.api.js';
import { useReportViewer } from '@/features/reports/useReportViewer.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { EVENTS, useRealtimeEvent, useDebouncedCallback } from '@/services/realtime.js';
import { ROUTES, tillReportPath } from '@/constants/routes.js';
import { formatCurrency, formatNumber, formatRelativeTime } from '@/lib/format.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn, useDebouncedValue } from '@/lib/utils.js';

/**
 * POS Management — the tills.
 * ---------------------------------------------------------------------------
 * Register tills, decide what each one sells, and open any till's own report.
 *
 * What a till sells is set here, per till: everything, a few categories (a
 * bakery till, a sauces-and-sides till), or a hand-picked list. It is enforced
 * by the server at the menu, the scanner and the sale itself, and the till
 * picks the change up immediately — no signing out.
 *
 * Each card shows today's takings, live, and "View report" opens that till's
 * full report: what it sold, how much, by whom and how it was paid — with CSV
 * and PDF.
 *
 * Disabling never deletes. Sales and shifts are financial records, so a till
 * with history can only be taken out of service, not removed.
 */

const EMPTY = {
  code: '',
  name: '',
  store: '',
  location: '',
  notes: '',
  menuMode: 'all',
  menuCategories: [],
  menuProducts: [],
};

const MENU_MODES = [
  { value: 'all', label: 'Everything', hint: 'The whole menu for its counter' },
  { value: 'categories', label: 'Chosen categories', hint: 'e.g. Bakery only, or Sauces & Sides' },
  { value: 'products', label: 'Chosen items', hint: 'A hand-picked list of products' },
];

export function PosManagementPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can('terminal.manage');
  const canReport = can('report.view');
  const canExport = can('report.export');

  const [editing, setEditing] = useState(null); // null | 'new' | terminal
  const [form, setForm] = useState(EMPTY);
  const [deleting, setDeleting] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const { data: terminals, isLoading, error, reload } = useResource(() => apiClient.get('/terminals'), []);
  const { data: stats, reload: reloadStats } = useResource(() => apiClient.get('/terminals/stats'), []);
  // Non-fatal: without `store.view` the screen still works, the assignment
  // selector simply does not appear.
  const { data: storeList } = useResource(() => apiClient.get('/stores').catch(() => []), []);
  const stores = storeList ?? [];
  const { data: categoryList } = useResource(() => adminCatalogApi.listCategories().catch(() => []), []);
  const categories = useMemo(() => categoryList ?? [], [categoryList]);

  // --- Today's takings per till, live ------------------------------------------
  const [today, setToday] = useState({});
  const loadToday = useCallback(async () => {
    if (!canReport) return;
    try {
      const report = await reportsApi.run('till-summary', { preset: 'today' });
      setToday(Object.fromEntries(report.rows.filter((r) => r.code).map((r) => [r.code, r])));
    } catch {
      /* The cards simply omit the figure. */
    }
  }, [canReport]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  const liveRefresh = useDebouncedCallback(() => {
    loadToday();
    reload();
    reloadStats();
  }, 800);
  useRealtimeEvent('web', EVENTS.ORDER_CHANGED, liveRefresh);
  useRealtimeEvent('web', EVENTS.TERMINAL_CHANGED, liveRefresh);

  const refresh = useCallback(async () => {
    await Promise.all([reload(), reloadStats()]);
  }, [reload, reloadStats]);

  const viewer = useReportViewer();
  const compareParams = { preset: 'today' };

  function openNew() {
    setForm(EMPTY);
    setFieldErrors({});
    setEditing('new');
  }

  function openEdit(terminal) {
    setForm({
      code: terminal.code,
      name: terminal.name,
      store: terminal.store ?? '',
      location: terminal.location ?? '',
      notes: terminal.notes ?? '',
      menuMode: terminal.menuMode ?? 'all',
      menuCategories: terminal.menuCategories ?? [],
      menuProducts: terminal.menuProducts ?? [],
    });
    setFieldErrors({});
    setEditing(terminal);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const menu = {
      menuMode: form.menuMode,
      menuCategories: form.menuMode === 'categories' ? form.menuCategories : [],
      menuProducts: form.menuMode === 'products' ? form.menuProducts : [],
    };

    try {
      const result =
        editing === 'new'
          ? await apiClient.post('/terminals', { ...form, ...menu, store: form.store || null })
          : // Code is omitted on edit — changing it would orphan every sale already
            // recorded against the old one. The store is not omitted: moving a till
            // to another counter is a normal thing to do, and `null` must be sendable
            // so it can be un-assigned again.
            await apiClient.patch(`/terminals/${editing.id}`, {
              name: form.name,
              store: form.store || null,
              location: form.location,
              notes: form.notes,
              ...menu,
            });

      setNotice({ type: 'success', text: result.message ?? 'Saved — the till picks this up immediately.' });
      setEditing(null);
      await refresh();
    } catch (err) {
      if (err.details?.length) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      }
      setNotice({ type: 'error', text: err.message ?? 'Could not save this terminal' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(terminal) {
    try {
      const result = await apiClient.patch(`/terminals/${terminal.id}/active`, {
        isActive: !terminal.isActive,
      });
      setNotice({ type: 'success', text: result.message });
      await refresh();
    } catch (err) {
      // The most likely refusal is "there is an open shift" — worth showing
      // verbatim, because it tells the manager exactly what to do first.
      setNotice({ type: 'error', text: err.message ?? 'Could not change this terminal' });
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const result = await apiClient.delete(`/terminals/${deleting.id}`);
      setNotice({ type: 'success', text: result.message });
      setDeleting(null);
      await refresh();
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not remove this terminal' });
      setDeleting(null);
    } finally {
      setSaving(false);
    }
  }

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const menuSummary = (terminal) => {
    if (terminal.menuMode === 'categories') {
      const names = (terminal.menuCategories ?? []).map((id) => categoryName.get(id)).filter(Boolean);
      return names.length ? `Sells: ${names.join(', ')}` : 'Sells: chosen categories';
    }
    if (terminal.menuMode === 'products') {
      const count = terminal.menuProducts?.length ?? 0;
      return `Sells: ${count} chosen item${count === 1 ? '' : 's'}`;
    }
    return 'Sells: everything';
  };

  const rows = terminals ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">POS Management</h1>
          <p className="text-sm text-muted-foreground">
            Your tills, what each one sells, and each till&apos;s own sales report.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReport && (
            <Button
              variant="outline"
              leftIcon={BarChart3}
              onClick={() => viewer.open('till-summary', compareParams)}
            >
              Compare tills (today)
            </Button>
          )}
          <Button
            as="a"
            href={ROUTES.POS}
            target="_blank"
            rel="noreferrer"
            variant="outline"
            leftIcon={ExternalLink}
          >
            Open the till
          </Button>
          {canManage && (
            <Button leftIcon={Plus} onClick={openNew}>
              Register Till
            </Button>
          )}
        </div>
      </header>

      {/* --- Summary --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Registered', value: stats?.total, icon: Monitor, tone: 'text-muted-foreground' },
          { label: 'Enabled', value: stats?.active, icon: Power, tone: 'text-success' },
          { label: 'In use now', value: stats?.inUse, icon: CircleDot, tone: 'text-gold' },
          {
            label: 'Till sales today',
            value: canReport
              ? formatCurrency(
                  Object.values(today).reduce((sum, r) => sum + r.revenue, 0),
                  { compact: true },
                )
              : stats?.disabled,
            icon: canReport ? BarChart3 : PowerOff,
            tone: canReport ? 'text-success' : 'text-destructive',
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{card.label}</span>
              <card.icon className={cn('h-4 w-4', card.tone)} aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{card.value ?? '—'}</p>
          </div>
        ))}
      </div>

      {notice && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
            notice.type === 'success'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* --- Registry --- */}
      {isLoading ? (
        <SectionLoader label="Loading terminals" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : !rows.length ? (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <Monitor className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">No terminals registered</p>
          <p className="text-sm text-muted-foreground">
            Nobody can sign in at a till until one is registered.
          </p>
          {canManage && (
            <Button className="mt-4" leftIcon={Plus} onClick={openNew}>
              Register the first till
            </Button>
          )}
        </div>
      ) : (
        <motion.ul {...staggerContainer} className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((terminal) => {
            const sales = today[terminal.code];
            return (
              <motion.li
                {...staggerItem}
                key={terminal.id}
                className={cn(
                  'flex flex-col rounded-2xl border bg-surface p-4 transition-colors',
                  terminal.openShift ? 'border-gold/50' : 'border-border',
                  canReport && 'hover:border-gold/40',
                )}
              >
                <button
                  type="button"
                  disabled={!canReport}
                  onClick={() => navigate(tillReportPath(terminal.code))}
                  className="flex-1 text-left disabled:cursor-default"
                  aria-label={`Open the report for ${terminal.code}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-gold">{terminal.code}</span>
                        {terminal.isActive ? (
                          <Badge variant="success" size="sm">
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="destructive" size="sm">
                            Disabled
                          </Badge>
                        )}
                        {terminal.openShift && (
                          <Badge variant="gold" size="sm" dot>
                            In use
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 font-semibold">{terminal.name}</p>
                    </div>

                    {canReport && (
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Today</p>
                        <p className="text-lg font-bold tabular-nums text-gold">
                          {formatCurrency(sales?.revenue ?? 0)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatNumber(sales?.orders ?? 0)} sale{sales?.orders === 1 ? '' : 's'}
                        </p>
                      </div>
                    )}
                  </div>

                  <p className="mt-2 flex items-center gap-1.5 text-xs">
                    <StoreIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {terminal.storeName ? (
                      <span className="text-gold/90">{terminal.storeName}</span>
                    ) : (
                      <span className="text-amber-400/80">Not assigned to a counter</span>
                    )}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs">
                    <UtensilsCrossed className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span
                      className={terminal.menuMode === 'all' ? 'text-muted-foreground' : 'text-foreground'}
                    >
                      {menuSummary(terminal)}
                    </span>
                  </p>
                  {terminal.location && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {terminal.location}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {terminal.openShift ? (
                      <>
                        {terminal.openShift.cashierName} since{' '}
                        {formatRelativeTime(terminal.openShift.openedAt)}
                      </>
                    ) : terminal.lastUsedAt ? (
                      <>
                        Last used {formatRelativeTime(terminal.lastUsedAt)}
                        {terminal.lastUsedBy && ` by ${terminal.lastUsedBy}`}
                      </>
                    ) : (
                      'Never used'
                    )}
                  </p>
                </button>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 border-t border-border pt-3">
                  {canReport ? (
                    <Link
                      to={tillReportPath(terminal.code)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-gold hover:underline"
                    >
                      View report <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : (
                    <span />
                  )}
                  {canManage && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={terminal.isActive ? PowerOff : Power}
                        onClick={() => toggleActive(terminal)}
                      >
                        {terminal.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(terminal)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={Trash2}
                        onClick={() => setDeleting(terminal)}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      {/* --- Editor --- */}
      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Register a Till' : `Edit ${editing?.code}`}
        description={
          editing === 'new'
            ? 'The code is what the terminal signs in with.'
            : 'The code cannot be changed — sales are recorded against it.'
        }
        size="lg"
      >
        <form onSubmit={save} className="space-y-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Input
              label="Terminal code"
              placeholder="TILL-01"
              required
              value={form.code}
              error={fieldErrors.code}
              // Locked on edit: changing it would orphan existing sales.
              disabled={editing !== 'new'}
              readOnly={editing !== 'new'}
              hint={editing === 'new' ? 'Letters, numbers and hyphens. Cannot be changed later.' : undefined}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
            <Input
              label="Name"
              placeholder="Bakery Counter"
              required
              value={form.name}
              error={fieldErrors.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          {stores.length > 0 && (
            <Select
              label="Counter"
              value={form.store}
              error={fieldErrors.store}
              hint="Which counter this till stands at — its sales are reported under it"
              onChange={(e) => setForm((f) => ({ ...f, store: e.target.value }))}
            >
              <option value="">Not assigned</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          )}

          <MenuScopeEditor form={form} setForm={setForm} categories={categories} />

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Input
              label="Location"
              placeholder="Main hall, by the entrance"
              value={form.location}
              error={fieldErrors.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
            <Textarea
              label="Notes"
              rows={1}
              placeholder="Printer model, hardware quirks…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              hint="Optional"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setEditing(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" isLoading={isSaving} loadingText="Saving…">
              {editing === 'new' ? 'Register' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        isLoading={isSaving}
        title={`Remove ${deleting?.code}?`}
        message="This only works for a till that has never taken a sale. Anything with history must be disabled instead, so the records stay intact."
        confirmLabel="Remove"
        cancelLabel="Cancel"
      />

      <ReportViewerModal {...viewer} onClose={viewer.close} canExport={canExport} />
    </div>
  );
}

/**
 * "What does this till sell?" — everything, chosen categories, or chosen items.
 */
function MenuScopeEditor({ form, setForm, categories }) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [results, setResults] = useState([]);
  const [names, setNames] = useState({}); // id → name, so chosen items stay labelled
  const [isSearching, setSearching] = useState(false);

  // Product search, server-side: a catalogue of hundreds does not fit a checklist.
  useEffect(() => {
    if (form.menuMode !== 'products') return undefined;
    let cancelled = false;
    setSearching(true);
    adminCatalogApi
      .listProducts({ limit: 40, status: 'active', ...(debounced && { search: debounced }) })
      .then((envelope) => {
        if (cancelled) return;
        const list = envelope.data ?? [];
        setResults(list);
        setNames((prev) => ({ ...prev, ...Object.fromEntries(list.map((p) => [p.id, p.name])) }));
      })
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [form.menuMode, debounced]);

  const toggle = (key, id) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
    }));

  return (
    <fieldset className="rounded-xl border border-border bg-background p-4">
      <legend className="px-1 text-sm font-semibold">What this till sells</legend>

      <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
        {MENU_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={form.menuMode === mode.value}
            onClick={() => setForm((f) => ({ ...f, menuMode: mode.value }))}
            className={cn(
              'rounded-lg border-2 px-3 py-2 text-left transition-colors',
              form.menuMode === mode.value
                ? 'border-gold bg-gold/10'
                : 'border-border-strong hover:border-gold/40',
            )}
          >
            <span className="block text-sm font-semibold">{mode.label}</span>
            <span className="block text-[11px] text-muted-foreground">{mode.hint}</span>
          </button>
        ))}
      </div>

      {form.menuMode === 'categories' && (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{form.menuCategories.length} selected</span>
            <span className="flex gap-3">
              <button
                type="button"
                className="text-gold hover:underline"
                onClick={() => setForm((f) => ({ ...f, menuCategories: categories.map((c) => c.id) }))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => setForm((f) => ({ ...f, menuCategories: [] }))}
              >
                Clear
              </button>
            </span>
          </div>
          <div className="grid max-h-52 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {categories.map((category) => (
              <Checkbox
                key={category.id}
                label={`${category.name} (${category.productCount ?? 0})`}
                checked={form.menuCategories.includes(category.id)}
                onChange={() => toggle('menuCategories', category.id)}
              />
            ))}
          </div>
        </div>
      )}

      {form.menuMode === 'products' && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products to add…"
              aria-label="Search products"
              className="h-9 w-full rounded-lg border border-border-strong bg-surface pl-9 pr-3 text-sm focus:border-gold focus:outline-none"
            />
          </div>

          {form.menuProducts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.menuProducts.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle('menuProducts', id)}
                  className="rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs text-gold hover:bg-gold/20"
                  title="Remove"
                >
                  {names[id] ?? 'Item'} ×
                </button>
              ))}
            </div>
          )}

          <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
            {isSearching ? (
              <div className="flex justify-center py-6">
                <Spinner size="sm" label="Searching" />
              </div>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No products match.</p>
            ) : (
              results.map((product) => (
                <label
                  key={product.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-gold"
                    checked={form.menuProducts.includes(product.id)}
                    onChange={() => toggle('menuProducts', product.id)}
                  />
                  <span className="flex-1 truncate">{product.name}</span>
                  <span className="text-xs text-muted-foreground">{product.category?.name}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Enforced by the server — a till cannot sell an item outside its menu even by scanning it. Changes
        reach the till immediately.
      </p>
    </fieldset>
  );
}

export default PosManagementPage;
