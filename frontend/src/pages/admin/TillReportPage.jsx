import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Monitor, Radio } from 'lucide-react';

import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { ExportButtons, ReportView, ReportViewerModal } from '@/components/reports/ReportView.jsx';
import { reportsApi } from '@/features/reports/reports.api.js';
import { useReportViewer } from '@/features/reports/useReportViewer.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { EVENTS, useRealtimeEvent, useDebouncedCallback } from '@/services/realtime.js';
import { ROUTES } from '@/constants/routes.js';
import { formatDateTime, toDateInputValue } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';

/**
 * One till's full report.
 * ---------------------------------------------------------------------------
 * Opened by clicking a till in POS Management. Everything that till sold in the
 * chosen period: takings, what was sold and how many, categories, payment
 * types, busy hours and every sale with its cashier — as View, CSV and PDF.
 *
 * It is the same "Full Sales Report" the Reports tab builds, scoped to this
 * till by the server (`scope=terminal`), so the figures here and in the
 * company-wide report are computed by one piece of code and agree to the rupee.
 *
 * Live: a sale on this till refreshes the report while it is open.
 */

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'quarter', label: '90 days' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Custom' },
];

export function TillReportPage() {
  const { code } = useParams();
  const { can } = useAuth();
  const canExport = can('report.export');

  const [preset, setPreset] = useState('today');
  const [custom, setCustom] = useState(() => ({
    from: toDateInputValue(new Date(Date.now() - 6 * 86_400_000)),
    to: toDateInputValue(new Date()),
  }));

  const params = useMemo(
    () => ({
      scope: 'terminal',
      terminal: code,
      preset,
      ...(preset === 'custom' && { from: custom.from, to: custom.to }),
    }),
    [code, preset, custom],
  );

  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      setReport(await reportsApi.run('sales-overview', params));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A sale on this till while the report is open.
  const refresh = useDebouncedCallback(load, 800);
  useRealtimeEvent('web', EVENTS.ORDER_CHANGED, (event) => {
    if (event?.terminalId === code) refresh();
  });

  const viewer = useReportViewer();

  return (
    <div className="space-y-5">
      <Link
        to={ROUTES.ADMIN_POS_MANAGEMENT}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All tills
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Monitor className="h-6 w-6 text-gold" aria-hidden="true" />
            {report?.scope?.label ?? code}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Radio className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            {report ? `${report.range.display} · updated ${formatDateTime(report.generatedAt)}` : 'Loading…'}
          </p>
        </div>

        <ExportButtons
          reportId="sales-overview"
          params={params}
          canExport={canExport}
          onView={() => viewer.open('sales-overview', params)}
        />
      </header>

      <div className="flex flex-wrap items-center gap-3">
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

        {preset === 'custom' && (
          <div className="flex items-center gap-2">
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
          </div>
        )}

        <Link
          to={`${ROUTES.ADMIN_ORDERS}?terminal=${encodeURIComponent(code)}`}
          className="ml-auto text-sm text-gold hover:underline"
        >
          This till&apos;s orders →
        </Link>
      </div>

      {isLoading && !report ? (
        <SectionLoader label="Building the till report" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message ?? 'Could not load this till'}
        </div>
      ) : (
        <ReportView report={report} />
      )}

      <ReportViewerModal {...viewer} onClose={viewer.close} canExport={canExport} />
    </div>
  );
}

export default TillReportPage;
