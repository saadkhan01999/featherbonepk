import { useMemo, useState } from 'react';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Eye, FileSpreadsheet, FileText, Printer, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Modal } from '@/components/ui/Modal.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { PrintPortal } from '@/components/common/PrintPortal.jsx';
import { reportsApi } from '@/features/reports/reports.api.js';
import { formatCurrency, formatNumber, formatDate, formatDateTime } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';

/**
 * The report renderer — KPIs, then one table per section.
 * ---------------------------------------------------------------------------
 * Draws the same document the server exports as CSV and PDF (see backend
 * report.service.js), from the server's column metadata. Nothing here knows
 * what a "sales report" or an "inventory report" is — so a report added on the
 * server appears here correctly formatted and totalled with no frontend change,
 * and the screen can never disagree with the file.
 */

/** One cell, by column type. Mirrors formatCell on the server. */
export function formatReportCell(column, value) {
  if (value === null || value === undefined || value === '') {
    return column.money || column.numeric ? (column.money ? formatCurrency(0) : '0') : '—';
  }
  if (column.money) return formatCurrency(value);
  if (column.numeric) return formatNumber(value, 2);
  if (column.datetime) return formatDateTime(value);
  if (column.date) return formatDate(value);
  return String(value);
}

const isRight = (column) => column.money || column.numeric;

/** A section shows this many rows before "Show all". */
const PREVIEW_ROWS = 50;

function KpiGrid({ kpis }) {
  if (!kpis?.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <div key={kpi.key} className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {kpi.label}
          </p>
          <p className="mt-1.5 truncate text-xl font-bold tabular-nums">{formatReportCell(kpi, kpi.value)}</p>
        </div>
      ))}
    </div>
  );
}

/** A bar chart of the first money column against the first text column. */
function SectionChart({ section }) {
  const chart = useMemo(() => {
    const labelKey = section.columns.find((c) => !c.money && !c.numeric)?.key;
    const valueColumn = [...section.columns].reverse().find((c) => c.money);
    if (!labelKey || !valueColumn || section.rows.length < 2) return null;
    return {
      valueLabel: valueColumn.label,
      // Chronological for a daily series; the table itself stays as sent.
      data: section.rows
        .slice(-45)
        .map((row) => ({ label: String(row[labelKey]).slice(5), value: row[valueColumn.key] })),
    };
  }, [section]);

  if (!chart) return null;

  return (
    <div className="border-b border-border p-4">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chart.data} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={12}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v) => formatCurrency(v, { compact: true, withSymbol: false })}
          />
          <Tooltip
            cursor={{ fill: 'hsl(var(--surface-hover))' }}
            contentStyle={{
              background: 'hsl(var(--surface-raised))',
              border: '1px solid hsl(var(--border-strong))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [formatCurrency(value), chart.valueLabel]}
          />
          <Bar dataKey="value" fill="#199e70" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReportSection({ section, printMode = false }) {
  const [showAll, setShowAll] = useState(false);
  const rows = printMode || showAll ? section.rows : section.rows.slice(0, PREVIEW_ROWS);
  const hasTotals = section.totals && Object.keys(section.totals).length > 0 && section.rows.length > 0;

  return (
    <section className="report-section overflow-hidden rounded-2xl border border-border bg-surface">
      <header className="border-b border-border px-5 py-3">
        <h3 className="font-semibold">{section.title}</h3>
        {section.note && <p className="text-xs text-muted-foreground">{section.note}</p>}
      </header>

      {section.chart && !printMode && <SectionChart section={section} />}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-hover/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              {section.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 font-semibold',
                    isRight(column) ? 'text-right' : 'text-left',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={section.columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  Nothing recorded for this selection.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index} className="transition-colors hover:bg-surface-hover">
                  {section.columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-4 py-2',
                        isRight(column) ? 'text-right tabular-nums' : '',
                        column.key === 'items' && 'min-w-[220px]',
                      )}
                    >
                      {formatReportCell(column, row[column.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr className="border-t-2 border-border-strong bg-background/40 font-semibold">
                {section.columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn('px-4 py-2.5', isRight(column) ? 'text-right tabular-nums' : '')}
                  >
                    {index === 0
                      ? 'Total'
                      : column.key in section.totals
                        ? formatReportCell(column, section.totals[column.key])
                        : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {(section.rows.length > PREVIEW_ROWS || section.truncated) && !printMode && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing {rows.length} of {section.totalRows ?? section.rows.length} rows
            {section.truncated && ' — export CSV for every row'}
          </span>
          {section.rows.length > PREVIEW_ROWS && (
            <button
              type="button"
              className="font-medium text-gold hover:underline"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show fewer' : `Show all ${section.rows.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** A whole report document. */
export function ReportView({ report, printMode = false }) {
  if (!report) return null;
  return (
    <div className="space-y-4">
      <KpiGrid kpis={report.kpis} />
      {report.sections.map((section) => (
        <ReportSection key={section.key} section={section} printMode={printMode} />
      ))}
    </div>
  );
}

/**
 * View · CSV · PDF — the three buttons every report screen offers.
 *
 * @param {object} props
 * @param {string} props.reportId
 * @param {object} props.params   the same filters the screen is showing
 * @param {() => void} [props.onView]
 * @param {boolean} [props.canExport] false hides the file buttons (no `report.export`)
 */
export function ExportButtons({ reportId, params, onView, canExport = true, size = 'md', className }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function download(format) {
    setBusy(format);
    setError(null);
    try {
      await reportsApi.download(reportId, params, format);
    } catch (err) {
      setError(err.message ?? 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn('flex flex-col items-end gap-1.5', className)}>
      <div className="flex flex-wrap gap-2">
        {onView && (
          <Button variant="outline" size={size} leftIcon={Eye} onClick={onView}>
            View
          </Button>
        )}
        {canExport && (
          <>
            <Button
              variant="outline"
              size={size}
              leftIcon={FileSpreadsheet}
              onClick={() => download('csv')}
              isLoading={busy === 'csv'}
              loadingText="CSV…"
              disabled={Boolean(busy)}
            >
              CSV
            </Button>
            <Button
              size={size}
              leftIcon={FileText}
              onClick={() => download('pdf')}
              isLoading={busy === 'pdf'}
              loadingText="PDF…"
              disabled={Boolean(busy)}
            >
              PDF
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The full report in a large dialog — "View" — with Print and the downloads.
 * Printing uses the browser's own print dialog, so "Save as PDF" is available
 * there too; the PDF button gives the server-rendered file.
 */
export function ReportViewerModal({
  isOpen,
  onClose,
  report,
  isLoading,
  error,
  reportId,
  params,
  canExport = true,
}) {
  const [printing, setPrinting] = useState(false);

  /*
   * Print through the print root, like the till receipt: the page's print CSS
   * hides everything else, and a copy rendered outside the scrolling, animated
   * dialog prints in full instead of being clipped to what is on screen.
   */
  function print() {
    setPrinting(true);
    // Two frames: one to mount the copy, one for the browser to lay it out.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
        setPrinting(false);
      }),
    );
  }

  return (
    <>
      {printing && report && (
        <PrintPortal>
          {/* `light` swaps in the light palette — paper is white. */}
          <div className="light report-print bg-white p-6 text-black">
            <h1 className="text-xl font-bold">{report.label}</h1>
            <p className="mb-4 text-xs">
              {[report.scope?.label, report.range?.display, `Generated ${formatDateTime(report.generatedAt)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <ReportView report={report} printMode />
          </div>
        </PrintPortal>
      )}
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="full"
        title={report?.label ?? 'Report'}
        description={
          report
            ? [report.scope?.label, report.range?.display, `Generated ${formatDateTime(report.generatedAt)}`]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" leftIcon={Printer} onClick={print} disabled={!report}>
              Print
            </Button>
            {reportId && <ExportButtons reportId={reportId} params={params} canExport={canExport} />}
          </>
        }
      >
        <div className="report-print-area">
          {isLoading ? (
            <SectionLoader label="Preparing report" />
          ) : error ? (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {error.message ?? 'Could not load this report'}
            </p>
          ) : (
            <ReportView report={report} />
          )}
        </div>
      </Modal>
    </>
  );
}

export default ReportView;
