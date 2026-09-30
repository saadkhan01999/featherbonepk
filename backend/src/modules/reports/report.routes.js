/**
 * Report routes — mounted at {API_PREFIX}/reports.
 * ---------------------------------------------------------------------------
 *   GET /reports                    the reports this account may open
 *   GET /reports/:id                run one, as JSON (the on-screen View)
 *   GET /reports/:id/export?format= the same report as `csv` (default) or `pdf`
 *
 * Permissions are per report, not a blanket router gate: an operations manager
 * may need product performance without seeing financial breakdowns. The
 * catalogue endpoint filters by the same rule, so the menu only ever lists
 * reports the caller can actually open.
 */
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, attachPermissions, checkPermission } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { sendSuccess } from '../../core/http/ApiResponse.js';
import { PERMISSIONS } from '../../core/constants/roles.js';
import { businessDetails } from '../settings/settings.service.js';
import { reportService, toCsv, toClientReport, MOVEMENT_TYPE_VALUES } from './report.service.js';
import { renderReportPdf } from './report.pdf.js';

const router = Router();

router.use(authenticate, attachPermissions);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

const querySchema = z.object({
  preset: z.enum(['today', 'week', 'month', 'quarter', 'year', 'custom']).default('month'),
  // Calendar dates only — parsing is done in the service, in the business
  // timezone. `new Date(str)` here would reintroduce the UTC-shift bug.
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Whose sales: the whole business, the website, every till, or one till. */
  scope: z.enum(['all', 'online', 'pos', 'terminal']).default('all'),
  terminal: z.string().trim().max(24).optional(),
  /**
   * Narrow to one counter. A request, not a grant — the service refuses a store
   * the caller is not assigned to, and imposes their own when they name none.
   */
  store: objectId.optional(),
  category: objectId.optional(),
  stock: z.enum(['all', 'active', 'in', 'low', 'out', 'inactive']).default('active'),
  movement: z.enum(['all', ...MOVEMENT_TYPE_VALUES]).default('all'),
  format: z.enum(['csv', 'pdf']).default('csv'),
});

router.get(
  '/',
  asyncHandler(async (req, res) =>
    sendSuccess(res, { message: 'OK', data: reportService.catalogue(req.can) }),
  ),
);

router.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1).max(60) }), query: querySchema }),
  asyncHandler(async (req, res) => {
    const report = await reportService.run(req.params.id, req.query, req.can, req.user, { mode: 'view' });
    return sendSuccess(res, { message: 'OK', data: toClientReport(report) });
  }),
);

/**
 * Export.
 * Requires `report.export` in addition to the report's own permission — being
 * able to read a figure on screen is a smaller grant than being able to walk
 * out with the whole dataset.
 */
router.get(
  '/:id/export',
  checkPermission(PERMISSIONS.REPORT_EXPORT),
  validate({ params: z.object({ id: z.string().min(1).max(60) }), query: querySchema }),
  asyncHandler(async (req, res) => {
    const { format } = req.query;
    const report = await reportService.run(req.params.id, req.query, req.can, req.user, { mode: format });

    // `fb-sales-overview-till-01-2026-09-25.pdf` — the scope in the name, so
    // three till exports saved to one folder do not overwrite each other.
    const stamp = new Date().toISOString().slice(0, 10);
    const scopePart = report.scope?.terminal
      ? `-${report.scope.terminal.toLowerCase()}`
      : report.scope?.key && report.scope.key !== 'all'
        ? `-${report.scope.key}`
        : '';
    const filename = `fb-${req.params.id}${scopePart}-${stamp}.${format}`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // A generated file must never be served from a shared cache to someone else.
    res.setHeader('Cache-Control', 'private, no-store');

    if (format === 'pdf') {
      const pdf = await renderReportPdf(report, businessDetails());
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(pdf);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(toCsv(report));
  }),
);

export default router;
