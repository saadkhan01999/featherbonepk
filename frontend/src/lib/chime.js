/**
 * Alert tones for the kitchen, the order board and the till.
 * ---------------------------------------------------------------------------
 * Generated with Web Audio rather than shipped as audio files: nothing to
 * download, nothing to cache, and the tone is identical on every device.
 *
 * Browsers block sound until someone taps the page. A kitchen screen left
 * running from a fresh boot would otherwise stay silent all day while looking
 * as if it were working. `unlockAudio()` is called from a real click (the sound
 * toggle, or any first tap), and `isAudioLocked()` lets the screen say
 * "tap to enable sound" instead of failing quietly.
 */

let context = null;

function audio() {
  const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext ?? window.webkitAudioContext) : null;
  if (!AudioCtx) return null;
  context ??= new AudioCtx();
  return context;
}

/** Call from a click handler. Safe to call repeatedly. */
export function unlockAudio() {
  const ctx = audio();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** True while the browser is still refusing to play sound. */
export function isAudioLocked() {
  const ctx = audio();
  return !ctx || ctx.state !== 'running';
}

/**
 * The tones, as note sequences [frequency Hz, start s, length s].
 *   order   a new ticket in the kitchen — two rising notes, noticeable over a fryer
 *   ready   an order is ready — a brighter three-note "ding-ding-ding"
 *   alert   something needs attention (a ticket running late)
 */
const PATTERNS = {
  order: [
    [660, 0, 0.16],
    [880, 0.18, 0.24],
  ],
  ready: [
    [988, 0, 0.14],
    [1319, 0.16, 0.14],
    [1568, 0.32, 0.3],
  ],
  alert: [
    [440, 0, 0.2],
    [440, 0.28, 0.2],
  ],
};

export function playChime(kind = 'order', volume = 0.35) {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return false;

  const now = ctx.currentTime;
  for (const [frequency, start, length] of PATTERNS[kind] ?? PATTERNS.order) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    // A short attack and exponential release: a bell, not a click.
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + length + 0.05);
  }
  return true;
}
