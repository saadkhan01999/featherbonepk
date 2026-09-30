import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Flame, Loader2 } from 'lucide-react';

import { apiClient } from '@/services/apiClient.js';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { fadeUp } from '@/lib/motion.js';

/**
 * Confirm an email address from the emailed link (/verify-email?token=…&email=…).
 * Runs once on arrival; the token is single-use, so a second request (React's
 * development double-render) must not be sent.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const email = params.get('email') ?? '';
  const [state, setState] = useState(token && email ? 'working' : 'incomplete');
  const [message, setMessage] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (!token || !email || sent.current) return;
    sent.current = true;
    apiClient
      .post('/auth/verify-email', { token, email })
      .then(() => setState('done'))
      .catch((err) => {
        setMessage(err.message ?? 'This link has expired or was already used.');
        setState('failed');
      });
  }, [token, email]);

  const view = {
    working: {
      icon: <Loader2 className="mx-auto h-9 w-9 animate-spin text-gold" aria-hidden="true" />,
      title: 'Confirming your email…',
      body: email,
    },
    done: {
      icon: <CheckCircle2 className="mx-auto h-9 w-9 text-success" aria-hidden="true" />,
      title: 'Email confirmed',
      body: `${email} is verified. Order updates will reach you there.`,
    },
    failed: {
      icon: <AlertCircle className="mx-auto h-9 w-9 text-destructive" aria-hidden="true" />,
      title: 'This link did not work',
      body: `${message} (Send a fresh link from My Account → Security.)`,
    },
    incomplete: {
      icon: <AlertCircle className="mx-auto h-9 w-9 text-destructive" aria-hidden="true" />,
      title: 'This link is incomplete',
      body: 'Open the link straight from your email, or send a new one from your account.',
    },
  }[state];

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <motion.div {...fadeUp} className="w-full max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-gradient">
          <Flame className="h-6 w-6 text-gold-foreground" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{config.brand.name}</h1>

        <div className="mt-8 rounded-2xl border border-border bg-surface p-6" role="status">
          {view.icon}
          <h2 className="mt-4 text-lg font-semibold">{view.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{view.body}</p>
          {state !== 'working' && (
            <div className="mt-5 flex justify-center gap-4 text-sm font-medium">
              <Link to={ROUTES.ACCOUNT} className="text-gold hover:underline">
                My account
              </Link>
              <Link to={ROUTES.HOME} className="text-muted-foreground hover:text-foreground">
                Back to the shop
              </Link>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default VerifyEmailPage;
