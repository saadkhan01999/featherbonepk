/**
 * Catalogue administration routes — mounted at {API_PREFIX}/admin/catalog.
 * ---------------------------------------------------------------------------
 * Every route is gated on a permission, not a role. That is what lets the owner
 * create a "Menu Manager" role in the back office and have it work immediately,
 * with no code change.
 */
import { Router } from 'express';
import { z } from 'zod';

import { ApiError } from '../../core/errors/ApiError.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission, attachPermissions } from '../../middleware/auth.middleware.js';
import { uploadImage, uploadMedia, isVideo, publicUrlFor } from '../../middleware/upload.middleware.js';
import { writeLimiter } from '../../middleware/rateLimiter.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { UNIT_VALUES, CHANNEL_VALUES } from './product.model.js';
import { adminCatalogService } from './admin.catalog.service.js';

const router = Router();

// Everything below requires a signed-in staff account.
router.use(authenticate);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// --- Schemas ---------------------------------------------------------------

const categoryBody = z.object({
  name: z.string().trim().min(2, 'Enter a category name').max(80),
  description: z.string().trim().max(500).optional(),
  image: z.string().trim().optional().nullable(),
  /**
   * Where it is sold. At least one channel — an empty list would hide the
   * record everywhere, which is a deletion wearing a disguise.
   */
  channels: z.array(z.enum(CHANNEL_VALUES)).min(1, 'Choose the website, the till, or both').optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

const productBody = z.object({
  name: z.string().trim().min(2, 'Enter a product name').max(140),
  category: objectId,
  /**
   * Which counter sells this.
   *
   * Nullable on purpose, and null is the common case: drinks, sides and combos
   * are rung up at whichever till the customer reaches and exist once in stock,
   * not once per counter. `.nullable()` (not just `.optional()`) so an item can
   * be moved back to "every counter" after being assigned — optional alone
   * would drop the field and leave the old assignment in place.
   */
  store: objectId.nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  // coerce: an HTML number input submits a string.
  price: z.coerce.number().min(0, 'Price cannot be negative'),
  costPrice: z.coerce.number().min(0).optional(),
  unit: z.enum(UNIT_VALUES).default('pcs'),
  // Digits only — a barcode with stray spaces will never match a scan.
  barcode: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, 'Barcode must be 6–20 digits')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  sku: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  image: z.string().trim().optional().nullable(),
  discountPercent: z.coerce.number().min(0).max(90).optional(),
  stock: z.coerce.number().min(0).optional(),
  lowStockThreshold: z.coerce.number().min(0).optional(),
  /**
   * Where it is sold. At least one channel — an empty list would hide the
   * record everywhere, which is a deletion wearing a disguise.
   */
  channels: z.array(z.enum(CHANNEL_VALUES)).min(1, 'Choose the website, the till, or both').optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
});

// --- Image upload ----------------------------------------------------------
// Shared by both forms; returns a URL the client then submits with the record.
// Uploading separately means a failed save doesn't lose the chosen image.
router.post(
  '/uploads',
  checkPermission(PERMISSIONS.PRODUCT_MANAGE),
  writeLimiter,
  uploadImage,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      /*
       * A bare `throw new Error` here produced a 500 — an unhandled server
       * fault for what is a malformed request. The logs filled with stack
       * traces pointing at this line, which told nobody anything: the actual
       * cause was the client sending `Content-Type: application/json` with a
       * FormData body, so multer found no multipart part to read.
       *
       * A 400 with a message naming the likely cause is both correct and
       * debuggable.
       */
      throw ApiError.badRequest(
        'No image was received. Send the file as multipart/form-data in a field named "image" — do not set the Content-Type header yourself, the browser must add the multipart boundary.',
      );
    }
    return sendCreated(res, { url: publicUrlFor(req), size: req.file.size }, 'Image uploaded');
  }),
);

// --- Media upload (images or video) ----------------------------------------
/*
 * A second endpoint rather than widening the first.
 *
 * `/uploads` is used by product photos, category tiles and the payment QR,
 * where a 50MB video is never a valid answer — widening it would let someone
 * set a film clip as a product thumbnail and quietly blow up every page that
 * renders it in an <img>.
 *
 * This one is for the storefront media fields, which legitimately take either.
 * Gated on SETTINGS_MANAGE, matching the screen that uses it.
 */
router.post(
  '/uploads/media',
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  writeLimiter,
  uploadMedia,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw ApiError.badRequest(
        'No file was received. Send it as multipart/form-data in a field named "image" — do not set the Content-Type header yourself, the browser must add the multipart boundary.',
      );
    }
    return sendCreated(
      res,
      {
        url: publicUrlFor(req),
        size: req.file.size,
        // The client uses this to decide between <img> and <video> without
        // having to guess from the file extension.
        kind: isVideo(req.file) ? 'video' : 'image',
      },
      isVideo(req.file) ? 'Video uploaded' : 'Image uploaded',
    );
  }),
);

// --- Categories ------------------------------------------------------------

router.get(
  '/categories',
  checkPermission(PERMISSIONS.CATEGORY_VIEW),
  asyncHandler(async (_req, res) =>
    sendSuccess(res, { message: 'OK', data: await adminCatalogService.listCategories() }),
  ),
);

router.post(
  '/categories',
  checkPermission(PERMISSIONS.CATEGORY_MANAGE),
  validate({ body: categoryBody }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await adminCatalogService.createCategory(req.body, req.user.id), 'Category created'),
  ),
);

router.patch(
  '/categories/:id',
  checkPermission(PERMISSIONS.CATEGORY_MANAGE),
  validate({ params: z.object({ id: objectId }), body: categoryBody.partial() }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Category updated',
      data: await adminCatalogService.updateCategory(req.params.id, req.body, req.user.id),
    }),
  ),
);

router.delete(
  '/categories/:id',
  checkPermission(PERMISSIONS.CATEGORY_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Category deleted',
      data: await adminCatalogService.deleteCategory(req.params.id),
    }),
  ),
);

// --- Products --------------------------------------------------------------

router.get(
  '/products',
  checkPermission(PERMISSIONS.PRODUCT_VIEW),
  validate({
    query: z.object({
      search: z.string().trim().max(120).optional(),
      category: objectId.optional(),
      status: z.enum(['all', 'active', 'inactive', 'low-stock']).default('all'),
      /*
       * Free-form on purpose. The columns that may be sorted are whitelisted in
       * the service (PRODUCT_SORTS); rejecting an unknown value here would turn
       * a stale bookmark into an error page instead of a list in the default
       * order, which is the wrong trade for a display preference.
       */
      sort: z.string().trim().max(40).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await adminCatalogService.listProducts(req.query);
    return sendPaginated(res, items, { page, limit, total });
  }),
);

router.post(
  '/products',
  checkPermission(PERMISSIONS.PRODUCT_MANAGE),
  validate({ body: productBody }),
  asyncHandler(async (req, res) =>
    sendCreated(res, await adminCatalogService.createProduct(req.body, req.user.id), 'Product saved'),
  ),
);

router.patch(
  '/products/:id',
  checkPermission(PERMISSIONS.PRODUCT_MANAGE),
  attachPermissions,
  validate({ params: z.object({ id: objectId }), body: productBody.partial() }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, {
      message: 'Product updated',
      // `req.user` too, so the audit entry names the person rather than an id.
      data: await adminCatalogService.updateProduct(req.params.id, req.body, req.user.id, req.user, {
        // Checked in the service against the current figure: the form resends
        // an unchanged stock value on every save, and that must not be refused.
        canAdjustStock: req.can(PERMISSIONS.INVENTORY_ADJUST),
      }),
    }),
  ),
);

router.delete(
  '/products/:id',
  checkPermission(PERMISSIONS.PRODUCT_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const result = await adminCatalogService.deleteProduct(req.params.id);
    // The message distinguishes archived from deleted, because the two have
    // very different consequences and the admin must know which happened.
    return sendSuccess(res, { message: result.message, data: result });
  }),
);

export default router;
