import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  FolderTree,
  Package,
  ShoppingBag,
  UserRound,
  Monitor,
  Globe,
  Image as ImageIcon,
  Megaphone,
  Boxes,
  BarChart3,
  Wallet,
  Settings,
  ScrollText,
  Bell,
  Menu,
  X,
  Flame,
  LogOut,
  ChevronDown,
  Store as StoreIcon,
  ChefHat,
  Tv,
  FileText,
  KeyRound,
  ExternalLink,
  Inbox,
  Split,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { SearchInput } from '@/components/ui/SearchInput.jsx';
import { NotificationBell } from '@/components/admin/NotificationBell.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useSite } from '@/features/site/siteContext.jsx';
import { mediaUrl } from '@/lib/media.js';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { drawerLeft, backdrop } from '@/lib/motion.js';
import { getInitials, cn } from '@/lib/utils.js';

/**
 * Back-office shell.
 * ---------------------------------------------------------------------------
 * Sidebar + top bar + content, matching the reference design's control-centre
 * layout with a gold active state.
 *
 * Responsive strategy: the sidebar is permanently visible from `lg` up and
 * becomes an overlay drawer below it. A dashboard is a desktop tool, but a
 * manager checking today's takings on a phone must still be able to navigate —
 * so the nav collapses rather than disappearing.
 *
 * Items the current account cannot use are hidden, not disabled: a disabled
 * menu full of things you may never click is noise, and the server enforces the
 * same rules regardless of what the nav shows.
 */

/** Sidebar sections, ordered as in the reference design. */
const NAV_SECTIONS = [
  {
    items: [{ to: ROUTES.ADMIN, label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    heading: 'Catalogue',
    items: [
      { to: ROUTES.ADMIN_CATEGORIES, label: 'Categories', icon: FolderTree, permission: 'category.view' },
      { to: ROUTES.ADMIN_PRODUCTS, label: 'Products', icon: Package, permission: 'product.view' },
      { to: ROUTES.ADMIN_INVENTORY, label: 'Inventory', icon: Boxes, permission: 'inventory.view' },
    ],
  },
  {
    heading: 'Sales',
    items: [
      { to: ROUTES.ADMIN_ORDERS, label: 'Orders', icon: ShoppingBag, permission: 'order.view' },
      { to: ROUTES.ADMIN_CUSTOMERS, label: 'Customers', icon: UserRound, permission: 'customer.view' },
      { to: ROUTES.ADMIN_STORES, label: 'Stores', icon: StoreIcon, permission: 'store.view' },
      {
        to: ROUTES.ADMIN_POS_MANAGEMENT,
        label: 'POS / Tills',
        icon: Monitor,
        permission: 'terminal.view',
      },
      { to: ROUTES.ADMIN_STATIONS, label: 'Kitchen Stations', icon: Split, permission: 'settings.view' },
      // Full-screen surfaces: they open in their own tab, for the kitchen
      // screen and the TV above the counter.
      {
        to: ROUTES.KITCHEN,
        label: 'Kitchen Display',
        icon: ChefHat,
        permission: 'kitchen.view',
        external: true,
      },
      { to: ROUTES.ORDER_BOARD, label: 'Order Board', icon: Tv, permission: 'kitchen.view', external: true },
      { to: ROUTES.ADMIN_FEEDBACK, label: 'Customer Feedback', icon: Megaphone, permission: 'review.view' },
      { to: ROUTES.ADMIN_MESSAGES, label: 'Contact Messages', icon: Inbox, permission: 'customer.view' },
    ],
  },
  {
    heading: 'People',
    items: [
      { to: ROUTES.ADMIN_USERS, label: 'User Management', icon: Users, permission: 'employee.view' },
      { to: ROUTES.ADMIN_ROLES, label: 'Roles & Permissions', icon: ShieldCheck, permission: 'role.view' },
    ],
  },
  {
    heading: 'Marketing',
    items: [
      { to: ROUTES.ADMIN_OFFERS, label: 'Offers & Banners', icon: ImageIcon, permission: 'offer.view' },
      { to: ROUTES.ADMIN_WEBSITE, label: 'Website Management', icon: Globe, permission: 'settings.view' },
      { to: ROUTES.ADMIN_PAGES, label: 'Pages', icon: FileText, permission: 'settings.view' },
    ],
  },
  {
    heading: 'Insight',
    items: [
      { to: ROUTES.ADMIN_REPORTS, label: 'Reports & Analytics', icon: BarChart3, permission: 'report.view' },
      { to: ROUTES.ADMIN_FINANCE, label: 'Finance', icon: Wallet, permission: 'report.financial' },
    ],
  },
  {
    heading: 'System',
    items: [
      { to: ROUTES.ADMIN_SETTINGS, label: 'Settings', icon: Settings, permission: 'settings.view' },
      { to: ROUTES.ADMIN_LOGS, label: 'System Logs', icon: ScrollText, permission: 'activity.view' },
      // No permission: the API filters each alert by what the reader may act on,
      // so everyone sees their own (possibly empty) list.
      { to: ROUTES.ADMIN_NOTIFICATIONS, label: 'Notifications', icon: Bell },
      // Everyone: their own password, email and devices.
      { to: ROUTES.ADMIN_PROFILE, label: 'My Profile & Password', icon: KeyRound },
    ],
  },
];

/**
 * Jump-to-module search. It searches the same permission-filtered nav the
 * sidebar renders, so it never offers a module the account cannot open.
 */
function ModuleSearch() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [isOpen, setOpen] = useState(false);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    return NAV_SECTIONS.flatMap((section) =>
      section.items
        .filter((item) => !item.permission || can(item.permission))
        .filter((item) => item.label.toLowerCase().includes(term))
        .map((item) => ({ ...item, group: section.heading })),
    ).slice(0, 6);
  }, [query, can]);

  function go(to) {
    navigate(to);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="relative hidden max-w-sm flex-1 sm:block">
      <SearchInput
        size="sm"
        value={query}
        placeholder="Jump to a module…"
        label="Search the back office"
        aria-expanded={isOpen && results.length > 0}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onClear={() => {
          setQuery('');
          setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        // Blur is delayed so a click on a result lands before the list unmounts.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) go(results[0].to);
          // Escape already clears the box inside SearchInput; this closes the
          // dropdown that the shared component knows nothing about.
          if (e.key === 'Escape') setOpen(false);
        }}
      />

      {isOpen && query.trim() && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
          {results.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-muted-foreground">
              Nothing matches &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            <ul>
              {results.map((item) => (
                <li key={item.to}>
                  <button
                    type="button"
                    onClick={() => go(item.to)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover"
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {item.group && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {item.group}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminLayout() {
  const { user, signOut } = useAuth();
  const [isNavOpen, setNavOpen] = useState(false);
  const location = useLocation();

  /*
   * A password reset by an administrator must be replaced before anything
   * else. The server enforces it (every other request is refused); this only
   * spares them a dashboard of failing panels by going straight to the form.
   */
  if (user?.mustChangePassword && location.pathname !== ROUTES.ADMIN_PROFILE) {
    return <Navigate to={ROUTES.ADMIN_PROFILE} replace />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* ---------------- Sidebar (desktop) ---------------- */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <SidebarContent />
      </aside>

      {/* ---------------- Sidebar (mobile drawer) ---------------- */}
      <AnimatePresence>
        {isNavOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              {...backdrop}
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 bg-black/70"
              aria-hidden="true"
            />
            <motion.aside
              {...drawerLeft}
              className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border bg-surface"
              aria-label="Navigation"
            >
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                aria-label="Close navigation"
                className="absolute right-3 top-3 rounded-lg p-2 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <SidebarContent onNavigate={() => setNavOpen(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* ---------------- Main column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="rounded-lg p-2 text-muted-foreground hover:bg-surface-hover hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <ModuleSearch />

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />

            {/*
              A link, not a label.
              This was a static block, which meant a staff account — including
              the owner's — had no way to change its own password from the back
              office. The page existed at /account/security and allows any
              signed-in user, but nothing in this layout pointed at it, so the
              only route in was typing the URL. "Change the seeded password
              first" is not advice anyone can follow if the screen is unreachable.
            */}
            <Link
              to={ROUTES.ADMIN_PROFILE}
              title="Your profile and password"
              className="flex items-center gap-2.5 rounded-lg border border-border bg-surface py-1.5 pl-2.5 pr-3 transition-colors hover:border-gold/40 hover:bg-surface-hover"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-gradient text-[11px] font-bold text-gold-foreground">
                {getInitials(user?.fullName ?? 'FB')}
              </span>
              <div className="hidden leading-tight sm:block">
                <p className="text-xs font-semibold">{user?.fullName}</p>
                <p className="text-[10px] capitalize text-muted-foreground">
                  {user?.role?.replace('_', ' ')}
                </p>
              </div>
            </Link>

            <Button variant="ghost" size="icon-sm" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Sidebar body — shared by the fixed desktop rail and the mobile drawer.
 *
 * Accordion behaviour: exactly one group is expanded at a time; opening another
 * closes the previous one. With seventeen destinations across seven groups, a
 * fully-expanded tree needs scrolling before the first click and buries the
 * active page. One open group keeps the whole structure visible in a glance.
 *
 * The group containing the current route opens automatically, so the sidebar
 * always shows where you are after a page load or a deep link.
 */
function SidebarContent({ onNavigate }) {
  const location = useLocation();
  const { can } = useAuth();
  const { business } = useSite();

  /**
   * Only the sections this account can actually use.
   *
   * A group whose every item is hidden disappears entirely — an empty
   * "Insight" heading that expands to nothing is worse than no heading, because
   * it looks broken rather than restricted.
   *
   * This is presentation, not protection: every route is enforced server-side,
   * and typing the URL directly still gets a 403.
   */
  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || can(item.permission)),
      })).filter((section) => section.items.length > 0),
    [can],
  );

  /** Which group owns the current URL? That one starts open. */
  const activeGroup = useMemo(() => {
    const match = sections.find(
      (section) => section.heading && section.items.some((item) => location.pathname.startsWith(item.to)),
    );
    return match?.heading ?? null;
  }, [location.pathname, sections]);

  const [openGroup, setOpenGroup] = useState(activeGroup);

  // Re-sync when navigation changes which group is active (e.g. via a link in
  // the page body rather than the sidebar).
  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup);
  }, [activeGroup]);

  const toggle = (heading) => setOpenGroup((current) => (current === heading ? null : heading));

  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-5">
        {business?.logoUrl ? (
          <img src={mediaUrl(business.logoUrl)} alt="" className="h-9 w-9 rounded-xl object-contain" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-gradient">
            <Flame className="h-5 w-5 text-gold-foreground" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold tracking-tight">{business?.name || config.brand.name}</p>
          <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Back Office</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Back office">
        {sections.map((section, index) => {
          // Ungrouped entries (Dashboard) render as a plain top-level link —
          // the primary destination should never be hidden inside a group.
          if (!section.heading) {
            return (
              <ul key={index} className="mb-2 space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavItem item={item} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            );
          }

          const isOpen = openGroup === section.heading;

          return (
            <div key={section.heading}>
              <button
                type="button"
                onClick={() => toggle(section.heading)}
                aria-expanded={isOpen}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors',
                  isOpen ? 'text-gold' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="truncate">{section.heading}</span>
                <ChevronDown
                  className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>

              {/* Height animation, not display toggling, so the open/close
                  reads as one motion rather than a jump. */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                    className="overflow-hidden"
                  >
                    <li className="space-y-0.5 py-0.5 pl-2">
                      {section.items.map((item) => (
                        <NavItem key={item.to} item={item} onNavigate={onNavigate} />
                      ))}
                    </li>
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>
    </>
  );
}

/** A single navigation entry. */
function NavItem({ item, onNavigate }) {
  const { to, label, icon: Icon, end, external } = item;

  if (external) {
    return (
      <a
        href={to}
        target="_blank"
        rel="noopener"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-60" aria-label="opens in a new tab" />
      </a>
    );
  }

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-gold-gradient font-semibold text-gold-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export default AdminLayout;
