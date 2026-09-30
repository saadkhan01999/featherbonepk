import { cn } from '@/lib/utils.js';

/**
 * Card — the standard raised surface.
 * ---------------------------------------------------------------------------
 * Composed from parts (Card / CardHeader / CardTitle / CardContent / CardFooter)
 * rather than driven by props. Composition means an unusual layout is built by
 * rearranging the parts, instead of growing another boolean prop on one
 * do-everything component.
 *
 * `interactive` is opt-in: hover affordances belong only on cards that actually
 * do something when clicked. Applying them everywhere teaches users that hover
 * feedback is meaningless.
 */

export function Card({ className, interactive = false, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface shadow-panel',
        interactive &&
          'cursor-pointer transition-all duration-200 ease-smooth hover:border-gold/40 hover:shadow-elevated',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props}>
      {children}
    </div>
  );
}

/**
 * `as` lets the heading level match the page's document outline. A card title
 * is an <h3> in one context and an <h2> in another; hard-coding the tag would
 * force a choice that is wrong half the time for screen-reader navigation.
 */
export function CardTitle({ className, as: Tag = 'h3', children, ...props }) {
  return (
    <Tag className={cn('text-base font-semibold leading-tight tracking-tight', className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardDescription({ className, children, ...props }) {
  return (
    <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }) {
  return (
    <div className={cn('p-5 pt-0', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }) {
  return (
    <div className={cn('flex items-center gap-3 border-t border-border p-5', className)} {...props}>
      {children}
    </div>
  );
}

export default Card;
