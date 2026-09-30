/**
 * Generate branded placeholder food imagery.
 * ---------------------------------------------------------------------------
 *   node scripts/generate-placeholder-images.mjs
 *
 * WHY GENERATED SVG RATHER THAN STOCK PHOTOS:
 *  • No network dependency — a hot-linked photo that 404s leaves the menu and
 *    the till full of broken tiles, which looks far worse than a placeholder.
 *  • Tiny (~1KB each) and infinitely scalable, so the POS grid stays sharp on a
 *    large touch screen without shipping megabytes of JPEG.
 *  • Drawn in the brand palette, so the grid reads as deliberate design rather
 *    than missing assets while real photography is pending.
 *
 * These are placeholders by design. Once the owner uploads real photos through
 * the admin product form, `product.image` points at the upload instead and
 * these are simply no longer referenced.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'products');

/** Warm palette, sampled from the design system's gold ramp. */
const P = {
  bg0: '#1a1512',
  bg1: '#0e0b09',
  gold: '#f9b416',
  goldSoft: '#fbc44a',
  goldDeep: '#c07f0a',
  crust: '#d98829',
  crustDark: '#a35f14',
  meat: '#b4471f',
  meatDark: '#7d2f13',
  cream: '#f3ddb0',
  green: '#5c7f3a',
  plate: '#2a2320',
};

/**
 * Shared frame: warm vignette background + a plate ellipse.
 * Every item sits on the same "plate" so the grid has a consistent rhythm.
 *
 * Gradient ids are the SAME in every file (crust1, meat1, …), which is safe
 * because these are served as standalone files via <img src>. Each is then its
 * own SVG document, so ids cannot collide. If they are ever INLINED into the
 * page instead, they must be made unique per file first — otherwise every tile
 * renders with whichever gradient the browser parsed first.
 */
const frame = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" role="img" aria-label="Food placeholder">
  <defs>
    <radialGradient id="bg1" cx="50%" cy="38%" r="72%">
      <stop offset="0%" stop-color="${P.bg0}"/>
      <stop offset="100%" stop-color="${P.bg1}"/>
    </radialGradient>
    <radialGradient id="glow1" cx="50%" cy="42%" r="46%">
      <stop offset="0%" stop-color="${P.gold}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${P.gold}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="crust1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${P.goldSoft}"/>
      <stop offset="100%" stop-color="${P.crustDark}"/>
    </linearGradient>
    <linearGradient id="meat1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${P.meat}"/>
      <stop offset="100%" stop-color="${P.meatDark}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#bg1)"/>
  <rect width="400" height="300" fill="url(#glow1)"/>
  <ellipse cx="200" cy="212" rx="132" ry="30" fill="${P.plate}"/>
  <ellipse cx="200" cy="208" rx="132" ry="30" fill="none" stroke="${P.gold}" stroke-opacity="0.28" stroke-width="1.5"/>
  ${body}
</svg>`;

/** One entry per visual family. Products map onto these by category. */
const ART = {
  // Whole roast bird: rounded body, wing highlight, two drumsticks.
  'roast-chicken': `
    <ellipse cx="200" cy="160" rx="76" ry="56" fill="url(#crust1)"/>
    <ellipse cx="182" cy="146" rx="40" ry="27" fill="${P.goldSoft}" opacity="0.5"/>
    <path d="M136 176c-14 8-26 6-30-2s6-18 22-20" fill="url(#crust1)" stroke="${P.crustDark}" stroke-width="2"/>
    <path d="M264 176c14 8 26 6 30-2s-6-18-22-20" fill="url(#crust1)" stroke="${P.crustDark}" stroke-width="2"/>
    <ellipse cx="200" cy="132" rx="30" ry="15" fill="${P.cream}" opacity="0.28"/>
    <circle cx="160" cy="188" r="4" fill="${P.green}" opacity="0.85"/>
    <circle cx="238" cy="190" r="3.5" fill="${P.green}" opacity="0.85"/>`,

  // Karahi / curry: dark wok with chunks of meat and a chilli.
  'mutton-beef': `
    <path d="M120 150h160c0 44-36 68-80 68s-80-24-80-68z" fill="#241c18" stroke="${P.gold}" stroke-opacity="0.35" stroke-width="2"/>
    <ellipse cx="200" cy="152" rx="80" ry="16" fill="url(#meat1)"/>
    <circle cx="176" cy="152" r="15" fill="${P.meat}"/>
    <circle cx="212" cy="148" r="17" fill="${P.meatDark}"/>
    <circle cx="238" cy="156" r="12" fill="${P.meat}"/>
    <path d="M186 138c8-6 20-6 28 0" stroke="${P.green}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="196" cy="145" rx="6" ry="3" fill="${P.cream}" opacity="0.35"/>`,

  // Grilled tikka pieces on a skewer.
  'tikka': `
    <line x1="118" y1="178" x2="284" y2="150" stroke="#8a8f96" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="152" cy="171" rx="24" ry="20" fill="url(#meat1)" transform="rotate(-9 152 171)"/>
    <ellipse cx="200" cy="163" rx="25" ry="21" fill="${P.meat}" transform="rotate(-9 200 163)"/>
    <ellipse cx="248" cy="155" rx="24" ry="20" fill="url(#meat1)" transform="rotate(-9 248 155)"/>
    <path d="M140 162c8-4 16-4 22 2" stroke="${P.goldSoft}" stroke-width="2.5" fill="none" opacity="0.6" stroke-linecap="round"/>
    <path d="M236 146c8-4 16-4 22 2" stroke="${P.goldSoft}" stroke-width="2.5" fill="none" opacity="0.6" stroke-linecap="round"/>`,

  // Seekh kababs on a grill.
  'bbq': `
    <line x1="112" y1="196" x2="288" y2="196" stroke="#6b7075" stroke-width="3"/>
    <line x1="112" y1="182" x2="288" y2="182" stroke="#6b7075" stroke-width="3"/>
    <rect x="126" y="150" width="150" height="20" rx="10" fill="url(#meat1)" transform="rotate(-4 200 160)"/>
    <rect x="126" y="176" width="150" height="20" rx="10" fill="${P.meatDark}" transform="rotate(-4 200 186)"/>
    <path d="M150 120c6-12-6-18 0-28M200 116c6-12-6-18 0-28M250 120c6-12-6-18 0-28"
      stroke="${P.gold}" stroke-opacity="0.3" stroke-width="3" fill="none" stroke-linecap="round"/>`,

  // Stack of naan / flatbread.
  'bakery': `
    <ellipse cx="200" cy="186" rx="92" ry="30" fill="${P.crustDark}"/>
    <ellipse cx="200" cy="172" rx="92" ry="30" fill="url(#crust1)"/>
    <ellipse cx="182" cy="164" rx="26" ry="9" fill="${P.cream}" opacity="0.35"/>
    <circle cx="228" cy="168" r="4" fill="${P.crustDark}" opacity="0.7"/>
    <circle cx="206" cy="180" r="3" fill="${P.crustDark}" opacity="0.6"/>
    <circle cx="248" cy="180" r="3" fill="${P.crustDark}" opacity="0.6"/>`,

  // Mithai / dessert pieces.
  'sweets': `
    <rect x="140" y="150" width="52" height="42" rx="6" fill="${P.cream}"/>
    <rect x="140" y="150" width="52" height="14" rx="6" fill="${P.goldSoft}"/>
    <rect x="204" y="150" width="52" height="42" rx="6" fill="#e8c98f"/>
    <rect x="204" y="150" width="52" height="14" rx="6" fill="${P.gold}"/>
    <circle cx="200" cy="140" r="16" fill="${P.crust}"/>
    <circle cx="196" cy="135" r="5" fill="${P.cream}" opacity="0.5"/>
    <circle cx="166" cy="146" r="3" fill="${P.green}"/>`,

  // Bottled drink with a glass.
  'beverages': `
    <path d="M186 108h28v16l10 16v58a8 8 0 0 1-8 8h-32a8 8 0 0 1-8-8v-58l10-16z" fill="#7a1f1f"/>
    <path d="M186 108h28v16l10 16v10h-48v-10l10-16z" fill="#a32a2a"/>
    <rect x="184" y="146" width="32" height="22" rx="3" fill="${P.cream}" opacity="0.85"/>
    <path d="M238 150h34l-5 52h-24z" fill="#c9d4dc" opacity="0.35"/>
    <path d="M240 162h30l-3 34h-24z" fill="#8b2b2b" opacity="0.75"/>`,

  // Fries in a carton.
  'sides': `
    <path d="M164 158h72l-9 60h-54z" fill="#c0392b"/>
    <path d="M164 158h72l-2 14h-68z" fill="#e04b39"/>
    <g fill="url(#crust1)">
      <rect x="172" y="118" width="11" height="46" rx="4" transform="rotate(-9 177 141)"/>
      <rect x="190" y="112" width="11" height="52" rx="4"/>
      <rect x="208" y="116" width="11" height="48" rx="4" transform="rotate(7 213 140)"/>
      <rect x="224" y="124" width="11" height="42" rx="4" transform="rotate(13 229 145)"/>
    </g>`,

  // Family combo: platter with several items.
  'combos': `
    <ellipse cx="200" cy="168" rx="110" ry="46" fill="#241c18" stroke="${P.gold}" stroke-opacity="0.3" stroke-width="2"/>
    <ellipse cx="164" cy="156" rx="34" ry="26" fill="url(#crust1)"/>
    <ellipse cx="156" cy="150" rx="16" ry="10" fill="${P.goldSoft}" opacity="0.45"/>
    <rect x="206" y="140" width="62" height="16" rx="8" fill="url(#meat1)"/>
    <rect x="206" y="162" width="62" height="16" rx="8" fill="${P.meatDark}"/>
    <ellipse cx="200" cy="192" rx="54" ry="12" fill="${P.crust}" opacity="0.65"/>`,
};

mkdirSync(OUT_DIR, { recursive: true });

let index = 0;
for (const [name, body] of Object.entries(ART)) {
  index += 1;
  writeFileSync(join(OUT_DIR, `${name}.svg`), frame(body), 'utf8');
  console.log(`  wrote ${name}.svg`);
}

console.log(`\n${index} placeholder images written to public/images/products/\n`);
