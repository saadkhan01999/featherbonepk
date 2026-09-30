import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PackageOpen, ChevronRight, Search } from 'lucide-react';

import { Badge } from '@/components/ui/Badge.jsx';
import { Button } from '@/components/ui/Button.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { formatCurrency, formatDateTime } from '@/lib/format.js';
import { ROUTES, orderPath } from '@/constants/routes.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

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

/** Grouped so "still coming" and "finished" read as different things. */
const FILTERS = [
  { key: 'active', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: '', label: 'All' },
];

const ACTIVE = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];

export function AccountOrdersPage() {
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');

  const { rows, meta, isLoading, error, goToPage } = usePagedResource(
    ({ page, limit }) => apiClient.get('/orders/mine', { params: { page, limit }, _wantEnvelope: true }),
    [],
  );

  // Filtered client-side: the page is capped at 50 and a round trip for a
  // three-way toggle is slower than the filter itself.
  const orders = useMemo(() => {
    let list = rows;

    if (filter === 'active') list = list.filter((o) => ACTIVE.includes(o.status));
    else if (filter === 'completed') {
      list = list.filter((o) => ['delivered', 'completed'].includes(o.status));
    }

    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(term) ||
          o.items?.some((i) => i.name.toLowerCase().includes(term)),
      );
    }

    return list;
  }, [rows, filter, search]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">My Orders</h2>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order number or dish…"
            aria-label="Search your orders"
            className="h-9 w-56 rounded-lg border border-border-strong bg-surface pl-9 pr-3 text-sm focus:border-gold focus:outline-none"
          />
        </div>
      </header>

      <div
        role="group"
        aria-label="Filter orders"
        className="flex rounded-lg border border-border-strong p-0.5"
      >
        {FILTERS.map((option) => (
          <button
            key={option.key || 'all'}
            type="button"
            onClick={() => setFilter(option.key)}
            aria-pressed={filter === option.key}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              filter === option.key
                ? 'bg-gold-gradient text-gold-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SectionLoader label="Loading your orders" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <PackageOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">{search || filter ? 'Nothing matches' : 'No orders yet'}</p>
          <p className="text-sm text-muted-foreground">
            {search || filter ? 'Try a different filter.' : 'Your orders will appear here.'}
          </p>
          {!search && !filter && (
            <Link to={ROUTES.MENU} className="mt-4 inline-block">
              <Button>Browse the menu</Button>
            </Link>
          )}
        </div>
      ) : (
        <motion.ul {...staggerContainer} className="space-y-2.5">
          {orders.map((order) => (
            <motion.li key={order._id ?? order.orderNumber} {...staggerItem}>
              <Link
                to={orderPath(order.orderNumber)}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-gold/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
                    <Badge variant={STATUS_VARIANT[order.status] ?? 'default'} size="sm">
                      {order.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>

                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {(order.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</p>
                </div>

                <span className="shrink-0 font-bold tabular-nums text-gold">
                  {formatCurrency(order.total)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}
      <Pagination meta={meta} onPageChange={goToPage} label="orders" filtered={orders.length} />
    </div>
  );
}

export default AccountOrdersPage;
