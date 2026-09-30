import { forwardRef, useRef } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils.js';

/**
 * A search box with an icon and a clear button.
 * ---------------------------------------------------------------------------
 * The same twenty lines of markup appeared on nine screens. They had already
 * drifted: some had a clear button, some did not; two used `type="text"`, which
 * loses the browser's own clear affordance and the search-history dropdown.
 *
 * Escape clears. Every search box in the application now behaves the same way,
 * which is the entire reason to have one component rather than nine copies.
 */
export const SearchInput = forwardRef(function SearchInput(
  {
    value,
    onChange,
    onClear,
    placeholder = 'Search…',
    label = 'Search',
    className,
    inputClassName,
    size = 'md',
    // Destructured out of the rest, so composing it below cannot be undone by
    // the spread further down.
    onKeyDown,
    ...props
  },
  forwardedRef,
) {
  const innerRef = useRef(null);
  const ref = forwardedRef ?? innerRef;

  const SIZES = {
    sm: 'h-9 pl-9 pr-8 text-sm',
    md: 'h-10 pl-9 pr-9 text-sm',
    lg: 'h-12 pl-12 pr-11 text-base',
  };

  function clear() {
    onClear ? onClear() : onChange?.({ target: { value: '' } });
    // Focus returns to the box: someone who clears a search is about to type
    // another one, and making them click again is a small daily annoyance.
    ref.current?.focus?.();
  }

  return (
    <div className={cn('relative', className)}>
      <Search
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground',
          size === 'lg' ? 'left-4 h-5 w-5' : 'left-3 h-4 w-4',
        )}
        aria-hidden="true"
      />

      <input
        ref={ref}
        // `type="search"` gives the browser's own clear control and search
        // history for free — `text` silently gives both up.
        type="search"
        value={value}
        onChange={onChange}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            clear();
          }
          // The caller's handler still runs — this composes, it does not replace.
          onKeyDown?.(event);
        }}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          'w-full rounded-lg border border-border-strong bg-surface transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60',
          SIZES[size],
          size === 'lg' && 'rounded-xl',
          inputClassName,
        )}
        {...props}
      />

      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className={cn(
            'absolute top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground',
            size === 'lg' ? 'right-3' : 'right-2',
          )}
        >
          <X className={size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

export default SearchInput;
