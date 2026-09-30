import { Link } from 'react-router-dom';
import { ChefHat, Monitor, Tv, Globe } from 'lucide-react';

import { SettingsEditor } from '@/components/admin/settings/SettingsEditor.jsx';
import { ROUTES } from '@/constants/routes.js';

/**
 * Settings — how the business runs.
 * ---------------------------------------------------------------------------
 * Tax, counter payments, the till (order types, quick-cash notes, receipt
 * layout — including the bold/large print that thermal printers need), the
 * kitchen flow and its timers, delivery and order rules.
 *
 * Everything the customer reads (logo, colours, homepage, About, Contact,
 * footer, social links) is in Website Management instead. Both screens edit the
 * same settings store and both are rendered from the server's registry — see
 * SettingsEditor. Every save is pushed live to open tills, kitchen screens and
 * the website.
 */

const ORDER = ['tax', 'pos', 'kitchen', 'display', 'payments', 'delivery', 'orders'];

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Tax, tills, receipts, the kitchen and delivery. Saved changes reach every open till and kitchen
            screen within a second — no reload.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <QuickLink to={ROUTES.ADMIN_POS_MANAGEMENT} icon={Monitor}>
            Tills &amp; menus
          </QuickLink>
          <QuickLink href={ROUTES.KITCHEN} icon={ChefHat}>
            Kitchen Display
          </QuickLink>
          <QuickLink href={ROUTES.ORDER_BOARD} icon={Tv}>
            Order Board
          </QuickLink>
          <QuickLink to={ROUTES.ADMIN_WEBSITE} icon={Globe}>
            Website &amp; theme
          </QuickLink>
        </div>
      </header>

      <SettingsEditor
        group="operations"
        order={ORDER}
        extras={{
          display: (
            <p className="mx-5 mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 px-3 py-2.5 text-xs text-muted-foreground">
              <Tv className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
              <span>
                The screen at <strong className="text-foreground">/display</strong> — open it on the counter
                TV and press full screen. Changes appear on it within a second.{' '}
                <a
                  href={ROUTES.ORDER_BOARD}
                  target="_blank"
                  rel="noopener"
                  className="text-gold hover:underline"
                >
                  Open the Order Board
                </a>
              </span>
            </p>
          ),
        }}
      />
    </div>
  );
}

function QuickLink({ to, href, icon: Icon, children }) {
  const className =
    'flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-muted-foreground transition-colors hover:border-gold/50 hover:text-foreground';
  return href ? (
    <a href={href} target="_blank" rel="noopener" className={className}>
      <Icon className="h-4 w-4 text-gold" aria-hidden="true" />
      {children}
    </a>
  ) : (
    <Link to={to} className={className}>
      <Icon className="h-4 w-4 text-gold" aria-hidden="true" />
      {children}
    </Link>
  );
}

export default SettingsPage;
