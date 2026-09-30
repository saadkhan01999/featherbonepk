import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { Switch } from '@/components/ui/Switch.jsx';
import { ConfirmDialog, Modal } from '@/components/ui/Modal.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { StatusBanner, useFlash } from '@/components/admin/CatalogShared.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useResource } from '@/features/catalog/catalog.api.js';
import { adminCatalogApi } from '@/features/catalog/adminCatalog.api.js';
import { stationsApi, STATION_COLORS } from '@/features/stations/stations.api.js';
import { EVENTS, useDebouncedCallback, useRealtimeEvent } from '@/services/realtime.js';
import { ROUTES } from '@/constants/routes.js';
import { cn } from '@/lib/utils.js';

/**
 * Kitchen Stations — where each order is prepared.
 *
 * A station owns categories; an order line goes to the station that owns its
 * category, anything else to the catch-all. Each station has its own screen
 * (/kitchen?station=<slug>).
 */
export function StationsPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage');
  const { data: stations, isLoading, error, reload } = useResource(() => stationsApi.list(), []);
  const { data: categories } = useResource(() => adminCatalogApi.listCategories(), []);
  const [editing, setEditing] = useState(null); // null | 'new' | station
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(null);
  const { notice, flash } = useFlash();

  const refresh = useDebouncedCallback(reload, 300);
  useRealtimeEvent('web', EVENTS.SETTINGS_CHANGED, (event) => {
    if (event?.sections?.includes('stations')) refresh();
  });

  async function toggleActive(station) {
    setBusy(station.id);
    try {
      await stationsApi.update(station.id, { isActive: !station.isActive });
      flash('success', `${station.name} ${station.isActive ? 'switched off' : 'switched on'}`);
      reload();
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    try {
      const result = await stationsApi.remove(deleting.id);
      flash('success', result.message ?? 'Station deleted');
      setDeleting(null);
      reload();
    } catch (err) {
      flash('error', err.message);
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kitchen Stations</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Where each order is prepared. Items go to the station that owns their category — for example
            chicken to the Chicken Counter — and everything else to the catch-all station. Each station has
            its own screen.
          </p>
        </div>
        {canManage && (
          <Button leftIcon={Plus} onClick={() => setEditing('new')}>
            Add station
          </Button>
        )}
      </header>

      <StatusBanner notice={notice} />

      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        Website orders wait under{' '}
        <span className="font-semibold text-foreground">Incoming website orders</span> on the dashboard until
        someone sends them on — or go straight to the stations, if you prefer. Choose in{' '}
        <Link to={ROUTES.ADMIN_SETTINGS} className="font-medium text-gold hover:underline">
          Settings → Kitchen Display
        </Link>
        .
      </p>

      {isLoading && !stations ? (
        <SectionLoader label="Loading stations" />
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          {error.message}
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stations.map((station) => (
            <li
              key={station.id}
              className={cn(
                'flex flex-col overflow-hidden rounded-2xl border border-border bg-surface',
                !station.isActive && 'opacity-70',
              )}
            >
              <div className="h-1.5" style={{ background: station.color }} aria-hidden="true" />
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 truncate font-semibold">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: station.color }}
                      />
                      {station.name}
                    </h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {station.isDefault && (
                        <Badge size="sm" variant="gold">
                          Catch-all
                        </Badge>
                      )}
                      {!station.isActive && <Badge size="sm">Switched off</Badge>}
                    </div>
                  </div>
                  {canManage && (
                    <Switch
                      checked={station.isActive}
                      disabled={station.isDefault || busy === station.id}
                      onChange={() => toggleActive(station)}
                      label={`${station.name} is ${station.isActive ? 'on' : 'off'}`}
                      title={station.isDefault ? 'The catch-all station is always on' : undefined}
                    />
                  )}
                </div>

                <div className="mt-3 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Prepares
                  </p>
                  {station.categories.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {station.categories.map((c) => (
                        <span key={c.id} className="rounded-full bg-surface-raised px-2.5 py-0.5 text-xs">
                          {c.name ?? 'Deleted category'}
                        </span>
                      ))}
                      {station.isDefault && (
                        <span className="text-xs text-muted-foreground">
                          and everything not listed elsewhere
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {station.isDefault
                        ? 'Everything no other station prepares.'
                        : 'No categories yet — items can still be sent here by hand.'}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <a
                    href={`${ROUTES.KITCHEN}?station=${station.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Open screen
                  </a>
                  {canManage && (
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" leftIcon={Pencil} onClick={() => setEditing(station)}>
                        Edit
                      </Button>
                      {!station.isDefault && (
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={Trash2}
                          onClick={() => setDeleting(station)}
                          className="text-destructive hover:text-destructive"
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <StationForm
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        station={editing === 'new' ? null : editing}
        isOpen={Boolean(editing)}
        stations={stations ?? []}
        categories={categories ?? []}
        onClose={() => setEditing(null)}
        onSaved={(saved, isNew) => {
          setEditing(null);
          flash('success', isNew ? `${saved.name} added` : `${saved.name} saved`);
          reload();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Delete ${deleting?.name}?`}
        message="Its categories go back to the catch-all station. Orders already sent to it keep their history."
        confirmLabel="Delete"
      />
    </div>
  );
}

function StationForm({ station, isOpen, stations, categories, onClose, onSaved }) {
  const isNew = !station;
  const [form, setForm] = useState(() => ({
    name: station?.name ?? '',
    color: station?.color ?? STATION_COLORS[stations.length % STATION_COLORS.length],
    categories: station?.categories.map((c) => c.id) ?? [],
    isDefault: station?.isDefault ?? false,
    isActive: station?.isActive ?? true,
  }));
  const [errors, setErrors] = useState({});
  const [isSaving, setSaving] = useState(false);

  // Which station each category belongs to now, to say "moves from …".
  const owner = useMemo(() => {
    const map = new Map();
    for (const s of stations) {
      if (s.id !== station?.id) for (const c of s.categories) map.set(c.id, s.name);
    }
    return map;
  }, [stations, station]);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const toggleCategory = (id) =>
    set(
      'categories',
      form.categories.includes(id) ? form.categories.filter((c) => c !== id) : [...form.categories, id],
    );

  async function save() {
    if (form.name.trim().length < 2) {
      setErrors({ name: 'Name the station' });
      return;
    }
    setSaving(true);
    try {
      const body = { ...form, name: form.name.trim() };
      const saved = isNew ? await stationsApi.create(body) : await stationsApi.update(station.id, body);
      onSaved(saved, isNew);
    } catch (err) {
      if (Array.isArray(err.details))
        setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      else setErrors({ form: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={isNew ? 'Add a station' : `Edit ${station.name}`}
      description="Choose the categories this station prepares. A category belongs to one station at a time."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            {isNew ? 'Add station' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {errors.form && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errors.form}
          </p>
        )}

        <Input
          label="Name"
          required
          value={form.name}
          maxLength={40}
          placeholder="Chicken Counter, Bakery, Grill…"
          error={errors.name}
          onChange={(e) => set('name', e.target.value)}
        />

        <fieldset>
          <legend className="text-sm font-medium">Colour</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => set('color', color)}
                aria-label={`Colour ${color}`}
                aria-pressed={form.color === color}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition',
                  form.color === color && 'ring-2 ring-foreground',
                )}
                style={{ background: color }}
              >
                {form.color === color && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">
            Prepares these categories{' '}
            <span className="font-normal text-muted-foreground">({form.categories.length} chosen)</span>
          </legend>
          {categories.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No categories yet — add them under Catalogue.
            </p>
          ) : (
            <div className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2">
              {categories.map((category) => {
                const checked = form.categories.includes(category.id);
                const from = owner.get(category.id);
                return (
                  <label
                    key={category.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-hover',
                      checked && 'bg-gold/10',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCategory(category.id)}
                      className="h-4 w-4 accent-gold"
                    />
                    <span className="min-w-0 flex-1 truncate">{category.name}</span>
                    {from && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {checked ? `moves from ${from}` : from}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          {errors.categories && <p className="mt-1 text-xs text-destructive">{errors.categories}</p>}
        </fieldset>

        <div className="space-y-2">
          <SwitchRow
            label="Catch-all station"
            help="Gets every item whose category no other station prepares. There is always exactly one."
            checked={form.isDefault}
            disabled={station?.isDefault}
            onChange={(on) => set('isDefault', on)}
          />
          <SwitchRow
            label="Switched on"
            help="A switched-off station gets no new orders and is hidden from the kitchen screens."
            checked={form.isDefault || form.isActive}
            disabled={form.isDefault}
            onChange={(on) => set('isActive', on)}
          />
        </div>
      </div>
    </Modal>
  );
}

function SwitchRow({ label, help, checked, disabled, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-background/40 p-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={label} className="mt-0.5" />
    </div>
  );
}

export default StationsPage;
