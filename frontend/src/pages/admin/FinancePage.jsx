import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Wallet, Receipt, Percent, Info, AlertCircle } from 'lucide-react';

import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { StatTile } from '@/components/ui/StatTile.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { formatCurrency } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';

/**
 * Finance.
 * ---------------------------------------------------------------------------
 * Revenue against cost of goods — the one screen gated on `report.financial`,
 * which by default only the owner holds. An admin who runs the shop day to day
 * does not automatically get to see the margin on every dish.
 *
 * It reads the same `profit-and-loss` report the Reports screen can export, so
 * the number on this page and the number in the spreadsheet cannot disagree.
 */

const RANGES = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

export function FinancePage() {
  const [preset, setPreset] = useState('month');

  const {
    data: report,
    isLoading,
    error,
  } = useResource(() => apiClient.get('/reports/profit-and-loss', { params: { preset } }), [preset]);

  const chart = useMemo(
    () =>
      (report?.rows ?? []).map((row) => ({
        label: row.bucket?.slice(5) ?? '',
        Revenue: row.revenue,
        Cost: row.cost,
        Profit: row.grossProfit,
      })),
    [report],
  );

  if (isLoading) return <SectionLoader label="Loading finances" />;

  // A 403 here is not a fault — it is the permission working. Say so, rather
  // than showing a red error that looks like something is broken.
  if (error) {
    const forbidden = /permission|forbidden|access/i.test(error.message ?? '');
    return (
      <div
        className={cn(
          'rounded-2xl border p-6 text-center',
          forbidden
            ? 'border-border bg-surface text-muted-foreground'
            : 'border-destructive/40 bg-destructive/10 text-destructive',
        )}
      >
        <AlertCircle className="mx-auto mb-3 h-6 w-6" aria-hidden="true" />
        {forbidden
          ? 'Financial figures are restricted. Ask a super admin for the "report.financial" permission.'
          : (error.message ?? 'Could not load financial data.')}
      </div>
    );
  }

  const t = report?.totals ?? {};
  const profitable = (t.grossProfit ?? 0) >= 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
          <p className="text-sm text-muted-foreground">
            Revenue against cost of goods. Excludes cancelled and refunded orders.
          </p>
        </div>

        <div role="group" aria-label="Period" className="flex rounded-lg border border-border-strong p-0.5">
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
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Wallet} label="Revenue" value={formatCurrency(t.revenue ?? 0)} />
        <StatTile icon={Receipt} label="Cost of Goods" value={formatCurrency(t.cost ?? 0)} tone="muted" />
        <StatTile
          icon={profitable ? TrendingUp : TrendingDown}
          label="Gross Profit"
          value={formatCurrency(t.grossProfit ?? 0)}
          tone={profitable ? 'success' : 'destructive'}
        />
        <StatTile
          icon={Percent}
          label="Margin"
          value={`${t.margin ?? 0}%`}
          hint="Profit as a share of revenue"
          tone={profitable ? 'success' : 'destructive'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          icon={Receipt}
          label="Tax Collected"
          value={formatCurrency(t.tax ?? 0)}
          hint="Owed onward — not income"
          tone="muted"
        />
        <StatTile
          icon={Percent}
          label="Discounts Given"
          value={formatCurrency(t.discount ?? 0)}
          hint="Revenue forgone"
          tone="muted"
        />
      </div>

      {/*
        Said plainly rather than buried in a tooltip. Orders do not snapshot
        cost price — it is commercially sensitive and has no business in a
        record a customer might be shown — so margin is computed against
        today's costs and drifts if a supplier's price has changed since.
      */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
        <p>
          Cost of goods uses each product&rsquo;s <strong>current</strong> cost price, because orders do not
          store cost. If a supplier&rsquo;s price has changed since a sale, that sale&rsquo;s margin shifts
          with it. Set cost prices on the Products screen to make these figures meaningful.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-4 font-semibold">Revenue, cost and profit</h2>

        {chart.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No completed sales in this period.
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(v)}
                  contentStyle={{
                    background: 'hsl(var(--surface))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="Revenue"
                  stroke="hsl(var(--gold))"
                  fill="hsl(var(--gold))"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="Cost"
                  stroke="hsl(var(--muted-foreground))"
                  fill="hsl(var(--muted-foreground))"
                  fillOpacity={0.08}
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="Profit"
                  stroke="hsl(var(--success))"
                  fill="hsl(var(--success))"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

export default FinancePage;
