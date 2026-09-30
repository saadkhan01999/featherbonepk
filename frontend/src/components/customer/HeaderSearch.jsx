import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Loader2 } from 'lucide-react';

import { apiClient } from '@/services/apiClient.js';
import { ROUTES } from '@/constants/routes.js';
import { formatCurrency } from '@/lib/format.js';
import { mediaUrl } from '@/lib/media.js';
import { cn } from '@/lib/utils.js';

/**
 * The storefront's search box.
 * ---------------------------------------------------------------------------
 * This was a `<Link>` styled to look like an input — it could not be typed
 * into, and it pointed at a route that did not exist. Two lies in one control.
 *
 * Now it searches as you type and shows the top matches, with Enter going to
 * the full results page. Suggestions are the point: someone looking for naan
 * wants the item, not a page listing it.
 *
 * Keyboard first. Up/Down move through the suggestions, Enter opens the
 * highlighted one (or runs the full search when nothing is highlighted), and
 * Escape closes without navigating. A search box that only works with a mouse
 * is broken for the people who use it most.
 */

const DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 6;

export function HeaderSearch({ className }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const boxRef = useRef(null);
  const inputRef = useRef(null);

  // --- Fetch, debounced --------------------------------------------------
  useEffect(() => {
    const trimmed = term.trim();

    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      apiClient
        .get('/catalog/products', { params: { search: trimmed, limit: MAX_SUGGESTIONS } })
        .then((data) => {
          if (cancelled) return;
          setResults(data ?? []);
          setHighlighted(-1);
        })
        .catch(() => {
          // A failed suggestion lookup must not interrupt browsing. Enter still
          // works, and the results page reports properly.
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  // --- Close when clicking away ------------------------------------------
  useEffect(() => {
    if (!isOpen) return undefined;

    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  function goToResults() {
    const trimmed = term.trim();
    if (!trimmed) return;
    setOpen(false);
    navigate(`${ROUTES.SEARCH}?q=${encodeURIComponent(trimmed)}`);
  }

  function openProduct(product) {
    setOpen(false);
    setTerm('');
    navigate(`/product/${product.slug}`);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Prevent the caret jumping to either end of the text while navigating.
      event.preventDefault();
      if (results.length === 0) return;

      setHighlighted((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        // Wrap, so holding a key never dead-ends.
        if (next >= results.length) return 0;
        if (next < 0) return results.length - 1;
        return next;
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted >= 0 && results[highlighted]) openProduct(results[highlighted]);
      else goToResults();
    }
  }

  const showPanel = isOpen && term.trim().length >= 2;

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          goToResults();
        }}
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search for items…"
          aria-label="Search the menu"
          aria-expanded={showPanel}
          aria-controls="header-search-results"
          className="h-9 w-full rounded-lg border border-border-strong bg-surface pl-9 pr-8 text-sm transition-colors hover:border-gold/50 focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60"
        />

        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </form>

      {showPanel && (
        <div
          id="header-search-results"
          className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-elevated"
        >
          {isLoading && results.length === 0 && (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Searching…
            </p>
          )}

          {!isLoading && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Nothing matches &ldquo;{term.trim()}&rdquo;
            </p>
          )}

          {results.length > 0 && (
            <ul role="listbox" aria-label="Search suggestions">
              {results.map((product, index) => (
                <li key={product.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onClick={() => openProduct(product)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                      index === highlighted ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                    )}
                  >
                    <img
                      src={mediaUrl(product.image)}
                      alt=""
                      loading="lazy"
                      className="h-9 w-9 shrink-0 rounded-lg object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{product.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {product.category?.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-gold">
                      {formatCurrency(product.effectivePrice ?? product.price)}
                    </span>
                  </button>
                </li>
              ))}

              <li className="border-t border-border">
                <button
                  type="button"
                  onClick={goToResults}
                  className="w-full px-4 py-2.5 text-left text-sm font-medium text-gold hover:bg-surface-hover"
                >
                  See all results for &ldquo;{term.trim()}&rdquo;
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default HeaderSearch;
