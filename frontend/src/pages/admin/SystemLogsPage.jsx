import { useMemo, useState } from 'react';
import { ScrollText, ShieldAlert, AlertTriangle, Info, User as UserIcon, Clock, X } from 'lucide-react';

import { Badge } from '@/components/ui/Badge.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { formatRelativeTime } from '@/lib/format.js';
import { cn, useDebouncedValue } from '@/lib/utils.js';

/**
 * System Logs.
 * ---------------------------------------------------------------------------
 * The audit trail: who changed what, and when.
 *
 * It shows the actions that move money or grant power — staff created, roles
 * changed, prices edited, stock written off. Deliberately not a request log:
 * recording every page view would bury the six entries that matter under a
 * hundred thousand that do not, and the entire value of this screen is that a
 * person can scan it and notice something wrong.
 *
 * Read-only, because the API is. An audit trail an administrator can edit is
 * not evidence of anything.
 */

const SEVERITY = {
  critical: { icon: ShieldAlert, badge: 'destructive', label: 'Critical' },
  warning: { icon: AlertTriangle, badge: 'warning', label: 'Warning' },
  info: { icon: Info, badge: 'default', label: 'Info' },
};

export function SystemLogsPage() {
  const [module, setModule] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  // The box updates instantly; the query waits for a pause in typing.
  const debouncedSearch = useDebouncedValue(search);

  const params = useMemo(
    () => ({
      ...(module && { module }),
      ...(severity && { severity }),
      ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
      limit: 100,
    }),
    [module, severity, debouncedSearch],
  );

  const {
    data: entries,
    isLoading,
    error,
  } = useResource(() => apiClient.get('/audit', { params }), [params.module, params.severity, params.search]);

  const { data: stats } = useResource(() => apiClient.get('/audit/stats').catch(() => null), []);

  if (isLoading) return <SectionLoader label="Loading activity" />;

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
        {forbidden
          ? 'Activity history is restricted. Ask a super admin for the "activity.view" permission.'
          : (error.message ?? 'Could not load activity.')}
      </div>
    );
  }

  const rows = entries ?? [];
  const hasFilters = Boolean(module || severity || search);

  /**
   * One definition, used by the toolbar link and the empty state alike.
   *
   * A plain function, not useCallback: this sits below the early returns above,
   * so a hook here would be called conditionally — and it is not passed to any
   * memoised child, so the identity stability would buy nothing anyway.
   */
  function clearFilters() {
    setModule('');
    setSeverity('');
    setSearch('');
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">System Logs</h1>
        <p className="text-sm text-muted-foreground">
          Every consequential change: staff, permissions, prices and stock. Written by the system and never
          editable.
        </p>
      </header>

      {stats && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Total entries', value: stats.total, tone: 'muted' },
            { label: 'Last 24 hours', value: stats.last24h, tone: 'gold' },
            { label: 'Critical', value: stats.bySeverity?.critical ?? 0, tone: 'destructive' },
            { label: 'Warnings', value: stats.bySeverity?.warning ?? 0, tone: 'warning' },
          ].map((tile) => (
            <article key={tile.label} className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{tile.label}</p>
              <p
                className={cn(
                  'mt-1 text-2xl font-bold tabular-nums',
                  tile.tone === 'destructive' && tile.value > 0 && 'text-destructive',
                  tile.tone === 'warning' && tile.value > 0 && 'text-warning',
                  tile.tone === 'gold' && 'text-gold',
                )}
              >
                {tile.value}
              </p>
            </article>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="min-w-[240px] flex-1 sm:max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by person or action…"
          label="Search activity"
        />

        <select
          value={module}
          onChange={(e) => setModule(e.target.value)}
          aria-label="Filter by area"
          className="h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm focus:border-gold focus:outline-none"
        >
          <option value="">All areas</option>
          {(stats?.modules ?? []).map((m) => (
            <option key={m} value={m}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          aria-label="Filter by severity"
          className="h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm focus:border-gold focus:outline-none"
        >
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={hasFilters ? 'Nothing matches those filters' : 'No activity recorded yet'}
          body={
            hasFilters
              ? 'Try a broader search, or clear the filters.'
              : 'Entries appear here as staff are added, prices change and stock is adjusted. An empty log on a new system is expected.'
          }
          action={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <ol className="space-y-2">
          {rows.map((entry) => {
            const meta = SEVERITY[entry.severity] ?? SEVERITY.info;
            const Icon = meta.icon;

            return (
              <li
                key={entry.id}
                className="flex gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold/30"
              >
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    entry.severity === 'critical' && 'bg-destructive/10 text-destructive',
                    entry.severity === 'warning' && 'bg-warning/10 text-warning',
                    entry.severity === 'info' && 'bg-surface-hover text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{entry.summary}</p>
                    <Badge variant={meta.badge} size="sm">
                      {meta.label}
                    </Badge>
                    <Badge variant="outline" size="sm">
                      {entry.module}
                    </Badge>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3 w-3" aria-hidden="true" />
                      {entry.actorName}
                      {entry.actorRole && ` · ${entry.actorRole.replace('_', ' ')}`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      <time dateTime={entry.at}>{formatRelativeTime(entry.at)}</time>
                    </span>
                    <code>{entry.action}</code>
                    {entry.ip && <span>from {entry.ip}</span>}
                  </div>

                  {/* Before/after, only for fields that actually changed. */}
                  {entry.changes && (
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-surface-hover px-3 py-2 text-xs">
                      {Object.entries(entry.changes).map(([field, change]) => (
                        <div key={field} className="flex items-center gap-1.5">
                          <dt className="text-muted-foreground">{field}:</dt>
                          <dd className="tabular-nums">
                            <span className="text-muted-foreground line-through">
                              {String(change.from ?? '—')}
                            </span>
                            {' → '}
                            <span className="font-medium text-gold">{String(change.to ?? '—')}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default SystemLogsPage;
