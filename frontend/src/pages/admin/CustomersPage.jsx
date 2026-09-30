import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  UserRound,
  Users,
  UserCheck,
  Ban,
  ShoppingBag,
  MapPin,
  Heart,
  AlertCircle,
  CheckCircle2,
  X,
  Mail,
  Phone,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { usePagedResource } from '@/features/catalog/usePagedResource.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { formatCurrency, formatRelativeTime, formatDateTime } from '@/lib/format.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { getInitials, cn, useDebouncedValue } from '@/lib/utils.js';

/**
 * Customer management.
 * ---------------------------------------------------------------------------
 * Separate from User & Role Management, which is about staff and permissions.
 * There is no role control here at all — a customer has nothing to escalate,
 * and promoting one to staff belongs in the screen that has the guards for it.
 */

const STATUS_META = {
  active: { label: 'Active', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'default' },
  suspended: { label: 'Suspended', variant: 'destructive' },
};

const ORDER_STATUS_VARIANT = {
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

const SORTS = [
  { value: 'recent', label: 'Newest' },
  { value: 'spend', label: 'Highest spend' },
  { value: 'orders', label: 'Most orders' },
  { value: 'name', label: 'Name (A–Z)' },
];

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  // Searches as you type; Enter searches at once.
  const typed = useDebouncedValue(search.trim(), 350);
  useEffect(() => setQuery(typed), [typed]);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('recent');
  const [viewing, setViewing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [isSaving, setSaving] = useState(false);
  /** The customer awaiting delete confirmation, or null. */
  const [deleting, setDeleting] = useState(null);
  const [notice, setNotice] = useState(null);

  const { rows, meta, isLoading, error, reload, goToPage } = usePagedResource(
    ({ page, limit }) =>
      apiClient.get('/customers', {
        params: { page, limit, sort, ...(status && { status }), ...(query && { search: query }) },
        _wantEnvelope: true,
      }),
    [query, status, sort],
  );

  const { data: stats, reload: reloadStats } = useResource(() => apiClient.get('/customers/stats'), []);

  /** Detail loads on demand — the list has no reason to carry order history. */
  const openDetail = useCallback(async (customer) => {
    setViewing({ loading: true, id: customer.id });
    try {
      setViewing({ loading: false, ...(await apiClient.get(`/customers/${customer.id}`)) });
    } catch (err) {
      setViewing(null);
      setNotice({ type: 'error', text: err.message ?? 'Could not load that customer' });
    }
  }, []);

  const changeStatus = useCallback(async () => {
    const { customer, next } = confirming;
    setSaving(true);
    try {
      const result = await apiClient.patch(`/customers/${customer.id}/status`, { status: next });
      setNotice({ type: 'success', text: result.message });
      setConfirming(null);
      await Promise.all([reload(), reloadStats()]);
      // Keep an open drawer in step with what just changed.
      if (viewing?.id === customer.id) setViewing((v) => ({ ...v, status: next }));
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not update this customer' });
    } finally {
      setSaving(false);
    }
  }, [confirming, reload, reloadStats, viewing]);

  /**
   * Delete a customer for good.
   *
   * The server refuses this whenever the person has orders — their sales
   * history is a business record — and returns a 409 saying so. That message is
   * shown as-is rather than replaced with a generic failure, because it names
   * the exact number of orders in the way and tells the owner to suspend
   * instead, which is the action they actually wanted.
   */
  const deleteCustomer = useCallback(async () => {
    const customer = deleting;
    setSaving(true);
    try {
      const result = await apiClient.delete(`/customers/${customer.id}`);
      setNotice({ type: 'success', text: result.message });
      setDeleting(null);
      // The drawer is showing an account that no longer exists.
      if (viewing?.id === customer.id) setViewing(null);
      await Promise.all([reload(), reloadStats()]);
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not delete this customer' });
      setDeleting(null);
    } finally {
      setSaving(false);
    }
  }, [deleting, reload, reloadStats, viewing]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Everyone who has signed up. Staff are managed under User Management.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <SearchInput
            size="sm"
            className="w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // Clearing drops the committed query too. Emptying the box but
            // leaving the old result set on screen reads as a broken filter.
            onClear={() => {
              setSearch('');
              setQuery('');
            }}
            placeholder="Name, email or phone…"
            label="Search customers"
          />
        </form>
      </header>

      {/* --- Summary --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total customers', value: stats?.total, icon: Users, tone: 'text-muted-foreground' },
          { label: 'Active', value: stats?.active, icon: UserCheck, tone: 'text-success' },
          { label: 'New (30 days)', value: stats?.newLast30Days, icon: UserRound, tone: 'text-gold' },
          { label: 'Have ordered', value: stats?.haveOrdered, icon: ShoppingBag, tone: 'text-info' },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{card.label}</span>
              <card.icon className={cn('h-4 w-4', card.tone)} aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{card.value ?? '—'}</p>
          </div>
        ))}
      </div>

      {notice && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
            notice.type === 'success'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* --- Filters --- */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex rounded-lg border border-border-strong p-0.5"
        >
          {[
            { key: '', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'suspended', label: 'Suspended' },
          ].map((option) => (
            <button
              key={option.key || 'all'}
              type="button"
              onClick={() => setStatus(option.key)}
              aria-pressed={status === option.key}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === option.key
                  ? 'bg-gold-gradient text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm text-foreground focus:border-gold focus:outline-none"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {query && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setQuery('');
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Clear &ldquo;{query}&rdquo;
          </button>
        )}
      </div>

      {/* --- List --- */}
      {isLoading ? (
        <SectionLoader label="Loading customers" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : !rows.length ? (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <UserRound className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">No customers found</p>
          <p className="text-sm text-muted-foreground">
            {query ? 'Try a different search.' : 'Sign-ups will appear here.'}
          </p>
        </div>
      ) : (
        <motion.ul {...staggerContainer} className="space-y-2.5">
          {rows.map((customer) => {
            const meta = STATUS_META[customer.status] ?? STATUS_META.inactive;
            return (
              <motion.li {...staggerItem} key={customer.id}>
                <button
                  type="button"
                  onClick={() => openDetail(customer)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition-colors hover:border-gold/40"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/15 text-sm font-semibold text-gold"
                  >
                    {getInitials(customer.fullName)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{customer.fullName}</span>
                      <Badge variant={meta.variant} size="sm">
                        {meta.label}
                      </Badge>
                      {!customer.emailVerified && (
                        <Badge variant="warning" size="sm">
                          Unverified
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {customer.email} · {customer.phone}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Joined {formatRelativeTime(customer.joinedAt)}
                      {customer.lastOrderAt && ` · last ordered ${formatRelativeTime(customer.lastOrderAt)}`}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-bold tabular-nums text-gold">{formatCurrency(customer.totalSpent)}</p>
                    <p className="text-xs text-muted-foreground">
                      {customer.orderCount} order{customer.orderCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      <Pagination meta={meta} onPageChange={goToPage} label="customers" />

      {/* --- Detail --- */}
      <Modal
        isOpen={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.loading ? 'Loading…' : viewing?.fullName}
        size="lg"
      >
        {viewing?.loading ? (
          <SectionLoader label="Loading customer" />
        ) : viewing ? (
          <div className="space-y-5">
            {/* Contact + status */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  {viewing.email}
                  {viewing.emailVerified ? (
                    <Badge variant="success" size="sm">
                      Verified
                    </Badge>
                  ) : (
                    <Badge variant="warning" size="sm">
                      Unverified
                    </Badge>
                  )}
                </p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {viewing.phone}
                </p>
                <p className="text-xs text-muted-foreground">
                  Joined {formatDateTime(viewing.joinedAt)}
                  {viewing.lastLoginAt && ` · last seen ${formatRelativeTime(viewing.lastLoginAt)}`}
                </p>
              </div>

              <Badge variant={(STATUS_META[viewing.status] ?? STATUS_META.inactive).variant}>
                {(STATUS_META[viewing.status] ?? STATUS_META.inactive).label}
              </Badge>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                { label: 'Orders', value: viewing.stats.orders, icon: ShoppingBag },
                { label: 'Spent', value: formatCurrency(viewing.stats.totalSpent), icon: ShoppingBag },
                { label: 'Avg order', value: formatCurrency(viewing.stats.averageOrder), icon: ShoppingBag },
                { label: 'Saved', value: viewing.stats.wishlist, icon: Heart },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-border bg-background p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                  <p className="mt-0.5 font-bold tabular-nums">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Addresses */}
            {viewing.addresses?.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  <MapPin className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                  Addresses
                </h3>
                <ul className="space-y-1.5">
                  {viewing.addresses.map((address) => (
                    <li
                      key={address.id}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
                    >
                      <span className="font-medium">{address.recipientName}</span>
                      {address.isDefault && (
                        <Badge variant="gold" size="sm" className="ml-2">
                          Default
                        </Badge>
                      )}
                      <br />
                      <span className="text-muted-foreground">
                        {address.line1}
                        {address.area ? `, ${address.area}` : ''}, {address.city}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Orders */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <ShoppingBag className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                Recent Orders
              </h3>
              {!viewing.recentOrders?.length ? (
                <p className="rounded-lg border border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground">
                  This customer has not ordered yet.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {viewing.recentOrders.map((order) => (
                    <li key={order.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="font-mono">{order.orderNumber}</span>
                      <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? 'default'} size="sm">
                        {order.status.replace(/_/g, ' ')}
                      </Badge>
                      <span className="ml-auto text-muted-foreground">
                        {formatRelativeTime(order.createdAt)}
                      </span>
                      <span className="font-semibold tabular-nums text-gold">
                        {formatCurrency(order.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Actions */}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              {/*
                Delete sits on the left and reads as the lesser action, because
                for almost every account suspension is the right answer and this
                one cannot be undone. The server refuses it outright for anyone
                with orders, so the dangerous case is not reachable from here.
              */}
              <Button
                variant="ghost"
                leftIcon={Trash2}
                className="mr-auto text-destructive hover:bg-destructive/10"
                onClick={() => setDeleting(viewing)}
              >
                Delete
              </Button>

              {viewing.status === 'active' ? (
                <Button
                  variant="ghost"
                  leftIcon={Ban}
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirming({ customer: viewing, next: 'suspended' })}
                >
                  Suspend
                </Button>
              ) : (
                <Button
                  leftIcon={UserCheck}
                  onClick={() => setConfirming({ customer: viewing, next: 'active' })}
                >
                  Restore access
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={deleteCustomer}
        isLoading={isSaving}
        title={`Delete ${deleting?.fullName}?`}
        message={
          'This removes the account permanently, along with their saved addresses, wishlist and reviews. ' +
          'It cannot be undone. If they have ever placed an order the deletion is refused — those orders are ' +
          'part of your sales history — so suspend the account instead.'
        }
        confirmLabel="Delete permanently"
      />

      <ConfirmDialog
        isOpen={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={changeStatus}
        isLoading={isSaving}
        title={
          confirming?.next === 'active'
            ? `Restore ${confirming?.customer?.fullName}?`
            : `Suspend ${confirming?.customer?.fullName}?`
        }
        message={
          confirming?.next === 'active'
            ? 'They will be able to sign in and order again.'
            : 'They will be signed out of every device immediately and cannot sign in until restored. Their order history is kept.'
        }
        confirmLabel={confirming?.next === 'active' ? 'Restore' : 'Suspend'}
        cancelLabel="Cancel"
      />
    </div>
  );
}

export default CustomersPage;
