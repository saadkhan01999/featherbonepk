import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { ROUTES } from '@/constants/routes.js';
import { revealOnScroll } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/format.js';
import { useSiteStore } from '@/features/site/siteContext.jsx';
import { mediaUrl } from '@/lib/media.js';
import { Seo } from '@/components/seo/Seo.jsx';

/**
 * Special offers.
 * ---------------------------------------------------------------------------
 * Filter pills → promotional banners → standing perks, matching the reference.
 *
 * Campaigns come from the promotions API, which returns only what is live right
 * now — the owner schedules a start and end date in the back office and the
 * offer appears and expires on its own. Nothing here needs a deploy.
 */

const FILTERS = [
  { value: 'all', label: 'All Offers' },
  { value: 'combo', label: 'Combo Deals' },
  { value: 'eid', label: 'Eid Offers' },
  { value: 'weekend', label: 'Weekend Deals' },
  { value: 'seasonal', label: 'Seasonal' },
];

/*
 * Standing perks. The free-delivery amount comes from Settings → Delivery and
 * the perk disappears when free delivery is off (threshold 0).
 */
const perksFor = (pricing) =>
  [
    pricing?.freeDeliveryThreshold > 0 && {
      image: '/images/perks/delivery.png?v=2',
      title: 'Free Delivery',
      body: 'On orders above',
      accent: formatCurrency(pricing.freeDeliveryThreshold),
    },
  ].filter(Boolean);

export function OffersPage() {
  const [filter, setFilter] = useState('all');
  const pricing = useSiteStore((s) => s.pricing);
  const perks = perksFor(pricing);

  // The API returns only live offers, so nothing here needs to check dates.
  const { data: campaigns, isLoading, error } = useResource(() => apiClient.get('/promotions'), []);

  const visible = useMemo(() => {
    const list = campaigns ?? [];
    return filter === 'all' ? list : list.filter((c) => c.type === filter);
  }, [campaigns, filter]);

  return (
    <div className="container py-12">
      <Seo title="Offers" description="Today's deals and seasonal offers." />
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Special Offers</h1>
        <p className="mt-2 text-sm text-muted-foreground">Delicious deals for you and your family</p>
        <div className="mx-auto mt-4 h-px w-32 fb-gold-rule" />
      </header>

      {/* --- Filter pills --- */}
      <div role="tablist" aria-label="Offer categories" className="mt-8 flex flex-wrap justify-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-all',
              filter === option.value
                ? 'bg-gold-gradient text-gold-foreground shadow-gold'
                : 'border border-border-strong text-muted-foreground hover:border-gold/50 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* --- Campaign banners --- */}
      {isLoading ? (
        <SectionLoader label="Loading offers" />
      ) : error ? (
        <p className="mt-12 text-center text-sm text-muted-foreground">
          We couldn&apos;t load our offers just now. Please try again shortly.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-12 text-center text-sm text-muted-foreground">
          No offers in this category right now — check back soon.
        </p>
      ) : (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {visible.map((campaign) => (
            <motion.article
              key={campaign.id}
              {...revealOnScroll}
              className="group relative h-[260px] overflow-hidden rounded-2xl border border-border"
            >
              <img
                src={mediaUrl(campaign.image)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              {/* Left-weighted scrim so the copy stays readable over any photo. */}
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent" />

              <div className="absolute inset-0 flex flex-col justify-center p-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
                  {campaign.kicker}
                </p>
                <h2 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">{campaign.title}</h2>
                <p className="mt-1 text-lg font-semibold text-gold">{campaign.highlight}</p>

                <Link to={campaign.ctaHref || ROUTES.MENU} className="mt-5 w-fit">
                  <Button>{campaign.ctaLabel || 'Order Now'}</Button>
                </Link>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      {/* --- Standing perks --- */}
      <div className="mt-6 flex justify-start">
        {perks.map(({ image, title, body, accent, accentFirst }) => (
          <motion.div
            key={title}
            {...revealOnScroll}
            className="relative flex w-full max-w-[280px] items-center overflow-hidden rounded-2xl border border-gold/35 bg-surface pl-4 pr-1 sm:max-w-[300px]"
          >
            <div className="relative z-10 min-w-0 flex-1 py-4 pr-1">
              <h3 className="text-base font-bold tracking-tight sm:text-lg">{title}</h3>
              {accentFirst ? (
                <>
                  <p className="mt-0.5 text-sm font-bold text-gold">{accent}</p>
                  <p className="text-xs text-muted-foreground">{body}</p>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
                  <p className="text-sm font-bold">{accent}</p>
                </>
              )}
            </div>
            <img
              src={image}
              alt=""
              aria-hidden="true"
              className="h-[92px] w-[92px] shrink-0 object-contain object-right drop-shadow-lg sm:h-[104px] sm:w-[104px]"
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default OffersPage;
