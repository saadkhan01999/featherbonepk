/**
 * Move existing local uploads into Cloudinary.
 * ---------------------------------------------------------------------------
 *   npm run migrate:media              show what would move (changes nothing)
 *   npm run migrate:media -- --apply   actually move it
 *
 * Why this is a command and not part of startup.
 *
 * It rewrites rows and uploads to a paid third-party account. A migration that
 * runs itself on boot runs again on every restart, on every replica, and during
 * the crash-loop where a container is restarting once a second — which is the
 * worst possible moment to be pushing files somewhere that bills per request.
 * It is idempotent, so that would be survivable rather than correct; the right
 * shape for a one-off data change is still a command someone chooses to run.
 *
 * Dry run by default. It prints the plan and exits. Nothing is uploaded and no
 * record is touched until `--apply` is passed.
 *
 * The local file is never deleted. After a successful migration the row points
 * at Cloudinary and the file on disk is simply unreferenced — so a mistake is
 * recoverable by restoring the previous value, and an old backup restored into
 * this database still finds its images. Clearing the directory is a separate
 * decision, made once you are satisfied.
 *
 * Safe to run twice. Only `/uploads/...` values are considered; anything already
 * absolute is skipped, so a re-run after a partial failure picks up exactly the
 * rows that did not make it.
 */
import path from 'node:path';
import fs from 'node:fs/promises';

import mongoose from 'mongoose';

import { env } from '../src/config/env.config.js';
import { connectDatabase } from '../src/database/connect.js';
import { logger } from '../src/core/utils/logger.js';
import { uploadToCloudinary } from '../src/core/storage/media.storage.js';
import { Product } from '../src/modules/catalog/product.model.js';
import { Category } from '../src/modules/catalog/category.model.js';

const APPLY = process.argv.includes('--apply');

/** Everything this project stores under /uploads is one of these. */
const CONTENT_TYPE = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

const isLocalUpload = (value) => typeof value === 'string' && value.startsWith('/uploads/');

const stats = { moved: 0, missing: 0, failed: 0, skipped: 0 };
/** One entry per distinct source URL, so an image on three products uploads once. */
const alreadyMoved = new Map();

/**
 * Upload one local file and return its Cloudinary URL.
 *
 * Returns null when the file is gone from disk — which is common on a host that
 * gave each deploy a fresh filesystem, and is exactly the situation this
 * migration exists to end. A missing file is reported and left alone rather
 * than nulled: the row still names what the image was, which is the only clue
 * left for putting it back, and blanking it destroys that for no gain.
 */
async function moveOne(url, folder) {
  if (alreadyMoved.has(url)) return alreadyMoved.get(url);

  const relative = url.replace(/^\/uploads\//, '');
  const absolute = path.resolve(env.uploadDir, relative);

  // Containment check, same rule as the storage layer: a crafted row must not
  // read a file from outside the upload directory.
  const root = path.resolve(env.uploadDir);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    logger.warn(`  refusing a path outside the upload root: ${url}`);
    stats.failed += 1;
    return null;
  }

  let buffer;
  try {
    buffer = await fs.readFile(absolute);
  } catch {
    stats.missing += 1;
    console.log(`  MISSING  ${url}  (file is not on disk — row left unchanged)`);
    return null;
  }

  const mimetype = CONTENT_TYPE[path.extname(absolute).toLowerCase()];
  if (!mimetype) {
    stats.skipped += 1;
    console.log(`  SKIP     ${url}  (unrecognised file type)`);
    return null;
  }

  if (!APPLY) {
    console.log(`  would move  ${url}  ->  ${env.CLOUDINARY_FOLDER}/${folder}/…`);
    stats.moved += 1;
    return null;
  }

  try {
    const { url: cloudUrl } = await uploadToCloudinary({ mimetype, buffer }, { folder });
    alreadyMoved.set(url, cloudUrl);
    stats.moved += 1;
    console.log(`  moved    ${url}\n        -> ${cloudUrl}`);
    return cloudUrl;
  } catch (error) {
    stats.failed += 1;
    console.log(`  FAILED   ${url}  (${error.message})`);
    return null;
  }
}

async function migrateProducts() {
  const products = await Product.find({
    $or: [{ image: /^\/uploads\// }, { gallery: /^\/uploads\// }],
  }).populate('category', 'name');

  if (products.length) console.log(`\nProducts (${products.length}):`);

  for (const product of products) {
    // Filed under the product's own category, matching where new uploads go.
    const folder = product.category?.name ?? 'products';
    let changed = false;

    if (isLocalUpload(product.image)) {
      const moved = await moveOne(product.image, folder);
      if (moved) {
        product.image = moved;
        changed = true;
      }
    }

    if (Array.isArray(product.gallery) && product.gallery.some(isLocalUpload)) {
      const next = [];
      for (const item of product.gallery) {
        if (!isLocalUpload(item)) {
          next.push(item);
          continue;
        }
        const moved = await moveOne(item, folder);
        // Keep the original when the move failed, so nothing is lost.
        next.push(moved ?? item);
        if (moved) changed = true;
      }
      product.gallery = next;
    }

    // `validateBeforeSave: false` because this touches only URL fields on rows
    // that were already valid; a since-tightened rule elsewhere on the document
    // must not block a media migration.
    if (changed && APPLY) await product.save({ validateBeforeSave: false });
  }
}

async function migrateCategories() {
  const categories = await Category.find({ image: /^\/uploads\// });
  if (categories.length) console.log(`\nCategories (${categories.length}):`);

  for (const category of categories) {
    const moved = await moveOne(category.image, 'categories');
    if (moved && APPLY) {
      category.image = moved;
      await category.save({ validateBeforeSave: false });
    }
  }
}

async function main() {
  if (env.UPLOAD_DRIVER !== 'cloudinary') {
    console.error(
      `\nUPLOAD_DRIVER is "${env.UPLOAD_DRIVER}", not "cloudinary".\n` +
        'There is nowhere to migrate to. Set UPLOAD_DRIVER=cloudinary (and the three\n' +
        'CLOUDINARY_* values) in the environment this command runs against.\n',
    );
    process.exit(1);
  }

  await connectDatabase();
  console.log(
    APPLY
      ? '\nMigrating local uploads to Cloudinary.\n'
      : '\nDRY RUN — nothing will be uploaded or changed. Re-run with --apply to do it.\n',
  );

  await migrateProducts();
  await migrateCategories();

  console.log(
    `\n${APPLY ? 'Moved' : 'Would move'}: ${stats.moved}` +
      `   missing on disk: ${stats.missing}` +
      `   skipped: ${stats.skipped}` +
      `   failed: ${stats.failed}`,
  );

  if (stats.missing > 0) {
    console.log(
      '\nRows whose file is gone were left pointing at the old path. The frontend\n' +
        'shows a placeholder for those; re-upload those images from the back office.',
    );
  }
  if (APPLY && stats.moved > 0) {
    console.log('\nThe local files were NOT deleted. Clear them once you are satisfied.');
  }

  await mongoose.connection.close();
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  logger.error('Media migration failed', { message: error.message });
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
