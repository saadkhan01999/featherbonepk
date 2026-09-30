import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, PasswordInput, Checkbox } from '@/components/ui/Input.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { modalContent } from '@/lib/motion.js';

/**
 * Customer sign-in.
 * ---------------------------------------------------------------------------
 * One of three doors, each with its own address and its own form:
 *
 *   /login        customers — this page
 *   /admin/login  staff     — the back office portal
 *   /pos/login    tills     — cashier + terminal code, separate token family
 *
 * This one is shaped for shoppers: it offers "create an account", because
 * customers sign themselves up. The staff portal offers no such thing, because
 * staff accounts are created by the owner in User Management.
 */
export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '', rememberMe: false });
  const [error, setError] = useState(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const update = (field) => (event) =>
    setForm((prev) => ({
      ...prev,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // `scope: 'customer'` makes the server turn a staff account away here,
      // with a message pointing at the staff portal — better than signing a
      // manager in on the storefront and leaving them to find the dashboard.
      const account = await signIn({ ...form, scope: 'customer' });

      // An administrator can reset a customer's password too, and the server
      // refuses everything else until it is replaced — so the security page is
      // the only destination that will actually load.
      if (account?.mustChangePassword) {
        navigate(ROUTES.ACCOUNT_SECURITY, { replace: true });
        return;
      }

      // Only customers reach this line, so the destination is the storefront —
      // or wherever they were headed before the guard intercepted them.
      navigate(location.state?.from ?? ROUTES.HOME, { replace: true });
    } catch (err) {
      setError(err.message ?? 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-gold/10 blur-[130px]"
      />

      <motion.form
        {...modalContent}
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-2xl border border-border-strong bg-surface-raised p-8 shadow-overlay"
      >
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-gradient shadow-gold">
            <Flame className="h-7 w-7 text-gold-foreground" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{config.brand.name}</h1>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Roast · Meat · Sweets · Bakery
          </p>

          <h2 className="mt-6 text-xl font-semibold">Welcome Back!</h2>
          <p className="text-sm text-muted-foreground">Login to your account</p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="mt-6 space-y-4">
          <Input
            label="Email Address"
            type="email"
            autoComplete="username"
            placeholder="Enter your email"
            value={form.email}
            onChange={update('email')}
            required
            autoFocus
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={form.password}
            onChange={update('password')}
            required
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Checkbox label="Remember me" checked={form.rememberMe} onChange={update('rememberMe')} />
          <Link to={ROUTES.FORGOT_PASSWORD} className="text-sm text-gold hover:underline">
            Forgot Password?
          </Link>
        </div>

        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-6"
          isLoading={isSubmitting}
          loadingText="Signing in…"
        >
          Login
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link to={ROUTES.REGISTER} className="font-medium text-gold hover:underline">
            Sign Up
          </Link>
        </p>

        {/* Quiet, and below the fold of attention: staff know to look for it,
            customers have no reason to read it. */}
        <p className="mt-4 border-t border-border pt-4 text-center text-xs text-muted-foreground">
          Staff member?{' '}
          <Link to={ROUTES.STAFF_LOGIN} className="text-gold hover:underline">
            Sign in to the dashboard
          </Link>
        </p>
      </motion.form>
    </div>
  );
}

export default LoginPage;
