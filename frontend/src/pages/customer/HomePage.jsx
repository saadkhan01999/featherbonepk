import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Pause, Play, Volume2, VolumeX } from 'lucide-react';

import { ProductCard, ProductCardSkeleton } from '@/components/customer/ProductCard.jsx';
import { HeroCarousel } from '@/components/customer/HeroCarousel.jsx';
import { catalogApi, useResource } from '@/features/catalog/catalog.api.js';
import { apiClient } from '@/services/apiClient.js';
import { useCart } from '@/features/cart/cartContext.jsx';
import { useWishlist } from '@/features/wishlist/wishlistContext.jsx';
import { ROUTES, categoryPath } from '@/constants/routes.js';
import { revealOnScroll, staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';
import { Seo } from '@/components/seo/Seo.jsx';
import { useSiteStore } from '@/features/site/siteContext.jsx';
import { HighlightIcon } from '@/components/common/HighlightIcon.jsx';
import { Testimonials } from '@/components/customer/Testimonials.jsx';

/**
 * Storefront home page.
 * ---------------------------------------------------------------------------
 *   carousel        → up to five slides under the menu bar (Website Management
 *                     → Homepage Slider: pictures, words, transition, timing)
 *   categories      → every category, large, five to a row, wrapping
 *   story           → the owner's video, full width
 *   best sellers    → what actually sells (pinned picks first)
 *   why choose us   → the owner's own cards
 *
 * Everything is the owner's content, read from the shared site store, which
 * the server keeps live — an edit in the back office appears here without a
 * reload.
 */

/** Used only when the owner has not uploaded any hero picture yet. */
const DEFAULT_HERO = '/images/products/photos/ambience.jpg';

export function HomePage() {
  const content = useSiteStore((s) => s.content);
  const business = useSiteStore((s) => s.business);
  const slider = useSiteStore((s) => s.slider);

  const { data: categories, isLoading: categoriesLoading } = useResource(() => catalogApi.categories(), []);
  const { data: bestSellers, isLoading: productsLoading } = useResource(
    () => catalogApi.bestSellers({ limit: 8 }),
    [],
  );

  return (
    <>
      {/*
        LocalBusiness data, built from the settings the owner filled in — never
        from constants. Every field is omitted rather than guessed when unset.
      */}
      <Seo
        title={business.name || undefined}
        description={business.tagline || 'Freshly prepared food. Order online for delivery or collection.'}
        schema={{
          '@context': 'https://schema.org',
          '@type': 'Restaurant',
          name: business.name,
          ...(business.logoUrl && { logo: business.logoUrl }),
          ...(business.phone && { telephone: business.phone }),
          ...(business.email && { email: business.email }),
          ...(business.address && {
            address: { '@type': 'PostalAddress', streetAddress: business.address },
          }),
          servesCuisine: 'Pakistani',
          priceRange: 'Rs',
        }}
      />

      <HomeCarousel slider={slider} content={content} />
      <CategoryGrid categories={categories} isLoading={categoriesLoading} />
      <StoryBanner content={content} businessName={business.name} />
      <BestSellers products={bestSellers} isLoading={productsLoading} />
      <Testimonials />
      <WhyChooseUs heading={content.whyHeading} cards={content.whyChooseUs} businessName={business.name} />
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The carousel's slides, in order of preference:
 *   1. Website Management → Homepage Slider (up to five, the owner's choice);
 *   2. live banners from Offers & Banners with placement "hero";
 *   3. the single hero from Website Content — so the top is never empty.
 */
function HomeCarousel({ slider, content }) {
  const hasOwnSlides = slider?.slides?.length > 0;
  const { data: heroBanners } = useResource(
    () =>
      hasOwnSlides ? Promise.resolve([]) : apiClient.get('/promotions', { params: { placement: 'hero' } }),
    [hasOwnSlides],
  );

  const slides = useMemo(() => {
    if (hasOwnSlides) return slider.slides;
    if (heroBanners?.length) {
      return heroBanners.slice(0, 5).map((banner) => ({
        image: banner.image,
        kicker: banner.kicker,
        title: banner.title,
        body: banner.body ?? '',
        ctaLabel: banner.ctaLabel,
        ctaHref: banner.ctaHref,
      }));
    }
    return [
      {
        image: content.heroImage || DEFAULT_HERO,
        kicker: content.heroKicker,
        title: content.heroTitle,
        body: content.heroBody,
        ctaLabel: 'Order now',
        ctaHref: ROUTES.MENU,
      },
    ];
  }, [hasOwnSlides, slider, heroBanners, content]);

  return (
    <HeroCarousel
      slides={slides}
      effect={slider?.effect}
      interval={slider?.interval ?? 6}
      autoplay={slider?.autoplay !== false}
      height={slider?.height}
      calmForReducedMotion={Boolean(slider?.calmForReducedMotion)}
    />
  );
}

/**
 * Every category, large enough to tap without aiming: five to a row on a
 * desktop, four on a tablet, three or two on a phone, wrapping onto new rows as
 * the owner adds more. A short last row is centred rather than left hanging.
 */
function CategoryGrid({ categories, isLoading }) {
  const list = categories ?? [];
  if (!isLoading && list.length === 0) return null;

  const tile =
    'w-[calc((100%-0.75rem)/2)] min-[480px]:w-[calc((100%-1.5rem)/3)] md:w-[calc((100%-3rem)/4)] lg:w-[calc((100%-4rem)/5)]';

  return (
    <section className="container relative z-10 mt-10 sm:mt-14" aria-labelledby="browse-categories">
      <SectionHeading
        id="browse-categories"
        title="Explore the menu"
        subtitle="Pick a category to see everything in it"
        to={ROUTES.MENU}
      />

      <div className="mt-6 flex flex-wrap justify-center gap-3 sm:gap-4">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={cn(tile, 'rounded-2xl border border-border bg-surface p-5')}>
                <div className="fb-shimmer mx-auto aspect-square w-[70%] max-w-[160px] rounded-full" />
                <div className="fb-shimmer mx-auto mt-4 h-4 w-24 rounded" />
              </div>
            ))
          : list.map((category, i) => (
              <motion.div
                key={category._id ?? category.id}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: (i % 5) * 0.06, ease: [0.32, 0.72, 0, 1] }}
                className={tile}
              >
                <Link
                  to={categoryPath(category.slug)}
                  className="group flex h-full flex-col items-center rounded-2xl border border-border bg-surface px-3 pb-5 pt-6 text-center transition-all duration-300 ease-smooth hover:-translate-y-1 hover:border-gold/50 hover:shadow-elevated"
                >
                  <span className="relative block aspect-square w-[72%] max-w-[168px] overflow-hidden rounded-full bg-surface-hover ring-1 ring-border transition-all duration-300 group-hover:ring-2 group-hover:ring-gold">
                    {category.image ? (
                      <img
                        src={mediaUrl(category.image)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-110"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-4xl font-bold text-gold/70">
                        {category.name.charAt(0)}
                      </span>
                    )}
                  </span>
                  <span className="mt-4 line-clamp-2 text-sm font-semibold tracking-tight sm:text-base">
                    {category.name}
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-gold">
                    View items
                    <ArrowRight
                      className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              </motion.div>
            ))}
      </div>
    </section>
  );
}

/**
 * "Our story" — the owner's video across the full width of the page.
 * ---------------------------------------------------------------------------
 * Autoplays muted and looping (the only way browsers allow autoplay), with a
 * sound button for anyone who wants to hear it and a pause button. If the
 * browser refuses autoplay (iOS Low Power Mode, data saver) a play button is
 * shown instead of a frozen frame; if the file cannot be decoded (some iPhone
 * MOV codecs) the poster is shown instead of a black box.
 */
function StoryBanner({ content = {}, businessName }) {
  const videoRef = useRef(null);
  const [isPlaying, setPlaying] = useState(false);
  const [isMuted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);

  // mediaUrl(): uploads are stored relative to the API, not the website.
  const rawSrc = mediaUrl(content.storyVideoUrl);
  const posterSrc = mediaUrl(content.storyPosterUrl);
  const videoSrc = failed ? undefined : rawSrc;

  // Paused by the visitor? Then scrolling back into view must not restart it.
  const userPaused = useRef(false);

  /*
   * Play when seen, pause when not. A muted video started while it is still
   * below the fold is paused by the browser and not always resumed, which left
   * a frozen first frame; and a video playing off-screen only drains the
   * battery. So it starts when it scrolls into view and stops when it leaves.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    setFailed(false);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !userPaused.current) {
          video.play().then(
            () => setPlaying(true),
            () => setPlaying(false),
          );
        } else if (!entry.isIntersecting) {
          video.pause();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [rawSrc]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      video.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      userPaused.current = true;
      video.pause();
      setPlaying(false);
    }
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (video.paused)
      video.play().then(
        () => setPlaying(true),
        () => {},
      );
  };

  return (
    <section className="container py-14 sm:py-20" aria-labelledby="our-story">
      <motion.div
        {...revealOnScroll}
        className="relative h-[clamp(340px,62vh,660px)] overflow-hidden rounded-3xl border border-border bg-black"
      >
        {videoSrc ? (
          <video
            ref={videoRef}
            key={videoSrc}
            src={videoSrc}
            poster={posterSrc}
            onError={() => setFailed(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <img
            src={posterSrc || mediaUrl(content.heroImage) || DEFAULT_HERO}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* Words stay readable over moving footage, where contrast changes frame to frame. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />

        <div className="relative flex h-full flex-col justify-end p-6 sm:p-10 lg:p-14">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold">Our story</p>
          <h2
            id="our-story"
            className="mt-3 max-w-xl text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl"
          >
            {content.storyHeading || 'Our Restaurant Story'}
          </h2>
          {content.storyBody && (
            <p className="mt-4 max-w-lg text-pretty text-sm leading-relaxed text-white/80 sm:text-base">
              {content.storyBody}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to={ROUTES.ABOUT}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gold-gradient px-5 text-sm font-semibold text-gold-foreground shadow-gold transition-all hover:brightness-110"
            >
              Read our story <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            {videoSrc && (
              <>
                <MediaButton label={isPlaying ? 'Pause video' : 'Play video'} onClick={togglePlay}>
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  )}
                </MediaButton>
                <MediaButton label={isMuted ? 'Turn sound on' : 'Mute'} onClick={toggleSound}>
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </MediaButton>
              </>
            )}
            {businessName && (
              <span className="ml-auto hidden font-serif text-xl italic text-gold sm:block">
                {businessName}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function MediaButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-11 w-11 place-items-center rounded-full border border-white/30 bg-black/30 text-white backdrop-blur transition-colors hover:border-gold hover:text-gold"
    >
      {children}
    </button>
  );
}

/**
 * Best sellers — decided by the server from real sales (see catalog.service
 * `bestSellers`): the owner's pinned picks first, then what sold most in the
 * last 90 days, then the most popular overall. Hidden when the menu is empty.
 */
function BestSellers({ products, isLoading }) {
  const { addItem } = useCart();
  const { isSaved, toggle } = useWishlist();

  if (!isLoading && !products?.length) return null;

  return (
    <section className="container py-8" aria-labelledby="best-sellers">
      <SectionHeading
        id="best-sellers"
        title="Best Sellers"
        subtitle="What our customers order most"
        to={ROUTES.MENU}
      />

      <motion.div
        variants={staggerContainer}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: '-60px' }}
        className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
      >
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)
          : products.map((product) => (
              <motion.div key={product.id} variants={staggerItem}>
                <ProductCard
                  product={product}
                  onAddToCart={addItem}
                  isWishlisted={isSaved(product.id)}
                  onToggleWishlist={toggle}
                />
              </motion.div>
            ))}
      </motion.div>
    </section>
  );
}

/**
 * "Why Choose Us" — the owner's own cards (Website Management → Homepage).
 * An empty list hides the section rather than showing somebody else's promises.
 */
function WhyChooseUs({ heading, cards = [], businessName }) {
  if (!cards?.length) return null;
  return (
    <section className="container py-14" aria-labelledby="why-choose-us">
      <SectionHeading
        id="why-choose-us"
        title={heading || 'Why Choose Us'}
        subtitle={businessName ? `What sets ${businessName} apart` : undefined}
        centered
      />

      <div
        className={cn(
          'mt-8 grid gap-4 sm:grid-cols-2',
          cards.length >= 4 ? 'lg:grid-cols-4' : cards.length === 3 ? 'lg:grid-cols-3' : '',
        )}
      >
        {cards.map(({ icon, title, body }, index) => (
          <motion.div
            key={`${title}-${index}`}
            {...revealOnScroll}
            className="rounded-2xl border border-border bg-surface p-6 text-center transition-colors hover:border-gold/40"
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 text-gold">
              <HighlightIcon icon={icon} />
            </span>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/** Shared section heading with the brand's gold rule. */
export function SectionHeading({ id, title, subtitle, to, centered = false }) {
  return (
    <div
      className={cn('flex items-end justify-between gap-4', centered && 'flex-col items-center text-center')}
    >
      <div>
        <h2 id={id} className="text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        <div className={cn('mt-3 h-px w-24 fb-gold-rule', centered && 'mx-auto')} />
      </div>
      {to && !centered && (
        <Link
          to={to}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-gold hover:underline"
        >
          View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export default HomePage;
