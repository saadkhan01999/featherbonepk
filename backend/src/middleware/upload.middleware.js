/**
 * Media upload handling (images and video).
 * ---------------------------------------------------------------------------
 * The checks live here; where the bytes end up is `core/storage/media.storage.js`,
 * chosen by UPLOAD_DRIVER. Both drivers pass through every control below, which
 * is the reason the split is drawn here rather than further down: a second
 * upload path would inevitably grow a weaker copy of these rules.
 *
 * Where files go with the local driver: `env.uploadDir`, which defaults to
 * `backend/uploads` but is overridable with `UPLOAD_DIR`. That override is the
 * difference between a catalogue that keeps its photos and one that loses every
 * image on the next deploy: most hosts give each release a fresh filesystem, so
 * on production this must point at a mounted volume that outlives the container
 * — or, more simply, UPLOAD_DRIVER=cloudinary.
 *
 * With the Cloudinary driver the file is held in memory, not written to disk.
 * Multer's size limit is applied before anything is buffered, so the ceiling on
 * what a request can allocate is the same one that applies to disk, and a
 * rejected file leaves nothing behind to clean up.
 *
 * Security: an upload endpoint is one of the most attacked parts of any admin
 * panel. Four independent controls here:
 *
 *  1. MIME allow-list — reject anything not on it up front.
 *  2. Server-generated filenames — the client's filename is never used. A name
 *     like `../../server.js` or `shell.php` is how path traversal and
 *     executable-upload attacks work; a random name makes both impossible.
 *  3. Size limit — enforced by multer before the file is buffered, so an
 *     oversized upload cannot exhaust memory.
 *  4. Signature check — the file's actual leading bytes must match the type it
 *     claims to be.
 *
 * Control 4 was missing, and its absence made control 1 decorative. The MIME
 * type in a multipart upload is a string the client chooses; it is not derived
 * from the bytes. A probe confirmed the gap: a Windows executable sent as
 * `evil.png` with `Content-Type: image/png` was accepted and stored, and the
 * uploads directory is served publicly — so the site could be used to host and
 * distribute a binary from its own domain, with the owner's URL lending it
 * credibility. Checking the magic bytes is the only way to know what a file
 * actually is.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import multer from 'multer';

import { env } from '../config/env.config.js';
import { ApiError } from '../core/errors/ApiError.js';
import { saveUpload, isCloudinary } from '../core/storage/media.storage.js';
import { logger } from '../core/utils/logger.js';

/** Single source of truth for the storage root — see the header note. */
const UPLOAD_ROOT = env.uploadDir;

/** Extensions we are willing to write, keyed by the MIME type we accept. */
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  // SVG is deliberately not allowed: it can carry <script>, so serving a
  // user-uploaded SVG from our own origin is a stored-XSS vector.
]);

/**
 * Video types, kept separate from images because they carry a different size
 * limit — and because most endpoints (a product photo, a category tile) should
 * accept images only. Mixing them into one list would silently let someone set
 * a 50MB clip as a product thumbnail.
 */
const VIDEO_TYPES = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  // QuickTime .mov is what iPhones produce, and it is what a restaurant owner
  // filming their kitchen will actually try to upload.
  ['video/quicktime', '.mov'],
]);

const ALL_TYPES = new Map([...IMAGE_TYPES, ...VIDEO_TYPES]);

/**
 * What is this file, judged by its opening bytes?
 *
 * Every format here begins with a fixed marker. Returns the MIME type the
 * content says it is, or null if it matches nothing we accept.
 *
 * The ISO base-media formats (MP4, AVIF, MOV) all carry `ftyp` at offset 4 and
 * are told apart by the brand that follows, which is why they are handled
 * together rather than by a flat prefix table.
 */
function sniffType(head) {
  const startsWith = (...bytes) => bytes.every((b, i) => head[i] === b);
  const ascii = (offset, length) => head.subarray(offset, offset + length).toString('latin1');

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';

  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand.startsWith('qt')) return 'video/quicktime';
    // mp42, isom, iso2, mmp4, M4V … all ordinary MP4 containers.
    return 'video/mp4';
  }

  return null;
}

/**
 * Reject anything whose bytes disagree with its declared type.
 *
 * With the local driver this runs after multer has already written the file, so
 * a rejection must also delete what was written, or a refused upload still
 * leaves the payload on disk. With the Cloudinary driver the bytes are still in
 * memory and nothing has left this process — which is why the check runs before
 * the upload rather than after it, and a forged file never reaches the account
 * at all.
 *
 * @param {Map<string,string>} allowed The type family this endpoint accepts.
 */
function verifySignature(allowed) {
  return (req, _res, next) => {
    if (!req.file) return next();

    const discard = () => {
      if (!req.file.path) return; // Memory storage: nothing on disk to remove.
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // Already gone, or the volume went away. Rejecting still matters more.
      }
    };

    let head;
    if (req.file.buffer) {
      head = req.file.buffer.subarray(0, 16);
    } else {
      try {
        const handle = fs.openSync(req.file.path, 'r');
        head = Buffer.alloc(16);
        fs.readSync(handle, head, 0, 16, 0);
        fs.closeSync(handle);
      } catch {
        discard();
        return next(ApiError.internal('The uploaded file could not be read back for checking.'));
      }
    }

    const actual = sniffType(head);

    if (!actual || !allowed.has(actual)) {
      discard();
      return next(
        ApiError.badRequest(
          'That file is not the kind of file it claims to be. Upload a real ' +
            (allowed === IMAGE_TYPES ? 'image (JPG, PNG, WebP or AVIF).' : 'image or video.'),
        ),
      );
    }

    /*
     * Correct the extension to match the content. The name was chosen from the
     * declared type, so a genuine MP4 announced as `image/png` would otherwise
     * sit on disk as `.png` and be served with the wrong content type.
     *
     * Only relevant on disk. Cloudinary derives the delivery extension from the
     * bytes it receives, so there is no name to correct.
     */
    const correct = allowed.get(actual);
    if (req.file.path && path.extname(req.file.path) !== correct) {
      const renamed = req.file.path.replace(/\.[^.]+$/, correct);
      try {
        fs.renameSync(req.file.path, renamed);
        req.file.path = renamed;
        req.file.filename = path.basename(renamed);
      } catch {
        // Keep the original name rather than fail: the content is verified,
        // which is the part that matters.
      }
    }

    req.file.mimetype = actual;
    return next();
  };
}

/**
 * Hand the verified file to the configured driver.
 *
 * Attaches `req.storedFile = { url, publicId }`. Routes read that instead of
 * building a URL themselves, so neither of them knows which driver ran.
 */
function persist(req, _res, next) {
  if (!req.file) return next();

  /*
   * Where this asset should be filed, named by the client.
   *
   * Read from the multipart body, which multer has finished parsing by the time
   * this runs, so the field is present regardless of the order the browser sent
   * its parts in. Optional: an endpoint that does not send one still gets the
   * month-based path.
   *
   * The value is untrusted and is sanitised inside the storage layer rather
   * than here — it is that module which decides what a public id may contain,
   * and putting the check anywhere else invites a second upload path that skips
   * it.
   */
  const folder = typeof req.body?.folder === 'string' ? req.body.folder : undefined;

  saveUpload(req.file, { folder })
    .then((stored) => {
      req.storedFile = stored;
      next();
    })
    .catch((error) => {
      logger.error('Upload could not be stored', {
        driver: env.UPLOAD_DRIVER,
        message: error.message,
      });
      next(
        ApiError.internal(
          isCloudinary
            ? 'The image could not be sent to the media library. Please try again.'
            : 'The image could not be saved. Check that the upload directory is writable.',
        ),
      );
    });
  return undefined;
}

const diskStorage = multer.diskStorage({
  destination(_req, _file, callback) {
    // Files are grouped by month so a directory never grows to hundreds of
    // thousands of entries, which slows down listing and backup.
    const folder = path.join(UPLOAD_ROOT, new Date().toISOString().slice(0, 7));
    try {
      fs.mkdirSync(folder, { recursive: true });
      callback(null, folder);
    } catch (error) {
      // A read-only or missing volume is the most likely production failure
      // here, and multer's own message ("ENOENT") says nothing useful about it.
      callback(
        ApiError.internal(
          `Cannot write to the upload directory (${UPLOAD_ROOT}). ` +
            `Check UPLOAD_DIR and that the volume is mounted and writable. [${error.code}]`,
        ),
      );
    }
  },

  filename(_req, file, callback) {
    // The original name is discarded entirely — see note 2 above.
    const extension = ALL_TYPES.get(file.mimetype) ?? '.bin';
    callback(null, `${crypto.randomBytes(16).toString('hex')}${extension}`);
  },
});

/*
 * Memory for Cloudinary, disk for local.
 *
 * Deliberately not "memory everywhere for simplicity": the local driver serves
 * files straight off the filesystem, and buffering a 50MB video through the
 * heap only to write it out again doubles the peak memory of every upload for
 * no benefit.
 */
const storage = isCloudinary ? multer.memoryStorage() : diskStorage;

/**
 * Build an upload handler for one family of media.
 * @param {Map<string,string>} types  accepted MIME types
 * @param {number} maxBytes           size ceiling
 * @param {string} describe           what to say when the type is refused
 */
function handlerFor(types, maxBytes, describe) {
  return multer({
    storage,
    limits: {
      fileSize: maxBytes,
      files: 1,
      // Cap non-file fields too; multipart parsing is otherwise unbounded.
      fields: 10,
    },
    fileFilter(_req, file, callback) {
      if (!types.has(file.mimetype)) {
        return callback(ApiError.badRequest(`Unsupported file type "${file.mimetype}". ${describe}`));
      }
      return callback(null, true);
    },
  }).single('image');
}

/**
 * Images only — product photos, category art, banners, the payment QR.
 *
 * The three steps are ordered so that each one only ever sees input the
 * previous one has already vouched for: parse and cap → prove the bytes are
 * what they claim → store. Nothing leaves the process before step two.
 */
export const uploadImage = [
  handlerFor(IMAGE_TYPES, env.uploadMaxBytes, 'Use JPG, PNG, WebP or AVIF.'),
  verifySignature(IMAGE_TYPES),
  persist,
];

/**
 * Images *or* video — the storefront media fields, where the story video and
 * its poster frame are set from the same screen.
 *
 * The size limit is the video ceiling for both, because multer decides the
 * limit before it knows the MIME type. An image beyond the image cap is
 * therefore accepted here; that is a deliberate trade for a single field that
 * takes either, and the type list is still enforced.
 */
export const uploadMedia = [
  handlerFor(ALL_TYPES, env.uploadVideoMaxBytes, 'Use JPG, PNG, WebP, AVIF, MP4, WebM or MOV.'),
  verifySignature(ALL_TYPES),
  persist,
];

/** True when the stored file is a video, for callers that branch on it. */
export function isVideo(file) {
  return Boolean(file && VIDEO_TYPES.has(file.mimetype));
}

/**
 * The URL that goes into the database, produced by whichever driver ran.
 *
 * Local URLs stay relative (`/uploads/…`) so the same record works across
 * localhost, staging and production without a rewrite; Cloudinary URLs are
 * absolute HTTPS because that is where the asset genuinely lives. The client
 * handles both — see frontend/src/lib/media.js.
 */
export function publicUrlFor(req) {
  return req?.storedFile?.url ?? null;
}

/** Exported so the static handler serves exactly what the writer wrote. */
export { UPLOAD_ROOT };
