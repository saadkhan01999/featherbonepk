import { KeyRound, ShieldCheck } from 'lucide-react';

import { AccountSecurityPanel } from '@/components/account/AccountSecurityPanel.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { getInitials } from '@/lib/utils.js';

/**
 * My Profile — /admin/profile
 * ---------------------------------------------------------------------------
 * Where the owner (and every staff member) changes their own password, name,
 * phone and sign-in email, and signs out devices they no longer use — without
 * leaving the back office for the customer account area.
 *
 * Staff whose password was reset by an administrator are sent here straight
 * after signing in; the server refuses everything else until they choose a new
 * one.
 */
export function AdminProfilePage() {
  const { user } = useAuth();
  const permissionCount = Array.isArray(user?.permissions) ? user.permissions.length : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-5">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gold-gradient text-lg font-bold text-gold-foreground">
          {getInitials(user?.fullName ?? 'FB')}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{user?.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {user?.email} · <span className="capitalize">{user?.role?.replace('_', ' ')}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="flex items-center gap-1.5 rounded-lg bg-surface-raised px-3 py-1.5">
            <ShieldCheck className="h-4 w-4 text-gold" aria-hidden="true" />
            {user?.role === 'super_admin'
              ? 'Full access'
              : permissionCount != null
                ? `${permissionCount} permissions`
                : 'Role-based access'}
          </span>
          <a
            href="#change-password"
            className="flex items-center gap-1.5 rounded-lg bg-surface-raised px-3 py-1.5 hover:text-gold"
          >
            <KeyRound className="h-4 w-4 text-gold" aria-hidden="true" />
            Change password
          </a>
        </div>
      </header>

      <div id="change-password">
        <AccountSecurityPanel />
      </div>
    </div>
  );
}

export default AdminProfilePage;
