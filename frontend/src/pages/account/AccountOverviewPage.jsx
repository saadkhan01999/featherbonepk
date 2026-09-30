import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Heart, MapPin, Wallet, ChevronRight, PackageOpen } from 'lucide-react';

import { Badge } from '@/components/ui/Badge.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { formatCurrency, formatRelativeTime } from '@/lib/format.js';
import { ROUTES, orderPath } from '@/constants/routes.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';

/** Status colours, matching the order confirmation page. */
const STATUS_VARIANT = {
  pending: 'warning',
  confirmed: 'info',
  preparing: 'info',
  ready: 'gold',
  out_for_delivery: 'gold',
  delivered: 'success',
  completed: 'success',
  cancelled: 'destructive',
  refunded: 'default',
};

/**
 * Account overview.
 * ---------------------------------------------------------------------------
 * Counters plus the last few orders — the two things someone opens their
 * account to check.
 */
export function AccountOverviewPage() {
  const { data: summary, isLoading } = useResource(() => apiClient.get('/account/summary'), []);
  const { data: orders } = useResource(
    () => apiClient.get('/orders/mine', { params: { limit: 5 }, _wantEnvelope: true }),
    [],
  );

  const recent = orders?.data ?? [];

  if (isLoading) return <SectionLoader label="Loading your account" />;

  return (
    <div className="space-y-6">
      {/* --- Counters --- */}
      <motion.div {...staggerContainer} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Orders', value: summary?.orders ?? 0, icon: ShoppingBag, to: ROUTES.ACCOUNT_ORDERS },
          { label: 'Total spent', value: formatCurrency(summary?.totalSpent ?? 0), icon: Wallet },
          { label: 'Saved items', value: summary?.wishlist ?? 0, icon: Heart, to: ROUTES.WISHLIST },
          { label: 'Addresses', value: summary?.addresses ?? 0, icon: MapPin, to: ROUTES.ACCOUNT_ADDRESSES },
        ].map((card) => {
          const content = (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{card.label}</span>
                <card.icon className="h-4 w-4 text-gold" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums">{card.value}</p>
            </>
          );

          return (
            <motion.div key={card.label} {...staggerItem}>
              {card.to ? (
                <Link
                  to={card.to}
                  className="block rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-gold/40"
                >
                  {content}
                </Link>
              ) : (
                <div className="rounded-2xl border border-border bg-surface p-4">{content}</div>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* --- Recent orders --- */}
      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold">Recent Orders</h2>
          {recent.length > 0 && (
            <Link
              to={ROUTES.ACCOUNT_ORDERS}
              className="flex items-center gap-1 text-xs text-gold hover:underline"
            >
              View all
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="py-14 text-center">
            <PackageOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 font-medium">No orders yet</p>
            <p className="text-sm text-muted-foreground">Your first order will show up here.</p>
            <Link to={ROUTES.MENU} className="mt-4 inline-block">
              <Button>Browse the menu</Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((order) => (
              <li key={order._id ?? order.orderNumber}>
                <Link
                  to={orderPath(order.orderNumber)}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
                      <Badge variant={STATUS_VARIANT[order.status] ?? 'default'} size="sm">
                        {order.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {order.items?.length ?? 0} item{order.items?.length === 1 ? '' : 's'}
                      {' · '}
                      {formatRelativeTime(order.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-gold">
                    {formatCurrency(order.total)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default AccountOverviewPage;
