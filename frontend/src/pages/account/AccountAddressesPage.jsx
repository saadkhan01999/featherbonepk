import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Plus, Pencil, Trash2, Star, Home, Building2, AlertCircle, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Input, Select, Textarea } from '@/components/ui/Input.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * Address book.
 * ---------------------------------------------------------------------------
 * The default address is what checkout pre-fills, so exactly one is always
 * marked — the server enforces that, including promoting another when the
 * default is deleted.
 */

const LABEL_META = {
  home: { label: 'Home', icon: Home },
  office: { label: 'Office', icon: Building2 },
  other: { label: 'Other', icon: MapPin },
};

const EMPTY = {
  label: 'home',
  recipientName: '',
  phone: '',
  line1: '',
  area: '',
  city: '',
  notes: '',
  isDefault: false,
};

export function AccountAddressesPage() {
  const [editing, setEditing] = useState(null); // null | 'new' | address
  const [form, setForm] = useState(EMPTY);
  const [deleting, setDeleting] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const {
    data: addresses,
    isLoading,
    error,
    reload,
  } = useResource(() => apiClient.get('/account/addresses'), []);

  function openNew() {
    setForm(EMPTY);
    setFieldErrors({});
    setEditing('new');
  }

  function openEdit(address) {
    setForm({
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      area: address.area ?? '',
      city: address.city,
      notes: address.notes ?? '',
      isDefault: address.isDefault,
    });
    setFieldErrors({});
    setEditing(address);
  }

  const save = useCallback(
    async (event) => {
      event.preventDefault();
      setSaving(true);
      setFieldErrors({});

      try {
        const result =
          editing === 'new'
            ? await apiClient.post('/account/addresses', form)
            : await apiClient.patch(`/account/addresses/${editing.id}`, form);

        setNotice({ type: 'success', text: result.message ?? 'Saved' });
        setEditing(null);
        reload();
      } catch (err) {
        if (err.details?.length) {
          setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
        } else {
          setNotice({ type: 'error', text: err.message ?? 'Could not save this address' });
        }
      } finally {
        setSaving(false);
      }
    },
    [editing, form, reload],
  );

  async function makeDefault(address) {
    try {
      await apiClient.post(`/account/addresses/${address.id}/default`);
      reload();
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not update the default' });
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const result = await apiClient.delete(`/account/addresses/${deleting.id}`);
      setNotice({ type: 'success', text: result.message ?? 'Removed' });
      setDeleting(null);
      reload();
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not remove this address' });
    } finally {
      setSaving(false);
    }
  }

  const list = addresses ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Saved Addresses</h2>
          <p className="text-sm text-muted-foreground">Your default is used at checkout.</p>
        </div>
        <Button leftIcon={Plus} onClick={openNew}>
          Add Address
        </Button>
      </header>

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

      {isLoading ? (
        <SectionLoader label="Loading addresses" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">No addresses saved</p>
          <p className="text-sm text-muted-foreground">Save one to speed up checkout.</p>
          <Button className="mt-4" leftIcon={Plus} onClick={openNew}>
            Add your first address
          </Button>
        </div>
      ) : (
        <motion.ul {...staggerContainer} className="grid gap-3 sm:grid-cols-2">
          {list.map((address) => {
            const meta = LABEL_META[address.label] ?? LABEL_META.other;
            return (
              <motion.li
                {...staggerItem}
                key={address.id}
                className={cn(
                  'rounded-2xl border bg-surface p-4',
                  address.isDefault ? 'border-gold/50' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge variant={address.isDefault ? 'gold' : 'default'} size="sm" icon={meta.icon}>
                    {meta.label}
                  </Badge>
                  {address.isDefault && (
                    <Badge variant="gold" size="sm" icon={Star}>
                      Default
                    </Badge>
                  )}
                </div>

                <p className="mt-2.5 font-semibold">{address.recipientName}</p>
                <p className="text-sm text-muted-foreground">{address.phone}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {address.line1}
                  {address.area ? `, ${address.area}` : ''}
                  <br />
                  {address.city}
                </p>
                {address.notes && (
                  <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{address.notes}&rdquo;</p>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  {!address.isDefault && (
                    <Button size="sm" variant="ghost" leftIcon={Star} onClick={() => makeDefault(address)}>
                      Set default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(address)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={Trash2}
                    onClick={() => setDeleting(address)}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    Remove
                  </Button>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add Address' : 'Edit Address'}
        size="md"
      >
        <form onSubmit={save} className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Label"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            >
              <option value="home">Home</option>
              <option value="office">Office</option>
              <option value="other">Other</option>
            </Select>
            <Input
              label="Recipient"
              required
              value={form.recipientName}
              error={fieldErrors.recipientName}
              onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
            />
          </div>

          <Input
            label="Mobile number"
            placeholder="03XXXXXXXXX"
            required
            value={form.phone}
            error={fieldErrors.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />

          <Input
            label="Street address"
            required
            value={form.line1}
            error={fieldErrors.line1}
            onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Area"
              value={form.area}
              error={fieldErrors.area}
              onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
            />
            <Input
              label="City"
              required
              value={form.city}
              error={fieldErrors.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            />
          </div>

          <Textarea
            label="Delivery notes"
            rows={2}
            placeholder="Gate colour, landmark, floor…"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            hint="Optional — helps the rider find you"
          />

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
              className="h-4 w-4 rounded border-border-strong accent-gold"
            />
            Use this as my default address
          </label>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setEditing(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" isLoading={isSaving} loadingText="Saving…">
              {editing === 'new' ? 'Save Address' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        isLoading={isSaving}
        title="Remove this address?"
        message="Past orders keep their own copy of where they were delivered, so this won't change your order history."
        confirmLabel="Remove"
        cancelLabel="Keep it"
      />
    </div>
  );
}

export default AccountAddressesPage;
