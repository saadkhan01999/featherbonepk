import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X, SearchX } from 'lucide-react';

import { ProductCard } from '@/components/customer/ProductCard.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useCart } from '@/features/cart/cartContext.jsx';
import { useWishlist } from '@/features/wishlist/wishlistContext.jsx';
import { ROUTES } from '@/constants/routes.js';
import { Seo } from '@/components/seo/Seo.jsx';

/**
 * Search results.
 * ---------------------------------------------------------------------------
 * The header has linked here since the storefront was built; the route did not
 * exist, so the magnifying glass led to the catch-all. This is that page.
 *
 * The query lives in the URL, not in component state. A search someone wants to
 * send to a friend, bookmark, or reach with the back button has to survive
 * leaving the page — and `?q=chicken` costs nothing to support while local
 * state cannot do any of it.
 *
 * Typing is debounced before it reaches either the URL or the API. Without it
 * every keystroke is a database query and a history entry, so "chicken" means
 * seven requests and seven presses of Back to escape.
 */

const DEBOUNCE_MS = 350;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';

  // Local input state so typing stays instant; the URL follows behind.
  const [term, setTerm] = useState(query);
  const [results, setResults] = useState(null);
  const [isSearching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const { addItem } = useCart();
  const { isSaved, toggle } = useWishlist();

  // Focus on arrival — someone who clicked "Search" intends to type.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the URL in step with the box, after a pause.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === query) return undefined;

    const timer = setTimeout(() => {
      // `replace` so a long word does not bury the previous page under one
      // history entry per character.
      setParams(trimmed ? { q: trimmed } : {}, { replace: true });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, query, setParams]);

  // Run the search whenever the URL's query changes — including on first load
  // and on back/forward, which is the reason the URL drives this and not state.
  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults(null);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);

    apiClient
      .get('/catalog/products', { params: { search: trimmed, limit: 48 } })
      .then((data) => {
        if (!cancelled) setResults(data ?? []);
      })
      .catch(() => {
        // An empty result and a failed request look the same to the visitor;
        // neither is worth a red banner on a search box.
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const heading = useMemo(() => {
    if (!query.trim()) return 'Search the menu';
    if (isSearching) return `Searching for “${query}”…`;
    const count = results?.length ?? 0;
    return count === 0
      ? `Nothing found for “${query}”`
      : `${count} result${count === 1 ? '' : 's'} for “${query}”`;
  }, [query, results, isSearching]);

  return (
    <div className="container py-8">
      <Seo title="Search" description="Search the menu." />
      <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>

      <div className="relative mt-5 max-w-xl">
        <SearchIcon
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search for chicken, naan, drinks…"
          aria-label="Search the menu"
          className="h-12 w-full rounded-xl border border-border-strong bg-surface pl-12 pr-11 text-base focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60"
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {query.trim().length > 0 && query.trim().length < 2 && (
        <p className="mt-4 text-sm text-muted-foreground">Type at least two letters.</p>
      )}

      {isSearching && <SectionLoader label="Searching" />}

      {!isSearching && results?.length === 0 && (
        <EmptyState
          className="mt-10"
          icon={SearchX}
          title="No matches"
          body="Try a shorter word, or browse the full menu."
          action={
            <Button as={Link} to={ROUTES.MENU} variant="outline">
              Browse the menu
            </Button>
          }
        />
      )}

      {!isSearching && results?.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {results.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onAddToCart={addItem}
              isWishlisted={isSaved(product.id)}
              onToggleWishlist={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default SearchPage;
