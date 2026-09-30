import { useState } from 'react';
import { Star } from 'lucide-react';

import { cn } from '@/lib/utils.js';

export const RATING_WORDS = ['', 'Poor', 'Could be better', 'Good', 'Very good', 'Excellent'];
const WORDS = RATING_WORDS;

/**
 * Stars — to show a score, or to choose one.
 *
 * Choosing is a proper radio group: arrow keys move, each star is announced
 * ("4 stars, Very good"), and the word for the hovered or chosen score is shown
 * beside it, so a customer knows what three stars will say.
 */
export function StarRating({
  value = 0,
  onChange,
  size = 'md',
  showWord = false,
  label = 'Rating',
  className,
}) {
  const [hover, setHover] = useState(0);
  const interactive = typeof onChange === 'function';
  const shown = hover || value;
  const dimension =
    { sm: 'h-3.5 w-3.5', md: 'h-5 w-5', lg: 'h-9 w-9', xl: 'h-11 w-11 sm:h-14 sm:w-14' }[size] ?? 'h-5 w-5';

  if (!interactive) {
    return (
      <span
        className={cn('inline-flex items-center gap-0.5', className)}
        aria-label={`${value} out of 5 stars`}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={cn(
              dimension,
              n <= Math.round(value) ? 'fill-gold text-gold' : 'text-muted-foreground/40',
            )}
            aria-hidden="true"
          />
        ))}
      </span>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(5, (value || 0) + 1));
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(1, (value || 1) - 1));
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}, ${WORDS[n]}`}
            tabIndex={value === n || (!value && n === 1) ? 0 : -1}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              className={cn(
                dimension,
                'transition-colors',
                n <= shown ? 'fill-gold text-gold' : 'text-muted-foreground/40',
              )}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      {showWord && (
        <span className={cn('text-sm font-semibold', shown ? 'text-gold' : 'text-muted-foreground')}>
          {shown ? WORDS[shown] : 'Tap a star'}
        </span>
      )}
    </div>
  );
}

export default StarRating;
