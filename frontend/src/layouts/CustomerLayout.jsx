import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Flame,
  Search,
  Heart,
  ShoppingCart,
  Menu,
  X,
  Phone,
  Mail,
  MapPin,
  Clock,
  ArrowUp,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { useCart } from '@/features/cart/cartContext.jsx';
import { useWishlist } from '@/features/wishlist/wishlistContext.jsx';
import { CartDrawer } from '@/components/customer/CartDrawer.jsx';
import { HeaderMenus } from '@/components/layout/HeaderMenus.jsx';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { useSiteStore } from '@/features/site/siteContext.jsx';
import { useOrderingStatus } from '@/features/site/orderingStatus.js';
import { ClosedBanner, OpenChip } from '@/components/customer/ShopClosed.jsx';
import { SocialIconLink, FieldIcon, isInternalHref } from '@/components/common/SiteIcons.jsx';
import { pagePath } from '@/constants/routes.js';
import { mediaUrl } from '@/lib/media.js';
import { HeaderSearch } from '@/components/customer/HeaderSearch.jsx';
import { drawerRight, backdrop, fade } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * Public storefront shell.
 * ---------------------------------------------------------------------------
 * Sticky header + page content + footer, matching the reference design's
 * navigation: Home · Menu · Offers · About Us · Track Order · Contact, with
 * search, wishlist, cart and account on the right.
 *
 * The header is sticky because on a food site the cart and menu are the two
 * things a customer reaches for constantly while scrolling a long menu.
 */

const NAV_LINKS = [
  { to: ROUTES.HOME, label: 'Home', end: true },
  { to: ROUTES.MENU, label: 'Menu' },
  { to: ROUTES.OFFERS, label: 'Offers' },
  { to: ROUTES.ABOUT, label: 'About Us' },
  { to: ROUTES.TRACK_ORDER, label: 'Track Order' },
  { to: ROUTES.CONTACT, label: 'Contact' },
  { to: ROUTES.FEEDBACK, label: 'Feedback' },
];

export function CustomerLayout() {
  const { isAuthenticated } = useAuth();
  const { totals, openCart } = useCart();
  const { count: wishlistCount } = useWishlist();
  const [isMenuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const business = useSiteStore((s) => s.business);
  const pages = useSiteStore((s) => s.pages);
  // Open or closed, from the owner's hours — kept live for the banner and footer.
  const ordering = useOrderingStatus();

  // The owner's own pages marked "Link in the header" join the fixed links.
  const navLinks = [
    ...NAV_LINKS,
    ...pages.filter((p) => p.showInHeader).map((p) => ({ to: pagePath(p.slug), label: p.title })),
  ];

  // Close the mobile drawer on navigation — leaving it open over the new page
  // is disorienting and hides the content the user just asked for.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ---------------- Header ---------------- */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        {/*
          On narrow screens the brand gives way (the tagline hides below `sm`
          and the name truncates) while the actions stay fixed, so the header
          never overflows the viewport whatever the shop is called.
        */}
        <div className="container flex h-[68px] items-center gap-2 sm:gap-4">
          <Link to={ROUTES.HOME} className="flex min-w-0 shrink items-center gap-2.5">
            <BrandMark business={business} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-bold tracking-tight">
                {business.name || config.brand.name}
              </span>
              {business.tagline && (
                <span className="hidden truncate text-[8px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
                  {business.tagline}
                </span>
              )}
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {navLinks.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'relative px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'text-gold' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {label}
                    {/* Underline marks the active section, as in the reference. */}
                    {isActive && (
                      <motion.span
                        layoutId="nav-underline"
                        className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-gold"
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/*
              A real search box. This was a <Link> dressed as an input — it
              could not be typed into and pointed at a route that did not exist.
            */}
            <HeaderSearch className="hidden w-44 sm:block lg:w-64" />

            {/* Below `sm` the box would crowd out the cart and account icons,
                so small screens get the icon and the full search page. */}
            <Link
              to={ROUTES.SEARCH}
              aria-label="Search"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground sm:hidden"
            >
              <Search className="h-5 w-5" aria-hidden="true" />
            </Link>

            <IconLink to={ROUTES.WISHLIST} label="Wishlist" icon={Heart} badge={wishlistCount} />

            {/* A button, not a link: opening the drawer keeps the customer on
                the page they were browsing. */}
            <button
              type="button"
              onClick={openCart}
              aria-label={`Open cart (${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'})`}
              className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <ShoppingCart className="h-5 w-5" aria-hidden="true" />
              {totals.itemCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground">
                  {totals.itemCount}
                </span>
              )}
            </button>

            {isAuthenticated ? (
              /* Notification bell + account menu — screen 06 of the design. */
              <HeaderMenus />
            ) : (
              // A styled Link, not a Button wrapping a Link: an <a> inside a
              // <button> is invalid HTML and gives the element two conflicting
              // roles, which breaks keyboard and screen-reader behaviour.
              <Link
                to={ROUTES.LOGIN}
                className="hidden h-9 items-center rounded-lg bg-gold-gradient px-4 text-sm font-semibold text-gold-foreground transition-all hover:shadow-gold sm:inline-flex"
              >
                Login
              </Link>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="rounded-lg p-2 text-muted-foreground hover:bg-surface-hover hover:text-foreground lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Outside opening hours: say so up front, before anyone fills a basket expecting dinner. */}
      {/* Not on checkout, which shows the full message in place of the order button. */}
      {location.pathname !== ROUTES.CHECKOUT && <ClosedBanner status={ordering} />}

      {/* ---------------- Mobile navigation ---------------- */}
      <AnimatePresence>
        {isMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              {...backdrop}
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              aria-hidden="true"
            />
            <motion.nav
              {...drawerRight}
              aria-label="Mobile navigation"
              className="absolute inset-y-0 right-0 flex w-[280px] flex-col border-l border-border bg-surface p-5"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="font-bold">Menu</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <ul className="space-y-1">
                {navLinks.map(({ to, label, end }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      className={({ isActive }) =>
                        cn(
                          'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-gold/10 text-gold'
                            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                        )
                      }
                    >
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>

              {!isAuthenticated && (
                <Link to={ROUTES.LOGIN} className="mt-6">
                  <Button fullWidth>Login</Button>
                </Link>
              )}
            </motion.nav>
          </div>
        )}
      </AnimatePresence>

      <main className="flex-1">
        <Outlet />
      </main>

      <SiteFooter ordering={ordering} />
      <ScrollToTopButton />
      <CartDrawer />
    </div>
  );
}

function IconLink({ to, label, icon: Icon, badge }) {
  return (
    <Link
      to={to}
      aria-label={badge ? `${label} (${badge})` : label}
      className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground">
          {badge}
        </span>
      )}
    </Link>
  );
}

/** The owner's logo, or the flame mark until one is uploaded. */
function BrandMark({ business }) {
  if (business?.logoUrl) {
    return (
      <img src={mediaUrl(business.logoUrl)} alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain" />
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-gradient">
      <Flame className="h-5 w-5 text-gold-foreground" aria-hidden="true" />
    </span>
  );
}

/**
 * Footer — every word and link from Website Management → Business details and
 * Footer & Social: the blurb, any number of social icons, the owner's extra
 * links, published pages marked for the footer, custom fields (a second branch,
 * a catering line, a halal certificate…) and the copyright line.
 */
function SiteFooter({ ordering }) {
  const business = useSiteStore((s) => s.business);
  const footer = useSiteStore((s) => s.footer);
  const pages = useSiteStore((s) => s.pages);
  const name = business.name || config.brand.name;
  const customFields = footer.customFields ?? [];

  const moreLinks = [
    ...(footer.links ?? []).map((link) => ({ to: link.href, label: link.label })),
    ...pages.filter((p) => p.showInFooter).map((p) => ({ to: pagePath(p.slug), label: p.title })),
  ];

  return (
    <footer className="border-t border-border bg-surface">
      <div className="container grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark business={business} />
            <span className="font-bold tracking-tight">{name}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {footer.about || business.tagline || 'Freshly prepared, every day.'}
          </p>
          {/* Only the links the owner has actually set. */}
          {footer.socialLinks?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {footer.socialLinks.map((link) => (
                <SocialIconLink key={link.url} link={link} />
              ))}
            </div>
          )}
        </div>

        <FooterColumn
          title="Quick Links"
          links={[
            { to: ROUTES.MENU, label: 'Our Menu' },
            { to: ROUTES.OFFERS, label: 'Special Offers' },
            { to: ROUTES.ABOUT, label: 'About Us' },
            { to: ROUTES.CONTACT, label: 'Contact' },
            ...moreLinks,
          ]}
        />

        <FooterColumn
          title="Customer Service"
          links={[
            { to: ROUTES.TRACK_ORDER, label: 'Track Order' },
            { to: ROUTES.FEEDBACK, label: 'Share Feedback' },
            { to: ROUTES.ACCOUNT_ORDERS, label: 'My Orders' },
            { to: ROUTES.WISHLIST, label: 'Wishlist' },
            { to: ROUTES.CART, label: 'Shopping Cart' },
          ]}
        />

        <div>
          <h3 className="text-sm font-semibold">Get in Touch</h3>
          {/* Each row renders only if the owner has entered that detail. */}
          <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            {business.phone && <ContactItem icon={Phone}>{business.phone}</ContactItem>}
            {business.email && <ContactItem icon={Mail}>{business.email}</ContactItem>}
            {business.address && <ContactItem icon={MapPin}>{business.address}</ContactItem>}
            {ordering?.summary?.length ? (
              <li className="flex gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="space-y-1 leading-relaxed">
                  {ordering.summary.map((line) => (
                    <span key={line.days} className="block">
                      <span className="text-foreground">{line.days}</span> · {line.hours}
                    </span>
                  ))}
                  <OpenChip status={ordering} />
                </span>
              </li>
            ) : (
              business.hours && <ContactItem icon={Clock}>{business.hours}</ContactItem>
            )}
            {customFields.map((field, index) => (
              <li key={`${field.label}-${index}`} className="flex gap-2.5">
                <FieldIcon icon={field.icon} className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                <span className="leading-relaxed">
                  <span className="font-medium text-foreground">{field.label}:</span> {field.value}
                </span>
              </li>
            ))}
            {!business.phone && !business.email && !business.address && customFields.length === 0 && (
              <li className="text-xs italic">Contact details coming soon.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="border-t border-border py-5">
        <p className="container text-center text-xs text-muted-foreground">
          {footer.copyright || `© ${new Date().getFullYear()} ${name}. All rights reserved.`}
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(({ to, label }) => (
          <li key={`${to}-${label}`}>
            {isInternalHref(to) ? (
              <Link to={to} className="text-muted-foreground transition-colors hover:text-gold">
                {label}
              </Link>
            ) : (
              <a
                href={to}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-gold"
              >
                {label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactItem({ icon: Icon, children }) {
  return (
    <li className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

/** Appears past 400px, as specified in the brief. */
function ScrollToTopButton() {
  const [isVisible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          {...fade}
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll back to top"
          className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gold-gradient text-gold-foreground shadow-gold transition-transform hover:scale-105"
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default CustomerLayout;
