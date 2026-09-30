import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart, ShoppingBag, Trash2, LogIn } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { ConfirmDialog } from '@/components/ui/Modal.jsx';
import { ProductCard } from '@/components/customer/ProductCard.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useWishlist } from '@/features/wishlist/wishlistContext.jsx';
import { useCart } from '@/features/cart/cartContext.jsx';
import { ROUTES } from '@/constants/routes.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { Seo } from '@/components/seo/Seo.jsx';

/**
 * Saved items.
 * ---------------------------------------------------------------------------
 * Prices and stock come from the current catalogue, not from whatever they were
 * when the item was saved — a wishlist showing a stale price would change under
 * the customer the moment they add it to the cart.
 */
export function WishlistPage() {
  const { isAuthenticated } = useAuth();
  const { remove, clear, count } = useWishlist();
  const { addItem } = useCart();
  const [isClearing, setClearing] = useState(false);

  const { data, isLoading, error, reload } = useResource(
    () => (isAuthenticated ? apiClient.get('/wishlist') : Promise.resolve({ items: [] })),
    [isAuthenticated, count],
  );

  const handleRemove = useCallback(
    async (product) => {
      await remove(product.id);
      reload();
    },
    [remove, reload],
  );

  const handleClear = useCallback(async () => {
    /*
     * `finally`, so a failed clear still closes the dialog.
     *
     * Written as three plain statements, a rejection from `clear()` skipped
     * both lines below it: the dialog kept spinning with no error and no way
     * out, and the only recourse was reloading the page.
     */
    try {
      await clear();
      reload();
    } finally {
      setClearing(false);
    }
  }, [clear, reload]);

  // --- Signed out ---------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-3 py-12 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/10">
          <Heart className="h-8 w-8 text-gold" aria-hidden="true" />
        </span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Your wishlist</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Sign in to save dishes and find them again on any device.
        </p>
        <div className="mt-3 flex gap-3">
          <Link to={ROUTES.LOGIN}>
            <Button leftIcon={LogIn}>Sign In</Button>
          </Link>
          <Link to={ROUTES.MENU}>
            <Button variant="outline">Browse the menu</Button>
          </Link>
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="container py-10">
      <Seo title="Your Wishlist" noindex />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Wishlist</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length === 0
              ? 'Nothing saved yet.'
              : `${items.length} dish${items.length === 1 ? '' : 'es'} saved.`}
          </p>
        </div>

        {items.length > 0 && (
          <Button
            variant="ghost"
            leftIcon={Trash2}
            onClick={() => setClearing(true)}
            className="text-destructive hover:bg-destructive/10"
          >
            Clear all
          </Button>
        )}
      </header>

      {isLoading ? (
        <SectionLoader label="Loading your saves" />
      ) : error ? (
        <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-border bg-surface py-20 text-center">
          <Heart className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-medium">Nothing saved yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap the heart on any dish to keep it here for later.
          </p>
          <Link to={ROUTES.MENU} className="mt-5 inline-block">
            <Button leftIcon={ShoppingBag}>Browse the menu</Button>
          </Link>
        </div>
      ) : (
        <motion.div
          {...staggerContainer}
          className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {items.map((product) => (
            <motion.div key={product.id} {...staggerItem}>
              <ProductCard
                product={product}
                onAddToCart={(p) => addItem(p, 1)}
                // On this page the heart always means "remove" — the item is
                // here because it is saved.
                isWishlisted
                onToggleWishlist={handleRemove}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      <ConfirmDialog
        isOpen={isClearing}
        onClose={() => setClearing(false)}
        onConfirm={handleClear}
        title="Clear your wishlist?"
        message="Every saved dish will be removed. You can always save them again."
        confirmLabel="Clear it"
        cancelLabel="Keep them"
      />
    </div>
  );
}

export default WishlistPage;
