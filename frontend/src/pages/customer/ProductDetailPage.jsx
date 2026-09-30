import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Star,
  Minus,
  Plus,
  Heart,
  ImageOff,
  ChevronRight,
  AlertCircle,
  ShoppingBag,
  Barcode,
  Package,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { ProductCard } from '@/components/customer/ProductCard.jsx';
import { catalogApi, useResource } from '@/features/catalog/catalog.api.js';
import { useCart } from '@/features/cart/cartContext.jsx';
import { useWishlist } from '@/features/wishlist/wishlistContext.jsx';
import { apiClient } from '@/services/apiClient.js';
import { formatCurrency, formatRelativeTime } from '@/lib/format.js';
import { ROUTES, categoryPath } from '@/constants/routes.js';
import { fadeUp } from '@/lib/motion.js';
import { getInitials, cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';
import { Seo } from '@/components/seo/Seo.jsx';
import { config } from '@/config/env.js';

/**
 * Product detail.
 * ---------------------------------------------------------------------------
 * Every ProductCard in the storefront links here, so this page is the
 * destination for the most-clicked element in the app.
 *
 * It is also where reviews surface. Ratings are collected on the order
 * confirmation page and moderated in the back office; without this page there
 * would be nowhere for an approved review to actually be read.
 */

/** Five stars filled to `value`. */
function Stars({ value, className = 'h-4 w-4' }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden="true"
          className={cn(className, star <= Math.round(value) ? 'fill-gold text-gold' : 'text-border-strong')}
        />
      ))}
    </span>
  );
}

export function ProductDetailPage() {
  const { slug } = useParams();
  const { addItem } = useCart();
  const { isSaved, toggle } = useWishlist();

  const [quantity, setQuantity] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const [added, setAdded] = useState(false);

  const { data: product, isLoading, error } = useResource(() => catalogApi.product(slug), [slug]);

  // Reviews load independently: a slow or failing review query must never stop
  // someone being able to see the dish and add it to their cart.
  const { data: reviews } = useResource(
    () => (product?.id ? apiClient.get(`/reviews/product/${product.id}`) : Promise.resolve(null)),
    [product?.id],
  );

  // "More from this category" — the cheapest useful recommendation there is,
  // and it needs no extra backend work.
  const { data: related } = useResource(
    () =>
      product?.category?.slug
        ? catalogApi.products({ category: product.category.slug, limit: 5 })
        : Promise.resolve(null),
    [product?.category?.slug],
  );

  const relatedItems = useMemo(
    () => (related?.data ?? []).filter((p) => p.id !== product?.id).slice(0, 4),
    [related, product?.id],
  );

  if (isLoading) return <SectionLoader label="Loading this dish" />;

  if (error) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
        <h1 className="text-xl font-semibold">We couldn&apos;t find that item</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{error.message}</p>
        <Link to={ROUTES.MENU}>
          <Button className="mt-2">Back to the menu</Button>
        </Link>
      </div>
    );
  }

  const isOut = product.stockStatus === 'out_of_stock';
  const hasDiscount = product.discountPercent > 0;
  // Weighed goods are sold in half-kilos; countable items in whole units.
  const step = product.isWeighed ? 0.5 : 1;

  function changeQuantity(delta) {
    // Rounded to one decimal — 0.1 + 0.2 is 0.30000000000000004 in binary
    // floating point, and that number must never reach a price calculation.
    setQuantity((current) => Math.max(step, Math.round((current + delta) * 10) / 10));
  }

  function handleAdd() {
    addItem(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <div className="container py-8">
      {/*
        Product structured data — this is what puts "Rs 850 · In stock" under the
        search result instead of a bare blue link. Only emitted for a product
        that actually loaded, so a 404 never claims to be a purchasable item.
      */}
      <Seo
        title={product.name}
        description={
          product.shortDescription ??
          product.description?.slice(0, 155) ??
          `${product.name} — fresh from ${config.brand.name}.`
        }
        image={product.image}
        schema={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          description: product.description ?? product.shortDescription ?? undefined,
          sku: product.sku ?? undefined,
          category: product.category?.name ?? undefined,
          offers: {
            '@type': 'Offer',
            price: product.effectivePrice ?? product.price,
            priceCurrency: config.currency,
            availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          },
          ...(product.ratingCount > 0 && {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: product.rating,
              reviewCount: product.ratingCount,
            },
          }),
        }}
      />
      {/* --- Breadcrumb --- */}
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      >
        <Link to={ROUTES.HOME} className="transition-colors hover:text-gold">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link to={ROUTES.MENU} className="transition-colors hover:text-gold">
          Menu
        </Link>
        {product.category && (
          <>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <Link to={categoryPath(product.category.slug)} className="transition-colors hover:text-gold">
              {product.category.name}
            </Link>
          </>
        )}
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* --- Image --- */}
        <motion.div
          {...fadeUp}
          className="relative overflow-hidden rounded-2xl border border-border bg-surface"
        >
          <div className="aspect-square bg-surface-hover">
            {product.image && !imageFailed ? (
              <img
                src={mediaUrl(product.image)}
                alt={product.name}
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageOff className="h-12 w-12" aria-hidden="true" />
              </div>
            )}
          </div>

          <div className="absolute left-3 top-3 flex flex-col gap-1.5">
            {hasDiscount && <Badge variant="solid-destructive">{product.discountPercent}% OFF</Badge>}
            {product.isBestSeller && <Badge variant="solid">Best Seller</Badge>}
          </div>

          {isOut && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/75 text-sm font-semibold uppercase tracking-wide text-destructive">
              Out of stock
            </span>
          )}
        </motion.div>

        {/* --- Details --- */}
        <motion.div {...fadeUp} className="flex flex-col">
          {product.category && (
            <span className="text-xs uppercase tracking-wider text-gold">{product.category.name}</span>
          )}
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{product.name}</h1>

          {product.ratingCount > 0 && (
            <a
              href="#reviews"
              className="mt-2 flex items-center gap-2 text-sm transition-opacity hover:opacity-80"
            >
              <Stars value={product.ratingAverage} />
              <span className="font-medium">{product.ratingAverage.toFixed(1)}</span>
              <span className="text-muted-foreground">
                ({product.ratingCount} review{product.ratingCount === 1 ? '' : 's'})
              </span>
            </a>
          )}

          <div className="mt-4 flex items-baseline gap-2.5">
            <span className="text-3xl font-bold tabular-nums text-gold">
              {formatCurrency(product.effectivePrice)}
            </span>
            {hasDiscount && (
              <span className="text-lg text-muted-foreground line-through tabular-nums">
                {formatCurrency(product.price)}
              </span>
            )}
            <span className="text-sm text-muted-foreground">per {product.unitLabel}</span>
          </div>

          {product.description && (
            <p className="mt-4 leading-relaxed text-muted-foreground">{product.description}</p>
          )}

          {/* --- Stock --- */}
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            {isOut ? (
              <Badge variant="destructive" icon={Package}>
                Out of stock
              </Badge>
            ) : product.stockStatus === 'low' ? (
              <Badge variant="warning" icon={Package}>
                Only {product.stock} left
              </Badge>
            ) : (
              <Badge variant="success" icon={Package}>
                In stock
              </Badge>
            )}
            {product.sku && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Barcode className="h-3.5 w-3.5" aria-hidden="true" />
                {product.sku}
              </span>
            )}
          </div>

          {/* --- Quantity + add --- */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-lg border border-border-strong">
              <button
                type="button"
                onClick={() => changeQuantity(-step)}
                disabled={quantity <= step || isOut}
                aria-label="Decrease quantity"
                className="flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:text-gold disabled:opacity-40"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="w-16 text-center font-semibold tabular-nums" aria-live="polite">
                {quantity}
                {product.isWeighed && <span className="ml-0.5 text-xs text-muted-foreground">kg</span>}
              </span>
              <button
                type="button"
                onClick={() => changeQuantity(step)}
                disabled={isOut}
                aria-label="Increase quantity"
                className="flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:text-gold disabled:opacity-40"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <Button
              size="lg"
              className="flex-1 sm:flex-none"
              leftIcon={ShoppingBag}
              onClick={handleAdd}
              disabled={isOut}
            >
              {added ? 'Added to cart' : 'Add to Cart'}
            </Button>

            <Button
              size="lg"
              variant="outline"
              aria-label={isSaved(product.id) ? 'Remove from wishlist' : 'Save for later'}
              aria-pressed={isSaved(product.id)}
              onClick={() => toggle(product)}
            >
              <Heart
                className={cn('h-4 w-4', isSaved(product.id) && 'fill-gold text-gold')}
                aria-hidden="true"
              />
            </Button>
          </div>

          {/* The line total, so nobody has to do the arithmetic themselves —
              especially for weighed items where the sum is not obvious. */}
          {!isOut && quantity > step && (
            <p className="mt-3 text-sm text-muted-foreground">
              {quantity} × {formatCurrency(product.effectivePrice)} ={' '}
              <span className="font-semibold text-foreground">
                {formatCurrency(Math.round(quantity * product.effectivePrice))}
              </span>
            </p>
          )}
        </motion.div>
      </div>

      {/* --- Reviews --- */}
      <section id="reviews" className="mt-14 scroll-mt-24">
        <h2 className="text-xl font-bold tracking-tight">Customer Reviews</h2>

        {!reviews?.items?.length ? (
          <p className="mt-3 rounded-2xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted-foreground">
            No reviews yet. Order this dish and you&apos;ll be able to rate it once it arrives.
          </p>
        ) : (
          <div className="mt-4 grid gap-6 lg:grid-cols-[240px_1fr]">
            {/* Summary + distribution */}
            <div className="rounded-2xl border border-border bg-surface p-5 text-center lg:text-left">
              <p className="text-4xl font-bold tabular-nums text-gold">{product.ratingAverage.toFixed(1)}</p>
              <div className="mt-1.5 flex justify-center lg:justify-start">
                <Stars value={product.ratingAverage} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                from {product.ratingCount} review{product.ratingCount === 1 ? '' : 's'}
              </p>

              <ul className="mt-4 space-y-1.5">
                {reviews.breakdown.map((row) => (
                  <li key={row.stars} className="flex items-center gap-2 text-xs">
                    <span className="w-3 tabular-nums text-muted-foreground">{row.stars}</span>
                    <Star className="h-3 w-3 fill-gold text-gold" aria-hidden="true" />
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <span
                        className="block h-full rounded-full bg-gold"
                        style={{ width: `${reviews.total ? (row.count / reviews.total) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="w-5 text-right tabular-nums text-muted-foreground">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Individual reviews */}
            <ul className="space-y-3">
              {reviews.items.map((review) => (
                <li
                  key={review._id ?? review.createdAt}
                  className="rounded-2xl border border-border bg-surface p-4"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xs font-semibold text-gold"
                    >
                      {getInitials(review.customerName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="text-sm font-semibold">{review.customerName}</span>
                        <Stars value={review.rating} className="h-3.5 w-3.5" />
                        {/* Every review on this page is tied to a real order —
                            the API refuses any that are not. */}
                        <Badge variant="success" size="sm">
                          Verified order
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatRelativeTime(review.createdAt)}</p>
                      {review.comment && (
                        <p className="mt-2 text-sm leading-relaxed text-foreground/90">{review.comment}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* --- Related --- */}
      {relatedItems.length > 0 && (
        <section className="mt-14">
          <h2 className="text-xl font-bold tracking-tight">More from {product.category?.name}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {relatedItems.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                onAddToCart={(p) => addItem(p, 1)}
                isWishlisted={isSaved(item.id)}
                onToggleWishlist={toggle}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default ProductDetailPage;
