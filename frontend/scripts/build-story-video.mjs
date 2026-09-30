/**
 * Build the "Our Restaurant Story" promo video.
 * ---------------------------------------------------------------------------
 *   node scripts/build-story-video.mjs
 *
 * Renders a short cinematic reel from the menu photography already in the
 * project: a slow Ken Burns push on each frame, crossfaded together, graded
 * slightly warm to match the brand.
 *
 * WHY GENERATE RATHER THAN DOWNLOAD A STOCK CLIP:
 *  • Licence certainty — it is built from imagery already cleared for this
 *    project, so there is no second licence to audit.
 *  • Stock CDNs block hotlinking, so a downloaded clip would have to be
 *    committed as a large binary anyway.
 *  • The result is on-brand: our food, our grade, our pacing.
 *
 * OUTPUT IS DELIBERATELY SILENT. Browsers block autoplay for videos with an
 * audio track; a muted video is the only kind that can play automatically
 * behind a hero section. It is also the polite default for a site that opens
 * while someone is at work.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const PHOTOS = join(here, '..', 'public', 'images', 'products', 'photos');
const OUT_DIR = join(here, '..', 'public', 'video');

/** ffmpeg-static is a dev-time dependency; resolved lazily so a normal
 *  install/build never needs it. */
let ffmpeg;
try {
  ffmpeg = require('ffmpeg-static');
} catch {
  console.error('ffmpeg-static is not installed. Run:  npm i -D ffmpeg-static');
  process.exit(1);
}

/**
 * Frames in narrative order: the room, then the people in it.
 *
 * NO PLATED FOOD HERE — the menu grid sits directly beside this panel and
 * already shows every dish. Repeating them turns the story video into a second
 * advert for the same products; showing the ROOM and the GUESTS is what
 * communicates atmosphere, which is the only thing a still menu cannot.
 */
const FRAMES = ['venue-room', 'venue-interior', 'venue-guests', 'venue-table', 'venue-friends'];

const W = 1280;
const H = 720;
const SECONDS_PER_FRAME = 2.8;
const FADE = 0.7; // Crossfade duration between frames.
// 24fps is cinematic and cuts render cost ~20% versus 30 for a slow push.
const FPS = 24;

const missing = FRAMES.filter((name) => !existsSync(join(PHOTOS, `${name}.jpg`)));
if (missing.length) {
  console.error(`Missing source photos: ${missing.join(', ')}`);
  console.error('Run  node scripts/fetch-menu-photos.mjs  first.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const framesTotal = Math.round(SECONDS_PER_FRAME * FPS);

/*
 * zoompan's `d` is frames emitted PER INPUT FRAME, not per segment.
 *
 * The input here is `-loop 1 -t 2.8`, which is already ~67 frames — so `d=67`
 * emits 67x67 = 4,489 frames and turns a 14-second reel into a 16-minute one.
 * (Observed exactly that before fixing it.)
 *
 * `d=1` is correct for a looped still: one output frame per input frame, with
 * `zoom` accumulating across them. The per-frame step is therefore the total
 * zoom travel divided by the segment's frame count.
 */
const ZOOM_TRAVEL = 0.12; // 1.00 -> 1.12 across the segment
const zoomStep = (ZOOM_TRAVEL / framesTotal).toFixed(6);

/*
 * Per-frame filter chain:
 *   scale/crop  — fill 1280x720 without distortion
 *   zoompan     — the Ken Burns push (1.0 → 1.12 over the frame's duration)
 *   fade        — in/out, which the concat crossfade blends across
 *
 * NOTE: zoompan is applied to an UPSCALED source. Zooming a 1280-wide image
 * directly resamples from too few pixels and the push looks soft and juddery;
 * scaling up first gives it room to crop into. 2x is the sweet spot — 4x looks
 * no better at 720p output but multiplies render time several-fold, because
 * zoompan resamples the full upscaled frame on EVERY output frame.
 */
const inputs = FRAMES.flatMap((name) => ['-loop', '1', '-t', String(SECONDS_PER_FRAME), '-i', join(PHOTOS, `${name}.jpg`)]);

const perFrame = FRAMES.map(
  (_, i) =>
    `[${i}:v]scale=${W * 2}:-1,` +
    `zoompan=z='min(zoom+${zoomStep},${1 + ZOOM_TRAVEL})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},` +
    `setsar=1,` +
    // Warm grade + gentle vignette so the reel matches the dark/gold UI.
    `eq=contrast=1.06:saturation=1.12:gamma_r=1.03:gamma_b=0.97,` +
    `vignette=PI/5,` +
    `fade=t=in:st=0:d=${FADE},fade=t=out:st=${SECONDS_PER_FRAME - FADE}:d=${FADE}[v${i}]`,
);

const concat = `${FRAMES.map((_, i) => `[v${i}]`).join('')}concat=n=${FRAMES.length}:v=1:a=0[out]`;
const filter = [...perFrame, concat].join(';');

const outFile = join(OUT_DIR, 'restaurant-story.mp4');

console.log(`Rendering ${FRAMES.length} frames → ${(FRAMES.length * SECONDS_PER_FRAME).toFixed(1)}s…`);

execFileSync(
  ffmpeg,
  [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[out]',
    '-c:v', 'libx264',
    '-profile:v', 'main',
    // yuv420p is REQUIRED for Safari/iOS. ffmpeg defaults to yuv444p here,
    // which those browsers refuse to decode — the video silently never plays.
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '26',
    // Puts the index at the head of the file so playback can start before the
    // whole thing has downloaded.
    '-movflags', '+faststart',
    '-an', // no audio track — see the note above about autoplay
    outFile,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

// Poster frame: shown before playback and while the video buffers. Without it
// the player is a black rectangle on first paint.
execFileSync(
  ffmpeg,
  ['-y', '-i', outFile, '-ss', '1.5', '-vframes', '1', '-q:v', '4', join(OUT_DIR, 'restaurant-story-poster.jpg')],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

console.log(`  ✓ ${outFile}`);
console.log(`  ✓ poster frame written`);
