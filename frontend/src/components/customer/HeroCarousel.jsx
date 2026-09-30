import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

import { isInternalHref } from '@/components/common/SiteIcons.jsx';
import { ROUTES } from '@/constants/routes.js';
import { mediaUrl } from '@/lib/media.js';
import { cn } from '@/lib/utils.js';

/**
 * Homepage carousel.
 * ---------------------------------------------------------------------------
 * Up to five slides, uploaded and worded by the owner in Website Management →
 * Homepage Slider, with the transition they choose:
 *
 *   book       the page turns over from its left edge, casting shade on the
 *              next page underneath — like leafing through a menu
 *   cube       the slides are the faces of a turning cube
 *   coverflow  slides swing past as angled cards
 *   kenburns   a slow cinematic crossfade and zoom
 *   slide      a sideways slide, the picture moving slower than the frame
 *
 * Behaviour a visitor never has to think about: it pauses while hovered or
 * focused and while the tab is in the background; arrow keys and swiping work;
 * the progress bar under the slides is the timer, so pausing and resuming
 * carries on from where it stopped rather than restarting the countdown.
 *
 * Reduced motion. Windows with "Show animations" off (and phones with "reduce
 * motion") ask websites for less movement. By default the owner's chosen
 * transition still plays — otherwise an owner on such a PC would see a plain
 * fade and think the effect was broken. Settings → Homepage Slider → "Calmer
 * slides for visitors who ask for less motion" switches those visitors to a
 * gentle fade without auto-play. The timer runs in JavaScript for the same
 * reason: the site's reduced-motion CSS stops every CSS animation.
 */

const HEIGHTS = {
  compact: 'h-[clamp(320px,52vh,560px)]',
  standard: 'h-[clamp(380px,68vh,760px)]',
  tall: 'h-[clamp(440px,82vh,900px)]',
  screen: 'h-[calc(100svh-68px)] min-h-[420px]',
};

const EASE = [0.65, 0, 0.35, 1];
const TURN = 1.15;

/*
 * One set of variants per effect. `dir` is +1 going forward and -1 going back,
 * passed through AnimatePresence's `custom` so the leaving slide knows the
 * direction too (it was rendered before the click that decided it).
 */
const EFFECTS = {
  book: {
    slide: {
      enter: (dir) =>
        dir > 0
          ? { zIndex: 1, rotateY: 0, scale: 1.035, filter: 'brightness(0.45)' }
          : { zIndex: 3, rotateY: -118, scale: 1, filter: 'brightness(1)' },
      center: {
        zIndex: 2,
        rotateY: 0,
        scale: 1,
        filter: 'brightness(1)',
        transition: { duration: TURN, ease: EASE },
      },
      exit: (dir) =>
        dir > 0
          ? { zIndex: 3, rotateY: -118, transition: { duration: TURN, ease: EASE } }
          : {
              zIndex: 1,
              scale: 1.035,
              filter: 'brightness(0.45)',
              transition: { duration: TURN, ease: EASE },
            },
    },
    // The curl of a turning page: darkest where it bends away from the light.
    shade: {
      enter: (dir) => ({ opacity: dir > 0 ? 0 : 0.7 }),
      center: { opacity: 0, transition: { duration: TURN, ease: EASE } },
      exit: (dir) => ({ opacity: dir > 0 ? 0.7 : 0, transition: { duration: TURN, ease: EASE } }),
    },
    origin: '0% 50%',
  },
  cube: {
    slide: {
      enter: (dir) => ({
        zIndex: 2,
        x: dir > 0 ? '100%' : '-100%',
        rotateY: dir > 0 ? 90 : -90,
        filter: 'brightness(0.55)',
        transformOrigin: dir > 0 ? '0% 50%' : '100% 50%',
      }),
      center: {
        zIndex: 2,
        x: 0,
        rotateY: 0,
        filter: 'brightness(1)',
        transition: { duration: 1, ease: EASE },
      },
      exit: (dir) => ({
        zIndex: 1,
        x: dir > 0 ? '-100%' : '100%',
        rotateY: dir > 0 ? -90 : 90,
        filter: 'brightness(0.55)',
        transformOrigin: dir > 0 ? '100% 50%' : '0% 50%',
        transition: { duration: 1, ease: EASE },
      }),
    },
  },
  coverflow: {
    slide: {
      enter: (dir) => ({ zIndex: 2, x: `${dir * 72}%`, rotateY: dir * -42, scale: 0.7, opacity: 0.35 }),
      center: {
        zIndex: 2,
        x: 0,
        rotateY: 0,
        scale: 1,
        opacity: 1,
        transition: { duration: 1, ease: EASE },
      },
      exit: (dir) => ({
        zIndex: 1,
        x: `${dir * -72}%`,
        rotateY: dir * 42,
        scale: 0.7,
        opacity: 0,
        transition: { duration: 1, ease: EASE },
      }),
    },
  },
  kenburns: {
    slide: {
      enter: { zIndex: 2, opacity: 0 },
      center: { zIndex: 2, opacity: 1, transition: { duration: 1.4, ease: 'easeInOut' } },
      exit: { zIndex: 1, opacity: 0, transition: { duration: 1.4, ease: 'easeInOut' } },
    },
  },
  slide: {
    slide: {
      enter: (dir) => ({ zIndex: 2, x: `${dir * 100}%` }),
      center: { zIndex: 2, x: 0, transition: { duration: 0.95, ease: EASE } },
      exit: (dir) => ({
        zIndex: 1,
        x: `${dir * -35}%`,
        filter: 'brightness(0.5)',
        transition: { duration: 0.95, ease: EASE },
      }),
    },
    // Parallax: the picture travels less than its frame.
    image: {
      enter: (dir) => ({ x: `${dir * -45}%` }),
      center: { x: 0, transition: { duration: 0.95, ease: EASE } },
      exit: { x: 0 },
    },
  },
  reduced: {
    slide: {
      enter: { zIndex: 2, opacity: 0 },
      center: { zIndex: 2, opacity: 1, transition: { duration: 0.5 } },
      exit: { zIndex: 1, opacity: 0, transition: { duration: 0.5 } },
    },
  },
};

const ALIGN = {
  left: 'items-start text-left',
  center: 'items-center text-center mx-auto',
  right: 'items-end text-right ml-auto',
};

/**
 * @param {object} props
 * @param {{image: string, kicker?: string, title?: string, body?: string, ctaLabel?: string, ctaHref?: string, align?: string}[]} props.slides
 * @param {'book'|'cube'|'coverflow'|'kenburns'|'slide'} [props.effect]
 * @param {number} [props.interval] seconds per slide
 * @param {boolean} [props.autoplay]
 * @param {'compact'|'standard'|'tall'|'screen'} [props.height]
 */
export function HeroCarousel({
  slides = [],
  effect = 'book',
  interval = 6,
  autoplay = true,
  height = 'standard',
  calmForReducedMotion = false,
}) {
  const prefersLessMotion = useReducedMotion();
  const reduceMotion = Boolean(prefersLessMotion && calmForReducedMotion);
  const [[index, dir], setState] = useState([0, 1]);
  const [isHovered, setHovered] = useState(false);
  const [isUserPaused, setUserPaused] = useState(false);
  const [isHidden, setHidden] = useState(false);
  const lockUntil = useRef(0);
  const rootRef = useRef(null);

  const count = slides.length;
  const current = slides[count ? index % count : 0];
  const fx = EFFECTS[reduceMotion ? 'reduced' : effect] ?? EFFECTS.book;
  // A calm visitor is not shown a slideshow that moves on by itself; the
  // arrows, swipe and bars still work.
  const autoplayOn = autoplay && !reduceMotion;
  const isPaused = !autoplayOn || isHovered || isUserPaused || isHidden || count < 2;

  // A settings save can shrink the list under us.
  useEffect(() => {
    if (index >= count && count > 0) setState([0, 1]);
  }, [count, index]);

  const go = useCallback(
    (step) => {
      if (count < 2) return;
      // One turn at a time: a second click mid-turn would tear the page.
      const now = Date.now();
      if (now < lockUntil.current) return;
      lockUntil.current = now + 650;
      setState(([i]) => [(i + step + count) % count, step > 0 ? 1 : -1]);
    },
    [count],
  );

  // The timer's own turn is never refused by the click lock, or a click just
  // before the bar filled would leave the slideshow stuck on a full bar.
  const advance = useCallback(() => {
    lockUntil.current = Date.now() + 650;
    setState(([i]) => [(i + 1) % count, 1]);
  }, [count]);

  /*
   * The timer: a motion value from 0 to 1 that draws the active progress bar
   * and turns the page when it reaches 1. Paused, it simply stops where it is;
   * resumed, it runs for the time that was left.
   */
  const progress = useMotionValue(0);
  useEffect(() => {
    progress.set(0);
  }, [index, progress]);
  useEffect(() => {
    if (isPaused) return undefined;
    const remaining = Math.max(0.05, (1 - progress.get()) * interval);
    const controls = animate(progress, 1, { duration: remaining, ease: 'linear', onComplete: advance });
    return () => controls.stop();
  }, [index, isPaused, interval, progress, advance]);

  const goTo = (target) => {
    if (target === index) return;
    lockUntil.current = 0;
    setState([target, target > index ? 1 : -1]);
  };

  // Pause while the tab is in the background — nobody is watching.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Warm the next picture so a turn never reveals a half-loaded image.
  useEffect(() => {
    if (count < 2) return;
    const next = slides[(index + 1) % count];
    if (next?.image) {
      const img = new Image();
      img.src = mediaUrl(next.image);
    }
  }, [index, count, slides]);

  if (!count) return null;

  const onKeyDown = (event) => {
    if (event.key === 'ArrowRight') go(1);
    if (event.key === 'ArrowLeft') go(-1);
  };

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label="Featured"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => !rootRef.current?.contains(e.relatedTarget) && setHovered(false)}
      className={cn(
        'relative isolate overflow-hidden bg-black outline-none',
        HEIGHTS[height] ?? HEIGHTS.standard,
      )}
    >
      {/* ---------------- Slides ---------------- */}
      <motion.div
        className="absolute inset-0"
        // pan-y: a vertical swipe still scrolls the page; only sideways turns it.
        style={{ perspective: 2200, touchAction: 'pan-y' }}
        // Swipe on touch screens; the drag itself moves nothing — it only decides.
        onPanEnd={(_, info) => {
          if (Math.abs(info.offset.x) > 60 && Math.abs(info.offset.x) > Math.abs(info.offset.y)) {
            go(info.offset.x < 0 ? 1 : -1);
          }
        }}
      >
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={index}
            custom={dir}
            variants={fx.slide}
            initial="enter"
            animate="center"
            exit="exit"
            className="absolute inset-0 overflow-hidden"
            style={{
              transformOrigin: fx.origin ?? '50% 50%',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              willChange: 'transform',
            }}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}`}
          >
            <motion.img
              src={mediaUrl(current.image)}
              alt=""
              draggable={false}
              fetchpriority={index === 0 ? 'high' : undefined}
              custom={dir}
              variants={fx.image}
              className="h-full w-full select-none object-cover"
              // Ken Burns: a slow drift for the whole time the slide is up.
              {...(effect === 'kenburns' && !reduceMotion
                ? {
                    initial: { scale: 1.16, x: index % 2 ? '-2%' : '2%' },
                    animate: { scale: 1, x: '0%' },
                    transition: { duration: interval + 1.5, ease: 'linear' },
                  }
                : {})}
            />

            {/* Legibility: the words sit on shade whatever photo is uploaded. */}
            <div
              className={cn(
                'pointer-events-none absolute inset-0',
                current.align === 'center'
                  ? 'bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.55),rgba(0,0,0,0.25)_70%)]'
                  : current.align === 'right'
                    ? 'bg-gradient-to-l from-black/80 via-black/40 to-transparent'
                    : 'bg-gradient-to-r from-black/80 via-black/40 to-transparent',
              )}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />

            {fx.shade && (
              <motion.div
                custom={dir}
                variants={fx.shade}
                className="pointer-events-none absolute inset-0 bg-gradient-to-l from-black via-black/60 to-black/10"
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* ---------------- Words ---------------- */}
      <div className="pointer-events-none relative z-10 flex h-full items-center">
        <div className="container">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={index}
              initial="hidden"
              animate="shown"
              exit="gone"
              variants={{
                hidden: {},
                shown: { transition: { staggerChildren: 0.09, delayChildren: reduceMotion ? 0 : 0.35 } },
                gone: { opacity: 0, transition: { duration: 0.25 } },
              }}
              className={cn('flex max-w-2xl flex-col', ALIGN[current.align] ?? ALIGN.left)}
            >
              {current.kicker && (
                <Line className="text-xs font-semibold uppercase tracking-[0.28em] text-gold sm:text-sm">
                  {current.kicker}
                </Line>
              )}
              {current.title && (
                <Line
                  as="h2"
                  className="mt-3 text-balance text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl"
                >
                  {current.title}
                </Line>
              )}
              {current.body && (
                <Line className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-white/80 sm:text-base">
                  {current.body}
                </Line>
              )}
              <Line className="pointer-events-auto mt-7 flex flex-wrap gap-3">
                <CallToAction href={current.ctaHref || ROUTES.MENU} primary>
                  {current.ctaLabel || 'Order now'}
                </CallToAction>
                {(current.ctaHref || ROUTES.MENU) !== ROUTES.MENU && (
                  <CallToAction href={ROUTES.MENU}>View menu</CallToAction>
                )}
              </Line>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ---------------- Controls ---------------- */}
      {count > 1 && (
        <>
          <div className="absolute inset-x-0 bottom-0 z-20">
            <div className="container flex items-center gap-4 pb-5 sm:pb-7">
              <span className="font-mono text-xs tabular-nums text-white/80 sm:text-sm">
                <span className="text-white">{String(index + 1).padStart(2, '0')}</span>
                <span className="mx-1.5 text-white/40">/</span>
                {String(count).padStart(2, '0')}
              </span>

              {/* The bars are the timer: the active one's animation ending turns the page. */}
              <div className="flex flex-1 gap-1.5 sm:max-w-md" role="tablist" aria-label="Choose a slide">
                {slides.map((slide, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={slide.title ? `Slide ${i + 1}: ${slide.title}` : `Slide ${i + 1}`}
                    onClick={() => goTo(i)}
                    className="group relative h-6 flex-1"
                  >
                    <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-colors group-hover:bg-white/40">
                      {i < index && <span className="absolute inset-0 bg-white/70" />}
                      {i === index && (
                        <motion.span
                          className="absolute inset-0 origin-left bg-gold"
                          style={autoplayOn ? { scaleX: progress } : undefined}
                        />
                      )}
                    </span>
                  </button>
                ))}
              </div>

              {autoplayOn && (
                <button
                  type="button"
                  onClick={() => setUserPaused((p) => !p)}
                  aria-label={isUserPaused ? 'Play slideshow' : 'Pause slideshow'}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/25 text-white/80 backdrop-blur transition-colors hover:border-gold hover:text-gold"
                >
                  {isUserPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </button>
              )}

              {/* Arrows live in the control bar, never over the words. */}
              <div className="ml-auto hidden gap-2 sm:flex">
                <ArrowButton label="Previous slide" onClick={() => go(-1)}>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </ArrowButton>
                <ArrowButton label="Next slide" onClick={() => go(1)}>
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </ArrowButton>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Line({ as = 'p', className, children }) {
  const Component = motion[as] ?? motion.p;
  return (
    <Component
      variants={{
        hidden: { opacity: 0, y: 22, filter: 'blur(6px)' },
        shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: EASE } },
      }}
      className={className}
    >
      {children}
    </Component>
  );
}

function CallToAction({ href, primary = false, children }) {
  const className = cn(
    'inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold transition-all',
    primary
      ? 'bg-gold-gradient text-gold-foreground shadow-gold hover:brightness-110'
      : 'border border-white/40 text-white backdrop-blur hover:border-gold hover:text-gold',
  );
  const content = (
    <>
      {children}
      {primary && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </>
  );
  return isInternalHref(href) ? (
    <Link to={href} className={className}>
      {content}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {content}
    </a>
  );
}

function ArrowButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-12 w-12 place-items-center rounded-full border border-white/25 bg-black/25 text-white backdrop-blur-md transition-all hover:scale-105 hover:border-gold hover:text-gold"
    >
      {children}
    </button>
  );
}

export default HeroCarousel;
