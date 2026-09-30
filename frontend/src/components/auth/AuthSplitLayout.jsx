import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';

import { config } from '@/config/env.js';
import { modalContent } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * Split-screen shell for the staff and till sign-in pages.
 * ---------------------------------------------------------------------------
 * Form on the left, an explanation of what lies behind the door on the right.
 *
 * Why the right-hand panel earns its space. These two pages are reached by
 * people who were handed a URL and a password, often with no idea what the
 * system does. A bare form tells them nothing and gives a wrong-door visitor no
 * clue they are in the wrong place. Listing the capabilities makes both obvious
 * before anyone types anything.
 *
 * It is decoration, not a menu: nothing on the right is clickable, because
 * clicking it before signing in could only ever bounce you back here.
 *
 * One component, two pages. The staff portal and the POS want the same
 * structure with different words and a different accent, so the layout lives
 * here and each page supplies its own content. Written twice, the two would
 * have drifted within a week.
 *
 * Responsive: below `lg` the right panel is hidden entirely rather than stacked
 * beneath the form. A cashier opening the till on a phone wants the password
 * box, not a marketing panel to scroll past — and on a shop-floor tablet in
 * portrait, a stacked panel pushes the button below the fold.
 */

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.children The form.
 * @param {string} props.eyebrow Small label above the brand ("Staff Portal").
 * @param {string} props.title Panel heading.
 * @param {string} props.blurb One line under the heading.
 * @param {Array<{icon: import('react').ElementType, title: string, body: string}>} props.features
 * @param {string} [props.footnote] Quiet line at the bottom of the panel.
 */
export function AuthSplitLayout({ children, eyebrow, title, blurb, features = [], footnote }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ---------------- Left: the form ---------------- */}
      <div className="relative flex items-center justify-center overflow-hidden bg-background p-4 sm:p-8">
        {/*
          `hsl(var(--gold)/0.08)`, not `theme(colors.gold/8%)`.

          Colours in this project are stored as bare HSL channels ("41 95% 53%")
          so Tailwind can apply opacity modifiers like `bg-gold/20`. That format
          is not a colour `theme()` can resolve inside an arbitrary value, so the
          utility was rejected at build time — Tailwind printed a warning and
          simply did not generate the class, leaving the panel flat with nothing
          on screen to say why. Referencing the variable directly works because
          `hsl()` receives exactly the channels it expects.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--gold)/0.08),transparent_60%)]"
        />

        <motion.div {...modalContent} className="relative w-full max-w-sm">
          <div className="mb-7 flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold-gradient shadow-gold">
              <Flame className="h-6 w-6 text-gold-foreground" aria-hidden="true" />
            </span>
            <h1 className="mt-3.5 text-xl font-bold tracking-tight">{config.brand.name}</h1>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-gold">{eyebrow}</p>
          </div>

          {children}
        </motion.div>
      </div>

      {/* ---------------- Right: what this door opens ----------------
          `hidden lg:flex` — see the note above on why it disappears rather
          than stacking. */}
      <aside className="relative hidden overflow-hidden border-l border-border bg-surface lg:flex lg:flex-col lg:justify-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-1/4 h-[420px] w-[420px] rounded-full bg-gold/10 blur-[120px]"
        />

        <div className="relative px-12 py-14 xl:px-16">
          <h2 className="text-2xl font-bold tracking-tight xl:text-3xl">{title}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{blurb}</p>

          <ul className="mt-9 space-y-5">
            {features.map(({ icon: Icon, title: featureTitle, body }) => (
              <li key={featureTitle} className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/25 bg-gold/10">
                  <Icon className="h-4 w-4 text-gold" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{featureTitle}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          {footnote && (
            <p className={cn('mt-10 max-w-md border-t border-border pt-5 text-xs text-muted-foreground')}>
              {footnote}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

export default AuthSplitLayout;
