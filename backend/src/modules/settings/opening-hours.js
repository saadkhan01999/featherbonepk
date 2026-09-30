/**
 * Opening hours — is the shop open, and does the website take orders now?
 * ---------------------------------------------------------------------------
 * Pure functions over the weekly schedule saved in Website Management →
 * Opening Hours. Everything is computed in the shop's time zone (Pakistan),
 * never the server's or the visitor's: a customer abroad ordering for their
 * family in Mardan is ordering from a shop on Mardan time.
 *
 * The schedule
 *   { mon: { open: '09:00', close: '23:00', closed: false }, tue: …, sun: … }
 *
 *   close later than open   → the same day        09:00 → 23:00
 *   close earlier than open → past midnight       18:00 → 02:00 (next day)
 *   close equal to open     → open 24 hours       00:00 → 00:00
 *   closed: true            → shut all day
 *
 * A late window from yesterday counts too: at 01:00 on Tuesday a shop open
 * Monday 18:00–02:00 is open, and closes at 02:00.
 *
 * Pakistan has no daylight-saving time, so minute arithmetic from "now" is
 * exact. (Elsewhere a window crossing a DST change could be off by an hour.)
 */

export const SHOP_TIME_ZONE = 'Asia/Karachi';

/** Keys in JavaScript `getDay()` order: 0 = Sunday. */
export const DAY_KEYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MINUTES_PER_DAY = 24 * 60;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Everyday default: 9 am to 11 pm, seven days. */
export const DEFAULT_SCHEDULE = Object.freeze(
  Object.fromEntries(DAY_KEYS.map((day) => [day, { open: '09:00', close: '23:00', closed: false }])),
);

export const isValidTime = (value) => TIME.test(String(value ?? ''));

const toMinutes = (hhmm) => {
  const [, h, m] = TIME.exec(hhmm) ?? [null, '0', '0'];
  return Number(h) * 60 + Number(m);
};

/** The shop-local weekday and minute-of-day for an instant. */
function localClock(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: SHOP_TIME_ZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { day: DAY_SHORT.indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** The open window for one weekday, in minutes from that day's midnight — or null when closed. */
function windowFor(schedule, dayIndex) {
  const entry = schedule?.[DAY_KEYS[(dayIndex + 7) % 7]];
  if (!entry || entry.closed || !isValidTime(entry.open) || !isValidTime(entry.close)) return null;
  const start = toMinutes(entry.open);
  let end = toMinutes(entry.close);
  if (end <= start) end += MINUTES_PER_DAY; // past midnight, or 24 hours when equal
  return { start, end };
}

/** "9:00 am" in shop time. */
export function formatClock(date) {
  return new Intl.DateTimeFormat('en-PK', {
    timeZone: SHOP_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toLowerCase();
}

/** "today at 9:00 am", "tomorrow at 9:00 am", "Monday at 9:00 am". */
export function describeWhen(date, now = new Date()) {
  const target = localClock(date);
  const today = localClock(now);
  const daysAhead = Math.floor((today.minutes + Math.round((date - now) / 60000)) / MINUTES_PER_DAY);
  const label = daysAhead <= 0 ? 'today' : daysAhead === 1 ? 'tomorrow' : DAY_NAMES[target.day];
  return `${label} at ${formatClock(date)}`;
}

const minutesFromNow = (now, minutes) => new Date(now.getTime() + minutes * 60_000);

/**
 * Where the shop stands right now.
 * @param {object} schedule weekly schedule (see top of file)
 * @param {object} [options]
 * @param {Date}    [options.now]
 * @param {number}  [options.lastOrderMinutes] stop taking orders this long before closing
 * @param {boolean} [options.temporarilyClosed] the "closed right now" switch
 */
export function hoursStatus(
  schedule,
  { now = new Date(), lastOrderMinutes = 0, temporarilyClosed = false } = {},
) {
  const { day, minutes } = localClock(now);
  // Seconds matter at the boundary: at 22:59:30 there are 30 seconds left, not a minute.
  const exact = minutes + now.getUTCSeconds() / 60;

  let closesAt = null;

  // Still inside last night's late window?
  const yesterday = windowFor(schedule, day - 1);
  if (yesterday && yesterday.end > MINUTES_PER_DAY && exact < yesterday.end - MINUTES_PER_DAY) {
    closesAt = minutesFromNow(now, yesterday.end - MINUTES_PER_DAY - exact);
  }

  // Inside today's window?
  const today = windowFor(schedule, day);
  if (!closesAt && today && exact >= today.start && exact < today.end) {
    closesAt = minutesFromNow(now, today.end - exact);
  }

  // Open straight through midnight into the next day's window (24-hour days,
  // or 18:00–00:00 followed by 00:00–02:00): the real closing time is later.
  if (closesAt) {
    for (let hop = 0; hop < 7; hop += 1) {
      const endMinutes = Math.round(exact + (closesAt - now) / 60_000); // from today's midnight
      const nextDay = Math.round(endMinutes / MINUTES_PER_DAY);
      const next = windowFor(schedule, day + nextDay);
      if (!next || endMinutes % MINUTES_PER_DAY !== 0 || next.start !== 0) break;
      closesAt = minutesFromNow(now, nextDay * MINUTES_PER_DAY + next.end - exact);
    }
  }

  // The next time it opens (the next window that has not started yet).
  // While open, that is the first opening after tonight's close.
  const notBefore = closesAt ? (closesAt - now) / 60_000 : 0;
  let opensAt = null;
  for (let offset = 0; offset <= 8 && !opensAt; offset += 1) {
    const w = windowFor(schedule, day + offset);
    if (!w) continue;
    const startsIn = offset * MINUTES_PER_DAY + w.start - exact;
    if (startsIn > notBefore) opensAt = minutesFromNow(now, startsIn);
  }

  const isOpen = Boolean(closesAt);
  const minutesLeft = isOpen ? (closesAt - now) / 60_000 : 0;
  const inLastOrders = isOpen && lastOrderMinutes > 0 && minutesLeft <= lastOrderMinutes;
  const acceptingOrders = isOpen && !inLastOrders && !temporarilyClosed;

  const reason = temporarilyClosed
    ? 'temporarily-closed'
    : !isOpen
      ? 'closed'
      : inLastOrders
        ? 'last-orders'
        : 'open';

  return {
    isOpen: isOpen && !temporarilyClosed,
    acceptingOrders,
    reason,
    closesAt: isOpen ? closesAt.toISOString() : null,
    // Closed by the switch, the schedule cannot say when it reopens.
    opensAt: opensAt && !temporarilyClosed ? opensAt.toISOString() : null,
    opensAtText: opensAt && !temporarilyClosed ? describeWhen(opensAt, now) : null,
    closesAtText: isOpen ? formatClock(closesAt) : null,
    checkedAt: now.toISOString(),
  };
}

/**
 * The week in a few lines for the footer and Contact page, with days that
 * share hours grouped: "Mon – Thu · 9:00 am – 11:00 pm", "Fri · Closed".
 */
export function scheduleSummary(schedule) {
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const text = (entry) => {
    if (!entry || entry.closed) return 'Closed';
    if (entry.open === entry.close) return 'Open 24 hours';
    const clock = (hhmm) => {
      const m = toMinutes(hhmm);
      const h = Math.floor(m / 60);
      const suffix = h >= 12 ? 'pm' : 'am';
      return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${suffix}`;
    };
    return `${clock(entry.open)} – ${clock(entry.close)}`;
  };

  const lines = [];
  for (const index of order) {
    const hours = text(schedule?.[DAY_KEYS[index]]);
    const last = lines[lines.length - 1];
    if (last && last.hours === hours) last.to = index;
    else lines.push({ from: index, to: index, hours });
  }
  return lines.map(({ from, to, hours }) => ({
    days: from === to ? DAY_SHORT[from] : `${DAY_SHORT[from]} – ${DAY_SHORT[to]}`,
    hours,
  }));
}

/** Validate and normalise a schedule from a settings form. Throws a message on a bad value. */
export function cleanSchedule(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Opening hours must list the days of the week');
  return Object.fromEntries(
    DAY_KEYS.map((day) => {
      const entry = raw[day] ?? {};
      const closed = typeof entry.closed === 'string' ? entry.closed === 'true' : Boolean(entry.closed);
      const open = String(entry.open ?? '').trim() || '09:00';
      const close = String(entry.close ?? '').trim() || '23:00';
      if (!closed && (!isValidTime(open) || !isValidTime(close))) {
        throw new Error(`Use times like 09:00 and 23:00 for ${DAY_NAMES[DAY_KEYS.indexOf(day)]}`);
      }
      return [day, { open, close, closed }];
    }),
  );
}
