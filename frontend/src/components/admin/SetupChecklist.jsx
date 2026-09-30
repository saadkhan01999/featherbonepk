import { Link } from 'react-router-dom';
import { Check, ArrowRight, Rocket } from 'lucide-react';

import { ROUTES } from '@/constants/routes.js';
import { cn } from '@/lib/utils.js';

/**
 * What to do first, on a shop that has nothing in it yet.
 * ---------------------------------------------------------------------------
 * A brand-new install used to open on a dashboard reading "0 live items across
 * 0 categories", Rs 0 on every tile, four empty charts, and — apart from the
 * date filter — not one button. Everything on screen described a business that
 * did not exist yet, and nothing said what to do about it. The owner's very
 * first impression of the software was a dead end.
 *
 * So the same screen now leads with the five things that have to happen, in the
 * order they have to happen, each linking to the page that does it.
 *
 * It disappears when it is done. A permanent "getting started" panel becomes
 * furniture — something long-time users scroll past forever. This unmounts on
 * the day the last step is finished and is never seen again.
 *
 * The order is a dependency order, not a preference. Products need a category
 * to live in; a till needs something to sell; staff need a till to stand at.
 * Presenting them in any other sequence sends people into a form that will
 * reject them.
 */

/**
 * @param {object} props
 * @param {object} props.setup Counts from the dashboard's `setup` block.
 */
export function SetupChecklist({ setup }) {
  if (!setup) return null;

  const steps = [
    {
      done: setup.categories > 0,
      title: 'Create your first category',
      body: 'Sections of your menu — Roast, Bakery, Drinks. Products live inside one.',
      to: ROUTES.ADMIN_CATEGORIES,
      cta: 'Add a category',
    },
    {
      done: setup.products > 0,
      title: 'Add something to sell',
      body: 'Name, price and a photo. Choose whether it appears on the website, the till, or both.',
      to: ROUTES.ADMIN_PRODUCTS,
      cta: 'Add a product',
    },
    {
      done: setup.businessConfigured,
      title: 'Fill in your business details',
      body: 'Your address and phone number. These print on every receipt and show on the contact page.',
      to: ROUTES.ADMIN_SETTINGS,
      cta: 'Open settings',
    },
    {
      done: setup.terminals > 0,
      title: 'Register a till',
      body: 'Each counter needs a terminal code. Staff type it when they sign in at the POS.',
      to: ROUTES.ADMIN_POS_MANAGEMENT,
      cta: 'Add a till',
    },
    {
      done: setup.staff > 0,
      title: 'Add your staff',
      body: 'Cashiers and managers. They sign in with the email and password you set here.',
      to: ROUTES.ADMIN_USERS,
      cta: 'Add a person',
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  if (completed === steps.length) return null;

  // The first unfinished step is the one to emphasise; the rest stay quiet, so
  // the panel reads as "do this next" rather than as five competing demands.
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <section
      aria-labelledby="setup-heading"
      className="overflow-hidden rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/[0.07] to-transparent"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-gold/20 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold">
          <Rocket className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 id="setup-heading" className="font-semibold">
            Let’s get your shop open
          </h2>
          <p className="text-sm text-muted-foreground">
            {completed === 0
              ? 'Five steps. Ten minutes. This panel disappears when you are done.'
              : `${completed} of ${steps.length} done — keep going.`}
          </p>
        </div>

        {/* A plain count, not a progress bar: five items is small enough that a
            bar is decoration, and the number is easier to read at a glance. */}
        <span className="rounded-full bg-gold/15 px-3 py-1 text-sm font-semibold tabular-nums text-gold">
          {completed}/{steps.length}
        </span>
      </header>

      <ol className="divide-y divide-border/60">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={cn(
              'flex flex-wrap items-center gap-3 px-5 py-3.5',
              step.done && 'opacity-55',
              index === nextIndex && 'bg-gold/[0.04]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                step.done
                  ? 'bg-success/15 text-success'
                  : index === nextIndex
                    ? 'bg-gold text-gold-foreground'
                    : 'border border-border-strong text-muted-foreground',
              )}
            >
              {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>

            <div className="min-w-0 flex-1">
              <p className={cn('font-medium', step.done && 'line-through')}>{step.title}</p>
              {!step.done && <p className="text-sm text-muted-foreground">{step.body}</p>}
            </div>

            {step.done ? (
              // "Done" is stated in words as well as by the tick — a colour and
              // a glyph alone say nothing to a screen reader.
              <span className="text-sm text-success">Done</span>
            ) : (
              <Link
                to={step.to}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  index === nextIndex
                    ? 'bg-gold-gradient text-gold-foreground hover:opacity-90'
                    : 'border border-border-strong hover:bg-surface-hover',
                )}
              >
                {step.cta}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default SetupChecklist;
