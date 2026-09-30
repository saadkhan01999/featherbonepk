import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Monitor,
  LayoutDashboard,
  Package,
  Users,
  BarChart3,
  Globe,
} from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { Input, PasswordInput } from '@/components/ui/Input.jsx';
import { useAuth } from '@/features/auth/authContext.jsx';
import { ROUTES } from '@/constants/routes.js';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout.jsx';

/**
 * Staff portal sign-in.
 * ---------------------------------------------------------------------------
 * The third of three doors, each with its own address and its own form:
 *
 *   /login       customers  — storefront, orders, wishlist
 *   /admin/login staff      — this page
 *   /pos/login   tills      — cashier + terminal code, separate token family
 *
 * Why split at all, when one form and a role-based redirect also worked?
 * Because the two audiences need different things from the page. A customer
 * form must offer "create an account" and "continue shopping"; a staff form
 * must offer neither — there is no self-service staff registration, and an
 * account is something the owner creates in User Management. Putting a
 * prominent "Sign Up" link on a staff portal invites the wrong action, and
 * putting none on the customer form loses a sale.
 *
 * It also removes the guessing: someone handed a URL and a password knows which
 * page is theirs, instead of trying the storefront login and wondering why they
 * landed on a menu.
 *
 * No sign-up. No role picker. No seeded credentials on screen. The form asks
 * for an email and a password and nothing else — a "role" dropdown here would
 * both leak the shape of the organisation and be meaningless, since the server
 * decides what an account can do from its permissions.
 */
/**
 * What the back office actually does — shown beside the form.
 *
 * Deliberately concrete. "Powerful analytics" tells a new manager nothing;
 * "today's takings, split between the website and each counter" tells them
 * whether this is the screen they were sent to find.
 */
const CAPABILITIES = [
  {
    icon: LayoutDashboard,
    title: 'See the business at a glance',
    body: "Today's takings split between the website and each counter, with the week and month beside them.",
  },
  {
    icon: Package,
    title: 'Run the menu and the stock',
    body: 'Add items and categories, set prices, upload photos, and watch stock fall as it sells — online and at the till, from one count.',
  },
  {
    icon: Globe,
    title: 'Edit the website itself',
    body: 'Change the homepage banner, the story video and the About page, and schedule offers that start and expire on their own.',
  },
  {
    icon: Users,
    title: 'Create staff and decide what they can touch',
    body: 'Every account gets exactly the permissions you tick — a cashier never sees your revenue.',
  },
  {
    icon: BarChart3,
    title: 'Report on any of it',
    body: 'Sales, products, categories, payment methods and profit — filtered by date or counter, and exportable.',
  },
];

export function StaffLoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // `scope: 'staff'` makes the server reject a customer account here with a
      // message that points them at the right page, rather than signing them in
      // and dropping them on a dashboard where every panel is empty.
      const account = await signIn({ ...form, scope: 'staff' });

      /*
       * A reset password goes straight to the security page.
       *
       * The server refuses every other request from this account until the
       * password is replaced, so sending them to the dashboard would render a
       * screen where each panel fails in turn. This is a convenience on top of
       * that rule, not the rule itself — the enforcement is in auth.middleware,
       * where a client cannot skip it.
       */
      if (account?.mustChangePassword) {
        navigate(ROUTES.ADMIN_PROFILE, { replace: true });
        return;
      }

      // `from` is set by the route guard when someone deep-links to a back
      // office page (or the kitchen screen) while signed out, so they resume
      // where they were headed. A kitchen account's home is the Kitchen Display.
      const home = account?.role === 'kitchen' ? ROUTES.KITCHEN : ROUTES.ADMIN;
      navigate(location.state?.from ?? home, { replace: true });
    } catch (err) {
      setError(err.message ?? 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSplitLayout
      eyebrow="Staff Portal"
      title="Everything the shop runs on, in one place."
      blurb="Sign in with the account your administrator created for you. You will see only the parts you have been given access to."
      features={CAPABILITIES}
      footnote="Do not have an account? They are created by the owner in User Management — ask them to add you rather than registering yourself."
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border-strong bg-surface-raised p-6 shadow-overlay sm:p-7"
      >
        <p className="text-sm text-muted-foreground">Sign in to the back office.</p>

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
            label="Work email"
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
        </div>

        {/*
          No "remember me". A back-office session left open on a shared office
          machine is a different risk from a customer staying signed in to browse
          a menu, and the refresh cookie already spans a normal shift.
        */}
        <div className="mt-4 flex justify-end">
          <Link to={ROUTES.FORGOT_PASSWORD} className="text-sm text-gold hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-5"
          isLoading={isSubmitting}
          loadingText="Signing in…"
        >
          Sign in to dashboard
        </Button>

        <div className="mt-5 space-y-2 border-t border-border pt-4 text-center text-sm">
          <p>
            <Link
              to={ROUTES.POS_LOGIN}
              className="inline-flex items-center gap-1.5 font-medium text-gold hover:underline"
            >
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
              Working a till? Open the POS
            </Link>
          </p>
          <p>
            <Link
              to={ROUTES.HOME}
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to the website
            </Link>
          </p>
        </div>
      </form>
    </AuthSplitLayout>
  );
}

export default StaffLoginPage;
