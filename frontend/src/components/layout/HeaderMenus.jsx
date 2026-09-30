import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { User, Settings, KeyRound, LifeBuoy, LogOut } from 'lucide-react';

import { useAuth } from '@/features/auth/authContext.jsx';
import { ROUTES } from '@/constants/routes.js';
import { dropdown } from '@/lib/motion.js';
import { getInitials, cn } from '@/lib/utils.js';

/**
 * Header notification and profile menus — screen 06 in the reference design.
 * ---------------------------------------------------------------------------
 * Both are built on one `Dropdown` primitive so they share the behaviour that
 * makes a menu feel finished rather than merely present:
 *
 *   • closes on outside click and on Escape
 *   • the trigger carries aria-expanded / aria-haspopup
 *   • focus returns to the trigger on close, so keyboard users are not dumped
 *     at the top of the document
 *   • only one menu is open at a time
 */

/** Shared dropdown shell. */
function Dropdown({ trigger, label, align = 'right', width = 'w-72', children, isOpen, onToggle }) {
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) onToggle(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onToggle(false);
        // Return focus so the next Tab continues from the trigger.
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onToggle]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onToggle(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        {trigger}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            {...dropdown}
            role="menu"
            className={cn(
              'absolute z-50 mt-2 overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-overlay',
              width,
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Account menu — the profile dropdown from the reference design. */
export function ProfileMenu({ isOpen, onToggle }) {
  const { user, signOut } = useAuth();

  const LINKS = [
    { to: ROUTES.ACCOUNT_PROFILE, label: 'My Profile', icon: User },
    { to: ROUTES.ACCOUNT, label: 'Account Settings', icon: Settings },
    { to: ROUTES.ACCOUNT_SECURITY, label: 'Change Password', icon: KeyRound },
    { to: ROUTES.CONTACT, label: 'Help & Support', icon: LifeBuoy },
  ];

  return (
    <Dropdown
      isOpen={isOpen}
      onToggle={onToggle}
      label="Account menu"
      width="w-60"
      trigger={
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-gradient text-[11px] font-bold text-gold-foreground">
          {getInitials(user?.fullName ?? 'FB')}
        </span>
      }
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-gradient text-xs font-bold text-gold-foreground">
          {getInitials(user?.fullName ?? 'FB')}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.fullName}</p>
          <p className="truncate text-xs capitalize text-muted-foreground">{user?.role?.replace('_', ' ')}</p>
        </div>
      </div>

      <ul className="py-1">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <li key={label}>
            <Link
              to={to}
              onClick={() => onToggle(false)}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>

      {/* Sign out sits below a divider — destructive-ish actions should not be
          adjacent to routine navigation. */}
      <div className="border-t border-border py-1">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onToggle(false);
            signOut();
          }}
          className="flex w-full items-center gap-3 px-4 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          Logout
        </button>
      </div>
    </Dropdown>
  );
}

/**
 * The signed-in menus in the storefront header.
 *
 * No notification bell here, and that is a decision rather than an omission.
 * There was one, rendering a hard-coded empty array behind a comment saying it
 * would be wired up "when the notifications module exists". That module does
 * exist — but everything it produces is back-office work: stock below its
 * threshold, orders awaiting confirmation, reviews needing moderation, each one
 * linking to /admin. None of it is a customer's business, so the bell on the
 * storefront could never have shown anything at all.
 *
 * A control that is permanently empty teaches customers to ignore it, and it
 * would have to be either faked or hidden the moment anyone asked what it was
 * for. The back office has its own bell — see components/admin/NotificationBell
 * — which reads the real feed.
 *
 * The single `open` state remains because ProfileMenu shares the dropdown
 * pattern, and a second menu will slot straight into it.
 */
export function HeaderMenus() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(null);

  if (!isAuthenticated) return null;

  return <ProfileMenu isOpen={open === 'profile'} onToggle={(next) => setOpen(next ? 'profile' : null)} />;
}

export default HeaderMenus;
