import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Image as ImageIcon,
  Plus,
  Pencil,
  Trash2,
  Play,
  Pause,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  ImageOff,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Input, Select } from '@/components/ui/Input.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { apiClient } from '@/services/apiClient.js';
import { Thumbnail, ImageUploadButton } from '@/components/admin/CatalogShared.jsx';
import { useResource } from '@/features/catalog/catalog.api.js';
import { formatDateTime } from '@/lib/format.js';
import { staggerContainer, staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { mediaUrl } from '@/lib/media.js';

/**
 * Offers & Banners.
 * ---------------------------------------------------------------------------
 * Create a campaign, give it a window, and it appears and expires on its own.
 *
 * `state` (live / scheduled / expired / paused) is derived by the server from
 * the dates at request time — it is not a stored flag. So a campaign that ended
 * overnight already reads "expired" here the next morning without anything
 * having had to run.
 */

const STATE_META = {
  live: { label: 'Live', variant: 'success', icon: CheckCircle2 },
  scheduled: { label: 'Scheduled', variant: 'info', icon: Clock },
  expired: { label: 'Expired', variant: 'default', icon: Clock },
  paused: { label: 'Paused', variant: 'warning', icon: Pause },
};

const TYPES = [
  { value: 'combo', label: 'Combo Deal' },
  { value: 'eid', label: 'Eid Offer' },
  { value: 'weekend', label: 'Weekend Deal' },
  { value: 'seasonal', label: 'Seasonal' },
];

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'expired', label: 'Expired' },
  { key: 'paused', label: 'Paused' },
];

const EMPTY = {
  kicker: '',
  title: '',
  highlight: '',
  type: 'combo',
  // Where the campaign shows. 'offers' matches the model default.
  placement: 'offers',
  // Empty, not a demo asset — a stock photo of someone else's food is worse
  // than no image while the owner is setting the business up.
  image: '',
  ctaLabel: 'Order Now',
  ctaHref: '/menu',
  startsAt: '',
  endsAt: '',
  displayOrder: 0,
};

/**
 * <input type="datetime-local"> wants `YYYY-MM-DDTHH:mm` in local time, while
 * the API speaks ISO with an offset. These two conversions are the whole reason
 * dates in forms go wrong, so they live in one place.
 */
const toLocalInput = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const toIso = (local) => (local ? new Date(local).toISOString() : '');

export function AdminOffersPage() {
  const [stateFilter, setStateFilter] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | offer
  const [form, setForm] = useState(EMPTY);
  const [deleting, setDeleting] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const {
    data: offers,
    isLoading,
    error,
    reload,
  } = useResource(
    () => apiClient.get('/promotions/admin', { params: stateFilter ? { state: stateFilter } : {} }),
    [stateFilter],
  );
  const { data: stats, reload: reloadStats } = useResource(
    () => apiClient.get('/promotions/admin/stats'),
    [],
  );

  const refresh = useCallback(async () => {
    await Promise.all([reload(), reloadStats()]);
  }, [reload, reloadStats]);

  function openNew() {
    setForm(EMPTY);
    setFieldErrors({});
    setEditing('new');
  }

  function openEdit(offer) {
    setForm({
      kicker: offer.kicker,
      title: offer.title,
      highlight: offer.highlight,
      type: offer.type,
      image: offer.image,
      ctaLabel: offer.ctaLabel ?? 'Order Now',
      ctaHref: offer.ctaHref ?? '/menu',
      placement: offer.placement ?? 'offers',
      startsAt: toLocalInput(offer.startsAt),
      endsAt: toLocalInput(offer.endsAt),
      displayOrder: offer.displayOrder ?? 0,
    });
    setFieldErrors({});
    setEditing(offer);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const payload = { ...form, startsAt: toIso(form.startsAt), endsAt: toIso(form.endsAt) };

    try {
      const result =
        editing === 'new'
          ? await apiClient.post('/promotions', payload)
          : await apiClient.patch(`/promotions/${editing.id}`, payload);

      setNotice({ type: 'success', text: result.message ?? 'Saved' });
      setEditing(null);
      await refresh();
    } catch (err) {
      // Field-level errors go under their inputs; anything else is a banner.
      if (err.details?.length) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        setNotice({ type: 'error', text: err.message ?? 'Could not save this offer' });
      }
    } finally {
      setSaving(false);
    }
  }

  /** Pause or resume without opening the form. */
  async function toggleActive(offer) {
    try {
      await apiClient.patch(`/promotions/${offer.id}`, { isActive: !offer.isActive });
      await refresh();
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not update this offer' });
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const result = await apiClient.delete(`/promotions/${deleting.id}`);
      setNotice({ type: 'success', text: result.message ?? 'Deleted' });
      setDeleting(null);
      await refresh();
    } catch (err) {
      setNotice({ type: 'error', text: err.message ?? 'Could not delete this offer' });
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(() => offers ?? [], [offers]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Offers &amp; Banners</h1>
          <p className="text-sm text-muted-foreground">
            Schedule a campaign and it goes live and expires on its own.
          </p>
        </div>
        <Button leftIcon={Plus} onClick={openNew}>
          New Offer
        </Button>
      </header>

      {/* --- Summary --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Live now', value: stats?.live, tone: 'text-success' },
          { label: 'Scheduled', value: stats?.scheduled, tone: 'text-info' },
          { label: 'Paused', value: stats?.paused, tone: 'text-warning' },
          { label: 'Expired', value: stats?.expired, tone: 'text-muted-foreground' },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-surface p-4">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{card.label}</span>
            <p className={cn('mt-2 text-2xl font-bold tabular-nums', card.tone)}>{card.value ?? '—'}</p>
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
      <div
        role="group"
        aria-label="Filter by state"
        className="flex flex-wrap rounded-lg border border-border-strong p-0.5"
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.key || 'all'}
            type="button"
            onClick={() => setStateFilter(filter.key)}
            aria-pressed={stateFilter === filter.key}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              stateFilter === filter.key
                ? 'bg-gold-gradient text-gold-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* --- List --- */}
      {isLoading ? (
        <SectionLoader label="Loading offers" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          {error.message}
        </div>
      ) : !rows.length ? (
        <div className="rounded-2xl border border-border bg-surface py-16 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">No offers here</p>
          <p className="text-sm text-muted-foreground">Create one and give it a window.</p>
        </div>
      ) : (
        <motion.ul {...staggerContainer} className="grid gap-3 lg:grid-cols-2">
          {rows.map((offer) => {
            const meta = STATE_META[offer.state] ?? STATE_META.paused;
            return (
              <motion.li
                {...staggerItem}
                key={offer.id}
                className="overflow-hidden rounded-2xl border border-border bg-surface"
              >
                <div className="flex gap-4 p-4">
                  {/* Thumbnail — the campaign is a visual thing, so show it. */}
                  <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-surface-hover">
                    {offer.image ? (
                      <img src={mediaUrl(offer.image)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.variant} size="sm" icon={meta.icon}>
                        {meta.label}
                      </Badge>
                      {/* Where it shows. Without this, "live" campaigns on two
                          different pages look identical in the list, and an
                          owner cannot tell why one is not on the homepage. */}
                      <Badge variant={offer.placement === 'hero' ? 'gold' : 'default'} size="sm">
                        {offer.placement === 'hero' ? 'Homepage hero' : 'Offers page'}
                      </Badge>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {TYPES.find((t) => t.value === offer.type)?.label ?? offer.type}
                      </span>
                    </div>

                    <p className="mt-1 text-xs uppercase tracking-wider text-gold">{offer.kicker}</p>
                    <h2 className="truncate font-semibold">{offer.title}</h2>
                    <p className="truncate text-sm text-gold">{offer.highlight}</p>

                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {offer.startsAt || offer.endsAt ? (
                        <>
                          {offer.startsAt ? formatDateTime(offer.startsAt) : 'Now'}
                          {' → '}
                          {offer.endsAt ? formatDateTime(offer.endsAt) : 'no end date'}
                        </>
                      ) : (
                        'Always on'
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-1.5 border-t border-border px-4 py-2.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={offer.isActive ? Pause : Play}
                    onClick={() => toggleActive(offer)}
                  >
                    {offer.isActive ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => openEdit(offer)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={Trash2}
                    onClick={() => setDeleting(offer)}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </Button>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      {/* --- Editor --- */}
      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New Offer' : 'Edit Offer'}
        description="Leave the dates empty for an offer that runs until you pause it."
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Label"
              placeholder="Eid Special"
              required
              value={form.kicker}
              error={fieldErrors.kicker}
              onChange={(e) => setForm((f) => ({ ...f, kicker: e.target.value }))}
            />
            <Select
              label="Category"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Title"
            placeholder="Family Combo"
            required
            value={form.title}
            error={fieldErrors.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />

          <Input
            label="The offer"
            placeholder="Get up to 25% OFF"
            required
            value={form.highlight}
            error={fieldErrors.highlight}
            onChange={(e) => setForm((f) => ({ ...f, highlight: e.target.value }))}
          />

          {/*
            Where it appears.
            This selector did not exist, and the model defaults to 'offers' —
            so every campaign created through this screen landed on the Offers
            page and nothing could ever reach the homepage hero. The owner made
            a banner, looked at the home page, and saw no change.
          */}
          <Select
            label="Where it appears"
            value={form.placement}
            hint={
              form.placement === 'hero'
                ? 'Shown as a full-width slide at the top of the homepage.'
                : 'Shown as a card on the Offers page.'
            }
            onChange={(e) => setForm((f) => ({ ...f, placement: e.target.value }))}
          >
            <option value="offers">Offers page</option>
            <option value="hero">Homepage hero banner</option>
          </Select>

          {/* Real upload, not "paste a path" — the previous hint asked the owner
              to go to Products, upload there, and copy the path back by hand. */}
          <div>
            <span className="text-sm font-medium">Image</span>
            <div className="mt-1.5 flex flex-wrap items-start gap-4">
              <Thumbnail src={form.image} alt="" className="h-20 w-32 shrink-0 rounded-xl" />
              <div className="min-w-[220px] flex-1 space-y-2">
                <input
                  value={form.image}
                  onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))}
                  aria-label="Image path"
                  placeholder="Upload a file, or paste a URL"
                  className="h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60"
                />
                <ImageUploadButton
                  label={form.image ? 'Replace image' : 'Upload image'}
                  folder="offers"
                  onUploaded={(url) => setForm((f) => ({ ...f, image: url }))}
                  onError={(m) => setFieldErrors((p) => ({ ...p, image: m }))}
                />
                {fieldErrors.image && <p className="text-xs text-destructive">{fieldErrors.image}</p>}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Starts"
              type="datetime-local"
              hint="Empty = starts immediately"
              value={form.startsAt}
              error={fieldErrors.startsAt}
              onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
            />
            <Input
              label="Ends"
              type="datetime-local"
              hint="Empty = no end date"
              value={form.endsAt}
              min={form.startsAt || undefined}
              error={fieldErrors.endsAt}
              onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Button text"
              value={form.ctaLabel}
              onChange={(e) => setForm((f) => ({ ...f, ctaLabel: e.target.value }))}
            />
            <Input
              label="Button link"
              value={form.ctaHref}
              onChange={(e) => setForm((f) => ({ ...f, ctaHref: e.target.value }))}
            />
            <Input
              label="Order"
              type="number"
              min={0}
              hint="Lower shows first"
              value={form.displayOrder}
              onChange={(e) => setForm((f) => ({ ...f, displayOrder: e.target.value }))}
            />
          </div>

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
              {editing === 'new' ? 'Create Offer' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        isLoading={isSaving}
        title={`Delete "${deleting?.title}"?`}
        message="This removes the campaign permanently. To take it off the site temporarily, pause it instead."
        confirmLabel="Delete"
        cancelLabel="Keep it"
      />
    </div>
  );
}

export default AdminOffersPage;
