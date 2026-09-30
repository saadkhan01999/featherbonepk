import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Store as StoreIcon,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  MapPin,
  Phone,
  Monitor,
  Package,
  Users,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { EmptyState } from '@/components/ui/EmptyState.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Input, Select } from '@/components/ui/Input.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * Stores — the counters the business trades from.
 * ---------------------------------------------------------------------------
 * A store is a counter under one roof: the bakery, the chicken counter, the
 * main kitchen. It is the unit that scopes almost everything else:
 *
 *   • a till stands at one store, and that decides the menu the cashier sees
 *   • a product belongs to one store, or to none (sold everywhere)
 *   • a sale records the store it was rung up at
 *   • Staff are assigned to stores, which confines what they can read
 *
 * Closing is not deleting. A store with sales history is a financial record;
 * it can be taken out of service, but removing it would orphan every order that
 * points at it.
 */

const EMPTY = { code: '', name: '', type: 'general', location: '', phone: '', displayOrder: 0 };

const TYPES = [
  { value: 'general', label: 'General / Main' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'chicken', label: 'Chicken & Roast' },
  { value: 'meat', label: 'Meat' },
  { value: 'grill', label: 'Grill & BBQ' },
];

/** One counter, with the things that hang off it. */
function StoreCard({ store, onEdit, onToggle, onDelete, busy }) {
  return (
    <motion.article
      variants={staggerItem}
      className={cn(
        'rounded-2xl border p-5 transition-colors',
        store.isActive
          ? 'border-white/10 bg-white/[0.03] hover:border-brand-gold/30'
          : 'border-white/5 bg-white/[0.01] opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display text-lg text-white">{store.name}</h3>
            <Badge variant={store.isActive ? 'success' : 'muted'}>{store.isActive ? 'Open' : 'Closed'}</Badge>
          </div>
          <p className="mt-1 font-mono text-xs uppercase tracking-widest text-brand-gold/70">{store.code}</p>
        </div>

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onEdit(store)}
            className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
            aria-label={`Edit ${store.name}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(store)}
            disabled={busy}
            className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            aria-label={store.isActive ? `Close ${store.name}` : `Reopen ${store.name}`}
          >
            {store.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => onDelete(store)}
            className="rounded-lg p-2 text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
            aria-label={`Delete ${store.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {(store.location || store.phone) && (
        <div className="mt-3 space-y-1 text-sm text-white/50">
          {store.location && (
            <p className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{store.location}</span>
            </p>
          )}
          {store.phone && (
            <p className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {store.phone}
            </p>
          )}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-white/5 pt-4">
        {[
          { icon: Monitor, label: 'Tills', value: store.terminalCount },
          { icon: Package, label: 'Items', value: store.productCount },
          { icon: Users, label: 'Staff', value: store.staffCount },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="text-center">
            <dt className="flex items-center justify-center gap-1 text-[0.65rem] uppercase tracking-wider text-white/40">
              <Icon className="h-3 w-3" />
              {label}
            </dt>
            <dd className="mt-1 font-display text-xl text-white">{value}</dd>
          </div>
        ))}
      </dl>

      {/*
        Spelled out because the number would otherwise look wrong: the item
        count includes goods sold at every counter (drinks, sides), which exist
        once in stock rather than once per counter.
      */}
      {store.globalProductCount > 0 && (
        <p className="mt-3 text-xs text-white/35">
          {store.ownProductCount} own &middot; {store.globalProductCount} sold at every counter
        </p>
      )}
    </motion.article>
  );
}

export function StoresPage() {
  const [editing, setEditing] = useState(null); // null | 'new' | store
  const [form, setForm] = useState(EMPTY);
  const [deleting, setDeleting] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const { data: stores, isLoading, error, reload } = useResource(() => apiClient.get('/stores'), []);

  const flash = useCallback((tone, message) => {
    setNotice({ tone, message });
    window.setTimeout(() => setNotice(null), 4000);
  }, []);

  function openNew() {
    setForm(EMPTY);
    setFieldErrors({});
    setEditing('new');
  }

  function openEdit(store) {
    setForm({
      code: store.code,
      name: store.name,
      type: store.type ?? 'general',
      location: store.location ?? '',
      phone: store.phone ?? '',
      displayOrder: store.displayOrder ?? 0,
    });
    setFieldErrors({});
    setEditing(store);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        location: form.location.trim() || undefined,
        phone: form.phone.trim() || undefined,
        displayOrder: Number(form.displayOrder) || 0,
      };

      if (editing === 'new') {
        // The code is the store's permanent identity — set once, never edited,
        // because sales, tills and staff assignments all point at it.
        await apiClient.post('/stores', { ...payload, code: form.code.trim().toUpperCase() });
        flash('success', `${payload.name} is open.`);
      } else {
        await apiClient.patch(`/stores/${editing.id}`, payload);
        flash('success', `${payload.name} updated.`);
      }

      setEditing(null);
      await reload();
    } catch (err) {
      // Field-level messages land under the input that caused them; anything
      // else becomes a banner, so a failure is never silent.
      if (err.details?.length) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        flash('error', err.message ?? 'Could not save the store.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(store) {
    setBusyId(store.id);
    try {
      const result = await apiClient.patch(`/stores/${store.id}/active`, {
        isActive: !store.isActive,
      });
      flash('success', result.message ?? 'Updated.');
      await reload();
    } catch (err) {
      // The server refuses to close a counter with an open shift — surfacing
      // its reason verbatim is more useful than a generic failure.
      flash('error', err.message ?? 'Could not change the store.');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const store = deleting;
    setDeleting(null);
    try {
      const result = await apiClient.delete(`/stores/${store.id}`);
      flash('success', result.message ?? 'Store removed.');
      await reload();
    } catch (err) {
      flash('error', err.message ?? 'Could not remove the store.');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-white sm:text-3xl">Stores</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/50">
            The counters you trade from. Each till stands at one store and shows only that counter&rsquo;s
            menu, and every sale is recorded against it.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Add store
        </Button>
      </header>

      {notice && (
        <div
          role="status"
          className={cn(
            'flex items-center gap-2 rounded-xl border px-4 py-3 text-sm',
            notice.tone === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300',
          )}
        >
          {notice.tone === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {notice.message}
        </div>
      )}

      {isLoading && <SectionLoader label="Loading stores…" />}

      {error && !isLoading && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center text-red-300">
          {error.message ?? 'Could not load stores.'}
        </div>
      )}

      {!isLoading && !error && stores?.length === 0 && (
        <EmptyState
          icon={StoreIcon}
          title="No stores yet"
          body="Add your first counter to start assigning tills and menu items to it."
          action={
            <Button onClick={openNew} leftIcon={Plus}>
              Add store
            </Button>
          }
        />
      )}

      {!isLoading && stores?.length > 0 && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {stores.map((store) => (
            <StoreCard
              key={store.id}
              store={store}
              busy={busyId === store.id}
              onEdit={openEdit}
              onToggle={toggleActive}
              onDelete={setDeleting}
            />
          ))}
        </motion.div>
      )}

      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add a store' : `Edit ${editing?.name ?? ''}`}
      >
        <form onSubmit={save} className="space-y-4">
          <Input
            label="Store name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={fieldErrors.name}
            placeholder="The Bakery Counter"
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              error={fieldErrors.code}
              placeholder="BAKERY"
              // Immutable after creation: sales, tills and staff assignments all
              // reference it, so changing it would rewrite history.
              disabled={editing !== 'new'}
              hint={editing === 'new' ? 'Letters, numbers and hyphens' : 'Codes cannot be changed'}
              required
            />
            <Select
              label="Type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              error={fieldErrors.type}
            >
              {TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            error={fieldErrors.location}
            placeholder="Left wing, by the entrance"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              error={fieldErrors.phone}
              placeholder="+92 300 1234567"
            />
            <Input
              label="Display order"
              type="number"
              min="0"
              value={form.displayOrder}
              onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
              error={fieldErrors.displayOrder}
              hint="Lower shows first"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving}>
              {editing === 'new' ? 'Add store' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Remove ${deleting?.name ?? 'this store'}?`}
        /*
         * Honest about the likely outcome. The server refuses to delete a store
         * that has sales, tills or products, so promising removal here and then
         * failing would train the user to distrust the dialog.
         */
        message="A store with sales, tills or menu items cannot be removed — close it instead. This only works for a counter that was never used."
        confirmLabel="Remove store"
        variant="destructive"
      />
    </div>
  );
}

export default StoresPage;
