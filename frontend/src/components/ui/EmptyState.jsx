import { cn } from '@/lib/utils.js';

/**
 * The "there is nothing here" panel.
 * ---------------------------------------------------------------------------
 * Four screens had their own copy, and they said different things about the
 * same situation.
 *
 * The distinction that matters: "you have not added anything yet" and "your
 * filter matched nothing" look identical and need opposite responses. The first
 * wants a button that creates something; the second wants the filters cleared.
 * Conflating them is how a new user ends up staring at "No results" on an empty
 * catalogue, with no idea that the answer is to add a product.
 *
 * So `action` is a prop, and callers are expected to pass a different one for
 * each case.
 */

/**
 * @param {object} props
 * @param {import('react').ElementType} props.icon
 * @param {string} props.title
 * @param {string} [props.body]
 * @param {import('react').ReactNode} [props.action]  A button or link.
 * @param {'default'|'compact'} [props.size]
 */
export function EmptyState({ icon: Icon, title, body, action, size = 'default', className }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-border text-center',
        size === 'compact' ? 'p-8' : 'p-12',
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn('mx-auto text-muted-foreground/40', size === 'compact' ? 'h-8 w-8' : 'h-10 w-10')}
          aria-hidden="true"
        />
      )}

      <h2 className={cn('font-semibold', size === 'compact' ? 'mt-3 text-sm' : 'mt-4')}>{title}</h2>

      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}

      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export default EmptyState;
