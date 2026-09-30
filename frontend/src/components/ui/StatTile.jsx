import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';

import { staggerItem } from '@/lib/motion.js';
import { cn } from '@/lib/utils.js';

/**
 * A headline figure with a label and an icon.
 * ---------------------------------------------------------------------------
 * Four pages had grown their own `Tile` — Dashboard, Finance, Inventory and
 * Staff — with converging props and diverging spacing, so the same figure sat
 * at a different height depending on which screen you were on.
 *
 * The tone names are semantic (`success`, `destructive`) rather than colours,
 * so a theme change lands in one file instead of four.
 */

const TONES = {
  gold: 'bg-gold/10 text-gold',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  muted: 'bg-surface-hover text-muted-foreground',
};

/**
 * @param {object} props
 * @param {import('react').ElementType} props.icon
 * @param {string} props.label
 * @param {string|number} props.value
 * @param {string} [props.hint]      Small print under the figure.
 * @param {number} [props.delta]     Percentage change; sign drives the arrow.
 * @param {keyof TONES} [props.tone]
 * @param {boolean} [props.animate]  Stagger in as part of a list.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  tone = 'gold',
  animate = true,
  className,
}) {
  const Wrapper = animate ? motion.article : 'article';
  const motionProps = animate ? { variants: staggerItem } : {};

  return (
    <Wrapper {...motionProps} className={cn('rounded-2xl border border-border bg-surface p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {/* `tabular-nums` so a figure updating in place does not shuffle
              sideways as digits change width. */}
          <p className="mt-1.5 truncate text-2xl font-bold tabular-nums">{value}</p>

          {typeof delta === 'number' && (
            <p
              className={cn(
                'mt-1 flex items-center gap-1 text-xs font-medium',
                delta >= 0 ? 'text-success' : 'text-destructive',
              )}
            >
              {delta >= 0 ? (
                <TrendingUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <TrendingDown className="h-3 w-3" aria-hidden="true" />
              )}
              {Math.abs(delta)}%
            </p>
          )}

          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>

        {Icon && (
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              TONES[tone] ?? TONES.gold,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
      </div>
    </Wrapper>
  );
}

export default StatTile;
