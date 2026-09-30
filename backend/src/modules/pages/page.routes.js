/**
 * Custom pages — mounted at {API_PREFIX}/pages.
 * ---------------------------------------------------------------------------
 *   GET    /pages            public — published pages, for the header and footer
 *   GET    /pages/:slug      public — one published page
 *   GET    /pages/admin/all  settings.view — every page, drafts included
 *   POST   /pages            settings.manage
 *   PATCH  /pages/:id        settings.manage
 *   DELETE /pages/:id        settings.manage
 *
 * A draft is invisible to the public API — not merely unlinked. An unpublished
 * page reachable by guessing its slug is a published page with extra steps.
 */
import { Router } from 'express';
import { z } from 'zod';

import { ApiError } from '../../core/errors/ApiError.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { realtime } from '../../core/realtime/realtime.js';
import { isSafeLink } from '../settings/settings.service.js';
import { auditService } from '../audit/audit.service.js';
import { Page, SLUG_PATTERN } from './page.model.js';

const router = Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid page');

const pageBody = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Give the page an address')
    .max(60)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and hyphens — e.g. privacy-policy'),
  title: z.string().trim().min(2, 'Give the page a title').max(120),
  subtitle: z.string().trim().max(240).optional(),
  heroImage: z
    .string()
    .trim()
    .max(500)
    .refine(isSafeLink, 'Upload an image or paste a web address')
    .optional(),
  body: z.string().max(20_000, 'That page is too long').optional(),
  seoDescription: z.string().trim().max(200).optional(),
  showInHeader: z.boolean().optional(),
  showInFooter: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).max(999).optional(),
});

const toSummary = (page) => ({
  id: String(page._id),
  slug: page.slug,
  title: page.title,
  showInHeader: page.showInHeader,
  showInFooter: page.showInFooter,
  displayOrder: page.displayOrder,
});

const toFull = (page) => ({
  ...toSummary(page),
  subtitle: page.subtitle,
  heroImage: page.heroImage,
  body: page.body,
  seoDescription: page.seoDescription,
  isPublished: page.isPublished,
  updatedAt: page.updatedAt,
});

// --- Admin (declared first, so "admin" is never read as a slug) -------------
router.get(
  '/admin/all',
  authenticate,
  checkPermission(PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (_req, res) => {
    const pages = await Page.find().sort({ displayOrder: 1, title: 1 }).lean();
    return sendSuccess(res, { message: 'OK', data: pages.map(toFull) });
  }),
);

// --- Public -----------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const pages = await Page.find({ isPublished: true })
      .select('slug title showInHeader showInFooter displayOrder')
      .sort({ displayOrder: 1, title: 1 })
      .lean();
    return sendSuccess(res, { message: 'OK', data: pages.map(toSummary) });
  }),
);

router.get(
  '/:slug',
  validate({ params: z.object({ slug: z.string().trim().toLowerCase().max(60) }) }),
  asyncHandler(async (req, res) => {
    const page = await Page.findOne({ slug: req.params.slug, isPublished: true }).lean();
    if (!page) throw ApiError.notFound('Page');
    return sendSuccess(res, { message: 'OK', data: toFull(page) });
  }),
);

// --- Writes -----------------------------------------------------------------
router.post(
  '/',
  authenticate,
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: pageBody }),
  asyncHandler(async (req, res) => {
    if (await Page.exists({ slug: req.body.slug })) {
      throw ApiError.conflict(`A page at /p/${req.body.slug} already exists`, {
        details: [{ field: 'slug', message: 'Already in use' }],
      });
    }
    const page = await Page.create({ ...req.body, createdBy: req.user.id, updatedBy: req.user.id });
    realtime.pagesChanged();
    await auditService.record({
      actor: req.user,
      action: 'page.created',
      module: 'settings',
      summary: `Created page "${page.title}" (/p/${page.slug})${page.isPublished ? ' — published' : ' — draft'}`,
      targetType: 'page',
      targetId: page._id,
    });
    return sendCreated(res, toFull(page.toObject()), 'Page created');
  }),
);

router.patch(
  '/:id',
  authenticate,
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ params: z.object({ id: objectId }), body: pageBody.partial() }),
  asyncHandler(async (req, res) => {
    const page = await Page.findById(req.params.id);
    if (!page) throw ApiError.notFound('Page');

    if (req.body.slug && req.body.slug !== page.slug && (await Page.exists({ slug: req.body.slug }))) {
      throw ApiError.conflict(`A page at /p/${req.body.slug} already exists`, {
        details: [{ field: 'slug', message: 'Already in use' }],
      });
    }

    Object.assign(page, req.body, { updatedBy: req.user.id });
    await page.save();
    realtime.pagesChanged();
    return sendSuccess(res, { message: 'Page saved', data: toFull(page.toObject()) });
  }),
);

router.delete(
  '/:id',
  authenticate,
  checkPermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const page = await Page.findByIdAndDelete(req.params.id).lean();
    if (!page) throw ApiError.notFound('Page');
    realtime.pagesChanged();
    await auditService.record({
      actor: req.user,
      action: 'page.deleted',
      module: 'settings',
      summary: `Deleted page "${page.title}" (/p/${page.slug})`,
      targetType: 'page',
      targetId: page._id,
    });
    return sendSuccess(res, { message: `"${page.title}" deleted`, data: { id: String(page._id) } });
  }),
);

export default router;
