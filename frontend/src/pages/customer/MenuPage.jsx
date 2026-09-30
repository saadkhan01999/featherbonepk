import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { SlidersHorizontal, PackageX } from 'lucide-react';

import { ProductCard, ProductCardSkeleton } from '@/components/customer/ProductCard.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { catalogApi, useResource } from '@/features/catalog/catalog.api.js';
import { useCart } from '@/features/cart/cartContext.jsx';
import { useWishlist } from '@/features/wishlist/wishlistContext.jsx';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';
import { Seo } from '@/components/seo/Seo.jsx';

/**
 * Menu / catalogue.
 * ---------------------------------------------------------------------------
 * Category sidebar on the left, product grid on the right — the reference
 * layout. Serves both `/menu` and `/menu/:slug`.
 *
 * Filter state lives in the URL, not component state. That makes a filtered
 * menu shareable, bookmarkable and survivable across a refresh, and makes the
 * browser back button behave the way a shopper expects.
 */

const SORT_OPTIONS = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'name', label: 'Alphabetical' },
];

export function MenuPage() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFilterOpen, setFilterOpen] = useState(false);
  const { addItem } = useCart();
  const { isSaved, toggle } = useWishlist();

  const sort = searchParams.get('sort') ?? 'featured';
  const activeCategory = slug ?? searchParams.get('category') ?? null;

  const { data: categories } = useResource(() => catalogApi.categories(), []);
  const { data: page, isLoading } = useResource(
    () => catalogApi.products({ category: activeCategory ?? undefined, sort, limit: 24 }),
    [activeCategory, sort],
  );

  const products = page?.data ?? [];
  const total = page?.meta?.pagination?.total ?? 0;
  const activeName = categories?.find((c) => c.slug === activeCategory)?.name;

  /** Update one search param without clobbering the others. */
  function setParam(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="container py-10">
      {/* --- Page heading, per the reference design --- */}
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">Our Delicious Menu</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {activeName ?? 'Everything We Make'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Freshly prepared with premium ingredients</p>
        <div className="mx-auto mt-4 h-px w-32 fb-gold-rule" />
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* ---------------- Category sidebar ---------------- */}
        <aside
          className={cn(
            'lg:block',
            // Below `lg` the sidebar is toggled rather than always shown —
            // otherwise it pushes the grid below the fold on a phone.
            isFilterOpen ? 'block' : 'hidden',
          )}
          aria-label="Categories"
        >
          <div className="rounded-2xl border border-border bg-surface p-3 lg:sticky lg:top-24">
            <h2 className="px-2 pb-2 text-sm font-semibold">Categories</h2>
            <ul className="space-y-0.5">
              <li>
                <CategoryButton
                  isActive={!activeCategory}
                  onClick={() => {
                    setParam('category', null);
                    if (slug) window.history.pushState({}, '', '/menu');
                  }}
                >
                  All Items
                </CategoryButton>
              </li>
              {categories?.map((category) => (
                <li key={category._id}>
                  <CategoryButton
                    isActive={activeCategory === category.slug}
                    onClick={() => setParam('category', category.slug)}
                    image={category.image}
                  >
                    {category.name}
                  </CategoryButton>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* ---------------- Products ---------------- */}
        <section aria-label="Menu items">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {isLoading ? 'Loading…' : `${total} item${total === 1 ? '' : 's'}`}
            </p>

            {/*
              `flex-wrap` here as well as on the row above. The outer row wraps,
              but this cluster did not, and at 320px the Categories button, the
              "Sort By" caption and the select came to about 310px inside a
              288px column — enough to push the whole page into a horizontal
              scroll.
            */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                leftIcon={SlidersHorizontal}
                className="lg:hidden"
                onClick={() => setFilterOpen((open) => !open)}
              >
                Categories
              </Button>

              <label className="flex items-center gap-2 text-sm">
                {/*
                  `sr-only`, not `hidden`: the caption is the select's accessible
                  name, so hiding it outright would leave a screen reader
                  announcing an unlabelled combo box. This drops it from the
                  layout on small screens while keeping it in the accessibility
                  tree, and shows it again from `sm` up.
                */}
                <span className="sr-only text-muted-foreground sm:not-sr-only">Sort By</span>
                <select
                  value={sort}
                  onChange={(event) => setParam('sort', event.target.value)}
                  className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface py-20 text-center">
              <PackageX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">Nothing here yet</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                There are no items in this category right now. Try another part of the menu.
              </p>
            </div>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"
            >
              {products.map((product) => (
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
          )}
        </section>
      </div>
    </div>
  );
}

function CategoryButton({ isActive, onClick, image, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors',
        isActive
          ? 'bg-gold-gradient font-semibold text-gold-foreground'
          : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      )}
    >
      <Seo
        title="Menu"
        description="Browse the full menu — roast chicken, fresh meat, bakery and sweets. Order online for delivery."
      />
      {image ? (
        <img
          // mediaUrl: an uploaded category image is a path relative to the API,
          // which is a different origin from the site in production. Raw, it
          // 404s there while working locally behind the Vite proxy.
          src={mediaUrl(image)}
          alt=""
          className="h-7 w-7 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : (
        <span className="h-7 w-7 shrink-0 rounded-md bg-surface-hover" />
      )}
      <span className="truncate">{children}</span>
    </button>
  );
}

export default MenuPage;
