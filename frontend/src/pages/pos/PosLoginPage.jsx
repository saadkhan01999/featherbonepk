import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ScanBarcode, Receipt, Banknote, PackageCheck, ShieldCheck, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, PasswordInput } from '@/components/ui/Input.jsx';
import { usePosAuth } from '@/features/pos/posAuth.jsx';
import { config } from '@/config/env.js';
import { ROUTES } from '@/constants/routes.js';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout.jsx';

/**
 * POS terminal sign-in — the till's own front door.
 * ---------------------------------------------------------------------------
 * Deliberately not the customer login screen:
 *
 *  • It asks for a terminal ID as well as credentials, because every sale must
 *    be attributable to a physical till for the cash drawer to reconcile.
 *  • It hits /auth/pos/login, which rejects non-POS roles outright — a customer
 *    account cannot open a till even with the correct password.
 *  • It offers no "create an account" or "continue with Google": terminal
 *    accounts are issued by the owner, never self-registered.
 *
 * The terminal id is remembered on the device, since a given till keeps its
 * identity across shifts and re-typing it every morning invites typos that
 * would scatter one drawer's takings across several terminal records.
 */
/**
 * What the till does — shown beside the form.
 *
 * Aimed at a cashier on their first shift, not at a buyer. Each line answers
 * "what will I actually be doing on this screen?".
 */
const TILL_CAPABILITIES = [
  {
    icon: ScanBarcode,
    title: 'Scan or tap to build the bill',
    body: 'A barcode gun types straight into the box. No barcode? Tap the item on the grid. Both beep so you can keep your eyes on the customer.',
  },
  {
    icon: Banknote,
    title: 'Take cash, card or JazzCash',
    body: 'Enter what you were handed and the change is worked out for you. Quick buttons cover the common notes.',
  },
  {
    icon: Receipt,
    title: 'Print the slip',
    body: 'An itemised receipt with the weight or count on every line, and a barcode that pulls the sale back up for a return.',
  },
  {
    icon: PackageCheck,
    title: 'Stock keeps itself straight',
    body: 'Every sale comes off the same count the website uses, so the two can never disagree about what is left.',
  },
];

export function PosLoginPage() {
  const { signIn, isAuthenticated } = usePosAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState(() => ({
    email: '',
    password: '',
    /*
     * Remembered per device, because a till is a fixed machine — the cashier
     * should not retype its code every shift.
     *
     * Falls back to empty, not to "TILL-01". A fresh install has no terminals
     * at all until the owner registers them, so a pre-filled code would be
     * wrong on every new system: the cashier presses sign in, gets "TILL-01 is
     * not registered", and has no idea the field was a guess rather than
     * something they or a colleague had set.
     */
    terminalId: localStorage.getItem(config.storageKeys.posTerminal) ?? '',
  }));
  const [error, setError] = useState(null);
  const [isSubmitting, setSubmitting] = useState(false);

  // Already signed in (e.g. opened /pos/login in a second tab) — go straight in.
  useEffect(() => {
    if (isAuthenticated) navigate(ROUTES.POS, { replace: true });
  }, [isAuthenticated, navigate]);

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signIn(form);
      // Return the cashier to wherever the guard intercepted them.
      navigate(location.state?.from ?? ROUTES.POS, { replace: true });
    } catch (err) {
      setError(err.message ?? 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSplitLayout
      eyebrow="Point of Sale"
      title="The counter till."
      blurb="Sign in with your staff account and the code of the till you are standing at. Authorised personnel only."
      features={TILL_CAPABILITIES}
      footnote="This session is separate from your website account and lasts one shift. Do not know your till code? It is on the terminal, or ask a manager to check POS Management."
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border-strong bg-surface-raised p-6 shadow-overlay sm:p-7"
      >
        <p className="text-sm text-muted-foreground">Staff sign-in — authorised personnel only.</p>

        {/* role="alert" so a screen reader announces the failure; a purely
            visual red border would be silent. */}
        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="mt-5 space-y-4">
          <Input
            label="Staff Email"
            type="email"
            autoComplete="username"
            placeholder="you@yourbusiness.com"
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

          <Input
            label="Terminal ID"
            placeholder="TILL-01"
            value={form.terminalId}
            onChange={update('terminalId')}
            hint="Identifies this till. Every sale and cash count is recorded against it."
            required
          />
        </div>

        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-5"
          isLoading={isSubmitting}
          loadingText="Opening terminal…"
        >
          Sign In to Terminal
        </Button>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          This session is separate from your website account
        </p>
      </form>
    </AuthSplitLayout>
  );
}

export default PosLoginPage;
