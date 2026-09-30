/**
 * Catalogue routes — mounted at {API_PREFIX}/catalog.
 * ---------------------------------------------------------------------------
 * Read-only and public: the menu must be browsable by a guest. Write endpoints
 * for the admin product manager live behind authentication in their own router.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../../core/http/ApiResponse.js';
import { catalogService } from './catalog.service.js';

const router = Router();

const listQuerySchema = z.object({
  category: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
  featured: z.coerce.boolean().optional(),
  bestSeller: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  // Capped at 100 so a caller cannot request the entire collection in one page.
  limit: z.coerce.number().int().positive().max(100).default(24),
  sort: z
    .enum(['featured', 'newest', 'price-asc', 'price-desc', 'popular', 'rating', 'name'])
    .default('featured'),
});

// --- Categories ------------------------------------------------------------
router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    // 'web': the public site never shows counter-only lines.
    const categories = await catalogService.listCategories({ channel: 'web' });
    return sendSuccess(res, { message: 'OK', data: categories });
  }),
);

// --- Products --------------------------------------------------------------
router.get(
  '/products',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const { items, total, page, limit } = await catalogService.listProducts({
      ...req.query,
      // Forced, not taken from the query — a client must not be able to ask the
      // public endpoint for till-only items by adding ?channel=pos.
      channel: 'web',
    });
    return sendPaginated(res, items, { page, limit, total });
  }),
);

/** Homepage best sellers: pinned first, then real sales, then popular. */
router.get(
  '/best-sellers',
  validate({
    query: z.object({
      limit: z.coerce.number().int().positive().max(24).default(8),
      days: z.coerce.number().int().positive().max(365).default(90),
    }),
  }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: await catalogService.bestSellers(req.query) }),
  ),
);

/**
 * Scanned-code lookup. Declared before `/products/:slug` so that "resolve" is
 * not swallowed as a slug — route order is load-bearing here.
 */
router.get(
  '/products/resolve',
  validate({ query: z.object({ code: z.string().trim().min(1, 'A code is required') }) }),
  asyncHandler(async (req, res) => {
    const product = await catalogService.resolveScannedCode(req.query.code, { channel: 'web' });
    return sendSuccess(res, { message: 'Product found', data: product });
  }),
);

router.get(
  '/products/:slug',
  asyncHandler(async (req, res) => {
    const product = await catalogService.getProductBySlug(req.params.slug);
    return sendSuccess(res, { message: 'OK', data: product });
  }),
);

export default router;
