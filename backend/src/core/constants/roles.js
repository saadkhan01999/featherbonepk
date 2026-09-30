/**
 * Roles and the permission catalogue.
 * ---------------------------------------------------------------------------
 * Two layers, deliberately:
 *
 *   Roles       — coarse identity ("what kind of account is this"). Stored on
 *                 the user, cheap to check, used for routing and guards.
 *   Permissions — fine-grained capability ("may this account refund a sale").
 *                 Routes are gated on these, not on role rank, so the owner can
 *                 create a "Kitchen Staff" role without anyone editing code.
 *
 * Gating on permissions rather than rank is what makes the role editor in the
 * back office real instead of decorative.
 */

export const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  RIDER: 'rider',
  KITCHEN: 'kitchen',
  CASHIER: 'cashier',
  MANAGER: 'manager',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

/**
 * Rank is used only for "can this account administer that account" checks —
 * never for feature access. Feature access is always a permission lookup.
 */
export const ROLE_RANK = Object.freeze({
  [ROLES.CUSTOMER]: 0,
  [ROLES.RIDER]: 10,
  [ROLES.KITCHEN]: 20,
  [ROLES.CASHIER]: 30,
  [ROLES.MANAGER]: 50,
  [ROLES.ADMIN]: 70,
  [ROLES.SUPER_ADMIN]: 100,
});

/** Human labels for the staff management UI. */
export const ROLE_LABEL = Object.freeze({
  [ROLES.CUSTOMER]: 'Customer',
  [ROLES.RIDER]: 'Delivery Rider',
  [ROLES.KITCHEN]: 'Kitchen Staff',
  [ROLES.CASHIER]: 'Cashier',
  [ROLES.MANAGER]: 'Online Manager',
  [ROLES.ADMIN]: 'Sub Admin',
  [ROLES.SUPER_ADMIN]: 'Super Admin',
});

/** Roles that may sign in at a POS terminal. */
/*
 * Till access is the `pos.operate` permission (granted per person in the
 * permission matrix), not a list of roles — a role check would make the
 * permission editor decorative.
 */

/**
 * Every employable role — i.e. anyone who appears in staff management.
 *
 * Note: this is not the same as "who may open the back office". A delivery
 * rider is staff and must be manageable (hire, assign, deactivate), but has no
 * dashboard access — that is decided by permissions, not by membership of this
 * list. Conflating the two previously left seeded riders invisible in the very
 * screen that is supposed to manage them.
 */
export const STAFF_ROLES = Object.freeze([
  ROLES.RIDER,
  ROLES.KITCHEN,
  ROLES.CASHIER,
  ROLES.MANAGER,
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
]);

/**
 * Permission catalogue — `module.action` strings.
 * Adding a permission here automatically adds a checkbox to the role matrix UI
 * (it renders from PERMISSION_GROUPS), so the two can never drift apart.
 */
export const PERMISSIONS = Object.freeze({
  // Catalogue
  CATEGORY_VIEW: 'category.view',
  CATEGORY_MANAGE: 'category.manage',
  PRODUCT_VIEW: 'product.view',
  PRODUCT_MANAGE: 'product.manage',

  // Inventory
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',

  // Orders
  ORDER_VIEW: 'order.view',
  ORDER_MANAGE: 'order.manage',
  ORDER_CANCEL: 'order.cancel',

  // POS — separation of duties: selling, discounting and refunding are
  // distinct grants so a cashier can sell without being able to refund.
  POS_OPERATE: 'pos.operate',
  POS_DISCOUNT: 'pos.discount',
  POS_REFUND: 'pos.refund',
  POS_CASH_MANAGE: 'pos.cash_manage',
  POS_VIEW_ALL_SALES: 'pos.view_all_sales',
  /** The till registry — which physical terminals exist and may be used. */
  TERMINAL_VIEW: 'terminal.view',
  TERMINAL_MANAGE: 'terminal.manage',

  /**
   * Stores (outlets). Opening or closing a counter is a business decision, so
   * `store.manage` sits with the owner by default while `store.view` is wide —
   * almost every scoped screen needs to know which stores exist.
   */
  STORE_VIEW: 'store.view',
  STORE_MANAGE: 'store.manage',

  /**
   * Kitchen. `kitchen.view` opens the Kitchen Display and the Order Status
   * Board; `kitchen.manage` moves tickets along (accept, done, served). Split
   * because a counter TV showing "Ready" must be able to read tickets without
   * being able to bump them.
   */
  KITCHEN_VIEW: 'kitchen.view',
  KITCHEN_MANAGE: 'kitchen.manage',

  // Customers & feedback
  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_MANAGE: 'customer.manage',
  REVIEW_VIEW: 'review.view',
  REVIEW_MODERATE: 'review.moderate',

  // Staff & access
  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_MANAGE: 'employee.manage',
  ROLE_VIEW: 'role.view',
  ROLE_MANAGE: 'role.manage',

  // Marketing
  OFFER_VIEW: 'offer.view',
  OFFER_MANAGE: 'offer.manage',

  // Insight
  REPORT_VIEW: 'report.view',
  REPORT_FINANCIAL: 'report.financial',
  REPORT_EXPORT: 'report.export',

  // Platform
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  ACTIVITY_VIEW: 'activity.view',
});

/** Drives the permission-matrix UI. Order here is the order on screen. */
export const PERMISSION_GROUPS = Object.freeze([
  {
    module: 'Catalogue',
    permissions: [
      PERMISSIONS.CATEGORY_VIEW,
      PERMISSIONS.CATEGORY_MANAGE,
      PERMISSIONS.PRODUCT_VIEW,
      PERMISSIONS.PRODUCT_MANAGE,
    ],
  },
  { module: 'Inventory', permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_ADJUST] },
  {
    module: 'Orders',
    permissions: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_MANAGE, PERMISSIONS.ORDER_CANCEL],
  },
  {
    module: 'Point of Sale',
    permissions: [
      PERMISSIONS.POS_OPERATE,
      PERMISSIONS.POS_DISCOUNT,
      PERMISSIONS.POS_REFUND,
      PERMISSIONS.POS_CASH_MANAGE,
      PERMISSIONS.POS_VIEW_ALL_SALES,
      PERMISSIONS.TERMINAL_VIEW,
      PERMISSIONS.TERMINAL_MANAGE,
    ],
  },
  { module: 'Kitchen', permissions: [PERMISSIONS.KITCHEN_VIEW, PERMISSIONS.KITCHEN_MANAGE] },
  {
    // Listed separately from the till: a store is the business unit, a terminal
    // is hardware standing in it. Someone may run a counter without being able
    // to open or close one.
    module: 'Stores',
    permissions: [PERMISSIONS.STORE_VIEW, PERMISSIONS.STORE_MANAGE],
  },
  {
    module: 'Customers',
    permissions: [
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.CUSTOMER_MANAGE,
      PERMISSIONS.REVIEW_VIEW,
      PERMISSIONS.REVIEW_MODERATE,
    ],
  },
  {
    module: 'Staff & Access',
    permissions: [
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.EMPLOYEE_MANAGE,
      PERMISSIONS.ROLE_VIEW,
      PERMISSIONS.ROLE_MANAGE,
    ],
  },
  { module: 'Marketing', permissions: [PERMISSIONS.OFFER_VIEW, PERMISSIONS.OFFER_MANAGE] },
  {
    module: 'Reports',
    permissions: [PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_FINANCIAL, PERMISSIONS.REPORT_EXPORT],
  },
  {
    module: 'Platform',
    permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.ACTIVITY_VIEW],
  },
]);

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

/**
 * Resolve what a user may actually do.
 *
 * Lives here, beside the permissions themselves, rather than in the auth
 * middleware — services need it too (POS sign-in, for one), and importing a
 * middleware from a service invites a circular dependency.
 *
 * `'*'` means unrestricted; only the super admin gets it. An explicit
 * `permissions` array on the user overrides the role default, which is what
 * makes per-person grants in the back office work.
 */
export function permissionsFor(user) {
  if (user.role === ROLES.SUPER_ADMIN) return ['*'];
  if (Array.isArray(user.permissions) && user.permissions.length > 0) return user.permissions;
  return DEFAULT_ROLE_PERMISSIONS[user.role] ?? [];
}

/** Does this user hold a given permission? */
export function userCan(user, permission) {
  const granted = permissionsFor(user);
  return granted.includes('*') || granted.includes(permission);
}

/**
 * Fallback grants for accounts with no custom Role document attached.
 * Super admin is intentionally absent: it resolves to the `*` wildcard in the
 * permission service and bypasses this table entirely.
 */
export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  [ROLES.CUSTOMER]: [],
  [ROLES.RIDER]: [PERMISSIONS.ORDER_VIEW],
  [ROLES.KITCHEN]: [
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.PRODUCT_VIEW,
    // The kitchen's whole job happens on the Kitchen Display.
    PERMISSIONS.KITCHEN_VIEW,
    PERMISSIONS.KITCHEN_MANAGE,
  ],
  [ROLES.CASHIER]: [
    PERMISSIONS.POS_OPERATE,
    PERMISSIONS.PRODUCT_VIEW,
    PERMISSIONS.CATEGORY_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
    // Needs to know which counter it is standing at; cannot open or close one.
    PERMISSIONS.STORE_VIEW,
  ],
  [ROLES.MANAGER]: [
    PERMISSIONS.CATEGORY_VIEW,
    PERMISSIONS.PRODUCT_VIEW,
    PERMISSIONS.PRODUCT_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.ORDER_CANCEL,
    PERMISSIONS.POS_OPERATE,
    PERMISSIONS.POS_DISCOUNT,
    PERMISSIONS.POS_VIEW_ALL_SALES,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.REVIEW_VIEW,
    PERMISSIONS.REVIEW_MODERATE,
    PERMISSIONS.OFFER_VIEW,
    PERMISSIONS.REPORT_VIEW,
    // Sees its own counter and the tills on it; cannot open or close either.
    PERMISSIONS.STORE_VIEW,
    PERMISSIONS.TERMINAL_VIEW,
    // A manager runs the pass when the kitchen is busy.
    PERMISSIONS.KITCHEN_VIEW,
    PERMISSIONS.KITCHEN_MANAGE,
  ],
  /*
   * Admin gets everything except the grants the owner keeps.
   *
   * `store.manage` is on that list deliberately: opening or closing an outlet
   * is a business decision, not an operational one, and an admin who could
   * close a counter could stop the business trading. Same reasoning as
   * `role.manage` — a sub-admin runs operations, it does not restructure the
   * company.
   */
  [ROLES.ADMIN]: ALL_PERMISSIONS.filter(
    (p) => ![PERMISSIONS.ROLE_MANAGE, PERMISSIONS.REPORT_FINANCIAL, PERMISSIONS.STORE_MANAGE].includes(p),
  ),
});
