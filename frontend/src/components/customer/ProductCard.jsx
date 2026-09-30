import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Plus, ImageOff, Star } from 'lucide-react';

import { Badge } from '@/components/ui/Badge.jsx';
import { formatCurrency } from '@/lib/format.js';
import { productPath } from '@/constants/routes.js';
import { cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';

/**
 * Menu item card.
 * ---------------------------------------------------------------------------
 * The storefront's most-repeated component — used on the home rails, the menu
 * grid and search results — so it is built once and reused rather than
 * re-styled per screen.
 *
 * The whole card links to the product, but Add-to-Cart and Wishlist are real
 * buttons layered above it. They call stopPropagation/preventDefault so tapping
 * "Add" doesn't also navigate away from the grid — losing your place in a long
 * menu is the fastest way to make a shopper give up.
 */
export function ProductCard({ product, onAddToCart, onToggleWishlist, isWishlisted = false }) {
  const [imageFailed, setImageFailed] = useState(false);

  const isOut = product.stockStatus === 'out_of_stock';
  const hasDiscount = product.discountPercent > 0;

  function handleAdd(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!isOut) onAddToCart?.(product);
  }

  function handleWishlist(event) {
    event.preventDefault();
    event.stopPropagation();
    onToggleWishlist?.(product);
  }

  return (
    <Link
      to={productPath(product.slug)}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface',
        // The card lifts slightly and the border warms; the image does the
        // zooming (below). Scaling the whole card would blur its text and
        // nudge its neighbours in the grid.
        'transition-all duration-300 ease-smooth hover:-translate-y-1 hover:border-gold/50 hover:shadow-elevated',
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-hover">
        {product.image && !imageFailed ? (
          <img
            src={mediaUrl(product.image)}
            alt={product.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
            // 700ms rather than 500: a slower swell reads as deliberate on a
            // large food photo, where a quick zoom looks like a glitch.
            className="h-full w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-7 w-7" aria-hidden="true" />
          </div>
        )}

        {/* Badges. Discount wins the top-left slot; best-seller falls back to it
            so the two never overlap. */}
        <div className="absolute left-2.5 top-2.5 flex flex-col gap-1.5">
          {hasDiscount && (
            <Badge variant="solid-destructive" size="sm">
              {product.discountPercent}% OFF
            </Badge>
          )}
          {product.isBestSeller && !hasDiscount && (
            <Badge variant="solid" size="sm">
              Best Seller
            </Badge>
          )}
        </div>

        <button
          type="button"
          onClick={handleWishlist}
          aria-label={isWishlisted ? `Remove ${product.name} from wishlist` : `Save ${product.name}`}
          aria-pressed={isWishlisted}
          className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 backdrop-blur transition-colors hover:bg-background"
        >
          <Heart
            className={cn('h-4 w-4', isWishlisted ? 'fill-gold text-gold' : 'text-muted-foreground')}
            aria-hidden="true"
          />
        </button>

        {isOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs font-semibold uppercase tracking-wide text-destructive">
            Out of stock
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-sm font-semibold">{product.name}</h3>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{product.category?.name}</span>

            {/* Only shown once the dish has been rated. A permanent "0.0 ★" on
                a new item reads as a bad score rather than no data. */}
            {product.ratingCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <Star className="h-3 w-3 fill-gold text-gold" aria-hidden="true" />
                  <span className="tabular-nums text-foreground">{product.ratingAverage.toFixed(1)}</span>
                  <span className="sr-only">out of 5, from {product.ratingCount} reviews</span>
                  <span aria-hidden="true">({product.ratingCount})</span>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold tabular-nums text-gold">
                {formatCurrency(product.effectivePrice)}
              </span>
              {/* Struck-through original price only when there is a discount —
                  showing it always would be misleading. */}
              {hasDiscount && (
                <span className="text-xs text-muted-foreground line-through tabular-nums">
                  {formatCurrency(product.price)}
                </span>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">per {product.unitLabel}</span>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={isOut}
            aria-label={`Add ${product.name} to cart`}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all',
              isOut
                ? 'cursor-not-allowed bg-surface-hover text-muted-foreground'
                : 'bg-gold-gradient text-gold-foreground hover:shadow-gold active:scale-95',
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </button>
        </div>
      </div>
    </Link>
  );
}

/** Matching skeleton — same dimensions, so the grid doesn't jump when data lands. */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="fb-shimmer aspect-[4/3]" />
      <div className="space-y-2 p-3.5">
        <div className="fb-shimmer h-4 w-3/4 rounded" />
        <div className="fb-shimmer h-3 w-1/3 rounded" />
        <div className="fb-shimmer h-5 w-1/2 rounded" />
      </div>
    </div>
  );
}

export default ProductCard;
