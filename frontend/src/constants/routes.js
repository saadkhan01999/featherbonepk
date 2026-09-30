/**
 * Route table — the single source of truth for every URL in the app.
 * ---------------------------------------------------------------------------
 * Components and the router reference these constants instead of literal
 * strings, so renaming a path is one edit and a typo is a build-time missing
 * property rather than a silent dead link.
 *
 * Three separate surfaces, deliberately kept apart:
 *   /            the public storefront and customer account
 *   /pos         the till — its own login, its own session, its own layout
 *   /admin       the back office
 *
 * The POS lives on its own URL with its own sign-in because a terminal is a
 * shared physical device in a shop. Its session must not be interchangeable
 * with a customer's browser session on the same machine.
 */
export const ROUTES = Object.freeze({
  // --- Public storefront ---
  HOME: '/',
  MENU: '/menu',
  OFFERS: '/offers',
  ABOUT: '/about',
  CONTACT: '/contact',
  FEEDBACK: '/feedback',
  TRACK_ORDER: '/track-order',
  SEARCH: '/search',
  CATEGORY: '/menu/:slug', // pattern
  PRODUCT: '/product/:slug', // pattern

  // --- Shopping ---
  CART: '/cart',
  WISHLIST: '/wishlist',
  CHECKOUT: '/checkout',
  ORDER_CONFIRMATION: '/order/:orderNumber', // pattern

  // --- Customer auth ---
  LOGIN: '/login',
  // The staff portal has its own address — see StaffLoginPage for why.
  STAFF_LOGIN: '/admin/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  VERIFY_EMAIL: '/verify-email',
  UNAUTHORIZED: '/unauthorized',

  // --- Customer account ---
  ACCOUNT: '/account',
  ACCOUNT_ORDERS: '/account/orders',
  ACCOUNT_ADDRESSES: '/account/addresses',
  ACCOUNT_PROFILE: '/account/profile',
  ACCOUNT_SECURITY: '/account/security',

  // --- POS terminal (separate secure surface) ---
  POS_LOGIN: '/pos/login',
  POS: '/pos',
  POS_SALES: '/pos/sales',
  POS_SHIFTS: '/pos/shifts',
  POS_RETURNS: '/pos/returns',

  // --- Back office ---
  ADMIN: '/admin',
  ADMIN_CATEGORIES: '/admin/categories',
  ADMIN_PRODUCTS: '/admin/products',
  ADMIN_INVENTORY: '/admin/inventory',
  ADMIN_ORDERS: '/admin/orders',
  ADMIN_STATIONS: '/admin/stations',
  ADMIN_CUSTOMERS: '/admin/customers',
  ADMIN_FEEDBACK: '/admin/feedback',
  ADMIN_MESSAGES: '/admin/messages',
  ADMIN_OFFERS: '/admin/offers',
  ADMIN_USERS: '/admin/users',
  ADMIN_ROLES: '/admin/roles',
  ADMIN_REPORTS: '/admin/reports',
  ADMIN_STORES: '/admin/stores',
  ADMIN_POS_MANAGEMENT: '/admin/pos',
  ADMIN_SETTINGS: '/admin/settings',
  ADMIN_WEBSITE: '/admin/website',
  ADMIN_FINANCE: '/admin/finance',
  ADMIN_LOGS: '/admin/logs',
  ADMIN_NOTIFICATIONS: '/admin/notifications',
  ADMIN_PAGES: '/admin/pages',
  ADMIN_PROFILE: '/admin/profile',
  ADMIN_TILL_REPORT: '/admin/pos/:code', // pattern

  // --- Kitchen (own full-screen surfaces, website session + kitchen.view) ---
  KITCHEN: '/kitchen',
  ORDER_BOARD: '/display',

  // --- Owner-written storefront pages ---
  PAGE: '/p/:slug', // pattern

  NOT_FOUND: '*',
});

// --- Builders for dynamic routes -------------------------------------------
// URL construction lives here so a pattern and its builder can never drift.

export const categoryPath = (slug) => `/menu/${slug}`;
export const productPath = (slug) => `/product/${slug}`;
export const orderPath = (orderNumber) => `/order/${orderNumber}`;
export const pagePath = (slug) => `/p/${slug}`;
export const tillReportPath = (code) => `/admin/pos/${encodeURIComponent(code)}`;

export default ROUTES;
