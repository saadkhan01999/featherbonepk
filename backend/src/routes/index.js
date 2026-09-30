/**
 * API router — the single mounting table for every module.
 * ---------------------------------------------------------------------------
 * One file lists every namespace in the API, so "where does /orders live?" is
 * answered by reading this file rather than grepping the tree.
 *
 * Modules are added here as they are built; the table below doubles as the
 * build's progress marker.
 */
import { Router } from 'express';

import healthRoutes from '../modules/health/health.routes.js';
import authRoutes from '../modules/auth/auth.routes.js';
import catalogRoutes from '../modules/catalog/catalog.routes.js';
import adminCatalogRoutes from '../modules/catalog/admin.catalog.routes.js';
import dashboardRoutes from '../modules/dashboard/dashboard.routes.js';
import settingsRoutes from '../modules/settings/settings.routes.js';
import orderRoutes from '../modules/orders/order.routes.js';
import staffRoutes from '../modules/staff/staff.routes.js';
import reportRoutes from '../modules/reports/report.routes.js';
import reviewRoutes from '../modules/reviews/review.routes.js';
import posRoutes from '../modules/pos/pos.routes.js';
import promotionRoutes from '../modules/promotions/promotion.routes.js';
import wishlistRoutes from '../modules/wishlist/wishlist.routes.js';
import accountRoutes from '../modules/account/account.routes.js';
import customerRoutes from '../modules/customers/customer.routes.js';
import terminalRoutes from '../modules/pos/terminal.routes.js';
import storeRoutes from '../modules/stores/store.routes.js';
import stationRoutes from '../modules/stations/station.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import notificationRoutes from '../modules/notifications/notification.routes.js';
import messageRoutes from '../modules/messages/message.routes.js';
import kitchenRoutes from '../modules/kitchen/kitchen.routes.js';
import inventoryRoutes from '../modules/inventory/inventory.routes.js';
import pageRoutes from '../modules/pages/page.routes.js';
import feedbackRoutes from '../modules/feedback/feedback.routes.js';

export const apiRouter = Router();

// --- Platform ---
apiRouter.use('/health', healthRoutes);

// --- Identity (includes the separate POS terminal sign-in) ---
apiRouter.use('/auth', authRoutes);

// --- Catalogue (public menu, shared by storefront and till) ---
apiRouter.use('/catalog', catalogRoutes);

// --- Back office. Every route inside is permission-gated. ---
apiRouter.use('/admin/catalog', adminCatalogRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/staff', staffRoutes);
apiRouter.use('/customers', customerRoutes);
// The till registry is back office, so it uses the website token family — a
// cashier must not be able to register or re-enable a terminal.
apiRouter.use('/terminals', terminalRoutes);
// Stores scope almost everything else, so this sits with the back office.
apiRouter.use('/stores', storeRoutes);
// Read-only trail of consequential actions. See audit.model.js.
apiRouter.use('/audit', auditRoutes);
// Derived from live state — see notification.service.js.
apiRouter.use('/notifications', notificationRoutes);
// Contact form: public POST, authenticated inbox.
apiRouter.use('/messages', messageRoutes);
apiRouter.use('/reports', reportRoutes);
apiRouter.use('/reviews', reviewRoutes);

// --- Checkout, orders and gateway callbacks ---
// Payment callbacks live under /orders/payments/:provider/callback so the
// verification path sits beside the order it settles.
apiRouter.use('/orders', orderRoutes);
apiRouter.use('/wishlist', wishlistRoutes);
apiRouter.use('/account', accountRoutes);

// --- Point of sale. Guarded by the POS token family, not the website one. ---
apiRouter.use('/pos', posRoutes);

// --- Kitchen Display and counter Order Board. kitchen.view / kitchen.manage. ---
apiRouter.use('/kitchen', kitchenRoutes);
apiRouter.use('/stations', stationRoutes);

// --- Stock adjustments and the stock ledger. Reports live under /reports. ---
apiRouter.use('/inventory', inventoryRoutes);

// --- Marketing. Public read of live offers; the rest is permission-gated. ---
apiRouter.use('/promotions', promotionRoutes);

// --- Owner-written storefront pages (/p/:slug on the site). ---
apiRouter.use('/pages', pageRoutes);

// Customer feedback: open to every visitor, moderated in the back office.
apiRouter.use('/feedback', feedbackRoutes);

export default apiRouter;
