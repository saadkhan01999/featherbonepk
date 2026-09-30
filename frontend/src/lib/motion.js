/**
 * Framer Motion presets.
 * ---------------------------------------------------------------------------
 * Animation is defined once here and reused, so every modal in the suite opens
 * the same way and the whole product feels like one piece of software.
 *
 * The brief asks for "tasteful and smooth, not over-animated". In practice that
 * means: short durations (150–350ms), small distances (8–16px), and motion that
 * only ever supports a state change — never decoration for its own sake.
 */

/** House easing: quick departure, soft arrival. Matches `ease-smooth` in Tailwind. */
export const EASE = [0.32, 0.72, 0, 1];

/** Durations in seconds, named by intent rather than number. */
export const DURATION = Object.freeze({
  instant: 0.12, // hover/press feedback
  fast: 0.2, // dropdowns, tooltips
  normal: 0.3, // modals, drawers
  slow: 0.45, // page and hero transitions
});

/** Simple fade — the safe default when in doubt. */
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.fast, ease: EASE },
};

/** Rise-and-fade for cards and sections entering the viewport. */
export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: DURATION.normal, ease: EASE },
};

/**
 * Modal content. Scales from 96% — enough to read as "arriving", small enough
 * that it still feels anchored to the page rather than flying in from off-screen.
 */
export const modalContent = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 4 },
  transition: { duration: DURATION.normal, ease: EASE },
};

/** Backdrop behind modals and drawers. */
export const backdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.fast },
};

/** Side drawer (cart, mobile nav, filters). */
export const drawerRight = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
  transition: { duration: DURATION.normal, ease: EASE },
};

export const drawerLeft = {
  initial: { x: '-100%' },
  animate: { x: 0 },
  exit: { x: '-100%' },
  transition: { duration: DURATION.normal, ease: EASE },
};

/** Dropdown/popover — originates from its trigger edge. */
export const dropdown = {
  initial: { opacity: 0, scale: 0.96, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -4 },
  transition: { duration: DURATION.fast, ease: EASE },
};

/** Route transition — subtle, because it runs on every navigation. */
export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.normal, ease: EASE },
};

/**
 * Staggered list container. Pair with `staggerItem` on children so a grid of
 * cards resolves in sequence instead of all at once.
 *
 * `staggerChildren` is kept small (0.04s): with 12 menu cards a 0.1s stagger
 * would take 1.2s to finish, which reads as slow loading rather than polish.
 */
export const staggerContainer = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.normal, ease: EASE } },
};

/**
 * Scroll-reveal props for a section.
 * `once: true` — re-animating on every scroll-past is distracting and makes
 * long pages feel unstable. `margin` starts the animation slightly before the
 * element is fully visible so it never appears to "pop in" late.
 */
export const revealOnScroll = {
  initial: 'initial',
  whileInView: 'animate',
  viewport: { once: true, margin: '-60px' },
  variants: fadeUp,
};

/** Press feedback for buttons and tappable cards. */
export const tapScale = {
  whileTap: { scale: 0.97 },
  transition: { duration: DURATION.instant },
};

/**
 * Does the visitor prefer reduced motion?
 *
 * CSS handles most of this (see index.css), but Framer Motion animates inline
 * styles that CSS media queries cannot reach — so JS-driven motion has to check
 * explicitly. Components pass `transition={prefersReducedMotion() ? { duration: 0 } : ...}`.
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
