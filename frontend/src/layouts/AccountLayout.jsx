import { NavLink, Outlet } from 'react-router-dom';
import { User, ShoppingBag, MapPin, ShieldCheck, Heart } from 'lucide-react';

import { useAuth } from '@/features/auth/authContext.jsx';
import { ROUTES } from '@/constants/routes.js';
import { getInitials, cn } from '@/lib/utils.js';

/**
 * Customer account shell.
 * ---------------------------------------------------------------------------
 * Sidebar on desktop, a horizontal scroller on mobile — a vertical nav stacked
 * above the content on a phone pushes the actual page below the fold, which is
 * the most common way this layout goes wrong.
 *
 * Route protection lives on the route, not here; this component only draws.
 */

const NAV = [
  { to: ROUTES.ACCOUNT, label: 'Overview', icon: User, end: true },
  { to: ROUTES.ACCOUNT_ORDERS, label: 'My Orders', icon: ShoppingBag },
  { to: ROUTES.ACCOUNT_ADDRESSES, label: 'Addresses', icon: MapPin },
  { to: ROUTES.ACCOUNT_SECURITY, label: 'Security', icon: ShieldCheck },
  { to: ROUTES.WISHLIST, label: 'Wishlist', icon: Heart },
];

export function AccountLayout() {
  const { user } = useAuth();

  return (
    <div className="container py-8">
      <header className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-lg font-bold text-gold"
        >
          {getInitials(user?.fullName ?? '')}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{user?.fullName}</h1>
          <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </header>

      <div className="mt-7 grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Account sections">
          {/* Horizontal and scrollable below `lg`, vertical above. */}
          <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {NAV.map((item) => (
              <li key={item.to} className="shrink-0 lg:shrink">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-gold-gradient text-gold-foreground'
                        : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default AccountLayout;
