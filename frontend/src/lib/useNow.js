import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `interval` ms.
 *
 * One ticking clock per screen rather than one per card: a kitchen with forty
 * tickets would otherwise run forty timers, all drifting apart.
 */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);

  return now;
}

/** `mm:ss`, or `h:mm:ss` past the hour — how a kitchen reads a ticket's age. */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default useNow;
