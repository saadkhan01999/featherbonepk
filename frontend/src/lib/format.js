/**
 * Formatting helpers — money, dates, numbers.
 * ---------------------------------------------------------------------------
 * All currency rendering in the app goes through `formatCurrency`. One
 * implementation means the receipt, the cart, the dashboard and the CSV export
 * can never disagree about how "Rs 1,200" is written.
 *
 * Money is handled in whole rupees. The domain prices everything in whole
 * PKR — there are no paisa amounts on the menu — so rounding is applied at the
 * edges rather than carrying float noise through totals. If sub-unit pricing is
 * ever needed, the correct fix is integer minor-units end to end, not adding
 * decimals here.
 */

const LOCALE = 'en-PK';

/*
 * Intl.NumberFormat construction is surprisingly expensive and these run inside
 * list renders (a menu grid formats a price per card, per keystroke of a
 * filter). Building each formatter once is a meaningful saving.
 */
const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Format an amount as PKR.
 *
 * The symbol is written as "Rs" rather than Intl's "PKR"/"₨" because that is
 * what the receipt, the menu boards and the printed slip use — matching the
 * physical artefacts matters more here than locale orthodoxy.
 *
 * @param {number} amount
 * @param {object} [options]
 * @param {boolean} [options.withSymbol=true]
 * @param {boolean} [options.compact=false] 1250000 → "Rs 1.25M" for dashboard tiles.
 */
export function formatCurrency(amount, { withSymbol = true, compact = false } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return withSymbol ? 'Rs 0' : '0';

  if (compact) {
    const abs = Math.abs(value);
    const [divisor, suffix] =
      abs >= 1_000_000_000
        ? [1_000_000_000, 'B']
        : abs >= 1_000_000
          ? [1_000_000, 'M']
          : abs >= 1_000
            ? [1_000, 'K']
            : [1, ''];
    const scaled = decimalFormatter.format(Math.round((value / divisor) * 100) / 100);
    return withSymbol ? `Rs ${scaled}${suffix}` : `${scaled}${suffix}`;
  }

  const formatted = currencyFormatter.format(Math.round(value));
  return withSymbol ? `Rs ${formatted}` : formatted;
}

/** Plain number with thousands separators — order counts, stock quantities. */
export function formatNumber(value, maximumFractionDigits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(n);
}

/**
 * Quantity with its unit. Weight-based items sell in fractions, countable
 * items do not — "1.5 Kg" is correct, "1.5 Pcs" is a bug worth making visible.
 */
export function formatQuantity(quantity, unit = 'pcs') {
  const n = Number(quantity) || 0;
  const isWeight = ['kg', 'g', 'ltr', 'ml'].includes(String(unit).toLowerCase());
  const shown = isWeight ? formatNumber(n, 3) : formatNumber(Math.round(n));
  return `${shown} ${UNIT_LABEL[String(unit).toLowerCase()] ?? unit}`;
}

/** Display labels for the units the catalogue supports. */
export const UNIT_LABEL = Object.freeze({
  kg: 'Kg',
  g: 'g',
  pcs: 'Pcs',
  pack: 'Pack',
  box: 'Box',
  dozen: 'Dozen',
  plate: 'Plate',
  ltr: 'Ltr',
  ml: 'ml',
});

/** Percentage, already expressed as a percentage (17 → "17%"). */
export function formatPercent(value, fractionDigits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${n.toFixed(fractionDigits)}%`;
}

/**
 * Signed percentage for trend indicators (+12.5% / −3.1%).
 * Returns null for a null input so the UI can render "no baseline" rather than
 * a misleading 0% — those mean very different things on a dashboard.
 */
export function formatDelta(value, fractionDigits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(fractionDigits)}%`;
}

// --- Dates -----------------------------------------------------------------
// The business runs in Pakistan; formatting in the viewer's local timezone
// would show a Karachi evening sale on the previous day for an overseas owner.

const TIMEZONE = 'Asia/Karachi';

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: TIMEZONE,
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: TIMEZONE,
});

/** "25 May 2026" */
export function formatDate(value) {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : '—';
}

/** "25 May 2026, 02:45 PM" */
export function formatDateTime(value) {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : '—';
}

/** "02:45 PM" */
export function formatTime(value) {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : '—';
}

/**
 * Relative time — "2 mins ago", "3 days ago".
 * Used in notification and activity feeds, where recency matters more than the
 * exact timestamp. Anything older than a week falls back to an absolute date,
 * because "43 days ago" is harder to reason about than the date itself.
 */
/*
 * Built once at module scope, like the currency and date formatters above.
 * Constructing an Intl formatter is comparatively expensive, and this is called
 * per row — an order list of fifty re-created it fifty times per render.
 */
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(value) {
  const date = toDate(value);
  if (!date) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';

  const divisions = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
  ];

  let duration = seconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return relativeTimeFormatter.format(-Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatDate(date);
}

/** Parse loosely (Date | ISO string | epoch ms) and reject invalid values. */
function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `YYYY-MM-DD` in the business timezone — for date inputs and report ranges.
 *
 * Deliberately not `toISOString().slice(0,10)`: that converts to UTC first, so
 * a 2am Karachi timestamp yields the previous calendar day. That single line is
 * the most common source of off-by-one-day bugs in date-range reporting.
 */
export function toDateInputValue(value) {
  const date = toDate(value) ?? new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIMEZONE,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Mask all but the last 4 characters — account numbers on receipts. */
export function maskTail(value, visible = 4) {
  const text = String(value ?? '');
  if (text.length <= visible) return text;
  return `${'•'.repeat(Math.min(text.length - visible, 8))}${text.slice(-visible)}`;
}
