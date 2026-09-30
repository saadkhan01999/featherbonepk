import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, MessageSquare, Check, X, Clock, AlertCircle, CheckCircle2, Filter } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { WebsiteFeedbackPanel } from '@/components/admin/WebsiteFeedbackPanel.jsx';
import { ROUTES } from '@/constants/routes.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { formatRelativeTime } from '@/lib/format.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { getInitials, cn } from '@/lib/utils.js';

/**
 * Customer Feedback — screen 12 in the reference design.
 * ---------------------------------------------------------------------------
 * The moderation queue: every review a customer has written, with approve and
 * reject controls.
 *
 * Nothing a customer writes reaches a product page until someone here has read
 * it. That is the whole point of the screen — an unmoderated review box on a
 * restaurant menu is a spam target, and one abusive comment sitting under a
 * dish costs more than the moderation takes.
 */

const STATUS_META = {
  pending: { label: 'Pending', variant: 'warning', icon: Clock },
  approved: { label: 'Approved', variant: 'success', icon: CheckCircle2 },
  rejected: { label: 'Rejected', variant: 'destructive', icon: X },
};

const FILTERS = [
  { key: 'pending', label: 'Needs review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
];

/** Five stars, filled to the rating. */
function Stars({ value, size = 'h-4 w-4' }) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden="true"
          className={cn(size, star <= value ? 'fill-gold text-gold' : 'text-border-strong')}
        />
      ))}
    </div>
  );
}

/**
 * Customer Feedback — two kinds, one page:
 *   Website feedback  anyone's word on the visit, from the website's Feedback page
 *   Product reviews   signed-in customers rating a dish they actually ordered
 */
export function FeedbackPage() {
  const [query, setQuery] = useSearchParams();
  const tab = query.get('tab') === 'reviews' ? 'reviews' : 'website';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customer Feedback</h1>
          <p className="text-sm text-muted-foreground">
            {tab === 'website'
              ? 'What visitors sent from the Feedback page. Reply, and publish the best to your website.'
              : 'Only reviews from customers who actually ordered the dish reach this queue.'}
          </p>
        </div>
        <Link to={ROUTES.FEEDBACK} target="_blank" className="text-sm text-gold hover:underline">
          Open the Feedback page →
        </Link>
      </header>

      <div role="tablist" aria-label="Kind of feedback" className="flex gap-1 border-b border-border">
        {[
          { key: 'website', label: 'Website feedback' },
          { key: 'reviews', label: 'Product reviews' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setQuery(t.key === 'website' ? {} : { tab: t.key }, { replace: true })}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
              tab === t.key
                ? 'border-gold text-gold'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'website' ? <WebsiteFeedbackPanel /> : <ProductReviewsPanel />}
    </div>
  );
}

function ProductReviewsPanel() {
  const [status, setStatus] = useState('pending');
  const [ratingFilter, setRatingFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  const params = useMemo(
    () => ({ ...(status && { status }), ...(ratingFilter && { rating: ratingFilter }) }),
    [status, ratingFilter],
  );

  const {
    rows: items,
    // Aliased: the review map below already binds `meta` to its status badge.
    meta: pageMeta,
    isLoading,
    error,
    reload,
    goToPage,
  } = usePagedResource(
    ({ page, limit }) =>
      apiClient.get('/reviews', { params: { ...params, page, limit }, _wantEnvelope: true }),
    [status, ratingFilter],
  );

  const { data: stats, reload: reloadStats } = useResource(() => apiClient.get('/reviews/stats'), []);

  /**
   * Approve or reject.
   *
   * Both lists are reloaded rather than patched in place: moderating changes
   * the product's rating average too, and a locally-spliced row would leave the
   * summary counters showing yesterday's numbers.
   */
  const moderate = useCallback(
    async (id, decision) => {
      setBusyId(id);
      setNotice(null);
      try {
        const result = await apiClient.patch(`/reviews/${id}/moderate`, { status: decision });
        setNotice({ type: 'success', text: result.message ?? `Review ${decision}.` });
        await Promise.all([reload(), reloadStats()]);
      } catch (err) {
        setNotice({ type: 'error', text: err.message ?? 'Could not update this review' });
      } finally {
        setBusyId(null);
      }
    },
    [reload, reloadStats],
  );

  return (
    <div className="space-y-5">
      {/* --- Summary --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Average rating',
            value: stats ? stats.averageRating.toFixed(1) : '—',
            icon: Star,
            tone: 'text-gold',
          },
          { label: 'Awaiting review', value: stats?.pending ?? '—', icon: Clock, tone: 'text-warning' },
          { label: 'Published', value: stats?.approved ?? '—', icon: CheckCircle2, tone: 'text-success' },
          {
            label: 'Total received',
            value: stats?.total ?? '—',
            icon: MessageSquare,
            tone: 'text-muted-foreground',
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{card.label}</span>
              <card.icon className={cn('h-4 w-4', card.tone)} aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{card.value}</p>
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

      {/* --- Filters --- */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap rounded-lg border border-border-strong p-0.5"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.key || 'all'}
              type="button"
              onClick={() => setStatus(filter.key)}
              aria-pressed={status === filter.key}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === filter.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
              {filter.key === 'pending' && stats?.pending > 0 && (
                <span className="ml-1.5 tabular-nums opacity-80">({stats.pending})</span>
              )}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Rating</span>
          <select
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value)}
            className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm text-foreground focus:border-gold focus:outline-none"
          >
            <option value="">Any</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} star{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* --- Queue --- */}
      {isLoading ? (
        <SectionLoader label="Loading feedback" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : !items.length ? (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">{status === 'pending' ? 'Nothing waiting' : 'No reviews here'}</p>
          <p className="text-sm text-muted-foreground">
            {status === 'pending' ? 'Every review has been dealt with.' : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        <motion.ul {...staggerContainer} className="space-y-3">
          {items.map((review) => {
            const meta = STATUS_META[review.status] ?? STATUS_META.pending;
            const isBusy = busyId === review.id;

            return (
              <motion.li
                key={review.id}
                {...staggerItem}
                className="rounded-2xl border border-border bg-surface p-4 sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  {/* Avatar — initials, because customers have no photo. */}
                  <div
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/15 text-sm font-semibold text-gold"
                  >
                    {getInitials(review.customerName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{review.customerName}</span>
                      <Stars value={review.rating} />
                      <Badge variant={meta.variant} size="sm" icon={meta.icon}>
                        {meta.label}
                      </Badge>
                    </div>

                    <p className="mt-0.5 text-xs text-muted-foreground">
                      on <span className="text-foreground">{review.productName}</span>
                      {' · '}
                      {formatRelativeTime(review.createdAt)}
                    </p>

                    {review.comment ? (
                      <p className="mt-2.5 text-sm leading-relaxed text-foreground/90">{review.comment}</p>
                    ) : (
                      <p className="mt-2.5 text-sm italic text-muted-foreground">
                        Rating only — no comment left.
                      </p>
                    )}

                    {review.moderatedAt && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {meta.label.toLowerCase()} {formatRelativeTime(review.moderatedAt)}
                        {review.moderationNote && ` — ${review.moderationNote}`}
                      </p>
                    )}
                  </div>

                  {/* Actions. An already-decided review keeps the opposite
                      action available, so a mistaken rejection is one click to
                      undo rather than a database edit. */}
                  <div className="flex shrink-0 gap-2 sm:flex-col">
                    {review.status !== 'approved' && (
                      <Button
                        size="sm"
                        leftIcon={Check}
                        onClick={() => moderate(review.id, 'approved')}
                        isLoading={isBusy}
                        disabled={isBusy}
                      >
                        Approve
                      </Button>
                    )}
                    {review.status !== 'rejected' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={X}
                        onClick={() => moderate(review.id, 'rejected')}
                        disabled={isBusy}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      <Pagination meta={pageMeta} onPageChange={goToPage} label="reviews" />
    </div>
  );
}

export default FeedbackPage;
