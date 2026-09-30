import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { apiClient } from '@/services/apiClient.js';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { checkPassword } from '@/lib/passwordRules.js';
import { fadeUp } from '@/lib/motion.js';

/**
 * Set a new password from an emailed link.
 * ---------------------------------------------------------------------------
 * The token and email arrive in the query string. Both are needed: the server
 * looks the token up alongside the address, so a token on its own is useless.
 *
 * Resetting ends every existing session, including any the attacker may hold —
 * that is the whole reason someone resets a password — and the page says so
 * rather than logging people out of their other devices as a surprise.
 */

/** Mirrors the server rule so the user is told before submitting, not after. */
/** Delegates to the shared policy so this screen and registration agree. */
function describeStrength(password) {
  if (!password) return null;
  const { ok, message } = checkPassword(password);
  return { ok, text: ok ? 'Strong enough' : message };
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get('token') ?? '';
  const email = params.get('email') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const strength = describeStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  const redirectTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(redirectTimer.current), []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (mismatch) return;

    setSubmitting(true);
    setError(null);

    try {
      await apiClient.post('/auth/reset-password', { token, email, password });
      setDone(true);
      // A short pause so the confirmation is actually read before the redirect.
      // Tracked so it can be cancelled: navigating away within those 2.5s would
      // otherwise fire a route change from a component that no longer exists,
      // yanking the user off whatever page they had just opened.
      redirectTimer.current = window.setTimeout(() => navigate(ROUTES.LOGIN, { replace: true }), 2500);
    } catch (err) {
      setError(err.message ?? 'Could not reset your password.');
    } finally {
      setSubmitting(false);
    }
  }

  // An incomplete link is a dead end — say so immediately rather than letting
  // someone type a password into a form that cannot possibly submit.
  if (!token || !email) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
          <AlertCircle className="mx-auto h-9 w-9 text-destructive" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">This link is incomplete</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Open the link straight from your email, or request a new one.
          </p>
          <Link
            to={ROUTES.FORGOT_PASSWORD}
            className="mt-5 inline-block text-sm font-medium text-gold hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <motion.div {...fadeUp} className="w-full max-w-md">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-gradient">
            <Flame className="h-6 w-6 text-gold-foreground" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{config.brand.name}</h1>
        </div>

        {done ? (
          <div className="mt-8 rounded-2xl border border-success/40 bg-success/5 p-6 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-success" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">Password changed</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              You have been signed out everywhere else. Taking you to sign in…
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-5 rounded-2xl border border-border bg-surface p-6"
          >
            <div>
              <h2 className="text-lg font-semibold">Choose a new password</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">for {email}</p>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={strength?.text}
              error={strength && !strength.ok && password.length > 3 ? strength.text : undefined}
              required
              autoFocus
            />

            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={mismatch ? 'The two passwords do not match' : undefined}
              required
            />

            <p className="text-xs text-muted-foreground">
              Changing your password signs you out on every other device.
            </p>

            <Button
              type="submit"
              className="w-full"
              isLoading={isSubmitting}
              loadingText="Saving…"
              disabled={!strength?.ok || mismatch}
            >
              Change password
            </Button>

            <Link
              to={ROUTES.LOGIN}
              className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to sign in
            </Link>
          </form>
        )}
      </motion.div>
    </div>
  );
}

export default ResetPasswordPage;
