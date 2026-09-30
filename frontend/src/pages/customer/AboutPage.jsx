import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowRight, Clock, MapPin, Navigation, Phone, Quote, ShoppingBag } from 'lucide-react';

import { RichText } from '@/components/common/RichText.jsx';
import { OpenChip } from '@/components/customer/ShopClosed.jsx';
import { Seo } from '@/components/seo/Seo.jsx';
import { catalogApi, useResource } from '@/features/catalog/catalog.api.js';
import { useOrderingStatus } from '@/features/site/orderingStatus.js';
import { useSiteStore } from '@/features/site/siteContext.jsx';
import { ROUTES, productPath } from '@/constants/routes.js';
import { config } from '@/config/env.js';
import { mediaUrl } from '@/lib/media.js';
import { revealOnScroll } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * About us — /about
 * ---------------------------------------------------------------------------
 * A page of its own, not the homepage again: no "Why Choose Us" cards, no
 * story video, no product grid. Top to bottom:
 *
 *   hero        heading, introduction, two-picture collage, "Since …" stamp
 *   story       the owner's words with a large first letter, and a quote
 *   figures     only the numbers the owner filled in
 *   how we work numbered steps (how an order really travels here)
 *   chapters    picture-and-text blocks, alternating sides
 *   timeline    milestones down a centre line
 *   team        portraits with name and role
 *   gallery     the owner's photos (or, until there are any, the menu's)
 *   visit       address, phone, this week's hours, open-now badge
 *
 * All of it is edited in Website Management → About Page, and every part that
 * is left empty is simply not shown. Nothing is invented: figures, team and
 * milestones appear only when the owner writes them.
 */

const DEFAULT_PICTURE = '/images/products/photos/ambience.jpg';

/** Varied heights make the gallery read as a wall of photos, not a grid of cards. */
const GALLERY_SHAPES = [
  'aspect-[4/5]',
  'aspect-square',
  'aspect-[4/3]',
  'aspect-[3/4]',
  'aspect-[5/4]',
  'aspect-square',
];

export function AboutPage() {
  const business = useSiteStore((s) => s.business);
  const content = useSiteStore((s) => s.content);
  const contact = useSiteStore((s) => s.contact);
  const ordering = useOrderingStatus();

  const name = business.name || config.brand.name;
  const gallery = content.aboutGallery ?? [];

  // The menu's photos stand in for the gallery (and the collage's second
  // picture) until the owner uploads their own — real food, nothing invented.
  const needMenuPhotos = gallery.length === 0 || !content.aboutImage2;
  const { data: menu } = useResource(
    () => (needMenuPhotos ? catalogApi.products({ limit: 24 }) : Promise.resolve(null)),
    [needMenuPhotos],
  );
  const menuPhotos = (menu?.data ?? []).filter((p) => p.image).slice(0, 6);

  const mapQuery = contact.mapQuery || business.address;

  return (
    <div className="overflow-x-clip">
      <Seo title="About Us" description={content.aboutLead || business.tagline || `The story of ${name}.`} />

      <Hero
        name={name}
        heading={content.aboutHeading || 'The story behind our food'}
        lead={content.aboutLead || business.tagline}
        since={content.aboutSince}
        address={business.address}
        ordering={ordering}
        picture={content.aboutImage || content.heroImage || DEFAULT_PICTURE}
        secondPicture={content.aboutImage2 || menuPhotos[0]?.image}
      />

      <Story
        name={name}
        tagline={business.tagline}
        body={content.aboutBody}
        quote={content.aboutQuote}
        quoteBy={content.aboutQuoteBy}
      />

      <Figures stats={content.aboutStats ?? []} />

      <Steps heading={content.aboutStepsHeading} steps={content.aboutSteps ?? []} />

      <Chapters sections={content.aboutSections ?? []} />

      <Timeline heading={content.aboutTimelineHeading} items={content.aboutTimeline ?? []} />

      <Team heading={content.aboutTeamHeading} people={content.aboutTeam ?? []} />

      {gallery.length > 0 ? (
        <Gallery kicker="Gallery" heading={content.aboutGalleryHeading || 'A look inside'} photos={gallery} />
      ) : (
        menuPhotos.length >= 3 && (
          <Gallery
            kicker="From the menu"
            heading="Fresh from our kitchen"
            photos={menuPhotos.map((p) => ({ image: p.image, caption: p.name, to: productPath(p.slug) }))}
            compact
          />
        )
      )}

      {content.aboutShowVisit !== false && (
        <Visit business={business} ordering={ordering} mapQuery={mapQuery} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/** Small gold label with a hairline — the About page's own section style. */
function Kicker({ children, center = false }) {
  return (
    <p
      className={cn(
        'flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.28em] text-gold',
        center && 'justify-center',
      )}
    >
      <span className="h-px w-8 bg-gold/70" aria-hidden="true" />
      {children}
      {center && <span className="h-px w-8 bg-gold/70" aria-hidden="true" />}
    </p>
  );
}

function SectionTitle({ kicker, title, center = false, id }) {
  return (
    <div className={cn(center && 'text-center')}>
      <Kicker center={center}>{kicker}</Kicker>
      <h2 id={id} className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

const pill =
  'inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const pillGold = cn(pill, 'bg-gold-gradient text-gold-foreground shadow-gold hover:brightness-110');
const pillOutline = cn(pill, 'border border-border-strong text-foreground hover:border-gold hover:text-gold');

/* ------------------------------------------------------------------------ */

function Hero({ name, heading, lead, since, address, ordering, picture, secondPicture }) {
  return (
    <section className="relative border-b border-border">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-0 h-[420px] w-[420px] rounded-full bg-gold/10 blur-[120px]"
      />
      <div className="container relative grid items-center gap-14 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Kicker>About {name}</Kicker>
          <h1 className="mt-5 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl xl:text-6xl">
            {heading}
          </h1>
          {lead && (
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {lead}
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={ROUTES.MENU} className={pillGold}>
              See the menu <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a href="#our-story" className={pillOutline}>
              Read our story <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>

          {(since || address || ordering) && (
            <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-6 text-sm">
              {since && <Fact label="Since" value={since} />}
              {address && <Fact label="Find us" value={address} />}
              {ordering && (
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Today
                  </dt>
                  <dd className="mt-1.5">
                    <OpenChip status={ordering} />
                  </dd>
                </div>
              )}
            </dl>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className={cn(
            'relative mx-auto w-full max-w-md lg:max-w-none',
            secondPicture && 'pb-10 pl-6 sm:pl-10',
          )}
        >
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-border shadow-elevated lg:aspect-[5/6]">
            <img src={mediaUrl(picture)} alt={`Inside ${name}`} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          </div>

          {secondPicture && (
            <div className="absolute bottom-0 left-0 w-[44%] overflow-hidden rounded-2xl border-4 border-background shadow-elevated">
              <img
                src={mediaUrl(secondPicture)}
                alt=""
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
            </div>
          )}

          {since && (
            <div className="absolute -right-2 top-6 grid h-24 w-24 -rotate-12 place-items-center rounded-full bg-gold-gradient text-center text-gold-foreground shadow-gold sm:-right-5 sm:h-28 sm:w-28">
              <span className="leading-none">
                <span className="block text-[10px] font-bold uppercase tracking-[0.22em]">Since</span>
                <span className="mt-1 block text-2xl font-black sm:text-3xl">{since}</span>
              </span>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}

function Fact({ label, value }) {
  return (
    <div className="min-w-0 max-w-xs">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 font-semibold">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/** "Roast | Meat | Sweets | Bakery" → "roast, meat, sweets and bakery". */
function describeTagline(tagline) {
  const parts = String(tagline ?? '')
    .split(/\s*[|·•,/]\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length < 2) return '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function Story({ name, tagline, body, quote, quoteBy }) {
  const makes = describeTagline(tagline);
  return (
    <section
      id="our-story"
      className="container scroll-mt-24 py-16 sm:py-24"
      aria-labelledby="our-story-title"
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <motion.div {...revealOnScroll} className="lg:sticky lg:top-28 lg:self-start">
          <SectionTitle kicker="Our story" title={name} id="our-story-title" />
          {tagline && <p className="mt-2 text-muted-foreground">{tagline}</p>}

          {quote && (
            <figure className="relative mt-8 overflow-hidden rounded-3xl border border-gold/25 bg-gold/5 p-6 sm:p-8">
              <Quote className="h-8 w-8 text-gold" aria-hidden="true" />
              <blockquote className="mt-3 text-pretty text-xl font-semibold leading-snug sm:text-2xl">
                &ldquo;{quote}&rdquo;
              </blockquote>
              {quoteBy && <figcaption className="mt-4 text-sm text-muted-foreground">— {quoteBy}</figcaption>}
            </figure>
          )}
        </motion.div>

        <motion.div {...revealOnScroll} className="text-base sm:text-lg">
          {body ? (
            <RichText source={body} className="fb-dropcap text-muted-foreground [&_strong]:text-foreground" />
          ) : (
            // Until the owner writes their story: a plain welcome, no claims.
            <div className="fb-dropcap space-y-4 leading-relaxed text-muted-foreground">
              <p>
                Welcome to {name}
                {makes ? ` — ${makes}` : ''}. Order at the counter or right here on the website, and follow
                your order from our kitchen to your table.
              </p>
              <p>
                We would love to hear what you think. Every message and every piece of feedback reaches the
                people who cook your food.
              </p>
            </div>
          )}
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link to={ROUTES.MENU} className="font-semibold text-gold hover:underline">
              Explore the menu →
            </Link>
            <Link to={ROUTES.FEEDBACK} className="font-semibold text-muted-foreground hover:text-gold">
              Tell us how we did
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function Figures({ stats }) {
  if (!stats.length) return null;
  return (
    <section aria-label="In numbers" className="border-y border-border bg-surface">
      <div
        className={cn(
          'container grid grid-cols-2 gap-px bg-border',
          stats.length >= 4 ? 'lg:grid-cols-4' : stats.length === 3 ? 'lg:grid-cols-3' : '',
        )}
      >
        {stats.map((stat, index) => (
          <motion.div
            key={`${stat.label}-${index}`}
            {...revealOnScroll}
            className="bg-surface px-4 py-10 text-center sm:py-12"
          >
            <p className="text-4xl font-black tracking-tight text-gold tabular-nums sm:text-5xl">
              {stat.value}
            </p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {stat.label}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Steps({ heading, steps }) {
  if (!steps.length) return null;
  const cols =
    steps.length === 4 ? 'lg:grid-cols-4' : steps.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3';
  return (
    <section className="container py-16 sm:py-24" aria-labelledby="how-we-work">
      <SectionTitle
        kicker="How we work"
        title={heading || 'From our kitchen to your table'}
        center
        id="how-we-work"
      />
      <ol className={cn('relative mt-14 grid gap-10 sm:grid-cols-2 lg:gap-8', cols)}>
        {/* The thread that joins the steps on a wide screen. */}
        <div
          aria-hidden="true"
          className="absolute left-[8%] right-[8%] top-7 hidden h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent lg:block"
        />
        {steps.map((step, index) => (
          <motion.li key={`${step.title}-${index}`} {...revealOnScroll} className="relative text-center">
            <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-full border border-gold/50 bg-background text-lg font-black tabular-nums text-gold shadow-gold">
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{step.body}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function Chapters({ sections }) {
  if (!sections.length) return null;
  return (
    <section className="container space-y-16 pb-16 sm:space-y-24 sm:pb-24" aria-label="Chapters">
      {sections.map((block, index) => (
        <motion.article
          key={`${block.heading}-${index}`}
          {...revealOnScroll}
          className={cn('grid items-center gap-8 lg:gap-16', block.image && 'lg:grid-cols-2')}
        >
          {block.image && (
            <div className={cn('relative', index % 2 === 1 && 'lg:order-2')}>
              <img
                src={mediaUrl(block.image)}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full rounded-[1.75rem] border border-border object-cover shadow-elevated"
              />
            </div>
          )}
          <div className={cn(!block.image && 'mx-auto max-w-3xl')}>
            <p
              className="text-6xl font-black leading-none text-gold/20 tabular-nums sm:text-7xl"
              aria-hidden="true"
            >
              {String(index + 1).padStart(2, '0')}
            </p>
            <h2 className="-mt-5 text-3xl font-bold tracking-tight sm:-mt-6 sm:text-4xl">{block.heading}</h2>
            <div className="mt-4 h-px w-16 bg-gold/60" />
            <RichText source={block.body} className="mt-5 text-base text-muted-foreground" />
          </div>
        </motion.article>
      ))}
    </section>
  );
}

function Timeline({ heading, items }) {
  if (!items.length) return null;
  return (
    <section className="border-y border-border bg-surface py-16 sm:py-24" aria-labelledby="journey">
      <div className="container max-w-4xl">
        <SectionTitle kicker="Milestones" title={heading || 'Our journey'} center id="journey" />
        <ol className="relative mt-14">
          <div aria-hidden="true" className="absolute bottom-2 left-4 top-2 w-px bg-border sm:left-1/2" />
          {items.map((item, index) => {
            const left = index % 2 === 0;
            return (
              <motion.li
                key={`${item.year}-${index}`}
                {...revealOnScroll}
                className={cn(
                  'relative pb-10 pl-12 last:pb-0 sm:w-1/2 sm:pl-0',
                  left ? 'sm:pr-12 sm:text-right' : 'sm:ml-auto sm:pl-12',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-[9px] top-1 h-3.5 w-3.5 rounded-full border-2 border-gold bg-background',
                    left ? 'sm:left-auto sm:-right-[7px]' : 'sm:-left-[7px]',
                  )}
                />
                <p className="text-sm font-black uppercase tracking-[0.2em] text-gold">{item.year}</p>
                <h3 className="mt-1 text-lg font-semibold">{item.title}</h3>
                {item.body && (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                )}
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function Team({ heading, people }) {
  if (!people.length) return null;
  return (
    <section className="container py-16 sm:py-24" aria-labelledby="our-team">
      <SectionTitle kicker="Our team" title={heading || 'The people behind the food'} id="our-team" />
      <div className="mt-10 grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
        {people.map((person, index) => (
          <motion.figure
            key={`${person.name}-${index}`}
            {...revealOnScroll}
            className="group relative overflow-hidden rounded-3xl border border-border bg-surface"
          >
            {person.photo ? (
              <img
                src={mediaUrl(person.photo)}
                alt={person.name}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="grid aspect-[3/4] place-items-center bg-surface-raised text-4xl font-black text-gold">
                {initials(person.name)}
              </div>
            )}
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 pt-14 text-white">
              <p className="font-semibold leading-tight">{person.name}</p>
              {person.role && <p className="mt-0.5 text-xs text-white/75">{person.role}</p>}
            </figcaption>
          </motion.figure>
        ))}
      </div>
    </section>
  );
}

/**
 * The owner's photos as a wall of varied shapes. `compact` (the menu's photos,
 * standing in until the owner uploads some) is one tidy row of squares, so
 * dish photos never take over the page.
 */
function Gallery({ kicker, heading, photos, compact = false }) {
  return (
    <section className="container py-16 sm:py-24" aria-labelledby="gallery">
      <SectionTitle kicker={kicker} title={heading} id="gallery" />
      <div
        className={cn(
          'mt-10',
          compact
            ? 'grid grid-cols-3 gap-3 sm:gap-4 lg:grid-cols-6'
            : 'columns-2 gap-4 sm:gap-5 md:columns-3',
        )}
      >
        {photos.map((photo, index) => {
          const picture = (
            <>
              <img
                src={mediaUrl(photo.image)}
                alt={photo.caption || ''}
                loading="lazy"
                className={cn(
                  'w-full object-cover transition-transform duration-500 group-hover:scale-105',
                  compact ? 'aspect-square' : GALLERY_SHAPES[index % GALLERY_SHAPES.length],
                )}
              />
              {photo.caption && (
                <figcaption
                  className={cn(
                    'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent font-medium text-white',
                    compact ? 'truncate p-2 pt-8 text-xs sm:text-sm' : 'p-3 pt-10 text-sm',
                  )}
                >
                  {photo.caption}
                </figcaption>
              )}
            </>
          );
          return (
            <motion.figure
              key={`${photo.image}-${index}`}
              {...revealOnScroll}
              className={cn(
                'group relative overflow-hidden rounded-2xl border border-border',
                !compact && 'mb-4 break-inside-avoid sm:mb-5',
              )}
            >
              {photo.to ? (
                <Link to={photo.to} className="block">
                  {picture}
                </Link>
              ) : (
                picture
              )}
            </motion.figure>
          );
        })}
      </div>
    </section>
  );
}

function Visit({ business, ordering, mapQuery }) {
  const hours = ordering?.summary?.length ? ordering.summary : null;
  return (
    <section className="container pb-16 sm:pb-24" aria-labelledby="visit-us">
      <motion.div
        {...revealOnScroll}
        className="relative overflow-hidden rounded-[2rem] border border-gold/25 bg-gradient-to-br from-surface-raised via-surface to-background"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-[90px]"
        />
        <div className="relative grid gap-10 p-7 sm:p-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <Kicker>Come and visit</Kicker>
            <h2 id="visit-us" className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              We&apos;d love to cook for you
            </h2>
            <ul className="mt-6 space-y-3 text-sm">
              {business.address && (
                <li className="flex gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <span>{business.address}</span>
                </li>
              )}
              {business.phone && (
                <li className="flex gap-3">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <a href={`tel:${business.phone.replace(/\s/g, '')}`} className="hover:text-gold">
                    {business.phone}
                  </a>
                </li>
              )}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              {mapQuery && (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(mapQuery)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={pillGold}
                >
                  <Navigation className="h-4 w-4" aria-hidden="true" /> Get directions
                </a>
              )}
              <Link to={ROUTES.MENU} className={pillOutline}>
                <ShoppingBag className="h-4 w-4" aria-hidden="true" /> Order online
              </Link>
              <Link
                to={ROUTES.CONTACT}
                className="inline-flex h-12 items-center px-2 text-sm font-semibold text-muted-foreground hover:text-gold"
              >
                Contact us
              </Link>
            </div>
          </div>

          {(hours || business.hours) && (
            <div className="rounded-2xl border border-border bg-background/60 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 font-semibold">
                  <Clock className="h-4 w-4 text-gold" aria-hidden="true" /> Opening hours
                </p>
                {ordering && <OpenChip status={ordering} />}
              </div>
              {hours ? (
                <dl className="mt-4 divide-y divide-border text-sm">
                  {hours.map((line) => (
                    <div key={line.days} className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted-foreground">{line.days}</dt>
                      <dd
                        className={cn(
                          'text-right font-medium',
                          line.hours === 'Closed' && 'text-muted-foreground',
                        )}
                      >
                        {line.hours}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">{business.hours}</p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </section>
  );
}

export default AboutPage;
