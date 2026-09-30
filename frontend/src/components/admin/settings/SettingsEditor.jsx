import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, ChevronDown, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, Textarea } from '@/components/ui/Input.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { Switch } from '@/components/ui/Switch.jsx';
import { StatusBanner, useFlash, ImageUploadButton, Thumbnail } from '@/components/admin/CatalogShared.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useAuth } from '@/features/auth/authContext.jsx';
import { EVENTS, useRealtimeEvent } from '@/services/realtime.js';
import { accentVariables } from '@/lib/theme.js';
import { mediaUrl } from '@/lib/media.js';
import { cn } from '@/lib/utils.js';

/**
 * The settings editor — shared by Settings (operations) and Website Management.
 * ---------------------------------------------------------------------------
 * Rendered from the server's registry. Every section, label, type, limit, option
 * list and help line comes from `GET /settings?group=…`, which is generated from
 * the same registry the server validates against. A setting added on the server
 * appears here, correctly typed, with no frontend change — so the form and the
 * validation cannot drift apart.
 *
 * Field types: string · text · number (with 'percent' and 'currency' units) ·
 * boolean · select · color · url · image · video · list (repeatable rows of the
 * above — social links, footer links, custom fields, About story blocks).
 *
 * Drafts are kept per section and survive switching tabs; a section with unsaved
 * changes is marked, and a save made elsewhere (another manager, another tab)
 * refreshes only the sections nobody is editing here.
 */

/* ------------------------------------------------------------------------ */
/* Stored ⇄ editable                                                         */
/* ------------------------------------------------------------------------ */

/** Stored value → what the editor holds. */
export function toDisplay(field, value) {
  switch (field.type) {
    case 'number':
      // A fraction is unreadable in a form: 0.05 is edited as 5.
      return field.unit === 'percent'
        ? String(Math.round(Number(value ?? 0) * 10000) / 100)
        : String(value ?? field.default ?? 0);
    case 'boolean':
      return Boolean(value ?? field.default);
    case 'list':
      return (Array.isArray(value) ? value : []).map((item) =>
        Object.fromEntries(Object.entries(field.itemFields).map(([k, f]) => [k, toDisplay(f, item?.[k])])),
      );
    case 'select':
      return value ?? field.default ?? field.options?.[0]?.value ?? '';
    default:
      return value ?? '';
  }
}

/** Editor value → what is sent and stored. */
export function toStored(field, value) {
  switch (field.type) {
    case 'number':
      return field.unit === 'percent' ? Number(value || 0) / 100 : Number(value || 0);
    case 'boolean':
      return Boolean(value);
    case 'list':
      return (value ?? []).map((item) =>
        Object.fromEntries(Object.entries(field.itemFields).map(([k, f]) => [k, toStored(f, item?.[k])])),
      );
    default:
      return typeof value === 'string' ? value.trim() : value;
  }
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------------ */
/* The editor                                                                */
/* ------------------------------------------------------------------------ */

/**
 * @param {object} props
 * @param {'operations'|'website'} props.group
 * @param {string[]} [props.order] section keys in the order to show them
 * @param {Record<string, React.ReactNode>} [props.extras] extra content under a section, by key
 */
export function SettingsEditor({ group, order, extras = {} }) {
  const { can } = useAuth();
  const canManage = can('settings.manage');
  const { notice, flash } = useFlash();

  const [sections, setSections] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [active, setActive] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(null);

  const saved = useMemo(
    () =>
      Object.fromEntries(
        (sections ?? []).map((s) => [
          s.key,
          Object.fromEntries(s.fields.map((f) => [f.key, toDisplay(f, f.value)])),
        ]),
      ),
    [sections],
  );

  const isDirty = useCallback(
    (key) => Boolean(drafts[key]) && !sameValue(drafts[key], saved[key]),
    [drafts, saved],
  );

  // A string key, so a caller passing a fresh array each render cannot loop the loader.
  const orderKey = (order ?? []).join(',');
  const load = useCallback(async () => {
    try {
      const data = await apiClient.get('/settings', { params: { group } });
      const keys = orderKey ? orderKey.split(',') : [];
      const rank = (key) => keys.indexOf(key) + 1 || 99;
      const sorted = keys.length ? [...data].sort((a, b) => rank(a.key) - rank(b.key)) : data;
      setSections(sorted);
      setLoadError(null);
      setActive((current) => current ?? sorted[0]?.key ?? null);
    } catch (err) {
      setLoadError(err);
    }
  }, [group, orderKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Seed drafts — but never overwrite a section someone is editing.
  const lastSaved = useRef({});
  useEffect(() => {
    if (!sections) return;
    const previous = lastSaved.current;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const section of sections) {
        if (!prev[section.key] || sameValue(prev[section.key], previous[section.key]))
          next[section.key] = saved[section.key];
      }
      return next;
    });
    lastSaved.current = saved;
  }, [sections, saved]);

  // Saved elsewhere? Re-read. The seeding above keeps local edits intact.
  useRealtimeEvent('web', EVENTS.SETTINGS_CHANGED, (event) => {
    if (!sections || event?.sections?.some((key) => sections.some((s) => s.key === key))) load();
  });

  if (loadError) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
        {loadError.message}
      </div>
    );
  }
  if (!sections) return <SectionLoader label="Loading settings" />;

  const section = sections.find((s) => s.key === active) ?? sections[0];
  const draft = drafts[section.key] ?? saved[section.key] ?? {};

  const setField = (fieldKey, value) =>
    setDrafts((prev) => ({
      ...prev,
      [section.key]: { ...(prev[section.key] ?? saved[section.key]), [fieldKey]: value },
    }));

  async function save() {
    setSaving(section.key);
    setErrors((prev) => ({ ...prev, [section.key]: {} }));
    try {
      // Only what changed — a save never re-writes a field nobody touched.
      const payload = {};
      for (const field of section.fields) {
        if (!sameValue(draft[field.key], saved[section.key]?.[field.key])) {
          payload[field.key] = toStored(field, draft[field.key]);
        }
      }
      if (!Object.keys(payload).length) {
        flash('success', 'Nothing has changed.');
        return;
      }
      await apiClient.patch(`/settings/${section.key}`, payload);
      flash('success', `${section.label} saved — live everywhere now.`);
      // Re-read what the server stored (trimmed, normalised), then drop the
      // draft so the section shows exactly that and reads as clean.
      await load();
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[section.key];
        return next;
      });
    } catch (err) {
      if (err.details?.length) {
        setErrors((prev) => ({
          ...prev,
          [section.key]: Object.fromEntries(err.details.map((d) => [d.field, d.message])),
        }));
      }
      flash('error', err.message ?? 'Could not save');
    } finally {
      setSaving(null);
    }
  }

  const reset = () => setDrafts((prev) => ({ ...prev, [section.key]: saved[section.key] }));
  const sectionErrors = errors[section.key] ?? {};

  return (
    <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
      {/* --- Section list --- */}
      <nav
        aria-label="Settings sections"
        className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible"
      >
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActive(s.key)}
            aria-current={s.key === section.key ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors',
              s.key === section.key
                ? 'bg-gold-gradient font-semibold text-gold-foreground'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <span className="truncate">{s.label}</span>
            {isDirty(s.key) && (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-warning"
                aria-label="unsaved changes"
                title="Unsaved changes"
              />
            )}
          </button>
        ))}
      </nav>

      {/* --- The section --- */}
      <div className="min-w-0 space-y-4">
        <StatusBanner notice={notice} />

        <section className="rounded-2xl border border-border bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">{section.label}</h2>
              {section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
            </div>
            {isDirty(section.key) && (
              <span className="rounded-lg bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning">
                Unsaved changes
              </span>
            )}
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-2">
            {section.fields.map((field) => (
              <SettingField
                key={field.key}
                field={field}
                path={field.key}
                value={draft[field.key]}
                errors={sectionErrors}
                disabled={!canManage}
                onChange={(value) => setField(field.key, value)}
                onError={(message) => flash('error', message)}
              />
            ))}
          </div>

          {extras[section.key]}

          {canManage ? (
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={RotateCcw}
                onClick={reset}
                disabled={!isDirty(section.key)}
              >
                Undo changes
              </Button>
              <Button leftIcon={Save} isLoading={saving === section.key} loadingText="Saving…" onClick={save}>
                Save {section.label}
              </Button>
            </div>
          ) : (
            <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
              View only — your account can read settings but not change them.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* One field                                                                 */
/* ------------------------------------------------------------------------ */

const WIDE = new Set(['text', 'image', 'video', 'list', 'schedule']);

export function SettingField({
  field,
  path,
  value,
  errors = {},
  disabled,
  onChange,
  onError,
  compact = false,
}) {
  const error = errors[path];
  const wide = !compact && WIDE.has(field.type);

  const help = field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>;
  const errorLine = error && (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {error}
    </p>
  );

  switch (field.type) {
    case 'boolean':
      return (
        <div
          className={cn(
            'flex items-start justify-between gap-4 rounded-xl border border-border bg-background/40 p-3.5',
            wide && 'md:col-span-2',
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{field.label}</p>
            {help}
          </div>
          <Switch
            checked={Boolean(value)}
            disabled={disabled}
            label={field.label}
            onChange={onChange}
            className="mt-0.5"
          />
        </div>
      );

    case 'select':
      return (
        <label className="block">
          <span className="text-sm font-medium">{field.label}</span>
          <select
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              'mt-1.5 h-10 w-full rounded-lg border bg-surface px-3 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60',
              error ? 'border-destructive' : 'border-border-strong',
            )}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {help}
          {errorLine}
        </label>
      );

    case 'color':
      return (
        <ColorField
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
          help={help}
          errorLine={errorLine}
        />
      );

    case 'text':
      return (
        <div className={cn(wide && 'md:col-span-2')}>
          <Textarea
            label={field.label}
            rows={compact ? 3 : 4}
            value={value ?? ''}
            disabled={disabled}
            maxLength={field.maxLength}
            error={error}
            hint={[field.help, field.maxLength && `${(value ?? '').length}/${field.maxLength}`]
              .filter(Boolean)
              .join(' · ')}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case 'image':
    case 'video':
      return (
        <div className={cn(wide && 'md:col-span-2')}>
          <span className="text-sm font-medium">{field.label}</span>
          <div className="mt-1.5 flex flex-wrap items-start gap-4">
            {field.type === 'video' ? (
              value ? (
                <video
                  key={value}
                  src={mediaUrl(value)}
                  muted
                  loop
                  playsInline
                  controls
                  className="h-24 w-40 shrink-0 rounded-xl border border-border bg-black object-cover"
                />
              ) : (
                <div className="flex h-24 w-40 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-surface-hover text-xs text-muted-foreground">
                  No video
                </div>
              )
            ) : (
              <Thumbnail
                src={mediaUrl(value)}
                alt=""
                className={cn('shrink-0 rounded-xl', compact ? 'h-16 w-24' : 'h-24 w-40')}
              />
            )}
            <div className="min-w-[200px] flex-1 space-y-2">
              <input
                value={value ?? ''}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Upload, or paste https://…"
                aria-label={field.label}
                className={cn(
                  'h-9 w-full rounded-lg border bg-surface px-3 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-ring/60',
                  error ? 'border-destructive' : 'border-border-strong',
                )}
              />
              {!disabled && (
                <div className="flex flex-wrap gap-2">
                  <ImageUploadButton
                    accept={field.type === 'video' ? 'media' : 'image'}
                    endpoint="media"
                    folder="website"
                    label={value ? 'Replace' : `Upload ${field.type}`}
                    onUploaded={(url) => onChange(url)}
                    onError={onError}
                  />
                  {value && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
              {help}
              {errorLine}
            </div>
          </div>
        </div>
      );

    case 'schedule':
      return (
        <ScheduleField
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
          help={help}
          errorLine={errorLine}
        />
      );

    case 'list':
      return (
        <ListField
          field={field}
          path={path}
          value={value ?? []}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
          onError={onError}
        />
      );

    case 'number': {
      const suffix =
        field.unit === 'percent'
          ? '%'
          : field.unit === 'currency'
            ? 'Rs'
            : field.unit === 'minutes'
              ? 'min'
              : null;
      return (
        <Input
          label={suffix ? `${field.label} (${suffix})` : field.label}
          type="number"
          inputMode="decimal"
          step={field.unit === 'percent' ? '0.5' : 'any'}
          min={field.unit === 'percent' ? 0 : field.min}
          max={field.unit === 'percent' ? 100 : field.max}
          value={value ?? ''}
          disabled={disabled}
          error={error}
          hint={field.help}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }

    case 'url':
      return (
        <Input
          label={field.label}
          type="text"
          inputMode="url"
          placeholder="https://… or /page"
          value={value ?? ''}
          disabled={disabled}
          error={error}
          hint={field.help}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return (
        <Input
          label={field.label}
          value={value ?? ''}
          disabled={disabled}
          maxLength={field.maxLength}
          error={error}
          hint={field.help}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

const WEEK = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];

/** "18:00" → "6:00 pm" for the little readout beside each day. */
function readable(hhmm) {
  const [h, m] = String(hhmm ?? '')
    .split(':')
    .map(Number);
  if (Number.isNaN(h)) return '';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

/**
 * The weekly timetable: open / close per day, or closed all day.
 * A close earlier than the open runs past midnight; equal times mean 24 hours.
 */
function ScheduleField({ field, value, disabled, onChange, help, errorLine }) {
  const week = value ?? {};
  const set = (day, patch) =>
    onChange({ ...week, [day]: { open: '09:00', close: '23:00', closed: false, ...week[day], ...patch } });
  const copyToAll = (day) => onChange(Object.fromEntries(WEEK.map(([key]) => [key, { ...week[day] }])));

  return (
    <div className="md:col-span-2">
      <span className="text-sm font-medium">{field.label}</span>
      <div className="mt-2 overflow-hidden rounded-xl border border-border">
        {WEEK.map(([day, name], index) => {
          const entry = { open: '09:00', close: '23:00', closed: false, ...week[day] };
          const overnight = !entry.closed && entry.close < entry.open;
          const allDay = !entry.closed && entry.close === entry.open;
          return (
            <div
              key={day}
              className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3',
                index > 0 && 'border-t border-border',
                entry.closed && 'bg-surface-raised/40',
              )}
            >
              <span className="w-24 shrink-0 text-sm font-semibold">{name}</span>
              <span className="flex items-center gap-2 text-sm">
                <Switch
                  size="sm"
                  checked={!entry.closed}
                  disabled={disabled}
                  label={`Open on ${name}`}
                  onChange={(open) => set(day, { closed: !open })}
                />
                <span aria-hidden="true">Open</span>
              </span>
              {entry.closed ? (
                <span className="text-sm text-muted-foreground">Closed all day</span>
              ) : (
                <>
                  <input
                    type="time"
                    value={entry.open}
                    disabled={disabled}
                    onChange={(e) => set(day, { open: e.target.value })}
                    aria-label={`${name} opens`}
                    className="h-9 rounded-lg border border-border-strong bg-surface px-2 text-sm focus:border-gold focus:outline-none"
                  />
                  <span className="text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={entry.close}
                    disabled={disabled}
                    onChange={(e) => set(day, { close: e.target.value })}
                    aria-label={`${name} closes`}
                    className="h-9 rounded-lg border border-border-strong bg-surface px-2 text-sm focus:border-gold focus:outline-none"
                  />
                  <span className="text-xs text-muted-foreground">
                    {allDay
                      ? 'Open 24 hours'
                      : `${readable(entry.open)} – ${readable(entry.close)}${overnight ? ' (next day)' : ''}`}
                  </span>
                </>
              )}
              {!disabled && index === 0 && (
                <button
                  type="button"
                  onClick={() => copyToAll(day)}
                  className="ml-auto rounded-md px-2 py-1 text-xs font-semibold text-gold hover:bg-gold/10"
                >
                  Copy Monday to every day
                </button>
              )}
            </div>
          );
        })}
      </div>
      {help}
      {errorLine}
    </div>
  );
}

const COLOR_PRESETS = [
  '#f9b416',
  '#e11d48',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#db2777',
];

/** Brand colour: picker, hex box, presets and a live preview of what it does. */
function ColorField({ field, value, disabled, onChange, help, errorLine }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#f9b416';
  const dark = accentVariables(hex, 'dark');
  const light = accentVariables(hex, 'light');

  return (
    <div className="md:col-span-2">
      <span className="text-sm font-medium">{field.label}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <input
          type="color"
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${field.label} picker`}
          className="h-10 w-14 cursor-pointer rounded-lg border border-border-strong bg-surface p-1"
        />
        <input
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          aria-label={`${field.label} hex code`}
          className="h-10 w-28 rounded-lg border border-border-strong bg-surface px-3 font-mono text-sm uppercase focus:border-gold focus:outline-none"
        />
        <div className="flex gap-1.5">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset)}
              aria-label={`Use ${preset}`}
              className={cn(
                'h-7 w-7 rounded-full border-2',
                hex.toLowerCase() === preset ? 'border-foreground' : 'border-transparent',
              )}
              style={{ background: preset }}
            />
          ))}
        </div>
      </div>

      {/* The same derivation the site uses, so what you see is what they get. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {[
          ['On dark screens', dark, '#0b0b0c', '#f5f5f4'],
          ['On light screens', light, '#fbfaf7', '#1c1917'],
        ].map(([label, vars, bg, fg]) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-border p-3"
            style={{ background: bg, color: fg }}
          >
            <span
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ background: `hsl(${vars['--gold']})`, color: `hsl(${vars['--gold-foreground']})` }}
            >
              Order now
            </span>
            <span className="text-sm font-bold" style={{ color: `hsl(${vars['--gold']})` }}>
              Rs 1,250
            </span>
            <span className="ml-auto text-[11px] opacity-70">{label}</span>
          </div>
        ))}
      </div>
      {help}
      {errorLine}
    </div>
  );
}

/** A repeatable group: social links, footer links, custom fields, story blocks. */
function ListField({ field, path, value, errors, disabled, onChange, onError }) {
  const [open, setOpen] = useState(() => new Set());
  const itemEntries = Object.entries(field.itemFields);
  const titleKey =
    ['label', 'heading', 'platform', 'title', 'name', 'caption'].find((k) => field.itemFields[k]) ??
    itemEntries[0][0];
  const canAdd = !disabled && (!field.maxItems || value.length < field.maxItems);

  const blank = () =>
    Object.fromEntries(
      itemEntries.map(([k, f]) => [
        k,
        toDisplay(f, f.default ?? (f.type === 'select' ? f.options[0]?.value : undefined)),
      ]),
    );

  const update = (index, key, next) =>
    onChange(value.map((item, i) => (i === index ? { ...item, [key]: next } : item)));
  const move = (index, delta) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  const toggle = (index) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const titleOf = (item, index) => {
    const raw = item[titleKey];
    const option = field.itemFields[titleKey]?.options?.find((o) => o.value === raw);
    const secondary = item.url || item.href || item.value || item.year || item.role || '';
    // A picture-only entry (gallery photo) says so rather than showing its file address.
    const fallback =
      field.itemFields[titleKey]?.type === 'image' ? `Photo ${index + 1}` : `Entry ${index + 1}`;
    const title = field.itemFields[titleKey]?.type === 'image' ? fallback : raw || fallback;
    return { title: option?.label ?? title, secondary };
  };

  return (
    <div className="md:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="text-sm font-medium">{field.label}</span>
          {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
        </div>
        {canAdd && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={Plus}
            onClick={() => {
              onChange([...value, blank()]);
              setOpen((prev) => new Set(prev).add(value.length));
            }}
          >
            Add
          </Button>
        )}
      </div>

      {value.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          Nothing added yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {value.map((item, index) => {
            const { title, secondary } = titleOf(item, index);
            const isOpen =
              open.has(index) || Object.keys(errors).some((k) => k.startsWith(`${path}.${index}.`));
            return (
              <li key={index} className="rounded-xl border border-border bg-background/40">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggle(index)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronDown
                      className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium">{title}</span>
                    {secondary && (
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        {secondary}
                      </span>
                    )}
                  </button>
                  {!disabled && (
                    <div className="flex shrink-0 items-center">
                      <IconAction
                        label="Move up"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        icon={ArrowUp}
                      />
                      <IconAction
                        label="Move down"
                        disabled={index === value.length - 1}
                        onClick={() => move(index, 1)}
                        icon={ArrowDown}
                      />
                      <IconAction
                        label="Remove"
                        onClick={() => onChange(value.filter((_, i) => i !== index))}
                        icon={Trash2}
                        className="hover:text-destructive"
                      />
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid gap-3 border-t border-border p-3 md:grid-cols-2">
                        {itemEntries.map(([key, itemField]) => (
                          <SettingField
                            key={key}
                            compact
                            field={{ ...itemField, key }}
                            path={`${path}.${index}.${key}`}
                            value={item[key]}
                            errors={errors}
                            disabled={disabled}
                            onChange={(next) => update(index, key, next)}
                            onError={onError}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
      {field.maxItems && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {value.length} of {field.maxItems}
        </p>
      )}
    </div>
  );
}

function IconAction({ label, icon: Icon, onClick, disabled, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-30',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export default SettingsEditor;
