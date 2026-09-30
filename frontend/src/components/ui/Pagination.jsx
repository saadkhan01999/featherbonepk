import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils.js';

/**
 * Page navigation for a server-paginated list.
 * ---------------------------------------------------------------------------
 * Why this exists: every admin list fetched a fixed slice — 50 or 100 rows —
 * and rendered "Showing 50 of 347". There was no way to reach row 51. Records
 * were not missing, they were unreachable, which is worse: the screen looked
 * complete and quietly was not.
 *
 * It reads the server's `meta.pagination` rather than deriving anything.
 * `sendPaginated` already computes `totalPages`, `hasNext` and `hasPrev` for
 * exactly this reason — a UI that recalculates them will eventually disagree
 * with the query that produced the rows.
 *
 * Windowed page numbers. Ten thousand orders is five hundred pages; rendering
 * every button is unusable and slow. This shows first, last, and a window
 * around the current page, with gaps marked — the pattern people already know
 * from search results.
 */

/**
 * Which page buttons to draw.
 * Always includes 1 and `totalPages`; `null` marks a gap.
 */
function pageWindow(page, totalPages, span = 1) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set([1, totalPages]);
  for (let p = page - span; p <= page + span; p += 1) {
    if (p > 1 && p < totalPages) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const withGaps = [];

  sorted.forEach((p, i) => {
    // A gap of exactly one page is silly — show the page instead of an ellipsis.
    if (i > 0 && p - sorted[i - 1] === 2) withGaps.push(sorted[i - 1] + 1);
    else if (i > 0 && p - sorted[i - 1] > 2) withGaps.push(null);
    withGaps.push(p);
  });

  return withGaps;
}

/**
 * @param {object} props
 * @param {object} props.meta   The server's `meta.pagination` block.
 * @param {(page: number) => void} props.onPageChange
 * @param {string} [props.label] What is being paged, for the summary line.
 * @param {number} [props.filtered] Rows left after CLIENT-side filtering, when
 *   the screen filters locally. Shown instead of the page slice so the count on
 *   screen matches the rows on screen.
 */
export function Pagination({ meta, onPageChange, label = 'records', filtered, className }) {
  if (!meta) return null;

  const { page = 1, limit = 20, total = 0, totalPages = 0, hasNext, hasPrev } = meta;

  const firstRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const lastRow = Math.min(page * limit, total);

  // Nothing to page through, and nothing worth saying about one short list.
  if (total === 0) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row',
        className,
      )}
    >
      {/*
        `aria-live` so a screen reader hears the new range after paging —
        otherwise the table silently changes underneath and nothing announces it.
      */}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {typeof filtered === 'number' && filtered !== total ? (
          <>
            <span className="font-medium text-foreground">{filtered}</span> of {total} {label} match your
            filters
          </>
        ) : (
          <>
            Showing <span className="font-medium text-foreground">{firstRow}</span>–
            <span className="font-medium text-foreground">{lastRow}</span> of {total} {label}
          </>
        )}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrev}
            aria-label="Previous page"
            className="flex h-8 items-center gap-1 rounded-lg border border-border-strong px-2.5 text-sm transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Prev</span>
          </button>

          {pages.map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-sm text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? 'page' : undefined}
                className={cn(
                  'h-8 min-w-8 rounded-lg px-2 text-sm font-medium tabular-nums transition-colors',
                  p === page
                    ? 'bg-gold-gradient text-gold-foreground'
                    : 'border border-border-strong hover:bg-surface-hover',
                )}
              >
                {p}
              </button>
            ),
          )}

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext}
            aria-label="Next page"
            className="flex h-8 items-center gap-1 rounded-lg border border-border-strong px-2.5 text-sm transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  );
}

export default Pagination;
