import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BadgeCheck, MessageSquareHeart, Quote } from 'lucide-react';

import { StarRating } from '@/components/common/StarRating.jsx';
import { useResource } from '@/features/catalog/catalog.api.js';
import { feedbackApi } from '@/features/feedback/feedback.api.js';
import { TAG_LABEL, isFixTag } from '@/features/feedback/feedbackTags.js';
import { ROUTES } from '@/constants/routes.js';
import { revealOnScroll } from '@/lib/motion.js';
import { formatDate } from '@/lib/format.js';
import { cn } from '@/lib/utils.js';

/**
 * Customer feedback on the website.
 *   FeedbackCard   one published comment, with the owner's reply if any
 *   ScoreSummary   the average, the number of ratings and the spread
 *   Testimonials   the homepage section: summary + latest comments + a way to add one
 * Only feedback the customer allowed and staff published ever appears.
 */

export function FeedbackCard({ item, className }) {
  return (
    <motion.figure
      {...revealOnScroll}
      className={cn('flex h-full flex-col rounded-2xl border border-border bg-surface p-5', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <StarRating value={item.rating} size="sm" />
        <Quote className="h-5 w-5 text-gold/40" aria-hidden="true" />
      </div>
      {item.comment ? (
        <blockquote className="mt-3 flex-1 text-pretty text-sm leading-relaxed text-foreground/90">
          &ldquo;{item.comment}&rdquo;
        </blockquote>
      ) : (
        <span className="flex-1" />
      )}
      {item.tags?.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Mentioned">
          {item.tags.map((tag) => (
            <li
              key={tag}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                isFixTag(tag) ? 'bg-warning/10 text-warning' : 'bg-gold/10 text-gold',
              )}
            >
              {TAG_LABEL[tag] ?? tag}
            </li>
          ))}
        </ul>
      )}
      {item.reply && (
        <p className="mt-3 rounded-xl border-l-2 border-gold/60 bg-gold/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-gold">Our reply: </span>
          {item.reply}
        </p>
      )}
      <figcaption className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          {item.name}
          {item.verifiedOrder && (
            <span
              className="flex items-center gap-0.5 font-medium text-success"
              title="Placed an order with us"
            >
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified order
            </span>
          )}
        </span>
        <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
      </figcaption>
    </motion.figure>
  );
}

export function ScoreSummary({ summary, className }) {
  if (!summary?.count) return null;
  const max = Math.max(1, ...Object.values(summary.distribution ?? {}));
  return (
    <div className={cn('flex flex-wrap items-center gap-6', className)}>
      <div className="text-center">
        <p className="text-5xl font-black tabular-nums text-gold">{summary.average?.toFixed(1)}</p>
        <StarRating value={summary.average} size="sm" className="mt-1" />
        <p className="mt-1 text-xs text-muted-foreground">
          {summary.count} rating{summary.count === 1 ? '' : 's'}
        </p>
      </div>
      <dl className="min-w-[180px] flex-1 space-y-1">
        {[5, 4, 3, 2, 1].map((n) => (
          <div key={n} className="flex items-center gap-2 text-xs">
            <dt className="w-3 tabular-nums text-muted-foreground">{n}</dt>
            <dd className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
              <span
                className="block h-full rounded-full bg-gold"
                style={{ width: `${((summary.distribution?.[n] ?? 0) / max) * 100}%` }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Rate us in one tap: choosing a star opens the Feedback page with that score
 * already set, so all that is left is "send".
 */
export function QuickRate({ label = 'Rate us', orderNumber, className }) {
  const navigate = useNavigate();
  const go = (rating) => {
    const params = new URLSearchParams({ rating: String(rating) });
    if (orderNumber) params.set('order', orderNumber);
    navigate(`${ROUTES.FEEDBACK}?${params}`);
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <StarRating value={0} onChange={go} size="md" label={label} />
    </div>
  );
}

/** Homepage: what customers say, and an invitation to add to it. */
export function Testimonials() {
  const { data } = useResource(() => feedbackApi.published(6), []);
  const items = data?.items ?? [];

  return (
    <section className="container py-14" aria-labelledby="customer-feedback">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="customer-feedback" className="text-2xl font-bold tracking-tight sm:text-3xl">
            What our customers say
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Real words from people who ate with us.</p>
          <div className="mt-3 h-px w-24 fb-gold-rule" />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {items.length > 0 && <QuickRate />}
          <Link
            to={ROUTES.FEEDBACK}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-gold/40 px-5 text-sm font-semibold text-gold transition-colors hover:bg-gold/10"
          >
            <MessageSquareHeart className="h-4 w-4" aria-hidden="true" /> Share your feedback
          </Link>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <ScoreSummary summary={data.summary} className="flex-col items-stretch" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <FeedbackCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      ) : (
        <motion.div
          {...revealOnScroll}
          className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border-strong px-6 py-12 text-center"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-gold/10 text-gold">
            <MessageSquareHeart className="h-7 w-7" aria-hidden="true" />
          </span>
          <h3 className="text-lg font-semibold">Be the first to tell us how we did</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Tap a star — it takes ten seconds. Every word is read by the owner, and the kind ones may appear
            here.
          </p>
          <QuickRate label="How was it?" className="mt-1 justify-center" />
        </motion.div>
      )}
    </section>
  );
}

export default Testimonials;
