import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatCurrency, formatNumber } from '@/lib/format.js';

/**
 * Dashboard charts.
 * ---------------------------------------------------------------------------
 * Colour rules followed here:
 *
 *  • Brand gold is not used for data marks. Gold means "interactive" everywhere
 *    else in this UI; a gold chart line reads as something you can click.
 *    Data gets its own palette so a mark is never mistaken for an affordance.
 *  • Colour follows the entity, not the rank — "online" is the same colour in
 *    every chart, so the eye can track it between panels.
 *  • The categorical hues differ in hue, not just lightness, so they survive
 *    greyscale printing and colour-vision deficiency.
 *  • One y-axis only. Revenue and order-count share a chart nowhere; a dual
 *    axis lets any two series be made to "cross" by choosing scales.
 */

/** Entity colours. Blue = online, orange = in-store, green = totals. */
const SERIES = {
  online: '#3987e5',
  pos: '#e07b39',
  revenue: '#199e70',
};

/** Categorical ramp for the category donut — distinct hues, dark-mode safe. */
const CATEGORICAL = [
  '#3987e5',
  '#e07b39',
  '#199e70',
  '#a978e8',
  '#d94f6d',
  '#41a7c4',
  '#c9a227',
  '#6f7f95',
  '#b4654a',
];

const AXIS = { stroke: 'hsl(35 8% 63%)', fontSize: 11 };
const GRID = 'hsl(30 6% 20%)';

/** Shared tooltip so every chart reports money identically. */
function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border-strong bg-surface-raised px-3 py-2 shadow-overlay">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey ?? entry.name} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="capitalize">{entry.name}</span>
          <span className="ml-auto font-semibold tabular-nums">{formatCurrency(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Revenue over time, split by channel.
 *
 * Stacked areas rather than two lines: the business question is "how much did
 * we take, and how was it split", and a stack answers both at once — the
 * combined height is total revenue.
 */
export function RevenueTrendChart({ data, period }) {
  if (!data?.length) {
    return <ChartEmpty>No sales in this period yet.</ChartEmpty>;
  }

  // Long date keys crowd the axis; shorten by the granularity being shown.
  const formatBucket = (bucket) => {
    if (period === 'monthly') return bucket;
    if (period === 'weekly') return bucket.replace(/^\d{4}-/, '');
    return bucket.slice(5); // MM-DD
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          {['online', 'pos'].map((key) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[key]} stopOpacity={0.5} />
              <stop offset="100%" stopColor={SERIES[key]} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={formatBucket}
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={54}
          // Compact ticks: full rupee values would need a 90px gutter.
          tickFormatter={(value) => formatCurrency(value, { compact: true, withSymbol: false })}
        />
        <Tooltip content={<MoneyTooltip />} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />

        <Area
          type="monotone"
          dataKey="online"
          name="Online"
          stackId="1"
          stroke={SERIES.online}
          fill="url(#fill-online)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="pos"
          name="In-store"
          stackId="1"
          stroke={SERIES.pos}
          fill="url(#fill-pos)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Revenue share by menu category. */
export function CategoryDonut({ data }) {
  if (!data?.length) return <ChartEmpty>No category sales yet.</ChartEmpty>;

  // Long tails make an unreadable donut — everything past the top 6 is grouped.
  const top = data.slice(0, 6);
  const rest = data.slice(6);
  const slices = rest.length
    ? [...top, { name: 'Other', revenue: rest.reduce((s, r) => s + r.revenue, 0) }]
    : top;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="revenue"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={58}
          outerRadius={92}
          paddingAngle={2}
          stroke="none"
        >
          {slices.map((slice, index) => (
            <Cell key={slice.name} fill={CATEGORICAL[index % CATEGORICAL.length]} />
          ))}
        </Pie>
        <Tooltip content={<MoneyTooltip />} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/**
 * Revenue by payment method.
 * One colour for every bar: the categories are nominal, so a value-ramp would
 * imply an ordering that does not exist.
 */
export function PaymentMethodChart({ data }) {
  if (!data?.length) return <ChartEmpty>No payments recorded yet.</ChartEmpty>;

  const LABELS = {
    cod: 'Cash on Delivery',
    jazzcash: 'JazzCash',
    easypaisa: 'EasyPaisa',
    bank_transfer: 'Bank Transfer',
    card: 'Card',
  };

  const rows = data.map((row) => ({ ...row, label: LABELS[row.method] ?? row.method }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatCurrency(v, { compact: true, withSymbol: false })}
        />
        <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={104} />
        <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'hsl(26 8% 11%)' }} />
        <Bar dataKey="revenue" name="Revenue" fill={SERIES.revenue} radius={[0, 6, 6, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Accessible table equivalent of the trend chart.
 * A chart alone is invisible to a screen reader; this is the same data in a
 * form assistive technology can actually read.
 */
export function TrendTable({ data }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Revenue by period, split by sales channel</caption>
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
          <th className="py-2 font-medium">Period</th>
          <th className="py-2 text-right font-medium">Online</th>
          <th className="py-2 text-right font-medium">In-store</th>
          <th className="py-2 text-right font-medium">Total</th>
          <th className="py-2 text-right font-medium">Orders</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {data.map((row) => (
          <tr key={row.bucket}>
            <td className="py-1.5">{row.bucket}</td>
            <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.online)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.pos)}</td>
            <td className="py-1.5 text-right font-semibold tabular-nums">{formatCurrency(row.revenue)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatNumber(row.orders)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartEmpty({ children }) {
  return (
    <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">{children}</div>
  );
}

export default RevenueTrendChart;
