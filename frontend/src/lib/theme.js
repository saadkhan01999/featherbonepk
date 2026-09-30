/**
 * Runtime theming — the owner's brand colour and light/dark per surface.
 * ---------------------------------------------------------------------------
 * The whole design system reads its accent from a handful of CSS variables
 * (`--gold`, `--gold-soft`, `--gold-deep`, `--ring`, …; see index.css). Setting
 * those on <html> re-colours every button, badge, price and focus ring at once,
 * with no rebuild — which is what lets Settings → Theme take effect live.
 *
 * One colour in, a contrast-safe set out. The owner picks a single brand colour;
 * the shades are derived here:
 *
 *   • on dark, the colour is used as picked, with a lighter "soft" and a
 *     darker "deep" for gradients and pressed states;
 *   • on light, it is darkened until it reads on white — a pale yellow that
 *     glows on black is illegible as text on a white page;
 *   • the text colour on the accent (button labels) is chosen by luminance, so
 *     a dark brand colour gets white text and a light one gets near-black.
 *
 * The last theme is remembered per surface (website, admin, pos, kitchen) in
 * localStorage, and index.html applies it before React boots. Without that, a
 * light-mode till would flash dark on every load while settings are fetched.
 */

export const SURFACES = Object.freeze(['website', 'admin', 'pos', 'kitchen']);

const STORAGE_KEY = 'fb-theme-v2';

/** `#rrggbb` → `{ h, s, l }` with s and l in 0–100. */
export function hexToHsl(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!match) return null;

  const n = parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hsl = ({ h, s, l }) => `${h} ${s}% ${l}%`;

/** The accent variables for one brand colour in one mode. */
export function accentVariables(brandColor, mode = 'dark') {
  const base = hexToHsl(brandColor) ?? { h: 41, s: 95, l: 53 };

  // On light backgrounds an accent brighter than ~46% lightness fails 4.5:1 as text.
  const gold =
    mode === 'light' ? { ...base, l: clamp(base.l, 20, 44) } : { ...base, l: clamp(base.l, 30, 70) };
  const soft = { ...gold, l: clamp(gold.l + 8, 0, 85) };
  const deep = { ...gold, l: clamp(gold.l - 9, 8, 90) };

  // Text on the accent: whichever of near-black and white reads better.
  const onAccent = gold.l >= 52 ? '26 60% 8%' : '0 0% 100%';

  return {
    '--gold': hsl(gold),
    '--gold-soft': hsl(soft),
    '--gold-deep': hsl(deep),
    '--gold-foreground': onAccent,
    '--primary': hsl(gold),
    '--primary-foreground': onAccent,
    '--accent': hsl(gold),
    '--accent-foreground': onAccent,
    '--ring': hsl(gold),
  };
}

/** Apply a mode and brand colour to the document, now. */
export function applyTheme({ brandColor, mode = 'dark' } = {}) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const light = mode === 'light';

  root.classList.toggle('light', light);
  root.classList.toggle('dark', !light);
  root.style.colorScheme = light ? 'light' : 'dark';

  for (const [name, value] of Object.entries(accentVariables(brandColor, mode))) {
    root.style.setProperty(name, value);
  }

  // The browser chrome on mobile follows the canvas.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#fbfaf7' : '#0b0b0c');
}

/** Remember a surface's theme for the pre-React bootstrap in index.html. */
export function rememberTheme(surface, theme) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    all[surface] = { brandColor: theme.brandColor, mode: theme.mode };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* Private mode — the flash on first paint is the only cost. */
  }
}

/**
 * Resolve and apply the theme for one surface from the settings payload's
 * `theme` block (`{ brandColor, modes: { website, admin, pos, kitchen } }`).
 */
export function applySurfaceTheme(surface, theme) {
  if (!theme) return;
  const resolved = { brandColor: theme.brandColor, mode: theme.modes?.[surface] ?? 'dark' };
  applyTheme(resolved);
  rememberTheme(surface, resolved);
}

/** Which surface a path belongs to — shared with the index.html bootstrap. */
export function surfaceForPath(pathname = '/') {
  if (pathname.startsWith('/pos')) return 'pos';
  if (pathname.startsWith('/kitchen') || pathname.startsWith('/display')) return 'kitchen';
  if (pathname.startsWith('/admin')) return 'admin';
  return 'website';
}
