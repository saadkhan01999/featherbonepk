import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Boxes,
  Users,
  TrendingUp,
  AlertTriangle,
  Clock,
  ImageOff,
  Wallet,
  ShoppingBag,
  PieChart as PieIcon,
  Table2,
  LineChart as LineIcon,
  LayoutDashboard,
} from 'lucide-react';

import {
  RevenueTrendChart,
  CategoryDonut,
  PaymentMethodChart,
  TrendTable,
} from '@/components/charts/DashboardCharts.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { EVENTS, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { SetupChecklist } from '@/components/admin/SetupChecklist.jsx';
import { IncomingOrdersPanel } from '@/components/admin/IncomingOrdersPanel.jsx';
import {
  formatCurrency,
  formatNumber,
  formatRelativeTime,
  formatQuantity,
  formatDelta,
} from '@/lib/format.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';

/**
 * Back-office dashboard.
 * ---------------------------------------------------------------------------
 * Headline figures, a revenue trend, and the two things an operator acts on
 * daily: what is selling and what is running out.
 *
 * The period filter changes both the window and the bucket size — asking for
 * "monthly" over 30 days would produce a single bar, which is not a trend.
 */

const RANGES = [
  { key: 'daily', label: 'Daily', days: 30, period: 'daily' },
  { key: 'weekly', label: 'Weekly', days: 90, period: 'weekly' },
  { key: 'monthly', label: 'Monthly', days: 365, period: 'monthly' },
];

export function DashboardPage() {
  const { user, can } = useAuth();
  const [rangeKey, setRangeKey] = useState('daily');
  const [showTable, setShowTable] = useState(false);

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];

  const { data, error, isLoading, reload } = useResource(
    () => apiClient.get('/dashboard/overview', { params: { days: range.days, period: range.period } }),
    [range.days, range.period],
  );

  // Live: a sale, an order or a stock movement anywhere updates the figures.
  // Debounced — the dashboard is an aggregate, so one re-read per burst is plenty.
  const refresh = useDebouncedCallback(reload, 3000);
  useRealtimeEvent('web', EVENTS.ORDER_CHANGED, refresh);
  useRealtimeEvent('web', EVENTS.STOCK_CHANGED, refresh);

  // Only the first load shows the loader; a live refresh keeps the page in place.
  if (isLoading && !data) return <SectionLoader label="Loading dashboard" />;

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
        <p className="mt-2 font-medium text-destructive">Could not load the dashboard</p>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  const {
    catalogue,
    stock,
    people,
    topSellers,
    lowStock,
    recentProducts,
    revenue,
    trend,
    byCategory,
    byMethod,
  } = data;

  /*
   * The server decides which panels this account may see and omits the rest.
   * Rendering is driven by that answer rather than by a second copy of the
   * permission rules here — two copies of "who sees revenue" is how a figure
   * ends up on screen for someone who should not have it.
   */
  const sections = data.sections ?? { revenue: true, stock: true, people: true };

  return (
    <div className="space-y-5">
      {/*
        First, before the numbers. On a new shop every tile below reads zero,
        which describes a business that does not exist yet — so the thing that
        tells you how to make it exist belongs above them, not underneath.
        Renders nothing once setup is finished.
      */}
      <SetupChecklist setup={data.setup} />

      {/* Website orders waiting to be sent to the kitchen — the first thing to act on. */}
      {can('order.view') && <IncomingOrdersPanel />}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back, {user?.fullName?.split(' ')[0] ?? 'there'}!
          </h1>
          <p className="text-sm text-muted-foreground">
            {catalogue
              ? `${catalogue.activeProducts} live items across ${catalogue.activeCategories} categories.`
              : 'Here is what you have access to.'}
          </p>
        </div>

        {/* Granularity filter. role=group + aria-pressed so the active choice is
            announced, not merely highlighted. */}
        <div
          role="group"
          aria-label="Report period"
          className="flex rounded-lg border border-border-strong p-0.5"
        >
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRangeKey(option.key)}
              aria-pressed={rangeKey === option.key}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                rangeKey === option.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {/* ---------------- Headline tiles ---------------- */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {sections.revenue && (
          <>
            <StatTile
              icon={Wallet}
              label="Total Revenue"
              value={formatCurrency(revenue.total, { compact: true })}
              hint={`${formatNumber(revenue.orders)} orders`}
              delta={revenue.revenueGrowth}
            />
            <StatTile
              icon={ShoppingBag}
              label="Avg Order Value"
              value={formatCurrency(revenue.averageOrderValue)}
              hint={`online ${formatCurrency(revenue.online, { compact: true })} · till ${formatCurrency(revenue.pos, { compact: true })}`}
              delta={revenue.orderGrowth}
            />
          </>
        )}

        {sections.stock && (
          <StatTile
            icon={Boxes}
            label="Stock Value"
            value={formatCurrency(stock.retailValue, { compact: true })}
            // The basis is stated: retail and cost valuation differ materially,
            // and an unlabelled figure invites the wrong reading.
            hint={`${formatNumber(stock.totalUnits)} units · at retail`}
          />
        )}

        {sections.people && (
          <StatTile
            icon={Users}
            label="Customers"
            value={formatNumber(people.totalCustomers)}
            hint={`${people.activeStaff} active staff`}
          />
        )}
      </motion.div>

      {/* ---------------- Revenue trend ---------------- */}
      {sections.revenue && (
        <Panel
          title="Revenue Overview"
          icon={LineIcon}
          action={
            <Button
              variant="ghost"
              size="sm"
              leftIcon={showTable ? LineIcon : Table2}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? 'Chart' : 'Table'}
            </Button>
          }
        >
          <div className="p-5 pt-3">
            {/* The table is the accessible equivalent of the chart, not a
              secondary feature — an SVG chart is unreadable to a screen reader. */}
            {showTable ? (
              <TrendTable data={trend} />
            ) : (
              <RevenueTrendChart data={trend} period={range.period} />
            )}
          </div>
        </Panel>
      )}

      {sections.revenue && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Sales by Category" icon={PieIcon}>
            <div className="p-5 pt-3">
              <CategoryDonut data={byCategory} />
            </div>
          </Panel>

          <Panel title="Payment Methods" icon={Wallet}>
            <div className="p-5 pt-3">
              <PaymentMethodChart data={byMethod} />
            </div>
          </Panel>
        </div>
      )}

      {/* Top sellers needs revenue; low stock needs inventory. Rendered
          together when both are permitted, alone when only one is. */}
      {(sections.revenue || sections.stock) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {sections.revenue && (
            <Panel title="Top Selling Items" icon={TrendingUp}>
              {topSellers.length === 0 ? (
                <Empty>No sales recorded yet.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {topSellers.map((item, index) => (
                    <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="w-5 shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <Thumb src={item.image} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(item.soldCount)} sold</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-gold">
                        {formatCurrency(item.revenue, { compact: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {/* ---------------- Low stock ---------------- */}
          {sections.stock && (
            <Panel
              title="Low Stock Alerts"
              icon={AlertTriangle}
              action={
                stock.outOfStock > 0 && (
                  <Badge variant="destructive" size="sm">
                    {stock.outOfStock} out of stock
                  </Badge>
                )
              }
            >
              {lowStock.length === 0 ? (
                <Empty>Everything is comfortably in stock.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {lowStock.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.category}</p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums">
                        {formatQuantity(item.stock, item.unit)}
                      </span>
                      <Badge size="sm" variant={item.severity === 'out' ? 'destructive' : 'warning'}>
                        {item.severity === 'out' ? 'Out' : item.severity === 'critical' ? 'Critical' : 'Low'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      )}

      {/* ---------------- Recent activity ---------------- */}
      {sections.stock && (
        <Panel title="Recently Updated" icon={Clock}>
          <ul className="divide-y divide-border">
            {recentProducts.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <Thumb src={item.image} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeTime(item.updatedAt)}</p>
                </div>
                <Badge size="sm" variant={item.isActive ? 'success' : 'warning'}>
                  {item.isActive ? 'Live' : 'Hidden'}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* An account with no dashboard permissions at all still gets a landing
          page rather than a blank screen or a 403. */}
      {!sections.revenue && !sections.stock && !sections.people && (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <LayoutDashboard className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">Nothing to show here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the menu to reach the areas you have access to.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StatTile({ icon: Icon, label, value, hint, delta }) {
  // A null delta means no baseline, which is not the same as 0% — the badge is
  // omitted entirely rather than implying flat performance.
  const deltaText = formatDelta(delta);

  return (
    <motion.div variants={staggerItem} className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {deltaText && (
              <span className={cn('text-xs font-semibold', delta >= 0 ? 'text-success' : 'text-destructive')}>
                {deltaText}
              </span>
            )}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/10">
          <Icon className="h-5 w-5 text-gold" aria-hidden="true" />
        </span>
      </div>
    </motion.div>
  );
}

function Panel({ title, icon: Icon, action, children }) {
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
        {Icon && <Icon className="h-4 w-4 text-gold" aria-hidden="true" />}
        <h2 className="text-sm font-semibold">{title}</h2>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function Thumb({ src }) {
  return src ? (
    <img src={mediaUrl(src)} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-muted-foreground">
      <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

export default DashboardPage;
