import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils.js';

/**
 * Loading indicators.
 * ---------------------------------------------------------------------------
 * `role="status"` + a visually-hidden label means assistive technology
 * announces that work is in progress. A bare spinning icon is silent to a
 * screen reader — the user simply gets nothing until the content appears.
 */

const SIZES = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

export function Spinner({ size = 'md', className, label = 'Loading' }) {
  return (
    <span role="status" className="inline-flex items-center justify-center">
      <Loader2
        className={cn('animate-spin text-gold', SIZES[size] ?? SIZES.md, className)}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Full-page loader — the Suspense fallback for lazily-loaded routes.
 * Sized to the viewport so a route swap doesn't collapse the page height and
 * bounce the scroll position.
 */
export function PageLoader({ label = 'Loading page' }) {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3">
      <Spinner size="xl" label={label} />
      <p className="text-sm text-muted-foreground">{label}…</p>
    </div>
  );
}

/** Inline loader for a panel or table body that is refreshing. */
export function SectionLoader({ label = 'Loading', className }) {
  return (
    <div className={cn('flex w-full items-center justify-center gap-3 py-12', className)}>
      <Spinner size="md" label={label} />
      <span className="text-sm text-muted-foreground">{label}…</span>
    </div>
  );
}

export default Spinner;
