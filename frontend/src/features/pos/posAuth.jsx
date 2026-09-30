import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { posClient, posSession } from '@/services/apiClient.js';
import { disconnectSocket, reconnectSocket } from '@/services/realtime.js';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { PageLoader } from '@/components/ui/Spinner.jsx';

/**
 * POS terminal session.
 * ---------------------------------------------------------------------------
 * Deliberately its own context, separate from the customer/staff auth state.
 * A terminal is a shared physical device: whoever is signed in at the till is
 * not necessarily whoever is signed in on the website in another tab, and
 * conflating the two would let one sign-out clobber the other.
 *
 * The cashier's identity and the terminal id are decoded from the stored token
 * so a page refresh mid-shift restores the session without a round trip.
 */

const PosAuthContext = createContext(null);

/** Decode a JWT payload without verifying it.
 *  Verification is the server's job — this is only used to render the cashier's
 *  name and to detect an obviously-expired token before making a request. A
 *  tampered token simply fails server-side on the next call. */
function decodeToken(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function PosAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isRestoring, setRestoring] = useState(true);

  // --- Restore an existing terminal session on mount ---------------------
  useEffect(() => {
    const token = posSession.token;
    if (!token) {
      setRestoring(false);
      return;
    }

    const payload = decodeToken(token);
    // `exp` is in seconds; a token that has already expired is discarded here
    // so the UI doesn't flash the till before the first request 401s.
    if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
      posSession.clear();
      setRestoring(false);
      return;
    }

    setSession({
      terminalId: payload.terminal,
      cashierId: payload.sub,
      role: payload.role,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      // The token carries no name, so it is cached alongside at sign-in.
      cashierName: localStorage.getItem('fb-pos-cashier') ?? 'Cashier',
    });
    setRestoring(false);
  }, []);

  // --- React to a server-side session rejection --------------------------
  useEffect(() => {
    const onExpired = () => setSession(null);
    window.addEventListener('fb:pos-session-expired', onExpired);
    return () => window.removeEventListener('fb:pos-session-expired', onExpired);
  }, []);

  const signIn = useCallback(async ({ email, password, terminalId }) => {
    const data = await posClient.post('/auth/pos/login', { email, password, terminalId });

    posSession.save(data.posToken);
    localStorage.setItem('fb-pos-cashier', data.user.fullName);
    localStorage.setItem(config.storageKeys.posTerminal, terminalId);

    const payload = decodeToken(data.posToken);
    setSession({
      terminalId,
      cashierId: data.user.id,
      cashierName: data.user.fullName,
      role: data.user.role,
      expiresAt: payload?.exp ? new Date(payload.exp * 1000) : null,
    });

    return data;
  }, []);

  const signOut = useCallback(() => {
    posSession.clear();
    localStorage.removeItem('fb-pos-cashier');
    setSession(null);
  }, []);

  /*
   * The till's live connection follows the session: a new cashier (a new POS
   * token) reconnects with their token, and signing out closes it, so a
   * signed-out till receives nothing.
   */
  const sessionKey = session ? `${session.terminalId}:${session.cashierId}` : null;
  useEffect(() => {
    if (sessionKey) reconnectSocket('pos');
    else disconnectSocket('pos');
  }, [sessionKey]);

  const value = useMemo(
    () => ({ session, isAuthenticated: Boolean(session), isRestoring, signIn, signOut }),
    [session, isRestoring, signIn, signOut],
  );

  return <PosAuthContext.Provider value={value}>{children}</PosAuthContext.Provider>;
}

export function usePosAuth() {
  const context = useContext(PosAuthContext);
  if (!context) throw new Error('usePosAuth must be used inside <PosAuthProvider>');
  return context;
}

/**
 * Route guard for every screen under /pos.
 *
 * Renders a loader while the stored token is being restored — without this,
 * the first paint has no session yet and the guard would bounce a signed-in
 * cashier to the login screen on every refresh.
 *
 * The redirect remembers where they were headed, so signing in returns them
 * there rather than dumping them on the register.
 */
export function PosProtectedRoute({ children }) {
  const { isAuthenticated, isRestoring } = usePosAuth();
  const location = useLocation();

  if (isRestoring) return <PageLoader label="Restoring terminal session" />;

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.POS_LOGIN} state={{ from: location.pathname }} replace />;
  }

  return children;
}

export default PosAuthProvider;
