import { useCallback, useEffect, useRef } from 'react';

/**
 * Audible feedback for the till.
 * ---------------------------------------------------------------------------
 * Why a sound at all: a cashier scanning a queue is looking at the customer and
 * the goods, not at the screen. A short blip confirms "that registered" without
 * asking them to look up — the same reason supermarket scanners beep. Silence
 * after a scan is indistinguishable from a scan that did not take, so the
 * cashier looks down to check, and the queue waits.
 *
 * Why synthesised and not an MP3: an audio file is one more asset to ship, to
 * cache-bust and to lose on a bad deploy; the Web Audio API produces this in a
 * few lines with nothing to download. It also starts instantly — an <audio>
 * element has real latency on first play, which defeats the purpose.
 *
 * Two distinct tones, because they mean opposite things:
 *   • `ok`    a bright, short blip  — the item went into the basket
 *   • `error` a lower, longer buzz  — nothing was added (unknown barcode, out
 *                                     of stock). A failure that sounds like a
 *                                     success is worse than no sound at all.
 *
 * Autoplay: browsers refuse to start audio before the user has interacted with
 * the page. That is fine here — the first sound follows a click or a scan, which
 * is itself the interaction. The context is created lazily on first use for the
 * same reason, and every call is wrapped so a browser that blocks audio degrades
 * to silence rather than throwing into the sale flow.
 */

const TONES = {
  ok: { frequency: 880, duration: 0.07, gain: 0.06 },
  error: { frequency: 220, duration: 0.22, gain: 0.08 },
};

export function useClickSound({ enabled = true } = {}) {
  const contextRef = useRef(null);

  // Release the audio device when the till unmounts. Left open, the browser
  // keeps an audio context alive per navigation and eventually refuses new ones.
  useEffect(
    () => () => {
      contextRef.current?.close?.().catch(() => {});
      contextRef.current = null;
    },
    [],
  );

  return useCallback(
    (tone = 'ok') => {
      if (!enabled) return;

      try {
        const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
        if (!AudioCtx) return;

        const context = (contextRef.current ??= new AudioCtx());
        // Browsers suspend the context when it is created before a gesture.
        if (context.state === 'suspended') context.resume().catch(() => {});

        const { frequency, duration, gain } = TONES[tone] ?? TONES.ok;
        const now = context.currentTime;

        const oscillator = context.createOscillator();
        const envelope = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);

        /*
         * The envelope is what stops it sounding like a doorbell. A raw
         * gain-on/gain-off produces an audible click at each edge, so the level
         * ramps up over 1ms and decays exponentially — the result reads as a
         * soft "tick" rather than a beep, which is far less wearing on someone
         * hearing it three hundred times a shift.
         */
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(gain, now + 0.001);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        oscillator.connect(envelope).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + duration);
      } catch {
        // Audio is a nicety. It must never be able to interrupt a sale.
      }
    },
    [enabled],
  );
}

export default useClickSound;
