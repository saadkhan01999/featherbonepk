import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { apiClient, setAccessToken, clearAccessToken, refreshSession } from '@/services/apiClient.js';
import { reconnectSocket, disconnectSocket } from '@/services/realtime.js';
import { PageLoader } from '@/components/ui/Spinner.jsx';
import { ROUTES } from '@/constants/routes.js';

/**
 * Website / back-office session.
 * ---------------------------------------------------------------------------
 * Covers customers and staff — one session, with `role` deciding what is
 * reachable. This is separate from the POS session (see features/pos/posAuth),
 * which uses a different token family entirely.
 *
 * Session restore: the access token lives only in memory, so a page refresh
 * loses it. On mount we attempt a silent refresh against the httpOnly cookie;
 * if it succeeds the user was never really signed out. Without this, every
 * refresh would dump a signed-in user back at the login screen.
 */

const AuthContext = createContext(null);

/**
 * Roles allowed into the back office.
 *
 * `rider` included: the server lets a rider sign in at the staff portal (they
 * hold `order.view` for their deliveries), and leaving them out here meant a
 * successful sign-in followed straight away by "Access denied". What each
 * person then sees is decided by their permissions, not by this list.
 */
const STAFF_ROLES = new Set(['rider', 'kitchen', 'cashier', 'manager', 'admin', 'super_admin']);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isRestoring, setRestoring] = useState(true);

  // --- Silent restore on mount -------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Shared with the 401 retry path — see refreshSession().
        const data = await refreshSession();
        if (cancelled) return;
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        // No valid cookie — a genuine guest. Not an error worth surfacing.
        if (!cancelled) clearAccessToken();
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * The staff socket follows the session: a new person signing in reconnects
   * it with their token (so they join the rooms their permissions allow), and
   * signing out stops it. The socket is created lazily by the first screen
   * that listens, so a customer never opens one.
   */
  useEffect(() => {
    if (user?.id) reconnectSocket('web');
    else disconnectSocket('web');
    // A kitchen screen stays connected either way (it may be an open screen);
    // it only needs to re-introduce itself with or without the token.
    reconnectSocket('kitchen');
  }, [user?.id]);

  // --- React to the interceptor giving up on a refresh --------------------
  useEffect(() => {
    const onExpired = () => {
      clearAccessToken();
      setUser(null);
    };
    window.addEventListener('fb:session-expired', onExpired);
    return () => window.removeEventListener('fb:session-expired', onExpired);
  }, []);

  const signIn = useCallback(async (credentials) => {
    const data = await apiClient.post('/auth/login', credentials);
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const signUp = useCallback(async (payload) => {
    const data = await apiClient.post('/auth/register', payload);
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Server-side revocation matters: without it the refresh cookie stays
      // valid and "sign out" would only clear local state.
      await apiClient.post('/auth/logout');
    } catch {
      /* Signing out must succeed locally even if the network call fails. */
    }
    clearAccessToken();
    setUser(null);
  }, []);

  /**
   * Re-read the signed-in user from the server.
   * Called after a profile edit — the header renders the name, so without this
   * it would keep showing the old one until the next page load.
   */
  const refreshUser = useCallback(async () => {
    try {
      setUser(await apiClient.get('/auth/me'));
    } catch {
      // Non-fatal: the edit itself already succeeded.
    }
  }, []);

  /**
   * Capability check for the UI.
   *
   * Not a security control — every route is enforced server-side. This exists
   * so the back office renders only the modules a person can actually use;
   * showing an admin a link that always 403s teaches them the UI lies.
   *
   * `'*'` is the super admin's wildcard, so callers never need to know the
   * role hierarchy to answer "can I?".
   */
  const can = useCallback(
    (permission) => {
      const granted = user?.permissions ?? [];
      if (granted.includes('*')) return true;
      // No argument means "any back-office capability at all".
      if (!permission) return granted.length > 0;
      return granted.includes(permission);
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isStaff: Boolean(user && STAFF_ROLES.has(user.role)),
      isSuperAdmin: user?.role === 'super_admin',
      isRestoring,
      can,
      signIn,
      signUp,
      signOut,
      refreshUser,
    }),
    [user, isRestoring, can, signIn, signUp, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * Guard for back-office routes.
 *
 * Waits for the restore attempt to finish before deciding — redirecting while
 * `isRestoring` is true would bounce a signed-in admin to the login page on
 * every refresh, which is the classic bug in this pattern.
 */
export function StaffRoute({ children }) {
  const { isStaff, isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) return <PageLoader label="Restoring session" />;

  if (!isAuthenticated) {
    // The staff portal, not the customer login — a manager deep-linking to a
    // report should land on the form that expects their account, not on a
    // storefront page inviting them to create a shopping account.
    return <Navigate to={ROUTES.STAFF_LOGIN} state={{ from: location.pathname }} replace />;
  }

  // Signed in but not staff — a customer who typed /admin. Send them somewhere
  // that explains the refusal rather than looping them back to a login form
  // they have already completed.
  if (!isStaff) return <Navigate to={ROUTES.UNAUTHORIZED} replace />;

  return children;
}

/**
 * Guard for the Kitchen Display and the Order Board.
 *
 * A signed-in person without `kitchen.view` is told so, rather than bounced to
 * a sign-in form they have already completed. Signing in from here returns to
 * the kitchen screen, not the back office — a wall-mounted screen should come
 * back to itself.
 */
export function KitchenRoute({ children }) {
  const { user, isAuthenticated, isRestoring, can } = useAuth();
  const location = useLocation();

  if (isRestoring) return <PageLoader label="Restoring session" />;
  if (!isAuthenticated) {
    return <Navigate to={ROUTES.STAFF_LOGIN} state={{ from: location.pathname }} replace />;
  }
  // A reset password is replaced first — the server refuses the tickets anyway.
  if (user?.mustChangePassword) return <Navigate to={ROUTES.ADMIN_PROFILE} replace />;
  if (!can('kitchen.view')) return <Navigate to={ROUTES.UNAUTHORIZED} replace />;

  return children;
}

/**
 * Guard for customer-only routes (account area).
 *
 * Same `isRestoring` care as StaffRoute — deciding before the restore attempt
 * finishes bounces a signed-in customer to login on every refresh.
 *
 * Remembers where they were headed, so signing in returns them there rather
 * than dumping them on the homepage.
 */
export function CustomerRoute({ children }) {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) return <PageLoader label="Restoring session" />;

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location.pathname }} replace />;
  }

  return children;
}

export default AuthProvider;
