import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, AlertCircle, Check } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, PasswordInput } from '@/components/ui/Input.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { modalContent } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';
import { checkPassword, passwordChecklist } from '@/lib/passwordRules.js';

/**
 * Create account — screen 08 in the reference design.
 * ---------------------------------------------------------------------------
 * The password rules are shown as a live checklist rather than as an error
 * after submitting. The server enforces the same five rules; mirroring them
 * here means the user is told what is required while they type instead of
 * being rejected once they think they are finished.
 */

/** Mirrors the server-side policy in auth.validation.js exactly. */
export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isSubmitting, setSubmitting] = useState(false);

  const update = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  // The shared password policy — see lib/passwordRules.js.
  const checklist = passwordChecklist(form.password);
  const isPasswordValid = checkPassword(form.password).ok;

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    /*
     * Validate here before spending a round trip.
     *
     * `noValidate` is on the form deliberately — the browser's own bubbles
     * cannot be styled and appear one at a time — but turning it off left no
     * check on name, email or phone at all. Every typo travelled to the server
     * and came back as a red banner, which on a slow connection is several
     * seconds to learn that an "@" is missing. These mirror the server's rules;
     * the server still enforces them.
     */
    const errors = {};

    if (form.fullName.trim().length < 2) {
      errors.fullName = 'Enter your full name';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = 'Enter a valid email address';
    }
    // Optional — but if given, it must be a Pakistani mobile, matching the API.
    if (form.phone.trim() && !/^03\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) {
      errors.phone = 'Enter a valid mobile number (03XXXXXXXXX)';
    }
    if (!isPasswordValid) {
      errors.password = checkPassword(form.password).message ?? 'Choose a stronger password';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      await signUp({
        fullName: form.fullName,
        email: form.email,
        // Phone is optional server-side; omit rather than send an empty string,
        // which would fail the format check instead of being skipped.
        ...(form.phone.trim() && { phone: form.phone }),
        password: form.password,
      });
      navigate(ROUTES.HOME, { replace: true });
    } catch (err) {
      if (Array.isArray(err.details)) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      }
      setError(err.message ?? 'Could not create your account');
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
        noValidate
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

          <h2 className="mt-6 text-xl font-semibold">Create Your Account</h2>
          <p className="text-sm text-muted-foreground">Join {config.brand.name}</p>
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
            label="Full Name"
            placeholder="Enter your full name"
            autoComplete="name"
            value={form.fullName}
            onChange={update('fullName')}
            error={fieldErrors.fullName}
            required
            autoFocus
          />
          <Input
            label="Email Address"
            type="email"
            placeholder="Enter your email"
            autoComplete="email"
            value={form.email}
            onChange={update('email')}
            error={fieldErrors.email}
            required
          />
          <Input
            label="Phone Number"
            placeholder="03XX XXXXXXX"
            autoComplete="tel"
            inputMode="numeric"
            value={form.phone}
            onChange={update('phone')}
            error={fieldErrors.phone}
            hint="Optional — helps us reach you about deliveries."
          />
          <PasswordInput
            label="Password"
            placeholder="Create a password"
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
            error={fieldErrors.password}
          />
        </div>

        {/* Live requirements checklist. Only shown once typing starts, so an
            untouched form isn't a wall of red. */}
        {form.password.length > 0 && (
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Password requirements">
            {checklist.map((rule) => {
              const ok = rule.met;
              return (
                <li
                  key={rule.key}
                  className={cn(
                    'flex items-center gap-1.5 text-[11px]',
                    ok ? 'text-success' : 'text-muted-foreground',
                  )}
                >
                  <Check className={cn('h-3 w-3 shrink-0', !ok && 'opacity-30')} aria-hidden="true" />
                  {rule.label}
                </li>
              );
            })}
          </ul>
        )}

        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-6"
          isLoading={isSubmitting}
          loadingText="Creating account…"
        >
          Sign Up
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to={ROUTES.LOGIN} className="font-medium text-gold hover:underline">
            Login
          </Link>
        </p>
      </motion.form>
    </div>
  );
}

export default RegisterPage;
