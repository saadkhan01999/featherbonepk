import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils.js';

/**
 * Button — the primary interactive primitive.
 * ---------------------------------------------------------------------------
 * Variants encode meaning, not just colour, so the visual weight of an action
 * always matches its consequence:
 *
 *   primary     the one main action on a screen (gold — brand + affordance)
 *   secondary   supporting actions
 *   outline     tertiary / cancel
 *   ghost       toolbar and icon actions
 *   destructive irreversible (delete, refund, clear cart)
 *
 * Accessibility: while loading the button is disabled and marked aria-busy, and
 * the spinner replaces the icon rather than the label — a screen-reader user
 * keeps the label, and a sighted user keeps the button's width, so the layout
 * doesn't jump mid-submit.
 */

const VARIANTS = {
  // Gradient + dark text: gold is a light colour, so white-on-gold would fail
  // contrast. The gold shadow on hover reads as a lift without a size change.
  primary:
    'bg-gold-gradient text-gold-foreground font-semibold shadow-panel hover:shadow-gold hover:brightness-105 active:brightness-95',
  secondary: 'bg-surface-raised text-foreground border border-border-strong hover:bg-surface-hover',
  outline: 'border border-border-strong bg-transparent text-foreground hover:bg-surface-hover',
  ghost: 'bg-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground font-medium hover:brightness-110',
  success: 'bg-success text-success-foreground font-medium hover:brightness-110',
  // Looks like a link but behaves like a button (still keyboard-focusable).
  link: 'bg-transparent text-gold underline-offset-4 hover:underline p-0 h-auto',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2 rounded-lg',
  // Square sizes for icon-only buttons — a rectangular icon button looks broken.
  icon: 'h-10 w-10 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-md',
  // Deliberately oversized for the till: a cashier taps these at speed, often
  // without looking, so the target is far larger than the web default.
  pos: 'h-14 px-6 text-base gap-2 rounded-xl font-semibold',
};

/**
 * `as` renders the same styling on another element — `as={Link} to="/menu"`,
 * or `as="a" href="…"`.
 */
export const Button = forwardRef(function Button(
  {
    as: Component = 'button',
    variant = 'primary',
    size = 'md',
    className,
    children,
    isLoading = false,
    loadingText,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    fullWidth = false,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || isLoading;
  const isNativeButton = Component === 'button';

  return (
    <Component
      ref={ref}
      // Defaulting to "button" is deliberate: HTML defaults to "submit", which
      // makes any unlabelled button inside a form submit it by accident.
      {...(isNativeButton ? { type, disabled: isDisabled } : { 'aria-disabled': isDisabled || undefined })}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap',
        'transition-all duration-200 ease-smooth',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        // `pointer-events-none` stops hover styles firing on a disabled control.
        'disabled:pointer-events-none disabled:opacity-50',
        !isNativeButton && isDisabled && 'pointer-events-none opacity-50',
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size] ?? SIZES.md,
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        LeftIcon && <LeftIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}

      {isLoading && loadingText ? loadingText : children}

      {!isLoading && RightIcon && <RightIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </Component>
  );
});

export default Button;
