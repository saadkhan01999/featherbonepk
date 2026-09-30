import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, MailCheck, ArrowLeft, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input } from '@/components/ui/Input.jsx';
import { apiClient } from '@/services/apiClient.js';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { fadeUp } from '@/lib/motion.js';

/**
 * Forgot password.
 * ---------------------------------------------------------------------------
 * The confirmation is deliberately vague. "If an account exists for that email"
 * rather than "sent" or "no such account": a form that distinguishes the two
 * becomes a way of discovering who has an account here, one address at a time.
 * The wording is the same whichever happened, and so is the response time.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await apiClient.post('/auth/forgot-password', { email: email.trim() });
      // The API's own wording, not ours — one source of truth for a message
      // whose exact phrasing is a security decision.
      setSent(result?.message ?? true);
    } catch (err) {
      // Only a network or rate-limit failure reaches here; an unknown address
      // is a success as far as this screen is concerned.
      setError(err.message ?? 'Could not send the reset email. Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
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

        {sent ? (
          <div className="mt-8 rounded-2xl border border-border bg-surface p-6 text-center">
            <MailCheck className="mx-auto h-9 w-9 text-success" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">Check your email</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {typeof sent === 'string'
                ? sent
                : 'If an account exists for that email, a reset link is on its way.'}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">The link works once and expires in one hour.</p>
            <Link
              to={ROUTES.LOGIN}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-5 rounded-2xl border border-border bg-surface p-6"
          >
            <div>
              <h2 className="text-lg font-semibold">Reset your password</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the email you signed up with and we&rsquo;ll send you a link.
              </p>
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
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />

            <Button type="submit" className="w-full" isLoading={isSubmitting} loadingText="Sending…">
              Send reset link
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

export default ForgotPasswordPage;
