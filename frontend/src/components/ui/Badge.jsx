import { cn } from '@/lib/utils.js';

/**
 * Badge — compact status label.
 * ---------------------------------------------------------------------------
 * Used for stock state, order status, roles and offer tags.
 *
 * Every variant pairs a tinted background with a solid border of the same hue.
 * On a near-black canvas a 10%-opacity fill alone is nearly invisible; the
 * border is what makes the badge read as a discrete object.
 *
 * Colour is never the only signal — badges always carry text, so the meaning
 * survives greyscale printing and colour-vision deficiency.
 */

const VARIANTS = {
  default: 'bg-surface-raised text-muted-foreground border-border-strong',
  gold: 'bg-gold/15 text-gold border-gold/40',
  success: 'bg-success/15 text-success border-success/40',
  warning: 'bg-warning/15 text-warning border-warning/40',
  destructive: 'bg-destructive/15 text-destructive border-destructive/40',
  info: 'bg-info/15 text-info border-info/40',
  // Filled variants for when a badge is the loudest thing in its row
  // (e.g. a discount flag sitting on top of a product photo).
  solid: 'bg-gold-gradient text-gold-foreground border-transparent font-semibold',
  'solid-destructive': 'bg-destructive text-destructive-foreground border-transparent font-semibold',
};

const SIZES = {
  sm: 'px-1.5 py-0.5 text-[10px] gap-1',
  md: 'px-2.5 py-0.5 text-xs gap-1.5',
  lg: 'px-3 py-1 text-sm gap-1.5',
};

export function Badge({
  variant = 'default',
  size = 'md',
  className,
  children,
  icon: Icon,
  dot = false,
  ...props
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium leading-none',
        VARIANTS[variant] ?? VARIANTS.default,
        SIZES[size] ?? SIZES.md,
        className,
      )}
      {...props}
    >
      {/* `currentColor` keeps the dot in step with the variant automatically. */}
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}

export default Badge;
